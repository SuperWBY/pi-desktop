# Pi Desktop

一个把 [pi](https://pi.dev) 包装成桌面客户端的应用。参考 Codex Desktop / Claude Cowork 的形态：左边是项目与会话，中间是对话与工具执行，底部是模型、推理强度和上下文占用。

主进程用 `pi --mode rpc` 启动 pi 子进程，通过官方 JSONL 协议通信；渲染层不直接接触 Node，只消费结构化事件。

## 安装

前置条件：本机已安装并登录 [pi](https://pi.dev)（`curl -fsSL https://pi.dev/install.sh | sh` 或 `npm install -g --ignore-scripts @earendil-works/pi-coding-agent`）。应用只负责界面，模型与凭证都由 pi 管。

### 从 GitHub Release 安装（推荐）

1. 打开本仓库的 **Releases**，下载最新的 `Pi-Desktop-<版本>-arm64.dmg`（Apple Silicon）。
2. 双击挂载，把 **Pi Desktop** 拖到 **Applications**。
3. 首次打开如果提示“已损坏”或“无法验证开发者”，执行一次：

   ```bash
   xattr -dr com.apple.quarantine "/Applications/Pi Desktop.app"
   ```

   然后再打开即可。（当前构建是 ad-hoc 签名，没有 Developer ID 与公证，所以系统会拦一次。）

### 自己构建

```bash
npm install
npm run dmg          # 产物：release/Pi-Desktop-0.1.0-arm64.dmg
```

想升级版本号：改 `package.json` 的 `version`，打 tag `v0.1.0` 推到 GitHub，`.github/workflows/release.yml` 会自动构建 DMG 并挂到 Release 上。

> 分发说明：`.github/workflows/release.yml` 用 `macos-14` runner 构建。要发给别人用且不弹 Gatekeeper 警告，需要 Apple Developer ID 证书 + 公证（notarytool），把证书塞进仓库 Secrets 后把 `make-dmg.mjs` 里的 ad-hoc 签名换成 `codesign --sign "Developer ID Application: …"` 即可。

![Chat](docs/screenshots/chat.png)

## 功能

- **项目 / 会话管理**：侧栏分成「项目」与「最近对话」；点击项目行展开/收起会话（无箭头图标），行尾 `+` 直接在该项目里新建对话。点「新建会话」先进入一个**临时对话**，在初始输入框上方的项目选择器里可以选已有项目、新建项目，或继续「不在项目中工作」——临时对话使用应用数据目录下的 `scratch` 工作区，会话文件仍由 pi 管理，但只出现在「最近对话」。正在运行的对话可以在后台继续，切换到其他会话或项目不会中断它；不属于任何项目的会话才进「最近对话」。会话行单行显示、悬停出操作菜单；支持搜索、重命名、在 Finder 中显示、删除；`⌘N` 新建临时对话。
- **流式对话**：文本、思考块、工具调用实时渲染；思考块在流式结束后自动折叠。
- **工具可视化**
  - 每一行读作一个动作：`已运行 npm run build`、`读取了 3 个文件`、`思考了 6.7s`，右侧对齐耗时；运行中显示 `正在运行 … 4s` 的实时计时。
  - `bash`：命令、输出与复制；`read` / `write`：带行号的文件内容；`edit`：红绿 diff（只显示变更附近的上下文）；其他工具：参数与结果 JSON。
  - 折叠态是安静的单行，悬停才浮出展开箭头；展开后才变成带边框的卡片。
- **模型控制**：模型选择（按 provider 分组、可搜索）、推理强度（off → max）、上下文环形指示、手动 compact。
- **输入体验**：图片粘贴 / 拖拽 / 选择上传；`/` 唤起命令与 Skill；流式中可 Steer 或 Follow-up 排队；`Esc` 停止并把排队消息退回输入框。
- **原生集成**：macOS 隐藏式标题栏、应用菜单、快捷键、外链用默认浏览器打开。
- **两种主题**：暖色深色主题 + 米白浅色主题，设置页内带预览。
- **设置页**：整页双栏布局，左侧分组导航 + 搜索，右侧卡片式设置项。
  - **常规**：pi 路径、版本、重启会话、steering / follow-up 投递方式、自动压缩、自动重试
  - **模型**：新会话默认模型与默认推理强度、当前模型信息；`pi --list-models` 的可用模型列表（含上下文 / 思考 / 图片标记）；直接添加自定义服务商与模型（写 `~/.pi/agent/models.json`，支持 OpenAI 兼容、Anthropic、Google 协议以及 Ollama / LM Studio / vLLM / OpenRouter 预设），保存后自动重启会话让 pi 重新加载
  - **工具与技能**：按工具开关内置工具集、工具卡默认展开、流式自动跟随
  - **外观 / 会话 / 快捷键 / 关于**：主题、存储目录、工作区、快捷键表与版本信息
  - 运行时项（模式、压缩、重试）走 RPC 立即生效；默认值写入 pi 的 `settings.json`，对新会话生效
  - 设置页顶部保留 42px 可拖拽区，关闭按钮固定右上角，`Esc` 也可退出。
- **技能与插件**：侧栏「新建会话」下方进入整页管理。技能以两列卡片浏览（图标、名称、作用域、描述、版本与依赖），搜索 + 全部/用户/项目/插件筛选；点卡片进入独立详情页，可直接「在对话中使用」、在 Finder 中显示或复制路径，并阅读 `SKILL.md`。插件 tab 列出 `settings.packages` 中的包（版本、来源、作用域），支持更新、移除，以及从 GitHub / npm / 本地目录安装（可只装到当前项目，带实时日志）；**连接器 tab** 聚合技能依赖的外部 CLI（`lark-cli`、`git`、`gh` 等），显示全局路径、连接状态与被哪些技能使用，可重新检测；变更后提示重启会话生效。
- **定时任务**：侧栏「定时任务」进入任务管理。支持一次性、每小时、每天、工作日、每周、**自定义 cron**、**文件变化触发**；按任务级 IANA 时区计算，夏令时自动跳过不存在的时间。任务在后台以 `pi -p` 独立会话执行，可指定项目目录、新会话/继续同一会话、工具白名单、错过补跑、完成通知；列表显示下次运行与上次状态，详情页展示 Prompt 与运行历史（可打开生成的会话或日志）。一次性任务成功执行后会自动从列表移除，并在创建它的原对话中留下完成消息；周期任务保留。任务和运行记录存在 `userData/schedules`，重启后恢复；运行中被退出会标记中断并补跑一次。打开「登录时启动」后随系统登录在后台启动；打开「关闭后继续运行」会注册 macOS LaunchAgent / Windows Task Scheduler，应用完全关闭也会每分钟检查到期任务。对话输入框直接输入 `/schedule [cron] 任务内容` 可打开预填的创建弹窗。**每个 pi 会话都会收到定时任务使用说明；在对话里说「5 分钟后…」「每天…」时，pi 应调用内置的 `pi-desktop-schedule` CLI 创建真正的定时任务，而不是 `nohup` / `sleep`。** 创建、开始、完成都会推送应用内提示，侧栏显示运行中/未读状态，提示和系统通知点击可直接跳到对应任务。
- **对话折叠（Turn）**：每一轮（提问 + 其后所有执行过程）是一条折叠单元，过程默认直接可见；打开「结论出现后收起过程」后会保留最终回复和过程摘要。`⌘.` 全收 / `⇧⌘.` 全展 / `⌘↑↓` 跳轮，折叠状态按会话持久化。
- **完整记录**：`⌘⇧O` 打开不折叠的全量 transcript，`⌘F` 搜索（命中计数 + 上下跳），Esc 关闭。
- **轮次导航**：窗口左缘的刻度线，鼠标滑过时以指针为中心向两侧渐次变长（坡度跟随指针）；悬停浮出该轮提问、回答摘要与图片，点击跳到该轮，`Esc` 关闭预览。
- **工具输出压缩**：连续同类调用自动合组（`读取了 5 个文件`），单卡输出默认只显示 20 行 + 「还有 N 行 · 显示全部」，bash 优先显示尾部；复制仍是全文。
- **右侧工作面板**（`⌘⇧E`）：通过「+」按需打开**变更、文件、终端、产物、浏览器**。在文件树点击文件会打开独立预览标签，可同时查看多个文件；切换或暂时关闭面板会保留已打开的预览。面板可拖拽调宽，也可以放大查看。
- **应用内浏览器**（`⌘⇧B` 或点击聊天里的链接）：在右侧打开网页，支持地址栏、前进/后退、刷新、下载和「用系统浏览器打开」。浏览器使用独立 session，默认拒绝摄像头、麦克风、定位等权限，只允许 http/https；本地开发地址允许 `localhost` / `127.0.0.1`，其他私网地址会被拦截。
- **使用情况与费用**：设置 → 应用 → 使用情况与费用。按今天 / 7 天 / 30 天 / 本月 / 全部统计本地会话的 Token、请求数、缓存命中和模型单价估算费用；每日趋势默认按 Tokens 展示，可切换费用；悬停显示当天 Tokens 与调用次数；用量明细默认按「套餐 + 模型」拆分（同一 provider 下的不同模型分行；不同套餐不合并），会话按 Tokens 排序，并统计从会话中读取 SKILL.md 的技能调用次数。当前一个 provider 对应一个套餐；以后接入多账号/多套餐时需要给每个账号单独的 provider 标识。
- **从 Chrome 导入登录状态**（设置 → 常规 → 链接）：可选地把指定站点的 Cookie 一次性导入内置浏览器，避免在每个站点重新登录。只导入 Cookie，不导入密码、Passkey 或扩展数据；默认不选择任何站点，导入前需要退出 Chrome。Windows 通过 DPAPI 解密 Chrome Cookie；macOS 通过 Keychain。新版 Chrome 的 App-Bound Encryption（v20）暂不支持。注意：这不是实时同步，部分站点仍会要求二次验证。
- **输出细节**：工具卡里的文件路径可直接「打开」或「在 Finder 中显示」；diff 默认只显示变更行上下 3 行，一键切全文件并复制改后内容；任意消息里的图片点击放大（⌘滚轮 / +- 缩放，Esc 关闭）。
- **导出**：会话右键 → 「导出 Markdown」（问题 + 结论 + 过程摘要）或「导出 HTML」（pi 自己的单文件导出，30MB 级别会话实测可用）。
- **长会话**：超过 40 轮后自动启用 `content-visibility` 按需渲染，只绘制视口附近的轮次。
- **后台通知**：窗口在后台时，一轮跑完会发系统通知（可关）。
- **诊断与恢复**：侧栏底部状态点打开诊断抽屉（pi 路径 / 版本 / agent 目录 / 最后 60 行 stderr / `models.json` 错误 / 一键复制）；删除会话进 `.trash` 并在提示条里「撤销」；重启后回到上次的会话。
- **键盘可达**：菜单支持 ↑↓ / Home / End / Enter / Esc，关闭后焦点回到触发器，全局 `:focus-visible` 环。
- **流畅度**
  - 会话切换复用同一个 pi 进程（`switch_session`），不再重启子进程；最近看过的会话直接命中本地缓存。
  - 流式事件按动画帧合并，消息与工具卡做 memo + 增量渲染，长回复不卡顿。
  - 发送时立即插入乐观消息；滚动保持贴底，内容长高时自动跟随。

| Diff | Light |
| --- | --- |
| ![Diff](docs/screenshots/diff.png) | ![Light](docs/screenshots/light.png) |

| Settings | Tools |
| --- | --- |
| ![Settings](docs/screenshots/settings.png) | ![Tools](docs/screenshots/settings-tools.png) |

## 架构

```
src/
  main/            Electron 主进程
    index.ts       窗口、菜单、IPC、pi 生命周期
    pi.ts          pi 子进程 + JSONL 协议（id 关联响应）
    sessions.ts    扫描 ~/.pi/agent/sessions/*.jsonl 生成会话列表
    pi-locate.ts   解析 pi 可执行文件（GUI 不继承 shell PATH）
    settings.ts    userData/settings.json（桌面端偏好）
    pi-settings.ts 读写 pi 的 ~/.pi/agent/settings.json
    schedules.ts   本地定时任务调度、运行记录与重启恢复
    schedule-cadence.ts  下一次运行时间计算（cron / 时区 / DST）
    platform-scheduler.ts  LaunchAgent / Task Scheduler 注册
  preload/         contextBridge 暴露 window.pi
  renderer/        React 19 + Vite
    store.tsx      事件 → 消息 / 工具状态的 reducer
    components/    侧栏、顶栏、对话、工具卡、输入框、弹窗
  shared/          主进程与渲染层共享的类型与 API 契约
```

关键设计：

- 每条命令带 `id`，响应按 id 关联；`message_update` 的 delta 按 `contentIndex` 重建流式消息，`message_end` 用完整消息覆盖。
- 工具执行有独立的 `tool_execution_start/update/end` 事件，按 `toolCallId` 聚合，不用轮询。
- 会话列表只读 JSONL 文件头、`session_info` 和首条用户消息，并基于 mtime/size 缓存。
- 打开项目时用 `realpath` 规范化路径（macOS `/tmp` → `/private/tmp`），避免会话按工作区过滤时丢失。
- 设置页分两层：实时项用 RPC（`set_steering_mode`、`set_follow_up_mode`、`set_auto_compaction`、`set_auto_retry`）立即作用于当前进程；默认项（默认模型、推理强度、`defaultTools`）合并写入 `~/.pi/agent/settings.json`，不覆盖未知字段。
- 流式事件先在 `requestAnimationFrame` 里攒成一批再 dispatch；消息用 memo 隔离重渲染，markdown 重解析限制在约 55ms 一次。
- 会话消息在渲染层按 `sessionPath` 缓存；切换时先显示缓存，再用 `get_messages` 结果覆盖。
- 保持单换行（`remark-breaks`），模型逐行输出的内容不会被 markdown 折成一段。

## 开发

要求：Node.js 22+、macOS（其他平台未测试）、本机已安装并登录 pi。

```bash
npm install
npm run dev          # electron-vite dev（HMR）
npm run typecheck    # 主进程 + 渲染层类型检查
npm run build        # 生产构建到 out/
npm run smoke        # 启动一次，检查无 pageerror
npm run e2e          # 交互用例（用 scripts/mock-pi.mjs 假 pi，不烧 token）
npm run test:cadence # cron / 时区 / DST 纯函数测试
npm run test:headless-ui # 无窗口渲染层检查；先运行 npm run build，需要本机 Chrome
```

e2e 按场景打了标签，改哪块只跑哪块（会自动先构建过期源码）：

```bash
node scripts/e2e.mjs --list          # 列出所有场景和标签
E2E_ONLY=tools node scripts/e2e.mjs  # 只跑工具行/分组
E2E_ONLY=fold,menu npm run e2e       # 跑折叠 + 菜单
```

无窗口检查使用模拟的桌面 API，不替代 Electron 主进程和真实 pi 的集成测试。Chrome 不在默认位置时可设置 `HEADLESS_CHROME_PATH`。

`scripts/mock-pi.mjs` 是 `pi --mode rpc` 的替身，支持 `MOCK_SCENARIO=default|auth-error|catalog-huge|model-switch-fails`，
可以在没有凭证、没有真 pi 的环境（包括 CI）里跑通界面和失败路径。

pi 路径默认自动探测：

1. 设置里的路径
2. `PI_DESKTOP_PI_PATH`
3. `~/.pi/agent/bin/pi`
4. `/opt/homebrew/bin/pi`、`/usr/local/bin/pi`
5. 登录 shell 的 `command -v pi`

也可以在设置里手动指定。

## 打包

```bash
npm run pack         # macOS .app
npm run dmg          # macOS .app + DMG（内含 Applications 快捷方式，可直接拖拽安装）
npm run pack:win     # Windows x64 免安装目录（release/Pi Desktop-win32-x64）
# macOS 产物：release/Pi Desktop-darwin-arm64/Pi Desktop.app
#             release/Pi-Desktop-0.1.0-arm64.dmg
```

macOS 打包脚本会做 ad-hoc 签名（`codesign --sign -`），保证 arm64 机器上能直接运行；但没有 Developer ID 与公证，其他人首次打开需要在「系统设置 → 隐私与安全性」放行，或执行 `xattr -dr com.apple.quarantine`。

Windows 使用系统原生标题栏（不在网页里模拟窗口按钮），快捷键提示会自动从 `⌘` 切换为 `Ctrl`，pi 的查找会额外检查 `%APPDATA%\npm\pi.cmd`，进程通过 `shell` 启动 `.cmd` shim。

## 快捷键

| 快捷键 | 动作 |
| --- | --- |
| `⌘N` | 新建会话 |
| `⌘O` | 打开项目 |
| `⌘B` | 收起/展开侧栏 |
| `⌘⇧L` | 切换主题 |
| `⌘⇧B` | 打开 / 关闭应用内浏览器 |
| `⌘,` | 设置 |
| `Enter` | 发送 |
| `Shift+Enter` | 换行 |
| `⌘.` / `⇧⌘.` | 收起 / 展开所有轮次 |
| `⌘⇧O` | 打开完整记录 |
| `⌘↑` / `⌘↓` | 跳到上/下一轮 |
| `Esc` | 停止（并把排队消息退回输入框） |

Windows / Linux 上对应使用 `Ctrl`（界面里的快捷键提示会按平台显示）。

## 已知限制

- RPC 模式下 pi 的部分扩展 UI 能力不可用（`custom()`、自定义编辑器/主题组件等），本应用对 `select / confirm / input / editor` 做了原生实现，其余降级为提示。
- 会话列表为全量扫描后前端过滤，会话数量极大时需要改成分页/增量索引。
- 尚未实现：分支树（`/tree`）、fork/clone、多窗口。
- 定时任务不是系统级 cron：不开启「关闭后继续运行」时，应用需要正在运行（或开启「登录时启动」在后台运行）；开启后会每 60 秒由系统调度器唤醒一次无窗口 tick。电脑睡眠期间不会准点触发，唤醒后会补跑一次。单次运行超时 30 分钟。
- 文件变化触发只在应用进程或后台 tick 存活时监听；应用完全关闭期间的文件变化不会补触发，只会在下次启动时恢复监听。
- 所有 pi 工具默认直接执行，没有二次确认；如果需要审批，应在 pi 侧用扩展实现。

## Roadmap

- 会话分支视图（`get_tree` / `fork`）
- 工具执行中的文件改动汇总面板
- 通知中心：长时间任务结束发系统通知
- 会话搜索走索引（SQLite）而不是全量扫描
- Windows 代码签名与自动更新（当前提供 x64 免安装目录）
