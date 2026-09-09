'use client';

/**
 * 静态站点挂载管理页。
 *
 * 站点文件托管在独立域名（BOX_SITES_HOST）上，与 BOX 主站不同源；
 * 这个页面只做管理：建站、上传（文件夹或 zip）、改配置、删除。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';

type SiteConfig = {
  title: string;
  visibility: 'public' | 'authenticated';
  spaFallback: boolean;
  notFoundPage: string;
  cacheSeconds: number;
};

type SiteSummary = {
  name: string;
  config: SiteConfig;
  fileCount: number;
  totalBytes: number;
  hasIndex: boolean;
  updatedAt: string | null;
};

type SiteFile = { path: string; byteSize: number; updatedAt: string };

type SitesResponse = {
  sites: SiteSummary[];
  sitesHosts: string[];
  primaryHost: string;
  limits: { maxFileBytes: number; maxArchiveBytes: number; maxTotalBytes: number };
};

// 拖放文件夹用到的 File System 条目接口，只声明实际用到的成员。
interface FsEntry { isFile: boolean; isDirectory: boolean; fullPath: string; name: string }
interface FsFileEntry extends FsEntry { file(onSuccess: (file: File) => void, onError?: (error: unknown) => void): void }
interface FsDirectoryEntry extends FsEntry {
  createReader(): { readEntries(onSuccess: (entries: FsEntry[]) => void, onError?: (error: unknown) => void): void };
}

type PendingFile = { path: string; file: File };

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: { ...(options?.body && typeof options.body === 'string' ? { 'Content-Type': 'application/json' } : {}), ...(options?.headers || {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((body as { error?: string }).error || '请求失败，请稍后重试。');
  return body as T;
}

/** 选择/拖入的文件夹总会带上外层目录名；若根下没有 index.html 就把这层剥掉，与服务端解压行为一致。 */
function stripCommonTopFolder(files: PendingFile[]): PendingFile[] {
  if (files.length === 0) return files;
  const tops = new Set(files.map((item) => item.path.split('/')[0]));
  if (tops.size !== 1) return files;
  const prefix = `${[...tops][0]}/`;
  const hasRootIndex = files.some((item) => item.path.toLowerCase() === 'index.html');
  const hasNestedIndex = files.some((item) => item.path.slice(prefix.length).toLowerCase() === 'index.html');
  if (hasRootIndex || !hasNestedIndex) return files;
  return files
    .map((item) => ({ ...item, path: item.path.startsWith(prefix) ? item.path.slice(prefix.length) : item.path }))
    .filter((item) => item.path !== '');
}

/** 递归读取拖入的目录条目。 */
async function readDroppedEntry(entry: FsEntry, collected: PendingFile[]): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File | null>((resolve) => {
      (entry as FsFileEntry).file((value) => resolve(value), () => resolve(null));
    });
    if (file) collected.push({ path: entry.fullPath.replace(/^\/+/, ''), file });
    return;
  }
  if (!entry.isDirectory) return;
  const reader = (entry as FsDirectoryEntry).createReader();
  // readEntries 每次最多返回一批，必须反复读到空数组为止。
  for (;;) {
    const batch = await new Promise<FsEntry[]>((resolve) => {
      reader.readEntries((entries) => resolve(entries), () => resolve([]));
    });
    if (!batch.length) break;
    for (const child of batch) await readDroppedEntry(child, collected);
  }
}

export default function StaticSitesPage() {
  const [data, setData] = useState<SitesResponse | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [files, setFiles] = useState<SiteFile[]>([]);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [replaceMode, setReplaceMode] = useState(true);

  const [newName, setNewName] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [newVisibility, setNewVisibility] = useState<'public' | 'authenticated'>('public');

  const [draft, setDraft] = useState<SiteConfig | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const zipInputRef = useRef<HTMLInputElement | null>(null);

  const sitesHost = data?.sitesHosts?.[0] || '';
  const selectedSite = useMemo(() => data?.sites.find((site) => site.name === selected) || null, [data, selected]);

  const refresh = useCallback(async (keepSelection = true) => {
    try {
      const next = await api<SitesResponse>('/api/sites');
      setData(next);
      if (!keepSelection) return next;
      setSelected((current) => (current && next.sites.some((site) => site.name === current) ? current : next.sites[0]?.name || null));
      return next;
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '加载站点列表失败。');
      return null;
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (!selected) { setFiles([]); setDraft(null); return; }
    setDraft(selectedSite ? { ...selectedSite.config } : null);
    void (async () => {
      try { setFiles((await api<{ files: SiteFile[] }>(`/api/sites/${encodeURIComponent(selected)}/files`)).files); }
      catch { setFiles([]); }
    })();
  }, [selected, selectedSite]);

  const siteUrl = (name: string) => (sitesHost ? `${window.location.protocol}//${sitesHost}/${name}/` : '');

  const createSite = async () => {
    setError(''); setNotice('');
    setBusy(true);
    try {
      const created = await api<SiteSummary>('/api/sites', {
        method: 'POST',
        body: JSON.stringify({ name: newName, config: { title: newTitle || newName, visibility: newVisibility } }),
      });
      setNewName(''); setNewTitle('');
      await refresh(false);
      setSelected(created.name);
      setNotice(`站点「${created.name}」已创建，现在可以上传文件。`);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : '创建站点失败。');
    } finally { setBusy(false); }
  };

  const uploadFiles = async (site: string, pending: PendingFile[]) => {
    const prepared = stripCommonTopFolder(pending).filter((item) => item.file.size > 0 || item.path.endsWith('/') === false);
    if (!prepared.length) { setError('没有可上传的文件。'); return; }

    setError(''); setNotice('');
    setBusy(true);
    setProgress({ done: 0, total: prepared.length });
    try {
      if (replaceMode) await api(`/api/sites/${encodeURIComponent(site)}/files`, { method: 'DELETE' });

      const queue = prepared.slice();
      let done = 0;
      const worker = async () => {
        for (;;) {
          const item = queue.shift();
          if (!item) return;
          const response = await fetch(`/api/sites/${encodeURIComponent(site)}/files`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/octet-stream', 'X-Site-File-Path': encodeURIComponent(item.path) },
            body: item.file,
          });
          if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            throw new Error((body as { error?: string }).error || `上传 ${item.path} 失败。`);
          }
          done += 1;
          setProgress({ done, total: prepared.length });
        }
      };
      await Promise.all(Array.from({ length: Math.min(4, prepared.length) }, () => worker()));
      await refresh();
      setFiles((await api<{ files: SiteFile[] }>(`/api/sites/${encodeURIComponent(site)}/files`)).files);
      setNotice(`已上传 ${prepared.length} 个文件。`);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : '上传失败。');
      await refresh();
    } finally { setBusy(false); setProgress(null); }
  };

  const uploadArchive = async (site: string, archive: File) => {
    setError(''); setNotice('');
    setBusy(true);
    try {
      const response = await fetch(`/api/sites/${encodeURIComponent(site)}/archive?replace=${replaceMode ? '1' : '0'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/zip' },
        body: archive,
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error((body as { error?: string }).error || '解压失败。');
      await refresh();
      setFiles((await api<{ files: SiteFile[] }>(`/api/sites/${encodeURIComponent(site)}/files`)).files);
      setNotice(`压缩包已解压，共 ${(body as { extracted?: number }).extracted ?? 0} 个文件。`);
    } catch (archiveError) {
      setError(archiveError instanceof Error ? archiveError.message : '上传压缩包失败。');
    } finally { setBusy(false); }
  };

  const handleDrop = async (event: React.DragEvent) => {
    event.preventDefault();
    setDragging(false);
    if (!selected) { setError('请先选择或创建一个站点。'); return; }

    const items = Array.from(event.dataTransfer.items || []);
    const zip = Array.from(event.dataTransfer.files || []).find((file) => file.name.toLowerCase().endsWith('.zip'));
    const entries = items
      .map((item) => (typeof item.webkitGetAsEntry === 'function' ? (item.webkitGetAsEntry() as unknown as FsEntry | null) : null))
      .filter((entry): entry is FsEntry => Boolean(entry));

    // 只拖了一个 zip 就走服务端解压；否则按文件夹/文件逐个上传。
    if (zip && entries.every((entry) => entry.isFile) && entries.length <= 1) {
      await uploadArchive(selected, zip);
      return;
    }
    const collected: PendingFile[] = [];
    for (const entry of entries) await readDroppedEntry(entry, collected);
    if (!collected.length) {
      const plainFiles = Array.from(event.dataTransfer.files || []).map((file) => ({ path: file.name, file }));
      if (!plainFiles.length) { setError('没有读取到文件。'); return; }
      await uploadFiles(selected, plainFiles);
      return;
    }
    await uploadFiles(selected, collected);
  };

  const saveConfig = async () => {
    if (!selected || !draft) return;
    setError(''); setNotice('');
    setBusy(true);
    try {
      await api<SiteConfig>(`/api/sites/${encodeURIComponent(selected)}/config`, { method: 'PUT', body: JSON.stringify(draft) });
      await refresh();
      setNotice('配置已保存。');
    } catch (configError) {
      setError(configError instanceof Error ? configError.message : '保存配置失败。');
    } finally { setBusy(false); }
  };

  const deleteSite = async (name: string) => {
    if (!window.confirm(`确定删除站点「${name}」及其所有文件？此操作不可恢复。`)) return;
    setBusy(true);
    try {
      await api(`/api/sites/${encodeURIComponent(name)}`, { method: 'DELETE' });
      setSelected(null);
      await refresh(false).then((next) => setSelected(next?.sites[0]?.name || null));
      setNotice(`站点「${name}」已删除。`);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : '删除站点失败。');
    } finally { setBusy(false); }
  };

  return (
    <main className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <header className="sticky top-0 z-30 border-b border-zinc-200 bg-white/85 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/85">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
          <Link href="/" className="text-sm text-zinc-500 transition-colors hover:text-sky-600 dark:text-zinc-400">← 返回首页</Link>
          <span className="rounded-full bg-sky-100 px-3 py-1 text-xs font-black tracking-widest text-sky-700 dark:bg-sky-950 dark:text-sky-300">静态站点挂载</span>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <section className="rounded-3xl bg-gradient-to-br from-sky-700 via-cyan-700 to-teal-800 p-6 text-white shadow-xl sm:p-8">
          <h1 className="text-3xl font-black tracking-tight sm:text-4xl">静态站点挂载 🌐</h1>
          <p className="mt-2 max-w-2xl text-sm text-sky-50/85">
            把写好的 HTML / CSS / JS 文件夹或 zip 拖上来即上线。每个文件夹是一个独立网页，通过站点域名对外访问。
          </p>
          <div className="mt-4 rounded-xl bg-black/20 p-3 text-xs backdrop-blur">
            {sitesHost ? (
              <span>站点域名：<code className="font-mono font-bold text-cyan-100">{sitesHost}</code>，访问地址形如 <code className="font-mono">{`${sitesHost}/站点名/`}</code></span>
            ) : (
              <span className="text-amber-200">尚未配置站点域名。请在 <code className="font-mono">.env.local</code> 设置 <code className="font-mono">BOX_SITES_HOST</code>（例如 <code className="font-mono">pages.example.com</code>）后重启服务，站点才能对外访问。</span>
            )}
          </div>
        </section>

        {error && <div className="mt-4 rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">{error}</div>}
        {notice && <div className="mt-4 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">{notice}</div>}

        <div className="mt-6 grid gap-5 lg:grid-cols-[22rem_1fr]">
          {/* 左侧：站点列表与新建 */}
          <div className="space-y-4">
            <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
              <h2 className="font-black">新建站点</h2>
              <div className="mt-3 space-y-2">
                <input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="站点名（小写字母、数字、- _）"
                  className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm outline-none focus:border-sky-500 dark:border-zinc-700 dark:bg-zinc-950" />
                <input value={newTitle} onChange={(event) => setNewTitle(event.target.value)} placeholder="显示名（可留空）"
                  className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm outline-none focus:border-sky-500 dark:border-zinc-700 dark:bg-zinc-950" />
                <div className="flex gap-2">
                  {(['public', 'authenticated'] as const).map((option) => (
                    <button key={option} onClick={() => setNewVisibility(option)}
                      className={`flex-1 rounded-lg px-3 py-2 text-xs font-bold transition-colors ${
                        newVisibility === option ? 'bg-sky-600 text-white' : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'
                      }`}>
                      {option === 'public' ? '公开访问' : '仅登录可见'}
                    </button>
                  ))}
                </div>
                <button onClick={() => void createSite()} disabled={busy || !newName.trim()}
                  className="w-full rounded-lg bg-sky-600 py-2.5 text-sm font-black text-white transition hover:bg-sky-500 disabled:opacity-50">
                  创建站点
                </button>
              </div>
            </section>

            <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
              <h2 className="font-black">已挂载站点 <span className="text-xs font-medium text-zinc-500">{data?.sites.length ?? 0} 个</span></h2>
              <div className="mt-3 space-y-2">
                {!data ? <p className="py-6 text-center text-sm text-zinc-500">正在加载…</p>
                  : data.sites.length === 0 ? <p className="py-6 text-center text-sm text-zinc-500">还没有站点，先在上面创建一个。</p>
                  : data.sites.map((site) => (
                    <button key={site.name} onClick={() => setSelected(site.name)}
                      className={`w-full rounded-xl border p-3 text-left transition ${
                        selected === site.name ? 'border-sky-500 bg-sky-50 dark:bg-sky-950/40' : 'border-zinc-200 hover:border-zinc-300 dark:border-zinc-800'
                      }`}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-bold">{site.config.title || site.name}</span>
                        <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-black ${
                          site.config.visibility === 'public'
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                            : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                        }`}>
                          {site.config.visibility === 'public' ? '公开' : '需登录'}
                        </span>
                      </div>
                      <div className="mt-1 truncate font-mono text-[11px] text-zinc-500">/{site.name}/</div>
                      <div className="mt-1 text-[11px] text-zinc-500">
                        {site.fileCount} 个文件 · {formatBytes(site.totalBytes)}
                        {!site.hasIndex && <span className="ml-1 text-rose-500">· 缺少 index.html</span>}
                      </div>
                    </button>
                  ))}
              </div>
            </section>
          </div>

          {/* 右侧：站点详情 */}
          <div className="space-y-4">
            {!selectedSite ? (
              <section className="rounded-2xl border-2 border-dashed border-zinc-200 py-20 text-center dark:border-zinc-800">
                <div className="text-5xl">📁</div>
                <p className="mt-3 text-sm text-zinc-500">选择左侧的站点，或先创建一个。</p>
              </section>
            ) : (
              <>
                <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="text-xl font-black">{selectedSite.config.title || selectedSite.name}</h2>
                      {sitesHost ? (
                        <a href={siteUrl(selectedSite.name)} target="_blank" rel="noreferrer"
                          className="mt-1 block truncate font-mono text-xs text-sky-600 hover:underline dark:text-sky-400">
                          {siteUrl(selectedSite.name)}
                        </a>
                      ) : (
                        <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">配置 BOX_SITES_HOST 后才能对外访问</p>
                      )}
                      <p className="mt-1 text-[11px] text-zinc-500">
                        {selectedSite.fileCount} 个文件 · {formatBytes(selectedSite.totalBytes)}
                        {selectedSite.updatedAt && ` · 更新于 ${new Date(selectedSite.updatedAt).toLocaleString('zh-CN')}`}
                      </p>
                    </div>
                    <button onClick={() => void deleteSite(selectedSite.name)} disabled={busy}
                      className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 hover:bg-rose-100 disabled:opacity-50 dark:bg-rose-950/40 dark:text-rose-300">
                      删除站点
                    </button>
                  </div>
                </section>

                {/* 上传区 */}
                <section
                  onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(event) => void handleDrop(event)}
                  className={`rounded-2xl border-2 border-dashed p-6 text-center transition-colors ${
                    dragging ? 'border-sky-500 bg-sky-50 dark:bg-sky-950/30' : 'border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-900'
                  }`}
                >
                  <div className="text-4xl">{busy ? '⏳' : '⬆️'}</div>
                  <p className="mt-2 font-bold">把文件夹或 zip 拖到这里</p>
                  <p className="mt-1 text-xs text-zinc-500">
                    单文件上限 {formatBytes(data?.limits.maxFileBytes || 0)} · 压缩包上限 {formatBytes(data?.limits.maxArchiveBytes || 0)} · 整站上限 {formatBytes(data?.limits.maxTotalBytes || 0)}
                  </p>

                  <label className="mt-4 inline-flex cursor-pointer items-center gap-2 text-xs font-bold text-zinc-600 dark:text-zinc-300">
                    <input type="checkbox" checked={replaceMode} onChange={(event) => setReplaceMode(event.target.checked)} className="accent-sky-600" />
                    覆盖发布（先清空站内原有文件）
                  </label>

                  <div className="mt-4 flex flex-wrap justify-center gap-2">
                    <button onClick={() => folderInputRef.current?.click()} disabled={busy}
                      className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-black text-white hover:bg-sky-500 disabled:opacity-50">选择文件夹</button>
                    <button onClick={() => zipInputRef.current?.click()} disabled={busy}
                      className="rounded-lg bg-zinc-800 px-4 py-2 text-sm font-black text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-700">选择 zip</button>
                  </div>

                  <input ref={folderInputRef} type="file" multiple className="hidden"
                    // @ts-expect-error 目录选择是浏览器扩展属性，TS 的 input 类型里没有声明
                    webkitdirectory="true"
                    onChange={(event) => {
                      const picked = Array.from(event.target.files || []).map((file) => ({ path: file.webkitRelativePath || file.name, file }));
                      event.currentTarget.value = '';
                      if (picked.length && selectedSite) void uploadFiles(selectedSite.name, picked);
                    }} />
                  <input ref={zipInputRef} type="file" accept=".zip,application/zip" className="hidden"
                    onChange={(event) => {
                      const picked = event.target.files?.[0];
                      event.currentTarget.value = '';
                      if (picked && selectedSite) void uploadArchive(selectedSite.name, picked);
                    }} />

                  {progress && (
                    <div className="mx-auto mt-4 max-w-sm">
                      <div className="h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                        <div className="h-full rounded-full bg-sky-500 transition-all" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
                      </div>
                      <p className="mt-1 text-xs text-zinc-500">{progress.done} / {progress.total}</p>
                    </div>
                  )}
                </section>

                {/* 配置 */}
                {draft && (
                  <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                    <h3 className="font-black">站点配置</h3>
                    <p className="mt-1 text-[11px] text-zinc-500">保存后写入站点目录下的 <code className="font-mono">site.json</code>，该文件不会被对外访问。</p>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <label className="text-xs font-bold text-zinc-600 dark:text-zinc-300">
                        显示名
                        <input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                          className="mt-1 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm outline-none focus:border-sky-500 dark:border-zinc-700 dark:bg-zinc-950" />
                      </label>
                      <label className="text-xs font-bold text-zinc-600 dark:text-zinc-300">
                        可见性
                        <select value={draft.visibility} onChange={(event) => setDraft({ ...draft, visibility: event.target.value as SiteConfig['visibility'] })}
                          className="mt-1 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm outline-none focus:border-sky-500 dark:border-zinc-700 dark:bg-zinc-950">
                          <option value="public">公开访问（任何人可看）</option>
                          <option value="authenticated">仅登录可见</option>
                        </select>
                      </label>
                      <label className="text-xs font-bold text-zinc-600 dark:text-zinc-300">
                        自定义 404 页面
                        <input value={draft.notFoundPage} onChange={(event) => setDraft({ ...draft, notFoundPage: event.target.value })}
                          placeholder="404.html"
                          className="mt-1 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm outline-none focus:border-sky-500 dark:border-zinc-700 dark:bg-zinc-950" />
                      </label>
                      <label className="text-xs font-bold text-zinc-600 dark:text-zinc-300">
                        浏览器缓存秒数（0 = 改了立即生效）
                        <input type="number" min={0} value={draft.cacheSeconds}
                          onChange={(event) => setDraft({ ...draft, cacheSeconds: Math.max(0, Math.trunc(Number(event.target.value) || 0)) })}
                          className="mt-1 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm outline-none focus:border-sky-500 dark:border-zinc-700 dark:bg-zinc-950" />
                      </label>
                    </div>
                    <label className="mt-3 flex items-center gap-2 text-xs font-bold text-zinc-600 dark:text-zinc-300">
                      <input type="checkbox" checked={draft.spaFallback} onChange={(event) => setDraft({ ...draft, spaFallback: event.target.checked })} className="accent-sky-600" />
                      单页应用回退（找不到路径时交给 index.html 处理路由）
                    </label>

                    {draft.visibility === 'authenticated' && !data?.primaryHost && (
                      <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                        「仅登录可见」需要设置 <code className="font-mono">BOX_PRIMARY_HOST</code>（BOX 主站域名），否则访客无法完成授权。
                      </p>
                    )}

                    <button onClick={() => void saveConfig()} disabled={busy}
                      className="mt-4 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-black text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900">
                      保存配置
                    </button>
                  </section>
                )}

                {/* 文件列表 */}
                <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                  <h3 className="font-black">站内文件 <span className="text-xs font-medium text-zinc-500">{files.length} 个</span></h3>
                  <div className="mt-2 max-h-72 space-y-1 overflow-y-auto text-xs">
                    {files.length === 0 ? <p className="py-6 text-center text-zinc-500">还没有文件，拖一个文件夹上来吧。</p>
                      : files.map((file) => (
                        <div key={file.path} className="flex items-center justify-between gap-2 rounded-lg bg-zinc-50 px-3 py-1.5 dark:bg-zinc-950">
                          <span className="truncate font-mono">{file.path}</span>
                          <span className="shrink-0 tabular-nums text-zinc-500">{formatBytes(file.byteSize)}</span>
                        </div>
                      ))}
                  </div>
                </section>
              </>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
