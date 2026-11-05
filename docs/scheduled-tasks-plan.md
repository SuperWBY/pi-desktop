# 定时任务（Scheduled Tasks）调研与实现方案

目标：在 Pi Desktop 侧栏加入「定时任务」，不是演示用的假开关，而是真的能按计划启动 pi、执行 prompt、保存会话与运行记录，并在失败/错过时给出状态。

---

## 1. 经典 Agent 产品是怎么做的

### ChatGPT Tasks / Scheduled

- 侧栏有独立 **Scheduled** 页面：新建、查看下次运行、暂停/恢复/编辑/删除。
- 任务 = prompt + 时间/周期 + 目标会话；支持一次性、每天、每周、工作日、时间窗口。
- 定时任务与普通对话关联；删除关联对话会自动暂停任务。
- 支持事件触发（Gmail / Slack / GitHub webhook）作为时间触发的补充。
- 运行在云端，不依赖本机；有频率下限（例如每小时最多一次）和每档位的活跃任务数量上限。
- 每次运行产生结果，可在任务里查看历史和通知。

### Claude Cowork Scheduled tasks

- 左侧栏 **Scheduled**；两种创建方式：让 Claude 代建（多轮确认）或手动表单。
- 手动表单字段：任务名、prompt、approval mode、频率（hourly / daily / weekly / weekdays / manual）、模型（可选）、工作目录（可选）。
- **每次运行是一个独立的 Cowork session**，默认全新上下文；连接器、skills、plugins 与普通任务一致。
- 本地运行时要求电脑唤醒且桌面 app 打开；睡眠/关闭期间错过的任务，恢复后补跑并提示延迟。
- 支持 pause / resume / run now / edit / delete，以及 upcoming / past runs。
- 云端版本改为在服务器运行，关掉电脑也能跑。

### Manus Automations / Scheduled Tasks

- 统一为 Automations：Schedule（时间）、Trigger（事件）、Advanced（自然语言编排）。
- 支持一次性、每天、工作日、每周、每月、自定义 cron；时区可选；最小间隔 5 分钟；可设置结束时间。
- **Run mode**：每次在同一个 task 里继续（保留历史/文件），或每次开新 task（独立结果）。
- 可以绑定 Project，复用项目的 instructions、files、skills、connectors、输出规范。
- 列表展示状态、下次运行、成功率、平均耗时、完整运行历史；支持 Test run。
- 云端执行，不依赖本地 app。

### 共同抽象

| 模块 | 作用 |
| --- | --- |
| 任务定义 | prompt、名称、schedule、项目/工作目录、模型、工具/审批策略、run mode |
| 调度器 | 计算 nextRun、触发、时区/DST、错过补跑、并发控制 |
| 执行器 | 起一个 agent 会话跑 prompt，隔离上下文，设置超时/重试 |
| 运行记录 | 每次 run 的状态、耗时、session、输出、错误 |
| 管理界面 | 列表、详情、创建/编辑、暂停/恢复、立即运行、删除 |
| 通知 | 成功/失败/错过、点通知回到 run |
| 安全 | 无人值守的权限边界、工具白名单、审批模式、敏感操作限制 |

---

## 2. Pi Desktop 的现实约束

- 当前是 **Electron 桌面端 + 本地 pi 子进程**，没有云端执行环境。
- pi CLI 没有 `schedule` 命令；但支持无交互执行：

```bash
pi -p \
  --session-dir <sessions> \
  --name "定时任务：<name> <date>" \
  --model <model> \
  --thinking <level> \
  " <prompt> "
```

- `--session-id <id>` 可以在同一目录复用同一个会话，实现「同任务连续上下文」；不传则每次新会话。
- 应用已有 `PiProcess`（RPC）用于聊天；定时任务不建议复用当前聊天进程，避免打断用户正在进行的会话。每次 run 单独 `spawn pi -p`，结束后退出。
- 本地执行意味着：**app 关闭时不会跑**。要做到关掉 app 也能跑，必须接 macOS `launchd` / Windows Task Scheduler，或做云端。

---

## 3. 建议的产品形态

侧栏在「技能与插件」下面增加：

```
⏱ 定时任务        3
```

整页管理，风格与技能页一致：

- 顶部：`定时任务` + `3 个启用 · 1 个暂停` + 新建按钮。
- 列表行：名称、频率（`每天 09:00`）、项目、下次运行、上次结果、开关。
- 点击进入详情：prompt、schedule、项目/模型/工具、运行历史（成功/失败/错过）、`立即运行`、`暂停`、`编辑`、`删除`。
- 新建任务用 Modal：
  - 名称
  - Prompt（多行）
  - 项目目录（复用 folder picker）
  - 频率：每小时 / 每天 / 工作日 / 每周 / 自定义 cron
  - 时间 + 时区
  - 运行方式：新会话 / 继续同一会话
  - 模型 / 思考强度（可选，默认继承）
  - 通知开关
  - 无人值守权限提示

---

## 4. 数据模型

```ts
type Cadence =
  | { type: 'hourly'; minute: number }
  | { type: 'daily'; time: string }          // "09:00"
  | { type: 'weekdays'; time: string }
  | { type: 'weekly'; weekday: number; time: string }
  | { type: 'cron'; expression: string }
  | { type: 'once'; at: string }

interface ScheduledTask {
  id: string
  name: string
  prompt: string
  projectPath: string
  cadence: Cadence
  timezone: string                          // IANA, e.g. Asia/Shanghai
  runMode: 'new-session' | 'continue-session'
  model?: string
  thinking?: string
  tools?: string[]                          // allowlist; undefined = default
  notifications: boolean
  enabled: boolean
  createdAt: number
  updatedAt: number
  nextRunAt: number | null
  lastRunAt: number | null
  lastStatus: 'success' | 'failed' | 'missed' | 'running' | null
  consecutiveFailures: number
}

interface TaskRun {
  id: string
  taskId: string
  trigger: 'schedule' | 'manual' | 'catch-up'
  status: 'running' | 'success' | 'failed' | 'timeout' | 'skipped'
  startedAt: number
  endedAt?: number
  exitCode?: number | null
  sessionPath?: string
  logPath: string
  summary?: string
  error?: string
}
```

存储位置：`app.getPath('userData')/schedules/`

```
tasks.json
runs/<taskId>/<runId>.json
logs/<taskId>/<runId>.log
```

不复用 pi 的 `settings.json`，定时任务是应用层数据；项目路径只作为执行 cwd。

---

## 5. 调度器实现

### 5.1 进程内调度（Phase 1，推荐先做）

- 主进程启动时加载任务，计算 `nextRunAt`。
- 一个 20–30 秒的 tick + 精确 `setTimeout` 到最近一次 nextRun；tick 用于兜底和时区/DST。
- `powerMonitor.on('resume')`、窗口恢复、系统时间变化时重新计算。
- 触发前先写一条 `TaskRun(status='running')` 做 claim，避免重复执行。
- 到点条件：`enabled && nextRunAt <= now && 没有同任务 run 在跑`。
- 执行完成后计算下一次；失败按策略重试一次。

### 5.2 错过补跑（app 睡眠/关闭）

- 启动/唤醒时扫描 `nextRunAt < now` 的任务。
- 每个任务只补跑 **最近一次**，不补全部积压；run 标记 `catch-up`，UI 显示「已延迟」。
- 计算下一次时基于当前时间向前推，避免连环触发。

### 5.3 并发

- 全局并发默认 1，可配置为 2。
- 同一任务永不并发；上一次还在跑时到点记 `skipped`（overlap）。
- 队列按 `nextRunAt` 排序；任务超时（默认 30 分钟）kill 子进程并记 `timeout`。

### 5.4 时区与 DST

- 任务保存 IANA 时区；用 `croner`（或等价库）计算下一次，避免手写 DST 逻辑。
- UI 显示本地时间；跨时区旅行不改变任务定义。

### 5.5 关掉 app 也能跑（Phase 3）

两条路线：

1. **OS 调度器**
   - macOS：LaunchAgent plist，按任务时间调用 `Pi Desktop --run-scheduled <taskId>`。
   - Windows：Task Scheduler 调用 `Pi Desktop.exe --run-scheduled <taskId>`。
   - app 在单实例锁之前处理这个 argv：headless 执行、写 run、退出，不打开窗口。
   - 需要处理：路径空格、权限、首次授权、睡眠唤醒、更新后 plist 重建。
2. **常驻 helper / 云端**
   - 独立 Node/Electron helper 常驻，或把任务提交到远端 worker。
   - 成本更高，但可靠性和跨设备能力最好。

Phase 1/2 先明确：**app 必须开着**，UI 里写清楚；不要假装关掉也能跑。

---

## 6. 执行器

```ts
spawn(piPath, [
  '-p',
  '--session-dir', sessionsDir,
  '--name', `定时任务：${task.name} ${date}`,
  ...(task.runMode === 'continue-session' ? ['--session-id', task.id] : []),
  ...(task.model ? ['--model', task.model] : []),
  ...(task.thinking ? ['--thinking', task.thinking] : []),
  ...(task.tools?.length ? ['--tools', task.tools.join(',')] : []),
  prompt
], {
  cwd: task.projectPath,
  env: augmentedEnv(),
  timeout: 30 * 60_000
})
```

- stdout/stderr 落盘到 `logs/<taskId>/<runId>.log`。
- 从输出/会话文件提取最终回答作为 `summary`。
- 子进程退出后读 session 文件路径，写入 run，UI 可直接打开该会话。
- 失败保留最后 200 行日志，详情页可复制诊断。
- 不在 run 中弹交互 UI；pi 的 `select/confirm` 在 `-p` 下会失败，因此任务 prompt 要写成自包含、无需确认的。

### 安全策略

- 默认 `tools` 继承；新建任务时明确提示「无人值守会读写文件/执行命令」。
- 提供只读模板（`--tools read,grep,find,ls`）给摘要/监控类任务。
- 不自动加 `--approve`；项目本地文件是否可信由用户显式选择。
- prompt 里不要放密钥；日志默认落本地。
- 失败通知包含任务名、错误摘要、打开运行详情。

---

## 7. IPC 与 UI

```ts
schedules:list(): Promise<ScheduledTask[]>
schedules:create(input): Promise<ScheduledTask>
schedules:update(id, patch): Promise<ScheduledTask>
schedules:delete(id): Promise<void>
schedules:runNow(id): Promise<TaskRun>
schedules:pause(id): Promise<void>
schedules:resume(id): Promise<void>
schedules:runs(taskId): Promise<TaskRun[]>
schedules:openRun(taskId, runId): Promise<void>   // 打开对应会话
```

事件：

```
schedules:changed        // 任务增删改 / 状态变化
schedules:run-progress   // running / done / failed
```

侧栏计数取 `enabled` 任务数；运行中在入口显示一个小 spinner，和会话执行中一致。

---

## 8. 分阶段落地

**Phase 1：能真的跑**
- 数据模型 + 本地 JSON 存储
- 进程内调度（每小时/每天/工作日/每周）
- 新建/编辑/删除/暂停/恢复/立即运行
- 每次 run 独立 pi 进程 + 日志 + 运行记录
- 侧栏入口 + 列表 + 详情运行历史
- app 打开才执行，UI 明确说明

**Phase 2：可靠性**
- 错过补跑、并发/重叠策略、超时、失败重试
- 系统通知 + 点通知跳转
- 自定义 cron、时区/DST
- 继续同一会话 / 新会话两种模式
- 只读/工具白名单模板

**Phase 3：后台执行**
- macOS LaunchAgent / Windows Task Scheduler
- headless `--run-scheduled` 启动路径
- 安装/卸载/更新时重建系统计划
- 代码签名与权限处理

**Phase 4：触发器**
- Gmail/Slack/GitHub webhook 或轮询
- 事件条件 + 去重 + 冷却时间

---

## 9. 关键设计结论

1. **任务不是聊天**：每次运行是一个独立 pi 进程/会话，聊天界面只是查看结果的入口。
2. **调度与执行分离**：调度器只负责 claim + nextRun；执行器只管跑一次并写 run。
3. **必须持久化 nextRun 和 run 记录**，不能只靠 `setInterval` 内存状态。
4. **错过只补一次**，不要醒来后连跑十个积压任务。
5. **本地 app 关闭 = 不执行**，这是 Phase 1/2 的硬边界；要跨关闭执行必须上 OS 调度器或云端。
6. **无人值守的安全边界要在创建时讲清楚**，默认不静默批准项目文件，不默认放开全部工具。

参考：
- ChatGPT Scheduled Tasks: https://help.openai.com/en/articles/10291617-scheduled-tasks-in-chatgpt
- Claude Cowork scheduled tasks: https://support.claude.com/en/articles/13854387-schedule-recurring-tasks-in-claude-cowork
- Manus Automations / Scheduled Tasks 2.0: https://manus.im/blog/manus-schedules
