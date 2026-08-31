'use strict';

/** Persistent public LAN chat: SQLite stores metadata, data/chat/uploads stores file bytes. */
const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { Transform } = require('stream');
const { pipeline } = require('stream/promises');
const { prisma } = require('./db');
const { CHAT_UPLOAD_DIR, CHAT_MAX_UPLOAD_BYTES } = require('./config');

const MESSAGE_LIMIT = 4000;
const PAGE_LIMIT = 50;
const MAX_ATTACHMENTS = 8;
const WITHDRAW_WINDOW_MS = 2 * 60 * 1000;
const UNATTACHED_TTL_MS = 24 * 60 * 60 * 1000;

class ChatError extends Error {
  constructor(message, statusCode = 400) { super(message); this.name = 'ChatError'; this.statusCode = statusCode; }
}

async function resolveUserId(user) {
  if (typeof user?.id === 'string' && user.id) return user.id;
  if (typeof user?.username !== 'string' || !user.username) throw new ChatError('当前登录账户无效。', 401);
  const record = await prisma.user.findUnique({ where: { username: user.username }, select: { id: true } });
  if (!record) throw new ChatError('当前账户不存在。', 401);
  return record.id;
}

function cleanFilename(value) {
  let name = typeof value === 'string' ? value : '';
  try { name = decodeURIComponent(name); } catch { /* use raw value */ }
  name = name.replace(/[\\/\0<>:"|?*\x00-\x1f]/g, '_').replace(/\s+/g, ' ').trim();
  return (name || '未命名文件').slice(0, 180);
}

function cleanMime(value) {
  const mime = typeof value === 'string' ? value.split(';')[0].trim().toLowerCase() : '';
  return /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(mime) ? mime.slice(0, 120) : 'application/octet-stream';
}

function previewKind(mimeType) {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  return 'file';
}

function attachmentDto(attachment) {
  return {
    id: attachment.id,
    originalName: attachment.originalName,
    mimeType: attachment.mimeType,
    byteSize: attachment.byteSize,
    createdAt: attachment.createdAt.toISOString(),
    previewKind: previewKind(attachment.mimeType),
    url: `/api/chat/files/${attachment.id}`,
  };
}

function messageDto(message, currentUserId) {
  const reactionGroups = new Map();
  for (const reaction of message.reactions || []) {
    const group = reactionGroups.get(reaction.emoji) || { emoji: reaction.emoji, count: 0, reacted: false };
    group.count += 1;
    if (reaction.userId === currentUserId) group.reacted = true;
    reactionGroups.set(reaction.emoji, group);
  }
  return {
    id: message.id,
    body: message.withdrawnAt ? '' : message.body,
    createdAt: message.createdAt.toISOString(),
    withdrawnAt: message.withdrawnAt?.toISOString() || null,
    author: { username: message.author.username },
    isOwn: message.authorId === currentUserId,
    replyTo: message.replyTo ? { id: message.replyTo.id, body: message.replyTo.withdrawnAt ? '' : message.replyTo.body, author: { username: message.replyTo.author.username }, withdrawnAt: message.replyTo.withdrawnAt?.toISOString() || null } : null,
    attachments: (message.attachments || []).map(attachmentDto),
    reactions: [...reactionGroups.values()].sort((left, right) => right.count - left.count || left.emoji.localeCompare(right.emoji)),
  };
}

const messageInclude = {
  author: { select: { username: true } },
  replyTo: { select: { id: true, body: true, withdrawnAt: true, author: { select: { username: true } } } },
  attachments: { orderBy: { createdAt: 'asc' } },
  reactions: { select: { emoji: true, userId: true } },
};

async function ensureUploadDirectory() { await fsp.mkdir(CHAT_UPLOAD_DIR, { recursive: true }); }
function attachmentPath(storedName) { return path.join(CHAT_UPLOAD_DIR, storedName); }
async function unlinkQuietly(file) { try { await fsp.unlink(file); } catch (error) { if (error.code !== 'ENOENT') console.error('聊天附件清理失败:', error); } }

async function cleanExpiredUploads() {
  const cutoff = new Date(Date.now() - UNATTACHED_TTL_MS);
  const stale = await prisma.chatAttachment.findMany({ where: { messageId: null, createdAt: { lt: cutoff } }, select: { id: true, storedName: true } });
  if (!stale.length) return;
  await prisma.chatAttachment.deleteMany({ where: { id: { in: stale.map((item) => item.id) } } });
  await Promise.all(stale.map((item) => unlinkQuietly(attachmentPath(item.storedName))));
}

async function uploadAttachment(req, user) {
  const userId = await resolveUserId(user);
  const declaredSize = Number(req.headers['content-length']);
  if (Number.isFinite(declaredSize) && (declaredSize < 1 || declaredSize > CHAT_MAX_UPLOAD_BYTES)) throw new ChatError(`文件大小必须在 1 B 到 ${CHAT_MAX_UPLOAD_BYTES} B 之间。`, 413);
  const originalName = cleanFilename(req.headers['x-chat-file-name']);
  const mimeType = cleanMime(req.headers['content-type']);
  await ensureUploadDirectory();
  const storedName = crypto.randomUUID();
  const temporaryPath = attachmentPath(`${storedName}.uploading`);
  const finalPath = attachmentPath(storedName);
  let byteSize = 0;
  const limiter = new Transform({
    transform(chunk, _encoding, callback) {
      byteSize += chunk.length;
      if (byteSize > CHAT_MAX_UPLOAD_BYTES) return callback(new ChatError(`单个文件不能超过 ${CHAT_MAX_UPLOAD_BYTES} B。`, 413));
      callback(null, chunk);
    },
  });
  try {
    await pipeline(req, limiter, fs.createWriteStream(temporaryPath, { flags: 'wx' }));
    if (byteSize === 0) throw new ChatError('不能上传空文件。');
    await fsp.rename(temporaryPath, finalPath);
    const attachment = await prisma.chatAttachment.create({ data: { uploaderId: userId, storedName, originalName, mimeType, byteSize } });
    void cleanExpiredUploads().catch((error) => console.error('清理临时聊天附件失败:', error));
    return attachmentDto(attachment);
  } catch (error) {
    await Promise.all([unlinkQuietly(temporaryPath), unlinkQuietly(finalPath)]);
    if (error instanceof ChatError) throw error;
    if (error?.code === 'ERR_STREAM_PREMATURE_CLOSE') throw new ChatError('上传被中断。', 400);
    throw error;
  }
}

function normalizeBody(value) {
  if (typeof value !== 'string') throw new ChatError('消息内容必须是文字。');
  const body = value.replace(/\r\n/g, '\n').trim();
  if (body.length > MESSAGE_LIMIT) throw new ChatError(`单条消息不能超过 ${MESSAGE_LIMIT} 个字符。`);
  return body;
}

function normalizeAttachmentIds(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((id) => typeof id !== 'string')) throw new ChatError('附件标识无效。');
  const ids = [...new Set(value)];
  if (ids.length > MAX_ATTACHMENTS) throw new ChatError(`每条消息最多 ${MAX_ATTACHMENTS} 个附件。`);
  return ids;
}

async function createMessage(user, input) {
  const userId = await resolveUserId(user);
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ChatError('请求体无效。');
  const body = normalizeBody(input.body || '');
  const attachmentIds = normalizeAttachmentIds(input.attachmentIds);
  const replyToId = typeof input.replyToId === 'string' && input.replyToId ? input.replyToId : null;
  if (replyToId && replyToId.length > 64) throw new ChatError('回复目标无效。');
  if (!body && !attachmentIds.length) throw new ChatError('请输入文字或添加附件。');
  const message = await prisma.$transaction(async (tx) => {
    if (replyToId) {
      const parent = await tx.chatMessage.findUnique({ where: { id: replyToId }, select: { id: true } });
      if (!parent) throw new ChatError('要回复的消息不存在。', 404);
    }
    if (attachmentIds.length) {
      const attachments = await tx.chatAttachment.findMany({ where: { id: { in: attachmentIds }, uploaderId: userId, messageId: null }, select: { id: true } });
      if (attachments.length !== attachmentIds.length) throw new ChatError('附件不存在、已发送，或不属于当前账户。', 409);
    }
    const created = await tx.chatMessage.create({ data: { authorId: userId, body, replyToId } });
    if (attachmentIds.length) await tx.chatAttachment.updateMany({ where: { id: { in: attachmentIds }, uploaderId: userId, messageId: null }, data: { messageId: created.id } });
    return tx.chatMessage.findUniqueOrThrow({ where: { id: created.id }, include: messageInclude });
  });
  return messageDto(message, userId);
}

async function getMessages(user, cursor) {
  const userId = await resolveUserId(user);
  if (cursor !== undefined && (typeof cursor !== 'string' || cursor.length > 64)) throw new ChatError('分页标记无效。');
  const records = await prisma.chatMessage.findMany({
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: PAGE_LIMIT + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), include: messageInclude,
  });
  const hasMore = records.length > PAGE_LIMIT;
  const page = records.slice(0, PAGE_LIMIT);
  return { messages: page.map((message) => messageDto(message, userId)), nextCursor: hasMore ? page[page.length - 1]?.id || null : null };
}

async function searchMessages(user, query) {
  const userId = await resolveUserId(user);
  if (typeof query !== 'string') throw new ChatError('搜索词无效。');
  const text = query.trim();
  if (!text || text.length > 100) throw new ChatError('搜索词长度需为 1–100 个字符。');
  const records = await prisma.chatMessage.findMany({ where: { body: { contains: text }, withdrawnAt: null }, orderBy: { createdAt: 'desc' }, take: PAGE_LIMIT, include: messageInclude });
  return records.map((message) => messageDto(message, userId));
}

async function toggleReaction(user, messageId, emoji) {
  const userId = await resolveUserId(user);
  if (typeof messageId !== 'string' || messageId.length > 64) throw new ChatError('消息标识无效。');
  if (typeof emoji !== 'string' || Array.from(emoji.trim()).length < 1 || Array.from(emoji.trim()).length > 16) throw new ChatError('表情无效。');
  const normalized = emoji.trim();
  const message = await prisma.chatMessage.findUnique({ where: { id: messageId }, select: { id: true, withdrawnAt: true } });
  if (!message) throw new ChatError('消息不存在。', 404);
  if (message.withdrawnAt) throw new ChatError('无法对已撤回的消息作出反应。');
  const key = { messageId_userId_emoji: { messageId, userId, emoji: normalized } };
  const existing = await prisma.chatReaction.findUnique({ where: key });
  if (existing) await prisma.chatReaction.delete({ where: key }); else await prisma.chatReaction.create({ data: { messageId, userId, emoji: normalized } });
  const updated = await prisma.chatMessage.findUniqueOrThrow({ where: { id: messageId }, include: messageInclude });
  return messageDto(updated, userId);
}

async function withdrawMessage(user, messageId) {
  const userId = await resolveUserId(user);
  const message = await prisma.chatMessage.findUnique({ where: { id: messageId }, include: { attachments: true } });
  if (!message) throw new ChatError('消息不存在。', 404);
  if (message.authorId !== userId) throw new ChatError('只能撤回自己发送的消息。', 403);
  if (message.withdrawnAt) throw new ChatError('消息已撤回。', 409);
  if (Date.now() - message.createdAt.getTime() > WITHDRAW_WINDOW_MS) throw new ChatError('消息发送超过两分钟，无法撤回。', 409);
  await prisma.$transaction([prisma.chatReaction.deleteMany({ where: { messageId } }), prisma.chatAttachment.deleteMany({ where: { messageId } }), prisma.chatMessage.update({ where: { id: messageId }, data: { body: '', withdrawnAt: new Date() } })]);
  await Promise.all(message.attachments.map((attachment) => unlinkQuietly(attachmentPath(attachment.storedName))));
  const updated = await prisma.chatMessage.findUniqueOrThrow({ where: { id: messageId }, include: messageInclude });
  return messageDto(updated, userId);
}

async function deleteMessageAsAdmin(messageId) {
  const message = await prisma.chatMessage.findUnique({ where: { id: messageId }, include: { attachments: true } });
  if (!message) throw new ChatError('消息不存在。', 404);
  await prisma.chatMessage.delete({ where: { id: messageId } });
  await Promise.all(message.attachments.map((attachment) => unlinkQuietly(attachmentPath(attachment.storedName))));
  return { id: messageId };
}

async function getAttachment(id) {
  if (typeof id !== 'string' || id.length > 64) throw new ChatError('附件标识无效。');
  const attachment = await prisma.chatAttachment.findUnique({ where: { id } });
  if (!attachment) throw new ChatError('附件不存在或已删除。', 404);
  return { attachment, filePath: attachmentPath(attachment.storedName) };
}

async function getAdminStats() {
  const [aggregate, messages, attachments] = await Promise.all([
    prisma.chatAttachment.aggregate({ _sum: { byteSize: true }, _count: true }),
    prisma.chatMessage.count(), prisma.chatAttachment.count(),
  ]);
  return { messageCount: messages, attachmentCount: attachments, totalBytes: aggregate._sum.byteSize || 0, maxUploadBytes: CHAT_MAX_UPLOAD_BYTES };
}

async function listMembers(auth) {
  const users = await prisma.user.findMany({ include: { permissions: { select: { permission: true } } }, orderBy: { username: 'asc' } });
  return users.filter((user) => auth.hasToolAccess({ permissions: user.permissions.map((entry) => entry.permission) }, 'lan-chat')).map((user) => user.username);
}

async function unlinkChatAttachmentFiles(attachments) {
  await Promise.all((attachments || []).map((attachment) => unlinkQuietly(attachmentPath(attachment.storedName))));
}

module.exports = { ChatError, CHAT_MAX_UPLOAD_BYTES, attachmentPath, unlinkChatAttachmentFiles, uploadAttachment, createMessage, getMessages, searchMessages, toggleReaction, withdrawMessage, deleteMessageAsAdmin, getAttachment, getAdminStats, listMembers };
