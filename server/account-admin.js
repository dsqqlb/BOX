'use strict';

const crypto = require('crypto');
const { prisma } = require('./db');
const { TOOL_SLUGS } = require('./config');
const { unlinkChatAttachmentFiles } = require('./chat-store');

const USERNAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{1,63}$/;
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 1024;

class AccountAdminError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

function isAdmin(user) {
  return Boolean(user?.permissions?.includes('*'));
}

function normalizeUsername(value) {
  const username = typeof value === 'string' ? value.trim() : '';
  if (!USERNAME_PATTERN.test(username)) throw new AccountAdminError('用户名需为 2–64 位字母、数字、点、下划线或连字符，且必须以字母或数字开头。');
  return username;
}

function normalizePassword(value) {
  if (typeof value !== 'string' || value.length < PASSWORD_MIN_LENGTH || value.length > PASSWORD_MAX_LENGTH) {
    throw new AccountAdminError(`密码长度需为 ${PASSWORD_MIN_LENGTH}–${PASSWORD_MAX_LENGTH} 个字符。`);
  }
  return value;
}

function normalizePermissions(value) {
  if (!Array.isArray(value)) throw new AccountAdminError('权限必须是数组。');
  const permissions = [...new Set(value.filter((item) => typeof item === 'string').map((item) => item.trim()).filter(Boolean))];
  if (!permissions.length) throw new AccountAdminError('账户至少需要一项权限。');
  const invalid = permissions.filter((permission) => permission !== '*' && !TOOL_SLUGS.includes(permission));
  if (invalid.length) throw new AccountAdminError(`包含未知权限：${invalid.join('、')}。`);
  return permissions.includes('*') ? ['*'] : permissions;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const N = 16384;
  const r = 8;
  const p = 1;
  const hash = crypto.scryptSync(password, salt, 64, {
    N,
    r,
    p,
    maxmem: Math.max(128 * N * r + 16 * 1024 * 1024, 32 * 1024 * 1024),
  });
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

function toPublicUser(user) {
  return {
    username: user.username,
    permissions: user.permissions.map((entry) => entry.permission).sort(),
    isAdmin: user.permissions.some((entry) => entry.permission === '*'),
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

const includePermissions = { permissions: { select: { permission: true } } };

async function listAccounts() {
  const users = await prisma.user.findMany({ include: includePermissions, orderBy: { username: 'asc' } });
  return users.map(toPublicUser);
}

async function createAccount(input) {
  const username = normalizeUsername(input.username);
  const password = normalizePassword(input.password);
  const permissions = normalizePermissions(input.permissions);
  try {
    const user = await prisma.user.create({
      data: { username, passwordHash: hashPassword(password), permissions: { create: permissions.map((permission) => ({ permission })) } },
      include: includePermissions,
    });
    return toPublicUser(user);
  } catch (error) {
    if (error?.code === 'P2002') throw new AccountAdminError('该用户名已存在。', 409);
    throw error;
  }
}

async function updateAccount(actorUsername, targetUsername, input) {
  const username = normalizeUsername(targetUsername);
  const hasPassword = input.password !== undefined;
  const hasPermissions = input.permissions !== undefined;
  if (!hasPassword && !hasPermissions) throw new AccountAdminError('请提供要更新的密码或权限。');
  const passwordHash = hasPassword ? hashPassword(normalizePassword(input.password)) : undefined;
  const permissions = hasPermissions ? normalizePermissions(input.permissions) : undefined;

  return prisma.$transaction(async (tx) => {
    const target = await tx.user.findUnique({ where: { username }, include: includePermissions });
    if (!target) throw new AccountAdminError('账户不存在。', 404);
    const targetIsAdmin = target.permissions.some((entry) => entry.permission === '*');
    const willBeAdmin = permissions ? permissions.includes('*') : targetIsAdmin;
    if (targetIsAdmin && !willBeAdmin) {
      const adminCount = await tx.user.count({ where: { permissions: { some: { permission: '*' } } } });
      if (adminCount <= 1) throw new AccountAdminError('不能撤销最后一个管理员账户的管理权限。', 409);
    }
    if (hasPermissions) await tx.userPermission.deleteMany({ where: { userId: target.id } });
    const user = await tx.user.update({
      where: { id: target.id },
      data: {
        ...(passwordHash ? { passwordHash, sessionRevision: { increment: 1 } } : {}),
        ...(hasPermissions ? { permissions: { create: permissions.map((permission) => ({ permission })) } } : {}),
        updatedAt: new Date(),
      },
      include: includePermissions,
    });
    return toPublicUser(user);
  });
}

async function deleteAccount(actorUsername, targetUsername) {
  const username = normalizeUsername(targetUsername);
  if (actorUsername === username) throw new AccountAdminError('不能删除当前登录的管理员账户。', 409);
  const attachments = await prisma.$transaction(async (tx) => {
    const target = await tx.user.findUnique({ where: { username }, include: { ...includePermissions, chatAttachments: { select: { storedName: true } } } });
    if (!target) throw new AccountAdminError('账户不存在。', 404);
    if (target.permissions.some((entry) => entry.permission === '*')) {
      const adminCount = await tx.user.count({ where: { permissions: { some: { permission: '*' } } } });
      if (adminCount <= 1) throw new AccountAdminError('不能删除最后一个管理员账户。', 409);
    }
    await tx.user.delete({ where: { id: target.id } });
    return target.chatAttachments;
  });
  // SQLite 外键级联不能删除磁盘二进制；事务成功后再尽力清理，失败时下次运维可按 data/chat/ 盘点。
  await unlinkChatAttachmentFiles(attachments);
}

module.exports = { AccountAdminError, isAdmin, listAccounts, createAccount, updateAccount, deleteAccount };
