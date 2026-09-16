'use strict';

const path = require('path');
const { DATA_DIR } = require('./config');
const { PrismaClient } = require('@prisma/client');

// 数据库与资源类目录一起放在可持久化的 resources/data/。
// 路径在这里算成绝对路径，避免 Prisma 相对路径的解析歧义。部署时可用 DATABASE_URL 覆盖此默认值。
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = `file:${path.join(DATA_DIR, 'box.sqlite').replace(/\\/g, '/')}`;
}

const globalForPrisma = global;
const prisma = globalForPrisma.__boxPrisma || new PrismaClient();
if (process.env.NODE_ENV !== 'production') globalForPrisma.__boxPrisma = prisma;

module.exports = { prisma };
