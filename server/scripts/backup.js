#!/usr/bin/env node
/**
 * 备份 DATA_DIR 里的持久化文件到 backups/ 目录。
 *
 * 用法（仓库根目录）：
 *   npm run backup
 *   DATA_DIR=/var/lib/charging-pile npm run backup
 *   BACKUP_DIR=/var/backups/charging-pile npm run backup
 */

const fs = require('fs');
const path = require('path');
const serverConfig = require('../config');

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function copyFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function main() {
  const cfg = serverConfig.get();
  const dataDir = path.resolve(cfg.dataDir);
  const backupRoot = path.resolve(process.env.BACKUP_DIR || path.join(process.cwd(), 'backups'));
  const targetDir = path.join(backupRoot, `backup-${stamp()}`);

  if (!fs.existsSync(dataDir)) {
    console.error(`[backup] 数据目录不存在: ${dataDir}`);
    process.exit(1);
  }

  fs.mkdirSync(targetDir, { recursive: true });
  const entries = fs.readdirSync(dataDir);
  let copied = 0;
  entries.forEach((name) => {
    const src = path.join(dataDir, name);
    const st = fs.statSync(src);
    if (!st.isFile()) return;
    copyFile(src, path.join(targetDir, name));
    copied += 1;
  });

  const meta = {
    createdAt: new Date().toISOString(),
    dataDir,
    files: copied,
    note: 'charging-pile server data backup'
  };
  fs.writeFileSync(path.join(targetDir, 'backup-meta.json'), JSON.stringify(meta, null, 2));
  console.log(`[backup] ok -> ${targetDir} (${copied} files)`);
}

main();
