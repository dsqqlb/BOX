'use strict';

const path = require('path');
const { PrismaClient } = require('@prisma/client');

// 数据库与项目一起放在可持久化的 data/ 目录。部署时可用 DATABASE_URL 覆盖此默认值。
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = `file:${path.join(__dirname, '..', 'data', 'box.sqlite').replace(/\\/g, '/')}`;
}

const globalForPrisma = global;
const prisma = globalForPrisma.__boxPrisma || new PrismaClient();
if (process.env.NODE_ENV !== 'production') globalForPrisma.__boxPrisma = prisma;

module.exports = { prisma };
