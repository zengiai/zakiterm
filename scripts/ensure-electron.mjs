#!/usr/bin/env node

import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);

function hasElectronRuntime() {
  try {
    require.resolve('electron');
    return true;
  } catch {
    return false;
  }
}

function readElectronVersion() {
  const packageJsonPath = path.join(appRoot, 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
  return packageJson.devDependencies?.electron;
}

function installElectron(versionRange) {
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  execFileSync(
    npmCommand,
    ['install', '--no-save', '--omit=dev', `electron@${versionRange}`],
    {
      cwd: appRoot,
      stdio: 'inherit',
      env: process.env
    }
  );
}

if (hasElectronRuntime()) {
  process.exit(0);
}

const electronVersion = readElectronVersion();
if (!electronVersion) {
  console.error('未找到 Electron 版本信息，无法自动安装运行时。');
  process.exit(1);
}

console.log(`正在补充 Electron 运行时 ${electronVersion} ...`);
installElectron(electronVersion);
