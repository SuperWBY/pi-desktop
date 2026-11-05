# 本地定时任务（Local Scheduled Tasks）详细方案

目标：在 Pi Desktop 里做一个**自己的**定时任务模块。参考 `agents-cron`、`@patimweb/pi-cron`、Claude Cowork 的思路，但不直接依赖别人的插件。

范围：

- ✅ 本地执行；任务和运行记录持久化
- ✅ app 重启、电脑睡眠唤醒、登录后重新打开 app，任务自动恢复
- ✅ 错过的任务补跑一次，不重复、不连环触发
- ✅ 每次运行是独立 pi 会话，可查看结果
- ❌ Phase 1 不做「app 关闭时也执行」（后续接 launchd / Task Scheduler）

---

## 1. 从现有插件借鉴什么

| 来源 | 借鉴点 | 不照搬 |
| --- | --- | --- |
| `agents-cron` | 调度与执行分离；每次独立 session；任务存储是唯一共享状态；运行记录/锁 | 系统 cron 外部调度、AGPL、Pi 内 `/schedule` 管理面 |
| `@patimweb/pi-cron` | 工具 allowlist；错过只补一次；中断后重跑；`~/.pi/agent/cron` 数据布局 | 调度器活在 pi 进程里（app 关掉就没了） |
| `@ryan_nookpi/pi-extension-cron` | 作用域（user/project）；LaunchAgent 持久化思路 | macOS-only、daemon 架构 |
| Claude Cowork | 侧栏 Scheduled 页面；手动/对话创建；每次新会话；错过提示延迟 | 云端执行 |
| Manus | 新会话 / 继续同一会话两种 run mode；运行历史 | 云端、项目绑定 |

我们的定位：**调度器在 Electron 主进程，执行器是 `pi -p` 子进程，数据在 app userData；Phase 3 再交给 OS 调度器唤醒。**

---

## 2. 用户体验

### 2.1 侧栏入口

在「技能与插件」下面：

```
⏱  定时任务        3
```

- 数字 = 启用中的任务数
- 有任务正在跑时，数字位置换成小 spinner
- 点击进入整页

### 2.2 列表页

顶部：`定时任务` + `3 个启用 · 1 个暂停` + `新建任务`

列表按下次运行时间排序，每行：

```
每天 09:00        早报
工作日 08:30      检查 CI          pi-desktop     下次 明天 08:30   上次 ✓
每周一 10:00      周报                                       下次 周一 10:00  上次 失败
```

字段：

- 名称
- 人类可读频率
- 项目（可空 = 应用默认目录）
- 下次运行
- 上次状态（成功 / 失败 / 错过 / 中断）
- 启用开关

已暂停的任务放列表底部或单独分组。

### 2.3 新建 / 编辑

Modal 或独立页：

1. **名称**
2. **Prompt**（多行；这是每次运行的完整指令）
3. **项目目录**（folder picker；决定 cwd）
4. **频率**
   - 每小时（第 N 分钟）
   - 每天 HH:mm
   - 工作日 HH:mm
   - 每周（周几 + HH:mm）
   - 自定义 cron
   - 仅一次（日期 + 时间）
5. **时区**（默认跟随系统；可固定 IANA）
6. **运行方式**：新会话 / 继续同一会话
7. **模型 / 思考强度**（可空 = 继承默认）
8. **工具**
   - 继承默认
   - 只读模板（read, grep, find, ls）
   - 自定义 allowlist（传给 `pi --tools`）
9. **错过补跑**（默认开；窗口 24h）
10. **通知**（默认开）
11. 预览未来 3 次运行时间
12. 保存 / 保存并立即运行

保存前显示无人值守警告：

> 定时任务会在没有你确认的情况下读写项目文件、执行命令。请只给可信的 prompt 和工具权限。

### 2.4 详情页

- 名称、状态、频率、项目、下次运行
- prompt 全文（可复制）
- 配置摘要（模型、工具、run mode、时区）
- 未来 5 次运行
- 运行历史列表：

```
09:00  成功   32s   [打开会话] [查看日志]
昨天 09:00  失败  5s   [重试] [日志]
```

- 操作：立即运行、暂停/恢复、编辑、复制任务、删除
- 删除确认：是否同时删除运行记录

### 2.5 通知

- 成功：`早报 已完成` → 点击打开该次运行的会话
- 失败：`早报 失败` → 点击打开运行详情
- 错过/延迟：`早报 已延迟运行`
- 运行中不通知，除非超过阈值（例如 10 分钟）提醒一次

---

## 3. 数据模型

```ts
type Cadence =
  | { type: 'hourly'; minute: number }
  | { type: 'daily'; time: string }                 // "09:00"
  | { type: 'weekdays'; time: string }
  | { type: 'weekly'; weekday: number; time: string }
  | { type: 'cron'; expression: string }
  | { type: 'once'; at: number }

type RunMode = 'new-session' | 'continue-session'
type ToolMode = 'inherit' | 'readonly' | 'custom'

interface ScheduledTask {
  id: string                       // nanoid
  name: string
  prompt: string
  projectPath: string | null
  cadence: Cadence
  timezone: string                 // IANA，默认系统时区
  runMode: RunMode
  model?: string
  thinking?: string
  toolMode: ToolMode
  tools?: string[]                 // toolMode === 'custom'
  catchUp: boolean                 // 默认 true
  catchUpWindowMs: number          // 默认 24h
  notifications: boolean
  enabled: boolean
  createdAt: number
  updatedAt: number
  nextRunAt: number | null
  lastRunAt: number | null
  lastStatus: RunStatus | null
  consecutiveFailures: number
  schemaVersion: 1
}

type RunStatus =
  | 'queued'
  | 'running'
  | 'success'
  | 'failed'
  | 'timeout'
  | 'interrupted'                  // app 退出/崩溃时中断
  | 'missed'                       // 超出补跑窗口
  | 'skipped'                      // 上一次还在跑

interface TaskRun {
  id: string                       // `${taskId}:${scheduledFor}` 确保幂等
  taskId: string
  trigger: 'schedule' | 'manual' | 'catch-up'
  scheduledFor: number | null
  status: RunStatus
  startedAt: number
  endedAt?: number
  durationMs?: number
  exitCode?: number | null
  sessionPath?: string
  logPath: string
  summary?: string
  error?: string
  interruptedByRestart?: boolean
}
```

### 3.1 文件布局

```
<userData>/schedules/
  tasks.json                 # 任务数组 + schemaVersion
  state.json                 # 最后启动时间、cleanShutdown、上次 tick
  runs/<taskId>.jsonl        # 每个 run 一行（追加写）
  logs/<taskId>/<runId>.log  # stdout + stderr
  locks/<taskId>.lock        # pid + startedAt，防并发
```

- 写 `tasks.json`：写临时文件 + `fsync` + rename，避免半截文件。
- `runs` 用 JSONL 追加，读取时按 `runId` 去重。
- 日志限制单文件 5MB，超出截断并标记。
- 启动时清理超过 30 天的运行记录/日志（可配置）。

---

## 4. 调度器

### 4.1 状态

```
disabled ──enable──▶ idle ──到点──▶ running ──成功──▶ idle
   ▲                  │  ▲              │
   └──────pause───────┘  └────失败/超时──┘
```

同一任务永远最多一个 active run。

### 4.2 时间计算

- 使用 `croner` 计算下一次运行；支持 IANA 时区与 DST。
- 预设频率先转换成 cron：
  - hourly `m * * * *`
  - daily `m h * * *`
  - weekdays `m h * * 1-5`
  - weekly `m h * * d`
  - once 直接存 timestamp
- 每次运行结束后重新计算 `nextRunAt`（基于当前时间，而不是上一次计划时间，避免补跑连环触发）。

### 4.3 触发器

- 主进程启动后：`setTimeout` 到最近的 `nextRunAt`（上限 2^31-1）。
- 同时保留 30 秒安全 tick：
  - 系统时间被修改
  - 电脑睡眠导致 timer 漂移
  - 时区变化
- `powerMonitor.on('resume')`：立即重算并检查补跑。
- `powerMonitor.on('suspend')`：记录 `suspendedAt`，不杀正在跑的进程。
- 触发时：

```ts
if (!task.enabled) skip
if (task.nextRunAt == null || task.nextRunAt > now) return
if (hasActiveRun(task.id)) { recordSkipped(); scheduleNext(); return }
const run = claimRun(task, 'schedule')   // 先写 running 记录
await executor.run(task, run)
```

### 4.4 幂等与锁

- runId = `${taskId}:${scheduledFor}`；已存在同 runId 则不重复执行。
- 全局单实例锁（Electron `requestSingleInstanceLock`）保证只有一个调度器。
- 启动时清理 stale lock：pid 不存在或启动时间早于本次进程 → 删除。
- 全局并发默认 1，可配置为 2；队列按 `nextRunAt` 排序。
- 同一任务到点时若上一次还在跑：记 `skipped`，不排队堆积。

### 4.5 失败与重试

- 超时：默认 30 分钟；kill 进程树，记 `timeout`。
- 失败：不自动无限重试。默认对**同一次调度**重试 1 次（间隔 1 分钟），仍失败则等下个周期。
- 连续失败 3 次：任务自动暂停，通知用户「连续失败已暂停」。
- `consecutiveFailures` 在成功时清零。

---

## 5. 重启 / 登录 / 睡眠恢复（重点）

这是本方案的核心，不能只靠内存里的 `setInterval`。

### 5.1 正常退出

- `before-quit`：
  - 停止接受新任务
  - 对正在运行的子进程发送终止信号
  - 将对应 run 标记 `interrupted`
  - 写入 `state.json { cleanShutdown: true, lastExitAt }`
  - 持久化 `nextRunAt`

### 5.2 崩溃/断电

- 上次 `cleanShutdown` 不是 true，或存在 `status='running'` 的 run：
  - 启动时统一标记为 `interrupted`，`interruptedByRestart: true`
  - 清理对应 lock
  - 如果任务开启了补跑且仍在窗口内，则本次启动补跑一次

### 5.3 app 重新打开 / 登录后启动

启动顺序：

1. Electron `ready`
2. 读取 `tasks.json` / `state.json` / runs
3. 恢复所有任务的内存状态
4. **恢复中断的 run**（见 5.2）
5. **补跑扫描**：
   ```
   for task of enabled:
     if task.nextRunAt != null && task.nextRunAt <= now:
       if now - task.nextRunAt <= task.catchUpWindowMs && task.catchUp:
         enqueue catch-up run (trigger='catch-up')
       else:
         record missed run
       task.nextRunAt = nextOccurrence(task, now)
   ```
6. 错开启动：多个补跑任务之间间隔 2–5 秒，避免同时起多个 pi
7. 启动 timer
8. 通知：「2 个定时任务已恢复，1 个补跑中」

**关键规则：不管错过多少个周期，每个任务只补跑一次。**

### 5.4 登录时自动启动 app

设置项：`登录时启动 Pi Desktop`（默认关，首次创建任务时提示开启）。

- macOS / Windows 都用 `app.setLoginItemSettings({ openAtLogin: true, args: ['--background'] })`
- `--background` 启动：
  - 不显示主窗口（或显示但最小化）
  - 仍然初始化调度器
  - 任务完成后发系统通知
  - 用户点通知或 Dock 图标再打开窗口
- 如果暂时没有托盘图标：`--background` 只隐藏窗口，Dock/任务栏仍可恢复。

这样「电脑打开 → 登录 → app 自动启动 → 调度器恢复 → 补跑」闭环成立；不需要 OS 级 cron。

### 5.5 睡眠 / 唤醒

- 睡眠期间 timer 不触发。
- `resume` 后：
  - 重算所有 `nextRunAt`
  - 若 `nextRunAt < now` 且未超窗口 → 补跑一次
  - 记录 run `trigger='catch-up'`
- 不依赖 `setInterval` 累积的次数。

### 5.6 时区 / 系统时间变化

- 任务保存 IANA 时区。
- 系统时区变化时，如果任务时区是「跟随系统」，更新任务时区并重算；固定时区不变。
- 系统时间大幅跳变（前后 > 5 分钟）触发重算，避免 timer 卡住。

---

## 6. 执行器

### 6.1 命令

```bash
pi -p \
  --session-dir <userData>/schedules/sessions/<taskId> \
  --name "定时任务：<name> <yyyy-MM-dd HH:mm>" \
  [--session-id <taskId>] \
  [--model <model>] \
  [--thinking <level>] \
  [--tools <allowlist>] \
  "<prompt>"
```

- `new-session`：不传 `--session-id`，每次独立；运行后从 session dir 找最新文件。
- `continue-session`：传 `--session-id task-<taskId>`，复用同一会话（项目固定）。
- `--tools`：只读模板 = `read,grep,find,ls`；自定义时传 allowlist。
- 不加 `--approve`；项目信任由用户在任务里选择。
- `cwd` = `task.projectPath`；不存在则失败并通知，不自动创建。

### 6.2 进程管理

- `spawn` 时 `detached: true`（POSIX）以便杀整个进程组；Windows 用 `taskkill /pid <pid> /T /F`。
- 捕获 stdout/stderr 写入 log；同时保留最后 200 行用于错误摘要。
- 退出码 0 且无 `error` → success；否则 failed。
- 超时 → timeout，先 SIGTERM，5 秒后 SIGKILL。
- 运行结束后：
  - 找 session 文件 → 写 `sessionPath`
  - 从 session 最后一条 assistant 消息提取 summary（截断 200 字）
  - 更新 task `lastRunAt/lastStatus/consecutiveFailures`
  - 发通知
  - IPC 广播 `schedules:run-finished`

### 6.3 无人值守的边界

- `pi -p` 下交互式 UI 请求（select/confirm）会失败；创建任务时提示 prompt 必须自包含。
- 默认不自动批准项目本地文件；需要时用户显式勾选。
- 工具 allowlist 越小越安全；提供「只读」模板。
- 日志可能包含敏感输出，默认只存本地，详情页可一键清空。

---

## 7. IPC / 前端状态

```ts
schedules:list(): Promise<ScheduledTask[]>
schedules:get(id): Promise<{ task: ScheduledTask; runs: TaskRun[] }>
schedules:create(input: CreateTaskInput): Promise<ScheduledTask>
schedules:update(id, patch): Promise<ScheduledTask>
schedules:delete(id, deleteRuns?: boolean): Promise<void>
schedules:pause(id): Promise<void>
schedules:resume(id): Promise<void>
schedules:runNow(id): Promise<TaskRun>
schedules:runs(id, limit?): Promise<TaskRun[]>
schedules:openRun(taskId, runId): Promise<void>   // 打开对应会话
schedules:preview(cadence, timezone): Promise<number[]> // 未来 3 次
```

事件：

```
schedules:changed
schedules:run-started
schedules:run-finished
schedules:recovery-summary
```

前端 store 增加：

```ts
schedules: ScheduledTask[]
schedulesOpen: boolean
scheduleRuns: Record<taskId, TaskRun[]>
```

侧栏入口与「技能与插件」同一套样式；数字是启用数，运行中显示 spinner。

---

## 8. 页面状态

- 空状态：`还没有定时任务` + `新建任务`
- 加载：骨架行
- 运行中：行内 spinner + `运行中 12s`
- 失败：红色状态点 + 最近错误摘要
- 中断：`因重启中断` + `重试`
- 错过：`已错过（超出补跑窗口）`
- 关闭提醒：`app 关闭期间不会执行；登录后自动补跑一次`

---

## 9. 测试计划

### 9.1 单元测试（纯函数）

- 每种 cadence 的 nextRun（含跨月、闰年、DST）
- 时区转换：`Asia/Shanghai` / `America/New_York`
- 补跑策略：错过 1 次 / 10 次都只补 1 次
- 超出 catchUpWindow → missed
- runId 幂等

### 9.2 集成测试（mock pi）

- 创建任务，nextRun 设为 1 秒后，等待 run 完成，断言 tasks/runs/logs
- 失败退出码 → failed + 通知
- 超时 → timeout + 进程被杀
- 同一任务运行中再次到点 → skipped

### 9.3 重启恢复 e2e

1. 创建任务，`nextRunAt = now - 1h`
2. 关闭 app（模拟崩溃：不写 cleanShutdown）
3. 重新启动
4. 断言：
   - 只有 1 条 catch-up run
   - 原 running run 变 interrupted
   - nextRunAt 已推进到未来
   - 侧栏恢复入口计数

### 9.4 睡眠恢复

- 用 mock 时间源（注入 clock）测试 resume 后的重算，避免真的等。
- 真机手测：合盖 5 分钟，打开后确认补跑与通知。

### 9.5 e2e 标签

```
E2E_ONLY=schedules
```

只跑新功能，符合现有测试策略。

---

## 10. 分阶段

### Phase 1（本次）
- 数据模型、原子存储、run 记录
- 本地调度器（hourly/daily/weekdays/weekly/once）
- 新建/编辑/删除/暂停/恢复/立即运行
- 独立 `pi -p` 执行 + 日志 + session 链接
- 侧栏入口 + 列表 + 详情 + 运行历史
- 重启恢复：中断标记、补跑一次、nextRun 重算
- 登录自启动设置
- 系统通知

### Phase 2
- 自定义 cron、时区/DST、未来运行预览
- 继续同一会话模式
- 工具 allowlist 模板、连续失败自动暂停
- 睡眠唤醒、时间跳变处理
- 历史清理、日志大小限制

### Phase 3
- macOS LaunchAgent / Windows Task Scheduler
- `--run-scheduled` headless 入口，app 完全关闭也能跑
- 安装/更新/卸载时重建系统计划

### Phase 4
- 事件触发（Gmail/Slack/GitHub）
- 对话内创建（`/schedule`）
- 任务模板与分享

---

## 11. 关键设计结论

1. **调度器必须在主进程，不能放渲染层**；渲染层只做 UI。
2. **nextRunAt 必须持久化**，启动时以它为准做补跑判断，不能靠内存 timer。
3. **每个任务只补一次**，并设置补跑窗口，避免开机后连环执行。
4. **运行记录先写 claim 再 spawn**，崩溃后能识别 interrupted。
5. **登录自启动是本地方案的闭环**：电脑打开 → app 启动 → 调度器恢复 → 补跑。
6. **Phase 1 不承诺 app 关闭时执行**，UI 明确写；Phase 3 再接 OS 调度器。
