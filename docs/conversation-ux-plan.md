# 对话输出（Turn）交互方案

> 前提：只动渲染层，不需要改 pi 协议。当前工作区里有一批未提交的 i18n 改动（`src/renderer/src/i18n/`，19:00 之后），本方案里的新文案都要走 `useTranslation` + `dictionary.ts`，所以建议等那批改动落定后再开工。

## 一、现在的结构（代码事实）

- `ChatView.tsx` 直接 `map` 每条消息：`user` → `UserMessageView`，`assistant` → `AssistantMessageView`（内部再按 block 渲染 text / thinking / toolCall），`toolResult` → 兜底 `ToolCard`。
- 每条 `assistant` 是独立卡片，各自带 `message-label`（model 名 + 时间）和 `message-meta`（tokens / cost）。
- 工具卡是逐张的：`ToolCard` 自己管 `open`，`status === 'running' | 'error'` 强制展开，`toolCardsExpanded` 只是"新卡默认展开"。
- **没有"轮"的概念**：一个用户提问 + 之后的 N 条 assistant + M 张工具卡，在 DOM 上是平铺的一串。

于是观感上就是：问题 → 卡片 → 卡片 → 卡片 → 结论，答案被切碎；想回看上一轮结论要滚很久；而工具卡已经单独能收，缺的是**中间过程的整体收拢**。

## 二、目标

1. **结论优先**：默认看到"我问了什么 + pi 最后答了什么"，中间过程一行摘要、随时展开。
2. **过程可查**：展开后和现在完全一样（thinking、每张工具卡、diff 都不动）。
3. **不打断阅读**：折叠/展开不跳视口，流式中不折叠。
4. **可持久**：手动折叠的状态在切换会话、重启应用后还在。
5. **可批量**：一键"只看结论"，一键"全部展开"。

## 三、交互设计

### 3.1 折叠单元 = 一轮（Turn）

```
Turn = [ user message ] + [ 之后连续的 assistant / toolResult / custom 消息，直到下一条 user ]
```

以 user 消息为分界，不依赖 pi 的 entry id，天然稳定。

### 3.2 三档折叠状态

| 档位 | 显示内容 | 用途 |
| --- | --- | --- |
| `full` 完全展开 | 现状：thinking + 每张工具卡 + 所有中间陈述 + 结论 | 正在跟跑 / 排查 |
| `steps` 过程折叠（**默认**） | 用户消息 + **最后一条 assistant 的正文结论** + 一行过程摘要（可展开） | 日常阅读 |
| `compact` 整轮折叠 | 用户消息（单行截断）+ 摘要行 | 历史浏览、长会话 |

摘要行（`steps` / `compact` 共用）：

```
⌄ 12 步 · read×4 edit×2 bash×3 · 6 个文件 · 1m24s · 18.2k tokens        [1 失败]
```

- 失败数 > 0 时右侧红点，点摘要行直接跳到第一处失败的工具卡；
- hover 显示工具名与文件清单；
- 摘要行左侧 chevron，点击整行切换 `steps ⇄ full`；
- 行内小按钮（hover 才出现）：`展开`、`只看结论`、`复制本轮`。

### 3.3 自动折叠策略（默认值，可在设置里关）

1. 流式中的轮次永远 `full`；
2. 用户发出下一条消息时，**上一条自动降为 `steps`**（最符合"刚跑完想看一眼结论"）；
3. 距今天 > 最近 N 轮（默认 5）的历史轮次自动降为 `compact`；
4. 用户手动设置过的轮次以手动为准，不再被自动改动（记录 `manual` 标记）。

三个开关放 设置 › 常规 › 对话：
- `自动收起上一轮`（默认开）
- `历史轮次降为摘要`（默认开，阈值 5）
- `默认档位`（`steps` / `full`）

### 3.4 键盘

| 快捷键 | 动作 |
| --- | --- |
| `⌘.` | 全部收成 `steps` |
| `⇧⌘.` | 全部展开 `full` |
| `⌥.` | 全部收成 `compact` |
| `⌘↑` / `⌘↓` | 跳到上/下一轮（焦点轮次高亮一下） |
| `Esc` | 优先级：先关弹层/抽屉 → 再停运行 → 最后收起当前轮（需确认这个顺序） |

## 四、实现方案

### 4.1 数据结构（渲染层，新增 `lib/turns.ts`）

```ts
export interface Turn {
  key: string                 // 稳定 id：user 消息 timestamp + 序号
  index: number
  user: UserMessage | null    // 会话开头若直接是 assistant，则 user 为 null（记为 "开场轮"）
  items: AgentMessage[]       // assistant / toolResult / custom
  stats: {
    steps: number             // assistant 消息 + toolCall 数
    tools: Record<string, number>
    files: string[]           // 从 toolCall.arguments.path 收集
    errors: number
    startedAt?: number
    endedAt?: number
    durationMs?: number
    tokens: number
    cost: number
  }
  streaming: boolean
}
```

`buildTurns(messages, toolRuns, results)` 一次 O(n) 扫描；`useMemo` 依赖 `state.messages`。

### 4.2 折叠状态（新增 `lib/turn-fold.ts`）

```ts
type FoldLevel = 0 | 1 | 2   // full / steps / compact
// localStorage: pi.folds.<sessionPath> => { [turnKey]: { level, manual } }
```

- 会话切换时读对应 key；写入 debounce 200ms；
- 会话被删除 → 顺手清 key（可选）；
- 不写 session 文件，不污染 pi 的 JSONL。

### 4.3 组件（新增 `components/TurnView.tsx`）

```tsx
<TurnView turn={turn} level={level} onLevel={setLevel} streaming={...} />
  ├─ <UserMessageView/>                     // 永远显示
  ├─ level === full   → items.map(...)      // 现有 AssistantMessageView / ToolCard
  ├─ level === steps  → <TurnSummary/> + 最后一条 assistant 的正文（复用 TextBlockView）
  └─ level === compact→ <TurnSummary collapse="one-line"/>
```

要点：
- `steps` 档**只渲染最后一条 assistant 的 text block**，thinking / tool cards / 中间陈述都不进 DOM（顺带省渲染）；
- `TurnSummary` 显示摘要行；展开时用 `items.map` 的同一套组件，避免两套渲染逻辑；
- 现有 `AssistantMessageView` / `ToolCard` 不改，只在 `full` 档使用；`steps` 档需要一个轻量的 `<AnswerOnly message/>`；
- 连续同类工具合并在 P1 做（见 §5），先不做，避免一次改太多。

### 4.4 滚动锚定（最容易做崩的地方）

折叠/展开会改变 `chat-inner` 高度，现有 `stickRef` + `ResizeObserver` 会把视口拽到底部。做法：

1. 切换档位前记录锚点：`const anchor = 视口顶部第一个 .turn[data-turn-key] + 其相对视口 offset`；
2. 折叠后 `requestAnimationFrame` 里把同一 turn 的 top 恢复到原 offset；
3. 期间 `programmatic.current = true`，抑制 `onScroll` 的 `stick` 计算；
4. 如果锚点轮次自己被折叠且高度不足以维持 offset，退化为"保持该轮 top 在视口顶部"。

### 4.5 粘性轮次头（P2）

轮次很长时（工具跑 50 步），滚到中间会失去"这是哪一轮"的上下文。做法：`position: sticky` 的 34px 轮次条，内容 = 用户消息首行 + 档位按钮；只在 `full` 档出现。

## 五、配套的输出侧优化（回答"还有什么可以优化"）

按"性价比 / 用户可感知"排序：

### P1（做完折叠顺手做，收益最大）

1. **连续同类工具合并成组**：`read`×5 → `读取 5 个文件`（展开后是 5 张原卡）。现在一次探索能刷出十几张卡，折叠只解决"整轮"，不解决"轮内噪音"。
2. **工具卡摘要统一**：`read/edit/write` 统一成 `路径 · 行数/字节`，`bash` 统一成 `命令 · 退出码 · 耗时`；现在字段缺失时会退化成原始 title。
3. **⌘F 会话内搜索**：命中高亮 + `⌘G/⇧⌘G` 上下一个 + 命中计数；折叠的轮次自动展开（或至少显示"命中在折叠轮内"）。
4. **轮次级操作**：复制本轮（问题 + 结论 + 工具摘要的 markdown）、导出本轮、`从这里重试`。
5. **time / token 归到轮次**：现在每条 assistant 各自显示 tokens/cost，折叠后信息会丢；把 `1m24s · 18.2k tokens` 放到摘要行，单条消息的 meta 改成 hover 显示。

### P2（长会话 / 重度使用）

6. **虚拟化**：>150 条消息时只渲染视口 ± 3 屏；折叠后的轮次高度稳定（fixed size），正好适合虚拟列表。
7. **轮次导航条**：右侧细条 = 每轮一个刻度（错误轮红点、当前轮高亮），点击跳转；`⌘↑↓` 同源。
8. **文件跳转**：工具卡里的路径可点 → 在 Finder 显示 / 用编辑器打开（需要新增 shell IPC，已经有 `shell.showItemInFolder`）。
9. **diff 增强**：默认只显示变更行 ±3（已做）→ 补"展开全文件""复制改后内容""上一个/下一个变更块"。
10. **图片**：附件与工具产出图片点击放大（lightbox），支持 `⌘滚轮` 缩放。

### P3（产品级）

11. 后台完成 → 系统通知（窗口失焦时才发）；
12. 会话书签 / 标记"重要轮次"；
13. 导出整段对话为 HTML/Markdown（pi 的 `export_html` 已有，可复用）；
14. 多窗口 / 分屏对比两轮输出。

## 六、测试（延续 mock-pi + `npm run e2e`）

新增用例（都能在 mock 里造出来：`MOCK_TRANSCRIPT=30` 已经有）：

| # | 用例 | 断言 |
| --- | --- | --- |
| 1 | 一轮含 5 个工具调用，点摘要行 | 只剩结论 + 摘要行；DOM 里 `.tool-card` 数为 0 |
| 2 | 再点展开 | `.tool-card` 恢复 5 个，内容与展开前一致 |
| 3 | 展开状态下折叠上方某轮 | 视口锚点不跳（记录锚点 turn 的 `top`） |
| 4 | 折叠后刷新应用 | localStorage 里的档位被恢复 |
| 5 | 流式中 | 该轮保持 `full`，不被自动策略改动 |
| 6 | 发送新消息 | 上一轮从 `full` → `steps`（开关开时） |
| 7 | `⌘.` / `⇧⌘.` | 全部轮次档位批量变化 |
| 8 | 折叠态渲染 | 折叠轮的 `.md-body`/`.tool-card` 节点不进 DOM（性能） |
| 9 | 连续 5 个 read（P1） | 合并成 1 个组，展开是 5 张卡 |
| 10 | ⌘F 搜索（P1） | 命中数正确、折叠轮自动展开 |

## 七、排期

| 阶段 | 内容 | 工作量 |
| --- | --- | --- |
| P0 | Turn 分组 + 三档折叠 + 摘要行 + 滚动锚定 + 持久化 + 自动降级 + 两个快捷键 + 5 条 e2e | 0.5–1 天 |
| P1 | 工具合组 + 摘要统一 + ⌘F + 轮次复制/重试 + 轮次 meta | 1 天 |
| P2 | 虚拟化 + 导航条 + 文件跳转 + diff 增强 + 图片 lightbox | 1–2 天 |
| P3 | 通知 / 书签 / 导出 / 多窗口 | 视情况 |

## 八、需要你拍板的 5 个点

1. **默认档位**：默认 `steps`（保留结论，过程一行摘要）还是 `full`（现状）？我建议 `steps`。
2. **自动收起时机**：发下一条消息时把上一轮降为 `steps`，还是保留最近 3 轮 `full`？
3. **要不要 `compact` 档**（整轮只剩一行）？也可以只做两档，减少复杂度。
4. **工具合组**默认开还是默认关？（我建议开，但保留全局开关）
5. **`Esc` 优先级**：关弹层 → 停止运行 → 收起当前轮，这个顺序对吗？

拍板后我直接按 P0 开工（Turn 分组 + 三档折叠 + 锚定 + e2e），一次交付可感知的效果。
