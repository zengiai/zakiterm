#!/usr/bin/env node

import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, '..');

function readPackageVersion() {
  const packageJson = require(path.join(appRoot, 'package.json'));
  return packageJson.version;
}

function printHelp() {
  console.log(`zakiterm

Usage:
  zakiterm
  zakiterm --help
  zakiterm --version`);
}

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  printHelp();
  process.exit(0);
}

if (args.includes('--version') || args.includes('-v')) {
  console.log(readPackageVersion());
  process.exit(0);
}

const electronBinary = require('electron');
const child = spawn(electronBinary, [appRoot], {
  stdio: 'inherit',
  env: process.env
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});

child.on('error', (error) => {
  console.error(`启动 Electron 应用失败: ${error.message}`);
  process.exit(1);
});
