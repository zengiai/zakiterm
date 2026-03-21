# ZakiTerm

一个面向 macOS 的桌面 SSH 客户端，基于 Electron + React + TypeScript，支持终端交互、SFTP 文件传输、远程 Web 隧道访问，以及连接配置/最近连接持久化。

## 功能特性

- SSH 终端控制台（`xterm`）
- 多会话管理
- 远程文件浏览（SFTP）
- 上传文件到远程目录
- 下载文件到本地工作区
- 通过 SSH 隧道打开远程网页
- 保存连接配置
- 自动记录最近成功连接
- 支持密码登录与私钥登录

## 运行环境

- macOS
- Node.js 18+
- npm 9+

## GitHub

发布到 GitHub 后，可以在这里展示项目：

```text
https://github.com/<your-name>/zakiterm
```

建议：

- GitHub 仓库名、应用名、命令名尽量统一成 `ZakiTerm`
- 每次发版时同时发布 Git tag 和 GitHub Release
- GitHub Release 中上传 `dmg` 和 `zip`，普通用户更容易使用

## 安装方式

这个项目现在支持两种安装方式：

### 1. 通过 npm 安装

适合开发者用户，支持命令行安装和更新。

当前包名配置为：

```text
zakiterm
```

全局安装：

```bash
npm install -g zakiterm
```

说明：

- 安装过程中会自动补充 Electron 运行时
- 首次安装时间会比普通 CLI 包更长一些
- `zakiterm` 这个 npm 包名在正式发布前仍需要你自己确认是否已被占用

安装完成后启动：

```bash
zakiterm
```

临时运行：

```bash
npx zakiterm
```

查看版本：

```bash
zakiterm --version
```

### 2. 通过 dmg 安装

适合普通 macOS 用户。

使用方式：

1. 从 GitHub Releases 下载最新的 `.dmg`
2. 双击打开 `.dmg`
3. 将 `ZakiTerm.app` 拖入 `Applications`
4. 从启动台或应用程序目录打开

说明：

- 第一版如果还没有做签名和公证，macOS 可能会提示安全限制
- 遇到提示时，可以在 Finder 中右键应用，选择“打开”

## 更新方式

### npm 更新

当你发布新版本后，用户可以直接执行：

```bash
npm install -g zakiterm@latest
```

然后重新启动：

```bash
zakiterm
```

### dmg 更新

`dmg` 方式不能通过 npm 更新，推荐流程是：

1. 到 GitHub Releases 下载最新版本的 `.dmg`
2. 重新拖入 `Applications` 覆盖旧版本

## 卸载方式

### 卸载 npm 版本

```bash
npm uninstall -g zakiterm
```

### 卸载 dmg 版本

直接删除 `Applications/ZakiTerm.app`

## 本地开发

安装依赖：

```bash
npm install
```

开发模式启动：

```bash
npm run dev
```

类型检查：

```bash
npm run typecheck
```

构建前端与主进程产物：

```bash
npm run build
```

生成应用图标资源：

```bash
npm run build:icon
```

本地以 npm 包启动方式运行：

```bash
npm run start
```

## 构建 dmg

生成 macOS `dmg`：

```bash
npm run dist:dmg
```

同时生成 `dmg + zip`：

```bash
npm run dist:mac
```

构建产物默认输出到：

```text
dist/
```

通常你会看到类似文件：

- `ZakiTerm-0.1.0-arm64.dmg`
- `ZakiTerm-0.1.0-arm64.zip`

说明：

- `dist:dmg` 和 `dist:mac` 会先自动生成 `assets/ZakiTerm.icns`
- 图标母稿位于 `assets/icon.svg`

## 发布到 npm

首次发布前请确认：

- 你已经注册 npm 账号
- 你已经执行过 `npm login`
- 包名在 npm 上未被占用

推荐发布流程：

1. 更新版本号

```bash
npm version patch
```

如果是较大改动，也可以用：

```bash
npm version minor
npm version major
```

2. 登录 npm

```bash
npm login
```

3. 发布

```bash
npm publish
```

说明：

- 发布前会自动执行 `prepack`
- `prepack` 会自动运行 `npm run typecheck && npm run build`
- npm 包中会包含 `bin/`、`out/`、`scripts/` 和 `README.md`
- 用户安装 npm 包后，`postinstall` 会自动补充 Electron 运行时

4. 推送代码和 tag 到 GitHub

```bash
git push origin main
git push origin --tags
```

## 发布到 GitHub Releases

推荐在发布 npm 版本的同时，也发布 `dmg` 到 GitHub：

1. 先构建桌面安装包

```bash
npm run dist:mac
```

2. 在 GitHub 创建一个新的 Release

3. 上传 `dist/` 目录下的 `.dmg` 和 `.zip`

4. 在 Release 描述中写清楚：

- 当前版本号
- 新增功能
- 安装方式
- 如果未签名，需要提示用户右键打开

## 用户数据位置

应用会在 Electron `userData` 目录下保存本地数据，例如：

- `connection-profiles.json`
- `recent-connections.json`

## 安全说明

- 当前版本中的密码属于本地明文存储
- 更适合个人工具或第一版产品验证
- 如果要持续对外发布，建议后续迁移到 macOS Keychain
- 如果要让 `dmg` 更顺畅安装，建议后续增加 Apple Developer 签名与公证

## 项目结构

```text
src/
  main/         Electron 主进程：SSH 连接、SFTP、隧道、IPC
  preload/      安全桥接：暴露 window.sshApi
  renderer/     React UI：连接、终端、文件、浏览器
  shared/       主进程 / 渲染进程共享类型
bin/
  zakiterm.mjs   npm 安装后的启动入口
scripts/
  ensure-electron.mjs   npm 安装后补充 Electron 运行时
out/
  应用构建产物
dist/
  electron-builder 生成的 dmg / zip
```

## 后续建议

- 增加自动更新机制
- 接入系统安全存储（Keychain）
- 增加应用签名与公证
- 增加 GitHub Actions 自动发布 npm 与 GitHub Releases
