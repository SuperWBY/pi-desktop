# 右侧工作面板 + 导出（PDF / 飞书）方案

> 参考依据：本机安装的 Claude Desktop（`/Applications/Claude.app`，`ion-dist.asar`）里的真实面板结构；Codex CLI 的 transcript 视图；pi 现有 RPC（`bash` / `export_html` / `get_session_stats`）。

## 一、参考实现里到底有什么（本机实证）

### Claude Desktop

从 `ion-dist.asar` 抽出的字符串可以确认右侧面板的形态：

| 能力 | 证据 |
| --- | --- |
| 右侧面板是 **Diff / Preview / Terminal 三组标签** | 面板菜单枚举 `Te.Diff` → `diff`、`Te.Preview` → `preview`、`Te.Terminal` → `terminal` |
| **每个 hunk 可独立展开**，并带"上下文阈值" | `fileDiff` / `hunkIndex` / `expandedHunks` / `collapsedContextThreshold` |
| 可「折叠测试文件」等过滤项 | `collapseTestFiles`、`hideWhitespace` 等 diff render options |
| **Review changes** 入口 + 汇总 | `"Review changes"` 按钮、`+/-` 统计 |
| 终端按会话多标签，面板关了也能重开 | `no terminal tabs are open for this session (the Terminal panel may be closed…)` + `open_terminal` 工具 |
| **产物（Artifacts）按类型分类** | `[Text]:"File", [Markdown]:"File", [Html]:"Artifacts", [React]:"Artifacts", [Code]:"Code", [Svg]:"Image"` |
| 轮次级进度状态 | `workflowProgress` / `Progress item` / `lastToolName` / `usage` |
| 计划任务 / 并行任务 / 新窗口 | `scheduledTasks`、`parallelTasks`、`parallelTasksNewWindow` |

### Codex CLI（已装 0.161.0）

- transcript 覆盖层 + 搜索 + activity group（我们已按这个做了「完整记录」和「轮次折叠」）。
- 没有右侧文件/终端面板——它是纯 TUI，靠 overlay。

### 行业通用的右栏能力（10 项，我们能否做）

| # | 能力 | 常见形态 | pi / 我们能拿到的数据 | 成本 |
| --- | --- | --- | --- | --- |
| 1 | 变更审查 | 文件列表 + 行内 diff + hunk 展开 | 工具调用参数（edit/write）+ `git diff` | 1 天 |
| 2 | 文件树 | 懒加载目录，点击预览/打开 | 主进程 `fs`（新 IPC） | 1 天 |
| 3 | 终端 | 多标签、流式输出、可停 | pi RPC `bash`（有 `bash_execution_update` 流式事件、`excludeFromContext`） | 0.5–1 天 |
| 4 | 产物预览 | HTML/React/图片/Markdown | 会话里的 image block、代码块、写出的文件 | 0.5–1 天 |
| 5 | 计划 / 待办 | todo 列表、子代理、后台任务 | pi `get_commands` / `statusText` / 工具运行时间线 | 1 天 |
| 6 | 用量与上下文 | token / cost / compact 按钮 | `get_session_stats`（已有）、TopBar 已有 pill | 0.5 天 |
| 7 | 审批队列 | 待确认的写/跑操作 | 需要给 pi 的工具加拦截（扩展），暂缓 | 2 天+ |
| 8 | Git 集成 | 分支、commit、开 PR | `execFile('git')` | 1 天 |
| 9 | 搜索 | 会话内 / 文件内 | 已有 transcript 搜索；文件内需 grep | 0.5 天 |
| 10 | 诊断 | 日志、stderr、配置 | 已有诊断抽屉 | 完成 |

## 二、我们自己的右栏设计

```
┌───────────────┬─────────────────────────────┬──────────────────────┐
│ 侧栏 274      │ 对话（轮次折叠）             │ 右栏 360（可拖 280–560）│
│               │                             │ ⌘⇧E 开合              │
│               │                             │ ┌────┬────┬────┬───┐ │
│               │                             │ │变更│文件│终端│产物│ │
│               │                             │ └────┴────┴────┴───┘ │
│               │                             │  +128 −34 · 7 文件    │
│               │                             │  ▾ src/turns.ts      │
│               │                             │    @@ -12,7 +12,9 …   │
└───────────────┴─────────────────────────────┴──────────────────────┘
```

### 变更（默认 tab）

- 两个数据源，顶部切换：
  - **本会话**：从 `toolRuns` 里 `edit` / `write` 的参数聚合（现在就有，零额外读取），按文件分组、按轮次标注；
  - **工作区**：`git status --porcelain=v1` + `git diff --stat`（新 IPC `git:status`），能看到"不是 agent 改的"改动。
- 顶部汇总：`+128 −34 · 7 文件 · 3 轮`，可切换「按文件 / 按轮次」分组。
- 点文件展开逐 hunk diff：复用现有 `DiffView`，保留 `±3 / 全文` 与"复制改后内容"，并加 hunk 级展开（对齐 Claude 的 `expandedHunks`）、「折叠测试文件/隐藏空白」两个过滤开关。
- 从对话联动：点某轮摘要的"文件数" → 变更 tab 过滤到该轮；点变更文件 → 对话滚到产生它的那张工具卡。

### 文件

- 懒加载目录树（`fs:readdir`，忽略 `node_modules/.git/dist/out/release`），顶部过滤框。
- 点文件 → 右栏内预览（< 200KB 文本，`highlight.js` 已有依赖），预览头带「打开 / Finder」。
- 双击目录展开，`⌘⇧F` 聚焦过滤框。

### 终端

- 用 pi 的 `bash` RPC：`{type:'bash', command, excludeFromContext: true}`，流式吃 `bash_execution_update`。
- **默认不计入模型上下文**（`excludeFromContext`），需要"让 pi 看到这条命令"时点一下开关。
- 多标签（每个标签一条命令历史），支持停止（`abort_bash`）、清空、复制输出。
- 首次使用弹一次确认："终端命令直接在项目目录执行，和 pi 的 bash 工具权限相同"。

### 产物

- 自动收集：本会话的图片 block、`write` 出的 `.html/.svg/.md`、代码块（可选"存成文件"）。
- HTML 用 sandbox iframe 预览（`sandbox="allow-scripts"`，不联网）；图片复用 lightbox；其余给"打开 / Finder"。

### 交互细节

- `⌘⇧E` 开合；宽度持久化到 settings；关闭时轮次导航条回到右边缘。
- 右栏打开时，`⌘F` 优先搜索右栏（有焦点时），否则搜会话。
- 面板与「完整记录」互斥：打开一个自动关另一个（避免三个层叠）。

## 三、PDF / 飞书导出

### PDF（`printToPDF`）

- 入口：会话菜单 + 顶栏"导出"菜单 → 「导出 PDF（简版 / 详版）」。
- 做法：主进程开一个隐藏 `BrowserWindow` 加载一个专门打印的 HTML（用 `turnsToMarkdown` 转 HTML，或复用 transcript 视图的打印样式），`webContents.printToPDF({printBackground:true})` → 保存。
- 简版 = 问题 + 结论 + 汇总；详版 = 加过程摘要、工具列表、diff。
- 成本 0.5 天。好处是不依赖 pi，离线可用。

### 飞书文档

- 本机已有 `lark-cli`（`~/.npm-global/bin/lark-cli`），走它的 docx 创建能力最省事：
  1. 生成"会话报告"Markdown（目标 / 改动文件 + 行数 / 工具统计 / 结论 / 下一步）
  2. `lark-cli` 创建飞书文档 → 返回链接 → toast 里给"打开"按钮
  3. 失败（未授权）→ 回退到 Markdown 文件 + 提示跑一次授权
- 成本 0.5 天（依赖授权状态）。
- 备选：只生成 Markdown 并复制到剪贴板（0 依赖，5 分钟就能给）。

### 报告内容（两种导出共用）

```
# <会话名> · 2026-10-28

## 目标
<第一条用户消息，截断>

## 改动
- src/a.ts (+24 −3)
- src/b.tsx (+12 −8)

## 过程
12 轮 · 65 步 · bash×22 read×10 · 3m16s · 5.6M tokens · $0.034

## 结论
<最后一轮最终回答>

## 未完成 / 下一步
<从最后一轮的工具结果/错误推导，或留空手填>
```

## 四、排期

| 阶段 | 内容 | 成本 |
| --- | --- | --- |
| P0 | 右栏骨架（拖拽宽度 / 开合 / tab 记忆）+ 变更 tab（本会话数据源） | 1.5 天 |
| P1 | 文件 tab（树 + 预览）+ PDF 导出 | 1.5 天 |
| P2 | 飞书导出 + 工作区 git 数据源 | 1 天 |
| P3 | 终端 tab（多标签 + 流式） | 0.5–1 天 |
| P4 | 产物 tab（HTML iframe 预览）+ hunk 级展开/过滤 | 1 天 |

合计约 5–6 天。建议顺序同表：先"变更"，因为它直接解决"这轮到底改了哪些文件"。

## 五、需要拍板

1. 右栏**默认展开还是收起**？（建议默认收起，`⌘⇧E` 打开；有 diff 时自动弹出一行提示）
2. 变更 tab 默认数据源：**本会话**（快、只看 agent 改的）还是**工作区**（全量、含手改）？
3. 终端：要不要**默认不进上下文**（建议要），以及首次使用是否需要确认弹窗？
4. 飞书导出：走 `lark-cli` 真写文档（需要授权），还是先只做"复制 Markdown 到剪贴板"？
5. PDF 默认出**简版**还是**详版**？
