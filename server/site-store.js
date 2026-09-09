'use strict';

/**
 * 静态站点仓储：data/sites/<站点名>/ 一个文件夹就是一个可独立访问的静态网页。
 *
 * 这个模块只负责「磁盘上的站点」，不涉及 HTTP 托管（见 server/site-hosting.js）。
 * 安全要点：
 *   1. 站点名与站内相对路径都经过严格白名单校验，解析后的绝对路径必须仍在站点目录内；
 *   2. zip 解压逐条校验条目路径（防 zip-slip）、跳过符号链接、限制条目数与体积（防 zip 炸弹）；
 *   3. 单文件、单个压缩包与整站体积都有上限；
 *   4. site.json 是站点配置，读取时做归一化，托管时不对外提供。
 */

const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { Transform } = require('stream');
const { pipeline } = require('stream/promises');
const yauzl = require('yauzl');
const { SITES_DIR, SITES_MAX_FILE_BYTES, SITES_MAX_ARCHIVE_BYTES, SITES_MAX_TOTAL_BYTES } = require('./config');

const SITE_CONFIG_FILE = 'site.json';
const SITE_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,39}$/;
// 这些名字会与授权回调等内部路径冲突，禁止用作站点名。
const RESERVED_SITE_NAMES = new Set(['__site-auth', '__site', 'api', 'login', 'logout', 'admin', 'well-known']);
const MAX_PATH_LENGTH = 400;
const MAX_SEGMENT_LENGTH = 120;
const MAX_PATH_DEPTH = 12;
const MAX_ARCHIVE_ENTRIES = 5000;
const TEMP_DIR = path.join(SITES_DIR, '.tmp');

class SiteStoreError extends Error {
  constructor(message, statusCode = 400) { super(message); this.name = 'SiteStoreError'; this.statusCode = statusCode; }
}

// ---------- 校验 ----------

function normalizeSiteName(value) {
  const name = String(value || '').trim().toLowerCase();
  if (!SITE_NAME_PATTERN.test(name)) throw new SiteStoreError('站点名只能使用小写字母、数字、连字符和下划线，需以字母或数字开头，最长 40 个字符。');
  if (RESERVED_SITE_NAMES.has(name)) throw new SiteStoreError(`「${name}」是保留名称，请换一个站点名。`);
  return name;
}

/**
 * 站内相对路径归一化：统一为 posix 分隔符，拒绝任何可能跳出站点目录的写法。
 * 同时用于上传接口和 zip 条目，保证两条入口的校验完全一致。
 */
function normalizeRelativePath(value) {
  let raw = String(value || '');
  try { raw = decodeURIComponent(raw); } catch { /* 原样使用，后面的字符校验会拦住异常内容 */ }
  raw = raw.replace(/\\/g, '/').trim();
  while (raw.startsWith('./')) raw = raw.slice(2);
  if (!raw) throw new SiteStoreError('文件路径不能为空。');
  if (raw.startsWith('/') || /^[a-zA-Z]:/.test(raw)) throw new SiteStoreError('文件路径必须是相对路径。');
  if (raw.includes('\0') || /[\x00-\x1f]/.test(raw)) throw new SiteStoreError('文件路径包含非法字符。');
  if (raw.length > MAX_PATH_LENGTH) throw new SiteStoreError(`文件路径过长（上限 ${MAX_PATH_LENGTH} 个字符）。`);

  const segments = raw.split('/').filter((segment) => segment !== '');
  if (!segments.length) throw new SiteStoreError('文件路径无效。');
  if (segments.length > MAX_PATH_DEPTH) throw new SiteStoreError(`目录层级过深（上限 ${MAX_PATH_DEPTH} 层）。`);
  for (const segment of segments) {
    if (segment === '.' || segment === '..') throw new SiteStoreError('文件路径不允许包含 . 或 .. 片段。');
    if (segment.length > MAX_SEGMENT_LENGTH) throw new SiteStoreError('文件名过长。');
    if (/[<>:"|?*]/.test(segment)) throw new SiteStoreError('文件名包含非法字符。');
    if (segment.endsWith('.') || segment.endsWith(' ')) throw new SiteStoreError('文件名不能以点或空格结尾。');
  }
  return segments.join('/');
}

function siteDir(name) { return path.join(SITES_DIR, normalizeSiteName(name)); }

/** 解析站内文件的绝对路径，并二次确认它没有跳出站点目录。 */
function resolveInsideSite(name, relativePath) {
  const root = siteDir(name);
  const safeRelative = normalizeRelativePath(relativePath);
  const absolute = path.resolve(root, safeRelative);
  if (absolute !== root && !absolute.startsWith(root + path.sep)) throw new SiteStoreError('文件路径超出站点目录。');
  return { root, relativePath: safeRelative, absolute };
}

// ---------- 配置 ----------

function normalizeConfig(value, fallbackTitle) {
  const raw = (value && typeof value === 'object' && !Array.isArray(value)) ? value : {};
  const title = typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim().slice(0, 80) : fallbackTitle;
  const visibility = raw.visibility === 'authenticated' ? 'authenticated' : 'public';
  const cacheSeconds = Number.isFinite(Number(raw.cacheSeconds)) ? Math.min(Math.max(Math.trunc(Number(raw.cacheSeconds)), 0), 31536000) : 0;
  let notFoundPage = '404.html';
  if (typeof raw.notFoundPage === 'string' && raw.notFoundPage.trim()) {
    try { notFoundPage = normalizeRelativePath(raw.notFoundPage); } catch { notFoundPage = '404.html'; }
  }
  return {
    title,
    visibility,
    spaFallback: raw.spaFallback === true,
    notFoundPage,
    cacheSeconds,
  };
}

async function readConfig(name) {
  const site = normalizeSiteName(name);
  try {
    const raw = await fsp.readFile(path.join(siteDir(site), SITE_CONFIG_FILE), 'utf8');
    return normalizeConfig(JSON.parse(raw), site);
  } catch {
    // 缺失或损坏的 site.json 一律回落到默认配置，不影响站点访问。
    return normalizeConfig(null, site);
  }
}

async function writeConfig(name, patch) {
  const site = normalizeSiteName(name);
  await ensureSiteExists(site);
  const current = await readConfig(site);
  const next = normalizeConfig({ ...current, ...(patch && typeof patch === 'object' ? patch : {}) }, site);
  await fsp.writeFile(path.join(siteDir(site), SITE_CONFIG_FILE), `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return next;
}

// ---------- 站点列表与统计 ----------

async function ensureRootDirectory() { await fsp.mkdir(SITES_DIR, { recursive: true }); }

async function siteExists(name) {
  try { return (await fsp.stat(siteDir(name))).isDirectory(); } catch { return false; }
}

async function ensureSiteExists(name) {
  if (!(await siteExists(name))) throw new SiteStoreError('站点不存在。', 404);
}

/** 递归统计站点文件数、总体积与最近修改时间；同时用于体积上限校验。 */
async function collectStats(directory) {
  let fileCount = 0;
  let totalBytes = 0;
  let updatedAt = 0;
  async function walk(current) {
    const entries = await fsp.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) { await walk(full); continue; }
      if (!entry.isFile()) continue; // 忽略符号链接等特殊条目
      const stat = await fsp.stat(full);
      fileCount += 1;
      totalBytes += stat.size;
      updatedAt = Math.max(updatedAt, stat.mtimeMs);
    }
  }
  try { await walk(directory); } catch { /* 目录不存在时返回空统计 */ }
  return { fileCount, totalBytes, updatedAt };
}

async function siteSummary(name) {
  const site = normalizeSiteName(name);
  const root = siteDir(site);
  const [config, stats] = await Promise.all([readConfig(site), collectStats(root)]);
  const hasIndex = fs.existsSync(path.join(root, 'index.html'));
  return {
    name: site,
    config,
    fileCount: stats.fileCount,
    totalBytes: stats.totalBytes,
    hasIndex,
    updatedAt: stats.updatedAt ? new Date(stats.updatedAt).toISOString() : null,
  };
}

async function listSites() {
  await ensureRootDirectory();
  const entries = await fsp.readdir(SITES_DIR, { withFileTypes: true });
  const names = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && SITE_NAME_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  return Promise.all(names.map((name) => siteSummary(name)));
}

async function createSite(name, config) {
  const site = normalizeSiteName(name);
  await ensureRootDirectory();
  if (await siteExists(site)) throw new SiteStoreError('同名站点已存在。', 409);
  await fsp.mkdir(siteDir(site), { recursive: true });
  await writeConfig(site, config || {});
  return siteSummary(site);
}

async function deleteSite(name) {
  const site = normalizeSiteName(name);
  await ensureSiteExists(site);
  await fsp.rm(siteDir(site), { recursive: true, force: true });
  return { name: site };
}

/** 清空站内文件但保留站点与配置，便于整站覆盖式重新上传。 */
async function clearSiteFiles(name) {
  const site = normalizeSiteName(name);
  await ensureSiteExists(site);
  const config = await readConfig(site);
  const root = siteDir(site);
  for (const entry of await fsp.readdir(root)) {
    await fsp.rm(path.join(root, entry), { recursive: true, force: true });
  }
  await writeConfig(site, config);
  return siteSummary(site);
}

async function deleteSiteFile(name, relativePath) {
  const site = normalizeSiteName(name);
  await ensureSiteExists(site);
  const { absolute } = resolveInsideSite(site, relativePath);
  try {
    if (!(await fsp.stat(absolute)).isFile()) throw new SiteStoreError('只能删除文件。');
  } catch (error) {
    if (error instanceof SiteStoreError) throw error;
    throw new SiteStoreError('文件不存在。', 404);
  }
  await fsp.rm(absolute, { force: true });
  return siteSummary(site);
}

/** 列出站内所有文件的相对路径与体积，供管理页展示。 */
async function listSiteFiles(name) {
  const site = normalizeSiteName(name);
  await ensureSiteExists(site);
  const root = siteDir(site);
  const files = [];
  async function walk(current, prefix) {
    const entries = await fsp.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) { await walk(full, relative); continue; }
      if (!entry.isFile()) continue;
      const stat = await fsp.stat(full);
      files.push({ path: relative, byteSize: stat.size, updatedAt: new Date(stat.mtimeMs).toISOString() });
    }
  }
  await walk(root, '');
  return files.sort((left, right) => left.path.localeCompare(right.path)).slice(0, 2000);
}

// ---------- 写入 ----------

async function ensureTempDirectory() { await fsp.mkdir(TEMP_DIR, { recursive: true }); }
async function unlinkQuietly(target) { try { await fsp.unlink(target); } catch (error) { if (error?.code !== 'ENOENT') console.error('静态站点临时文件清理失败:', error); } }

/** 把请求体按大小上限落到临时文件，再原子改名到目标位置。 */
async function saveUploadedFile(name, relativePath, req) {
  const site = normalizeSiteName(name);
  await ensureSiteExists(site);
  const { absolute, relativePath: safeRelative } = resolveInsideSite(site, relativePath);

  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > SITES_MAX_FILE_BYTES) throw new SiteStoreError(`单个文件不能超过 ${Math.round(SITES_MAX_FILE_BYTES / 1024 / 1024)} MiB。`, 413);

  const existingStats = await collectStats(siteDir(site));
  await ensureTempDirectory();
  const temporary = path.join(TEMP_DIR, `${crypto.randomUUID()}.part`);
  let byteSize = 0;
  const limiter = new Transform({
    transform(chunk, _encoding, callback) {
      byteSize += chunk.length;
      if (byteSize > SITES_MAX_FILE_BYTES) return callback(new SiteStoreError(`单个文件不能超过 ${Math.round(SITES_MAX_FILE_BYTES / 1024 / 1024)} MiB。`, 413));
      if (existingStats.totalBytes + byteSize > SITES_MAX_TOTAL_BYTES) return callback(new SiteStoreError(`站点总体积不能超过 ${Math.round(SITES_MAX_TOTAL_BYTES / 1024 / 1024)} MiB。`, 413));
      callback(null, chunk);
    },
  });

  try {
    await pipeline(req, limiter, fs.createWriteStream(temporary, { flags: 'wx' }));
    await fsp.mkdir(path.dirname(absolute), { recursive: true });
    await fsp.rename(temporary, absolute);
    return { path: safeRelative, byteSize };
  } catch (error) {
    await unlinkQuietly(temporary);
    if (error instanceof SiteStoreError) throw error;
    if (error?.code === 'ERR_STREAM_PREMATURE_CLOSE') throw new SiteStoreError('上传被中断。');
    throw error;
  }
}

/** zip 条目是否为符号链接：外部属性高 16 位是 Unix 文件模式。 */
function isSymlinkEntry(entry) {
  const mode = (entry.externalFileAttributes >>> 16) & 0xffff;
  return (mode & 0xf000) === 0xa000;
}

/**
 * 若压缩包里所有条目都在同一个顶层目录下，且该目录内含 index.html，
 * 则解压时自动去掉这层目录——从「压缩整个文件夹」得到的 zip 才不会多套一层。
 */
function detectStripPrefix(entryNames) {
  const tops = new Set();
  for (const entryName of entryNames) {
    const top = entryName.split('/')[0];
    if (!top) return null;
    tops.add(top);
    if (tops.size > 1) return null;
  }
  if (tops.size !== 1) return null;
  const prefix = `${[...tops][0]}/`;
  const hasNestedIndex = entryNames.some((entryName) => entryName.slice(prefix.length).toLowerCase() === 'index.html');
  const hasRootIndex = entryNames.some((entryName) => entryName.toLowerCase() === 'index.html');
  return !hasRootIndex && hasNestedIndex ? prefix : null;
}

function openZip(file) {
  return new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true, autoClose: false }, (error, zipfile) => {
      if (error || !zipfile) return reject(new SiteStoreError('压缩包无法读取，请确认是有效的 zip 文件。'));
      resolve(zipfile);
    });
  });
}

function readZipEntries(zipfile) {
  return new Promise((resolve, reject) => {
    const entries = [];
    zipfile.on('entry', (entry) => {
      entries.push(entry);
      if (entries.length > MAX_ARCHIVE_ENTRIES) return reject(new SiteStoreError(`压缩包内条目过多（上限 ${MAX_ARCHIVE_ENTRIES} 个）。`, 413));
      zipfile.readEntry();
    });
    zipfile.on('end', () => resolve(entries));
    zipfile.on('error', () => reject(new SiteStoreError('压缩包解析失败。')));
    zipfile.readEntry();
  });
}

function extractEntry(zipfile, entry, destination) {
  return new Promise((resolve, reject) => {
    zipfile.openReadStream(entry, (error, readStream) => {
      if (error || !readStream) return reject(new SiteStoreError(`解压 ${entry.fileName} 失败。`));
      pipeline(readStream, fs.createWriteStream(destination)).then(resolve).catch(reject);
    });
  });
}

/**
 * 上传并解压 zip：先把请求体落到临时文件，再逐条校验后解压。
 * replace=true 时先清空站内原有文件，实现整站覆盖发布。
 */
async function extractUploadedArchive(name, req, { replace = false } = {}) {
  const site = normalizeSiteName(name);
  await ensureSiteExists(site);
  const root = siteDir(site);

  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > SITES_MAX_ARCHIVE_BYTES) throw new SiteStoreError(`压缩包不能超过 ${Math.round(SITES_MAX_ARCHIVE_BYTES / 1024 / 1024)} MiB。`, 413);

  await ensureTempDirectory();
  const temporary = path.join(TEMP_DIR, `${crypto.randomUUID()}.zip`);
  let received = 0;
  const limiter = new Transform({
    transform(chunk, _encoding, callback) {
      received += chunk.length;
      if (received > SITES_MAX_ARCHIVE_BYTES) return callback(new SiteStoreError(`压缩包不能超过 ${Math.round(SITES_MAX_ARCHIVE_BYTES / 1024 / 1024)} MiB。`, 413));
      callback(null, chunk);
    },
  });

  let zipfile = null;
  try {
    await pipeline(req, limiter, fs.createWriteStream(temporary, { flags: 'wx' }));
    if (!received) throw new SiteStoreError('压缩包内容为空。');

    zipfile = await openZip(temporary);
    const entries = await readZipEntries(zipfile);
    const fileEntries = entries.filter((entry) => !entry.fileName.endsWith('/') && !isSymlinkEntry(entry));
    if (!fileEntries.length) throw new SiteStoreError('压缩包里没有可用的文件。');

    // 先整体校验：路径合法、单文件与总体积都不超限，避免解压到一半才失败。
    const stripPrefix = detectStripPrefix(fileEntries.map((entry) => entry.fileName.replace(/\\/g, '/')));
    const planned = [];
    let plannedBytes = 0;
    for (const entry of fileEntries) {
      const rawName = entry.fileName.replace(/\\/g, '/');
      const trimmed = stripPrefix && rawName.startsWith(stripPrefix) ? rawName.slice(stripPrefix.length) : rawName;
      if (!trimmed) continue;
      const target = resolveInsideSite(site, trimmed);
      if (entry.uncompressedSize > SITES_MAX_FILE_BYTES) throw new SiteStoreError(`压缩包内 ${trimmed} 超过单文件上限。`, 413);
      plannedBytes += entry.uncompressedSize;
      planned.push({ entry, ...target });
    }
    if (!planned.length) throw new SiteStoreError('压缩包里没有可用的文件。');

    const baseBytes = replace ? 0 : (await collectStats(root)).totalBytes;
    if (baseBytes + plannedBytes > SITES_MAX_TOTAL_BYTES) throw new SiteStoreError(`解压后站点总体积会超过 ${Math.round(SITES_MAX_TOTAL_BYTES / 1024 / 1024)} MiB。`, 413);

    const config = await readConfig(site);
    if (replace) await clearSiteFiles(site);

    for (const item of planned) {
      await fsp.mkdir(path.dirname(item.absolute), { recursive: true });
      await extractEntry(zipfile, item.entry, item.absolute);
    }
    // 压缩包里如果自带 site.json，用归一化后的内容覆盖，避免写入非法配置。
    await writeConfig(site, replace ? config : (await readConfig(site)));

    return { extracted: planned.length, totalBytes: plannedBytes, summary: await siteSummary(site) };
  } finally {
    if (zipfile) { try { zipfile.close(); } catch { /* 关闭失败不影响结果 */ } }
    await unlinkQuietly(temporary);
  }
}

module.exports = {
  SiteStoreError,
  SITE_CONFIG_FILE,
  normalizeSiteName,
  normalizeRelativePath,
  resolveInsideSite,
  siteDir,
  siteExists,
  readConfig,
  writeConfig,
  listSites,
  siteSummary,
  listSiteFiles,
  createSite,
  deleteSite,
  clearSiteFiles,
  deleteSiteFile,
  saveUploadedFile,
  extractUploadedArchive,
};
