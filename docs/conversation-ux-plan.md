# 对话输出（Turn）交互方案 v2

> 依据：本机已安装的 Codex CLI 0.161.0 与 Claude Code 2.1.292 的二进制里的真实 UI 文案/键位/结构（不是凭印象），加上我们自己的代码事实。
> 只动渲染层，不需要改 pi 协议。当前工作区有一批未提交的 i18n 改动，新文案要走 `useTranslation` + `dictionary.ts`。

## 一、我们的现状（代码事实）

- `ChatView.tsx` 直接 `map` 每条消息：`user` → `UserMessageView`，`assistant` → `AssistantMessageView`（内部按 block 渲染 text / thinking / toolCall），`toolResult` → 兜底 `ToolCard`。
- 每条 assistant 独立成卡、各自带 `message-label`（model + 时间）与 `message-meta`（tokens / cost）。
- 工具卡逐张管理 `open`；`running | error` 强制展开；`toolCardsExpanded` 只影响"新卡默认展开"。
- **没有"轮"的概念**，也没有"完整记录"视图，所以过程一多就是一条读不完的长河，答案被切碎。

## 二、Codex 与 Claude Code 怎么做的（本机实测）

### Claude Code 2.1.292

| 观察到的实现 | 证据（二进制字符串） |
| --- | --- |
| 有全局 `ctrl+o` = **toggleTranscript**，专门在"主视图"和"完整 transcript"之间切换 | `app:toggleTranscript","Global","ctrl+o"` |
| 折叠内容后面跟显式键位提示 | `` ge.dim(`(${r} to expand)`) `` → 渲染成 `(ctrl+o to expand)` |
| **工具结果是"一行折叠 + 点击展开"**，不是整轮折叠 | `· Click to expand collapsed tool results` |
| 大输出按行截断，露出"还有 N 行" | `aboveTheFold` / `remainingLines` 变量名 |
| 一次连发多条消息会合并成一行摘要 | `sent a message (ctrl+o)` / `sent ${y} messages (ctrl+o)` |
| thinking 显示是一等设置（不是硬编码） | `--thinking-display <display>`、`setThinkingDisplayExplicit` |
| 失败就地在原位给重试 | `Press Ctrl+R to retry · Press … to cancel` |
| 有 `/context all to expand` 这类"按需全展开"的命令 | `/context all to expand` |

### Codex CLI 0.161.0

| 观察到的实现 | 证据 |
| --- | --- |
| 独立的 **transcript 视图**（overlay），带布局、搜索、tabs、disclosure 四套模块 | `tui/src/transcript_view/{layout,search,disclosure,text_tabs}.rs` |
| **活动组（activity group）可以聚焦展开/收起**，不是按消息 | `focus_activity`：`Focus transcript activity groups to expand or collapse their details` |
| 主视图只留最近的，历史指向完整记录 | `Earlier messages are available press <key> to view the full transcript` |
| transcript 内搜索有完整交互（命中计数、上下跳、esc 关闭） | `No more matches` / `enter next previous` / `full transcript esc close` |
| **系统提示里直接规定：过程在最终答案出现后折叠** | `users should never need to read earlier commentary updates, since they are collapsed after the final answer is shown to users` |
| 大输出带明确的截断标记 | `original token count: N`、`Warning: truncated output`、`[omitted …]` |
| 模型输出有 inline / fullscreen 两种显示模式 | `preferred_model_display_mode: inline / fullscreen` |
| 运行态有耗时与重试计数 | `Working for …`、`attempts`、`Ctrl+N` |

### 提炼成 7 条原则

1. **两面真相**：主视图永远压缩，另有一个"完整记录"视图承载全量（`ctrl+o` / transcript overlay），而不是让用户在长河里去折叠。
2. **折叠单元是"活动组"**，粒度天然包含"多条消息 + 多次工具调用"，而不是单条消息。
3. **结论一到就折**：Codex 的系统提示写死了这个契约——过程不需要读者再回看。
4. **每层折叠都给键位提示**，且全局一致（他们用 `ctrl+o`）。
5. **大输出按行截断**（前 N 行 + 还有 M 行），而不是"全展开 or 全隐藏"。
6. **thinking 显示是设置项**，三档；不是散落在组件里的默认值。
7. **失败就地可重试**，不需要回到输入框重发。

## 三、目标

1. 结论优先：默认看到"我问了什么 + pi 最后答了什么"，过程一行摘要、随时展开。
2. 过程可查：展开后与现在完全一致（thinking / 工具卡 / diff 都不动），另有完整记录视图兜底。
3. 不打断阅读：折叠/展开不跳视口；流式中不折叠。
4. 可持久：折叠状态跨会话切换、重启保留。
5. 可批量：一键收/展；历史聚合。

## 四、交互设计

### 4.1 折叠单元 = 一轮（Turn）

```
Turn = [ user message ] + [ 其后连续的 assistant / toolResult / custom 消息，直到下一条 user ]
```

以 user 消息为界，不依赖 pi 的 entry id，稳定。

### 4.2 三档（沿用 v1，措辞按参考实现校准）

| 档 | 显示 | 说明 |
| --- | --- | --- |
| `full` | 现状全展开 | 跟跑 / 排查 |
| `steps`（默认） | 用户消息 + **最终结论** + 一行摘要 | 日常阅读 |
| `compact` | 用户消息单行 + 一行摘要 | 历史 |

摘要行（兼顾 Codex 的 activity group 与 Claude 的 "sent N messages"）：

```
⌄ 12 步 · read×4 edit×2 bash×3 · 6 个文件 · 1m24s · 18.2k tokens   (⌘⇧O 看完整记录)   [1 失败]
```

- 失败数 > 0 → 右侧红点，点摘要行直接跳到第一处失败的工具卡；
- 行内小按钮（hover）：`展开` / `只看结论` / `复制本轮`；
- 运行中的轮次摘要是活的：`运行中 · 已 42s · bash 正在执行`，每秒 tick。

### 4.3 折叠时机（按 Codex 的契约改）

1. 流式中的轮次永远 `full`；
2. **最终答案落地的瞬间，该轮降为 `steps`**（不等下一条消息）——这是 Codex 系统提示里写死的用户体验契约；
3. 更早的轮次（默认超过 5 轮）**聚合成一条**：`更早的 12 轮 · 1 小时前 · 查看完整记录`（不是 12 条 compact，避免主视图刷屏）；这是 Claude 的 "sent N messages" 与 Codex 的 "Earlier messages are available" 的结合；
4. 手动设置过的轮次以手动为准（`manual` 标记），不再被自动策略改动。

设置项（设置 › 常规 › 对话）：

- `结论出现后收起过程`（默认开）
- `更早的轮次聚合`（默认开，阈值 5）
- `默认档位`（`steps` / `full`）
- `思考内容显示`（`off` / `summary` / `full`，默认 `summary` = 折叠成一行"思考 12 行 · 4.2s"）

### 4.4 完整记录视图（新增，参考 ctrl+o / transcript overlay）

- 入口：侧栏底部"完整记录"按钮、`⌘⇧O`、每个摘要行的 `(⌘⇧O 看完整记录)`；
- 内容：当前会话**全量、不折叠**的 transcript（复用现有 `AssistantMessageView` / `ToolCard`）；
- 顶部常驻搜索框（`⌘F` 自动聚焦）：命中计数 `3/17`、`⏎` 下一个 / `⇧⏎` 上一个、`Esc` 关闭；命中项自动展开所在轮；
- 右侧细导航条：每轮一个刻度（错误红点、当前轮高亮），点击跳转。

### 4.5 工具卡内部：按行截断（参考 aboveTheFold / remainingLines）

- 默认显示前 **20 行**，下面一条 `… 还有 132 行 · 显示全部`（点击展开，不改变卡片折叠状态）；
- `bash` 输出优先显示**尾部**（tail），并标注 `… 前面省略 980 行`；
- 截断只影响显示，不影响复制（复制仍是全文）。

### 4.6 键盘

| 键 | 动作 |
| --- | --- |
| `⌘⇧O` | 打开/关闭完整记录 |
| `⌘.` / `⇧⌘.` | 全部收成 `steps` / 全部展开 |
| `⌘F` | 会话内搜索（完整记录里定位，主视图同步展开命中轮） |
| `⌘↑` / `⌘↓` | 上/下一轮 |
| `Esc` | 关弹层 → 停止运行 → 收起当前轮（顺序待你确认） |

## 五、实现方案

### 5.1 数据结构（新增 `lib/turns.ts`）

```ts
export interface Turn {
  key: string            // 稳定 id：user 消息 timestamp + 序号
  user: UserMessage | null
  items: AgentMessage[]
  stats: {
    steps: number
    tools: Record<string, number>
    files: string[]
    errors: number
    durationMs?: number
    tokens: number
    cost: number
  }
  streaming: boolean
  finalText: string      // 最后一条 assistant 的正文（steps / compact 档用）
}
```

`buildTurns(messages, toolRuns, results)` 一次 O(n) 扫描 + `useMemo`。

### 5.2 折叠状态（新增 `lib/turn-fold.ts`）

```ts
type FoldLevel = 0 | 1 | 2            // full / steps / compact
// localStorage: pi.folds.<sessionPath> => { [turnKey]: { level, manual } }
```

- 切换会话读取，写入 debounce 200ms；
- 不写 pi 的 JSONL。

### 5.3 组件

```tsx
<TurnView turn={turn} level={level} onLevel={setLevel} streaming={...} />
  ├─ UserMessageView                       // 永远显示
  ├─ full    → items.map(...)              // 现有 AssistantMessageView / ToolCard
  ├─ steps   → TurnSummary + <AnswerOnly/> // 只渲染最后一条 assistant 的 text block
  └─ compact → TurnSummary(collapse="one-line")
```

- `steps` 档**不挂** thinking / 工具卡 / 中间陈述（顺带省 DOM）；
- `TurnSummary` 同时服务于"历史聚合行"；
- 现有 `AssistantMessageView` / `ToolCard` 不动，只在 `full`（和完整记录视图）里用。

### 5.4 滚动锚定（最容易做崩）

1. 切档前记录：视口顶部第一个 `.turn[data-turn-key]` + 其相对视口 offset；
2. 折叠后 `requestAnimationFrame` 里恢复同一 turn 的 top；
3. 期间 `programmatic.current = true`，抑制 `onScroll` 的 stick 计算；
4. 锚点轮次本身高度不够还原 offset 时，退化为"把该轮贴到视口顶部"。

## 六、配套优化（按性价比）

### P1

1. **连续同类工具合并成组**：`read`×5 → `读取 5 个文件`（展开仍是 5 张卡）——折叠只解决"整轮"，不解决"轮内十几张卡"。
2. **工具卡摘要统一**：`read/edit/write` → `路径 · 行数`；`bash` → `命令 · 退出码 · 耗时`；缺字段时不再退化成原始 title。
3. 轮次级操作：复制本轮（问题 + 结论 + 工具摘要的 markdown）、导出、`从这里重试`。
4. 错误行内联 `重试`（对齐 Claude 的 Ctrl+R），并把 `pi` 的原始 error 折叠在"详情"里。
5. 轮次 meta 上移：`1m24s · 18.2k tokens · $0.004` 放摘要行，单条消息只留 hover。

### P2

6. 虚拟化：>150 条消息只渲染视口 ± 3 屏（折叠后高度稳定，正好适合虚拟列表）。
7. 文件路径可点：Finder / 编辑器打开（`shell.showItemInFolder` 已有，加 open-in-editor）。
8. diff 增强：展开全文件、复制改后内容、上/下一变更块。
9. 图片 lightbox（附件 + 工具产出）。
10. 完整记录的搜索命中高亮与"仅看错误"过滤。

### P3

11. 后台完成 → 系统通知（窗口失焦时）。
12. 轮次书签 / 标记"重要轮次"。
13. 导出整段对话（复用 pi 的 `export_html`）。
14. 多窗口 / 分屏对比两轮输出。

## 七、测试（延续 mock-pi + `npm run e2e`）

| # | 用例 | 断言 |
| --- | --- | --- |
| 1 | 一轮含 5 个工具调用，点摘要行 | 只剩结论 + 摘要行；`.tool-card` 数为 0 |
| 2 | 再点展开 | `.tool-card` 恢复 5 个，内容一致 |
| 3 | 折叠上方某轮 | 锚点 turn 的视口 top 不变（±2px） |
| 4 | 折叠后重启 | localStorage 档位被恢复 |
| 5 | 流式中 | 该轮保持 `full` |
| 6 | 最终答案到达 | 该轮自动降为 `steps`（开关开） |
| 7 | 第 6 轮之后 | 出现"更早的 N 轮"聚合行，且能一键展开 |
| 8 | `⌘⇧O` | 完整记录打开，含全部工具卡；`Esc` 关闭 |
| 9 | 完整记录里 `⌘F` 搜关键字 | 命中计数正确、⏎ 跳下一个、命中轮自动展开 |
| 10 | bash 输出 500 行 | 默认只渲染 20 行 + "还有 480 行"；点"显示全部"变 500 |
| 11 | 折叠态 | 折叠轮不产生 `.md-body` / `.tool-card` 节点（性能断言） |
| 12 | `⌘.` / `⇧⌘.` | 全部轮次档位批量变化 |

## 八、排期

| 阶段 | 内容 | 工作量 |
| --- | --- | --- |
| **P0** | Turn 分组 + 三档 + 摘要行 + 结论到达即折叠 + 历史聚合行 + 滚动锚定 + 持久化 + `⌘.`/`⇧⌘.` + 6 条 e2e | 1 天 |
| **P1** | 完整记录视图（含 `⌘F` 搜索/导航条）+ 工具结果按行截断 + 连续工具合组 + 工具摘要统一 + 轮次复制/重试 | 1–1.5 天 |
| **P2** | 虚拟化 + 文件跳转 + diff 增强 + 图片 lightbox | 1–2 天 |
| **P3** | 通知 / 书签 / 导出 / 多窗口 | 视情况 |

## 九、落地结果（v0.1.4）

已实现：Turn 分组、三档折叠（full / steps / compact）、过程摘要行（含耗时与 token/费用、错误徽标）、结论到达即自动折叠、更早轮次聚合成一行、滚动锚定、按会话持久化、`⌘.` / `⇧⌘.` / `⌘⇧O` / `⌘↑↓`、完整记录视图（`⌘F` 搜索 + 命中计数 + 上下跳 + 去重渲染）、连续同类工具合组、工具输出按行截断（bash tail 优先）、轮次复制 / 重试、设置项（自动折叠 / 聚合阈值 / 思考显示 off·summary·full）、右侧轮次导航条。

未做（P2 余项）：虚拟化、工具卡路径跳转、diff 增强、图片 lightbox、系统通知、导出 HTML。

## 十、需要拍板（已按参考实现收敛成 4 条）

1. **"结论到达即折叠"** 采纳吗？（Codex 的系统提示就是这么定的；我建议采纳，配 `设置` 开关）
2. **完整记录视图**要不要一起做？（Claude/Codex 都有，我建议做，放在 P1 而不是 P0）
3. **历史聚合阈值**：默认超过几轮就聚合成"更早的 N 轮"？（建议 5）
4. **工具输出默认只显示 20 行 + 还有 N 行**，复制仍是全文 —— 接受吗？（建议接受，bash 用 tail 优先）

回"1 采纳、2 做、3 用 5、4 接受"我就开工 P0。
