# ZakiTerm

ZakiTerm 是一个面向 macOS 的桌面 SSH 客户端，定位是“轻量、直接、可发布”的终端工具。它基于 Electron + React + TypeScript 构建，支持 SSH 终端、多会话切换、SFTP 文件传输，以及通过 SSH 隧道打开远程 Web 页面。

这个项目适合两类人：

- 想直接下载一个可用的 SSH 桌面工具的人
- 想学习 Electron 桌面应用、SSH 会话管理、SFTP 文件操作和 macOS 打包发布流程的人

## 项目亮点

- 终端、文件、远程浏览器三个高频能力整合在一个应用里
- 支持多会话
- 支持密码登录和私钥登录
- 支持保存连接配置和最近连接
- 支持以 npm 包形式分发
- 支持打包成 macOS `dmg`
- 项目结构清晰，适合继续演进

## 功能列表

- SSH 终端控制台（`xterm`）
- 多会话管理
- 远程目录浏览（SFTP）
- 上传文件到远程目录
- 下载文件到本地工作区
- 通过 SSH 隧道打开远程网页
- 保存连接配置
- 自动记录最近成功连接
- 自定义 `ZakiTerm` 应用图标

## 技术栈

- Electron
- React
- TypeScript
- electron-vite
- ssh2
- xterm
- electron-builder

## 运行环境

- macOS
- Node.js 18+
- npm 9+

## 快速开始

### 本地开发

安装依赖：

```bash
npm install
```

启动开发环境：

```bash
npm run dev
```

常用命令：

```bash
npm run typecheck
npm run build
npm run build:icon
```

## 作为应用使用

### 方式一：通过 npm 安装

适合开发者用户，也适合希望用命令升级版本的人。

安装：

```bash
npm install -g zakiterm
```

启动：

```bash
zakiterm
```

查看版本：

```bash
zakiterm --version
```

更新：

```bash
npm install -g zakiterm@latest
```

说明：

- 首次安装会补充 Electron 运行时
- 首次安装耗时会比普通 CLI 包长一点
- `zakiterm` 这个包名发布前需要自行确认是否已被占用

### 方式二：通过 dmg 安装

适合普通 macOS 用户。

使用方式：

1. 从 GitHub Releases 下载最新 `.dmg`
2. 双击打开镜像
3. 将 `ZakiTerm.app` 拖入 `Applications`
4. 从启动台或应用程序目录打开

更新方式：

1. 下载新的 `.dmg`
2. 用新版本覆盖 `Applications` 中的旧版本

## 项目结构

```text
src/
  main/         Electron 主进程：SSH 会话、SFTP、隧道、IPC
  preload/      安全桥接层：向渲染进程暴露受控 API
  renderer/     React 前端界面
  shared/       主进程 / 渲染进程共享类型
assets/
  icon.svg      图标母稿
  ZakiTerm.icns macOS 应用图标
bin/
  zakiterm.mjs  npm 安装后的启动入口
scripts/
  build-icon.mjs       生成图标资源
  ensure-electron.mjs  npm 安装后补充 Electron 运行时
out/
  Electron / Vite 构建输出
dist/
  electron-builder 生成的 dmg / zip
```

## 架构说明

### 主进程

主进程负责所有 Node 能力和系统能力，包括：

- 建立 SSH 连接
- 打开 Shell
- 打开 SFTP 会话
- 建立本地端口转发
- 打开 Electron 主窗口和远程浏览器窗口

### 预加载层

预加载层通过 `contextBridge` 暴露 `window.sshApi`，保证渲染层不能直接接触危险的 Node 能力。

### 渲染层

渲染层负责 UI 展示和交互逻辑，包括：

- 左侧导航和会话管理
- 连接配置与最近连接
- 终端展示
- 文件树展示
- 远程浏览器表单与状态反馈

## 设计思路

这个项目没有追求“大而全”，而是优先把几个高频场景做通：

- 连接远程机器
- 在终端里执行命令
- 浏览和传输文件
- 打开远程 Web 服务

在实现上遵循了这几个原则：

- 尽量把系统能力收敛在主进程
- 渲染层只负责交互和状态展示
- 连接信息和最近连接做本地持久化
- 先完成第一版可用产品，再逐步增强工程能力

## 发布指南

### 发布 npm 包

更新版本号：

```bash
npm version patch
```

登录 npm：

```bash
npm login
```

发布：

```bash
npm publish
```

说明：

- 发布前会自动执行 `prepack`
- `prepack` 会自动跑 `typecheck + build`

### 构建 dmg

生成 `dmg`：

```bash
npm run dist:dmg
```

生成 `dmg + zip`：

```bash
npm run dist:mac
```

产物在：

```text
dist/
```

### 发布 GitHub Release

推荐流程：

1. 推送代码和 tag
2. 运行 `npm run dist:mac`
3. 在 GitHub Releases 上传 `.dmg` 和 `.zip`
4. 在 Release 描述里写清楚版本、改动点和安装方式

## 用户数据

应用会在 Electron `userData` 目录下保存本地数据，例如：

- `connection-profiles.json`
- `recent-connections.json`

## 当前限制

- 当前密码仍属于本地明文存储
- 当前版本更适合作为第一版产品验证
- 当前未做 Apple Developer 签名和 notarization
- 当前未做自动更新

## 路线图

- 接入系统安全存储（Keychain）
- 增加应用签名与公证
- 增加自动更新
- 增加 GitHub Actions 自动打包与发布
- 增加更多连接管理能力

## 适合继续扩展的方向

- 标签式会话管理增强
- 更强的文件操作体验
- 远程监控与系统信息面板
- 连接收藏和分组
- 更完整的发布流水线

如果你是第一次接触 Electron 项目，这个仓库也很适合作为一个完整的小型桌面应用参考。
