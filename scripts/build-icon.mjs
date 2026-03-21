#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const sourcePng = path.join(rootDir, 'assets', 'icon-1024.png');
const iconsetDir = path.join(rootDir, 'assets', 'ZakiTerm.iconset');
const targetIcns = path.join(rootDir, 'assets', 'ZakiTerm.icns');
const renderScript = path.join(rootDir, 'scripts', 'render_icon.py');

const iconsetSizes = [
  { size: 16, name: 'icon_16x16.png' },
  { size: 32, name: 'icon_16x16@2x.png' },
  { size: 32, name: 'icon_32x32.png' },
  { size: 64, name: 'icon_32x32@2x.png' },
  { size: 128, name: 'icon_128x128.png' },
  { size: 256, name: 'icon_128x128@2x.png' },
  { size: 256, name: 'icon_256x256.png' },
  { size: 512, name: 'icon_256x256@2x.png' },
  { size: 512, name: 'icon_512x512.png' },
  { size: 1024, name: 'icon_512x512@2x.png' }
];

function run(command, args) {
  execFileSync(command, args, {
    cwd: rootDir,
    stdio: 'inherit',
    env: process.env
  });
}

if (!fs.existsSync(renderScript)) {
  console.error(`图标生成脚本不存在: ${renderScript}`);
  process.exit(1);
}

fs.rmSync(iconsetDir, { recursive: true, force: true });
fs.mkdirSync(iconsetDir, { recursive: true });
run('python', [renderScript]);

if (!fs.existsSync(sourcePng)) {
  console.error(`未生成原始 PNG 图标: ${sourcePng}`);
  process.exit(1);
}

for (const item of iconsetSizes) {
  run('sips', ['-z', String(item.size), String(item.size), sourcePng, '--out', path.join(iconsetDir, item.name)]);
}

run('iconutil', ['-c', 'icns', iconsetDir, '-o', targetIcns]);

console.log(`已生成图标文件: ${targetIcns}`);
