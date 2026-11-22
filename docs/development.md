# Pi Desktop 开发指南

产品介绍与安装入口见[项目首页](../README.md)。本页面向需要运行源码、修改代码和打包的开发者。

## 本地启动

准备：

- Node.js 22.18+ 与 npm。macOS 原生模块编译需要 Node 头文件和 Xcode Command Line Tools。
- 可用的 Pi 运行时和模型配置。首次启动也会检查运行时；macOS 打包可内置 Pi seed。
- macOS Apple Silicon 是当前主要开发与验证环境。

```bash
git clone https://github.com/SuperWBY/pi-desktop.git
cd pi-desktop
npm ci
npm run dev
```

开发分支的功能可能尚未进入默认分支或 Releases。需要复现某次改动时，请检出对应 PR 的分支或提交。

Pi 路径可在设置里指定，也支持 `PI_DESKTOP_PI_PATH`。自动探测还会检查用户安装目录、常见系统位置及登录 shell 的 PATH。应用通过 `pi --mode rpc` 与运行时通信。

## 常用验证

```bash
npm run typecheck
npm run build
npm run smoke
npm run e2e
```

`npm run build` 会编译 macOS 触摸板与语音原生模块，执行类型检查，再构建 Electron 主进程、预加载脚本和界面。

E2E 默认使用隔离的应用数据、项目和会话目录。多数场景使用模拟 Pi；创意模式另用真实 Pi 验证加载与安装，模型行为测试使用本地替身。测试场景的具体外部依赖以对应脚本为准。

按修改范围选择测试：

```bash
node scripts/e2e.mjs --list
E2E_ONLY=creator,package-catalog,plugin-navigation npm run e2e
E2E_ONLY=composer-ui,slash-menu npm run e2e
E2E_ONLY=navigation-gestures npm run e2e

node --experimental-strip-types scripts/test-created-plugins.mjs
node --experimental-strip-types scripts/test-creator.mjs
node --experimental-strip-types scripts/test-creator-control.mjs
node --experimental-strip-types scripts/test-package-readme-locales.mjs
node --experimental-strip-types scripts/test-context-usage.mjs
node --experimental-strip-types scripts/test-pi-runtime-selection.mjs
npm run test:cadence
```

创意模式等真实 Pi 集成测试使用准备好的 seed；必要时先运行 `npm run prepare:pi-seed`。完整场景、边界及回归命令见 [AGENTS.md](../AGENTS.md)。

无窗口界面检查需要本机 Chrome，不能替代 Electron 与真实 Pi 的集成验证：

```bash
npm run build
npm run test:headless-ui
```

Chrome 不在默认位置时可设置 `HEADLESS_CHROME_PATH`。测试产物写入被 Git 忽略的 `output/`。

## 代码结构

```text
src/
  main/             窗口、Pi 进程、IPC、插件、浏览器、定时任务与本机服务
  preload/          向界面暴露受控的 window.pi API
  renderer/src/     React 界面、会话状态与交互
  shared/           跨进程 API、数据类型和校验
extensions/
  computer-use/     网页与桌面操作、上下文统计
  chrome-bridge/    Chrome 扩展桥
  creator/          创意模式、插件草稿、检查和运行模板
native/             macOS 触摸板阶段与语音输入模块源码
scripts/            构建、打包及验证脚本
docs/               产品、开发、边界和界面文档
```

渲染层不直接访问 Node。新增调用应经过共享 API、preload 和主进程 IPC，校验调用来源、参数与当前会话归属。

插件草稿位于工作区的 `.pi/creator`。安装使用经过验证的独立快照，修改源码会使旧验证失效。“我的插件”读取已知工作区的草稿，浏览列表不会执行插件代码。

## 平台与打包

```bash
npm run pack       # 在当前 macOS 开发环境生成 .app
npm run dmg        # 生成 macOS .app 和 DMG
npm run pack:win   # Windows x64 目录
npm run check:win  # Windows 包结构检查
npm run pack:linux # Linux x64 目录
```

产物位于 `release/`。macOS 的应用路径为 `release/Pi Desktop-darwin-arm64/Pi Desktop.app`；DMG 名称跟随 `package.json` 版本，文档不固定版本号。

Windows/Linux 打包入口已提供，不代表与 macOS 相同的原生功能已全面验证。macOS Computer Use、原生语音和触摸板模块有平台边界，系统级沙箱也有平台差异。

构建源码不会自动更新 `/Applications/Pi Desktop.app`。验证安装版时，需要分别确认签名、运行中的可执行文件及安装包摘要，再检查实际交互。

### macOS 签名

本地打包可通过 `PI_MAC_SIGNING_IDENTITY` 指定签名身份，也可在本机应用数据目录配置本地签名身份；未配置时可使用 ad-hoc 签名。自签名或临时签名不等于 Apple Developer ID 公证。

正式分发使用 `scripts/release-mac.sh`，需要配置该脚本要求的 Apple Developer ID 签名与公证环境。不要将证书私钥、密码或本机签名配置提交到仓库。

`.github/workflows/release.yml` 在推送 `v*` 标签时生成安装包并发布 Release；上传源码分支不会自动发布新版安装包。

## 定时任务的运行条件

- 默认由应用进程执行，任务及运行记录存入应用数据目录，重启后恢复。
- 开启相应后台选项后，可通过系统调度器检查到期任务；睡眠、关机期间不能保证准点运行。
- 文件变化触发依赖监听进程存活，应用完全关闭期间的文件变化不会补触发。
- 独立任务会话、错过运行的处理和异常恢复，以任务配置及界面实际状态为准。

相关实现位于 `src/main/schedules.ts`、`schedule-cadence.ts` 与 `platform-scheduler.ts`。

## 开发约定

先阅读 [AGENTS.md](../AGENTS.md)。保持现有配色、组件和 motion tokens；实现展开、收起、进行、完成与失败反馈，并遵守减少动态效果。界面变更需要验证实际操作，不能只以编译通过作为完成依据。

会话、凭据、模型配置、本机缓存、打包产物和个人截图不属于源代码提交。分享日志与截图前应检查私人内容；新增测试使用隔离数据，避免改写日常使用的 Pi 配置。

更详细的网络与沙箱边界见 [sandbox-network.md](sandbox-network.md)，第三方分发声明见 [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)。
