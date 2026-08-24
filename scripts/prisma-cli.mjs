#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Prisma CLI 不会读取项目的 .env.local；给本地 SQLite 一条与运行时一致的默认路径。
process.env.DATABASE_URL ||= 'file:../data/box.sqlite';
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const executable = process.platform === 'win32' ? path.join(projectRoot, 'node_modules', '.bin', 'prisma.cmd') : path.join(projectRoot, 'node_modules', '.bin', 'prisma');
const result = spawnSync(executable, process.argv.slice(2), { stdio: 'inherit', env: process.env, shell: process.platform === 'win32' });
process.exit(result.status ?? 1);
