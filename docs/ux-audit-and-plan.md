# UX 审计与优化路线

审计对象：Pi Desktop 0.1.1（当前 `master`）
审计方式：读代码 + 在真实进程里用 Playwright 做交互实测（`--mode rpc` 真 pi、33 个模型的真实会话）。

---

## 一、已实测复现的问题

### 1. 弹层被"滚动"误关（已修，`ui.tsx`）

现象：打开模型选择后，用触控板往下滑一层，整个弹层立刻消失；模型列表根本滑不动。

根因：`Popover` 里

```ts
const onScroll = (): void => setOpen(false)
window.addEventListener('scroll', onScroll, true)   // capture 阶段
```

capture 阶段监听 `window` 的 `scroll`，所以**弹层内部列表的滚动也算**，第一格滚轮就把自己关了。

实测（修复前 / 修复后）：

| 指标 | 修复前 | 修复后 |
| --- | --- | --- |
| `.menu-list` 可滚动空间 | 1643px / 可见 380px | 同 |
| 列表内滚一格后弹层是否还在 | **关了（0）** | 还在（1），scrollTop=300 |
| 滚动对话区后弹层 | 关了 | 还在，且重新跟随触发器（top 347→350） |
| 点选模型 | — | 正常切换（chip → “Qwen3.8 Flash”）并关闭 |

修法：滚动时不关闭，改为用 rAF 重新 `place()`；只有当滚动发生在弹层内部时才忽略。同一个 bug 也影响推理强度菜单、侧栏会话“…”菜单。

### 2. 模型菜单完全不能用键盘

实测：打开菜单后按 `ArrowDown` `ArrowDown`，焦点仍停在搜索框（`document.activeElement.className === ''`），没有任何高亮项。

缺的东西：方向键上下移动、`Enter` 选中、`Home/End`、hover 与键盘共用一个 "active" 状态、`aria-activedescendant`。
同类问题：`⌘K`/`⌘M` 之类快捷键完全不存在，33 个模型只能靠鼠标找。

### 3. 每次启动都开新会话，上下文丢失

`store.tsx` 启动流程：

```ts
const workspace = boot.settings.lastWorkspace
if (workspace) await openSession(workspace, null)   // ← sessionPath 永远是 null
```

结果：重启后回到项目，但**不会回到上次那个会话**，而是又建一个新会话。侧栏里三个同名的「你好」（now / 18m / 2h）就是这么攒出来的。用户视角就是"我刚才聊的东西没了"。

### 4. pi 的 stderr 全程不可见

`store.tsx:586` 把 stderr 收进 `state.stderr`（保留最后 4000 字），但**渲染层没有任何地方展示它**（`grep stderr src/renderer/src/components` 为空）。

于是最常见的几类失败——401/鉴权过期、`models.json` 语法错误、"No models available"、扩展加载失败——用户只能看到一个笼统 toast，没有任何可自查的信息。

### 5. 设置里的「默认模型」在没开会话时是空列表

来源是 RPC 的 `get_available_models`（`state.models`），会话没起来就是 `[]`。而 0.1.1 里已经有了 `pi --list-models` 的完整结果，却只用在展示上，没用来填这个下拉框。

---

## 二、体检清单（按模块，附位置）

### 弹层 / 菜单系统（`components/ui.tsx`）

- 只会左/右对齐，没有"上下空间不足时翻到另一侧 + 视口内夹取高度"；`menu-list` 固定 `min(50vh,380px)`
- 没有 `role="menu"` / `aria-expanded` / 焦点归还（关闭后焦点不回到触发器）
- 打开弹层时外部滚动仍会带动对话区（靠 `overscroll-behavior` 局部兜住，不彻底）
- 没有子菜单/多级（设置里选了 provider 再选 model 只能靠 optgroup）
- 一次只能开一个弹层的约束是"碰巧成立"（靠 mousedown 关别人），不是显式状态

### 模型 / 推理强度选择（`Composer.tsx`）

- 无键盘操作（见上）
- 无「最近使用」「收藏」「只显示可用」；33 个模型平铺，`opencode-go` 一个组里全塞满
- 搜索是纯 `includes`，不排序、不高亮；`qwen` 命中 8 个也不会把最匹配的排前面
- 切换模型期间没有 loading/禁用态；失败只弹 toast，chip 显示不会回滚（`setModel` 只在成功时 dispatch，UI 其实是对的，但缺"正在切换"的反馈）
- **streaming 中切模型的行为未定义**（没有禁用、也没有确认），需要实测 pi 的反应后补保护
- chip 宽度 `max-width: 210px`，长模型名会被截断但没有 tooltip

### 输入区（`Composer.tsx`）

- 只有 `Enter` 发送，没有 `⌘Enter`（很多人习惯），也没有"发送前确认"这类可选保护
- 发送失败时乐观消息会被移除，**草稿直接丢**，没有"重试/恢复草稿"
- 附件只有 `accept="image/*"` 的软约束，没有体积/尺寸上限提示；超过模型 `inputLimits` 才在 pi 侧报错
- 拖拽非图片文件无任何提示（拖上去像坏了一样）
- `/` 命令面板有，但没有 `Tab` 补全、没有最近使用

### 侧栏 / 会话（`Sidebar.tsx`）

- 会话"…"菜单 **`opacity: 0` 只有 hover / active 才出现**（`styles.css:465`）→ 键盘用户和"新用户不知道有菜单"都受影响；也没有右键菜单
- 会话条目不支持键盘上下移动、不支持 `⌘1..9` 跳转
- 没有置顶/收藏/归档；没有"未读/完成"标记
- 删除只有确认弹窗，**不提供撤销**；`⌘Z` 无效（pi 的会话文件是删了就没了，风险偏高）
- 相对时间不刷新（`2h` 会一直停在 `2h`）
- 列表 `slice(0, 200)` 静默截断，无提示
- 搜索只过滤已加载的 200 条，且不做高亮

### 对话区（`ChatView.tsx` / `Message.tsx`）

- 没有 retry / regenerate / 编辑后重发（pi 侧完全支持，UI 没入口）
- 没有 fork / clone / 分支树入口（pi 的 `fork`、`clone`、`get_tree` 都没用上）
- 错误消息只显示文本，不带 stderr、不带"复制诊断信息"
- 只有逐条 copy，没有"复制整段回答 / 导出 markdown"
- 工具卡没有"重新运行这个工具""在编辑器打开文件"
- 长会话没有虚拟滚动，markdown 每次重解析（虽有 55ms 节流）

### 设置（`SettingsPage.tsx`）

- 自定义服务商表单：**没有"测试连接"**（写进去发现 key 错，只能等下一次对话失败）
- API Key 是明文 `input`，没有隐藏/显示切换，也没有"是否已在 pi 环境变量里"的提示
- 保存前没有 JSON 预览 diff，用户不知道到底往 `models.json` 写了什么
- 没有"恢复默认"/"删除全部自定义配置"/"导入导出"
- 设置项没有"脏数据"提示，改完立刻写盘（有的要重启会话才生效，但只有 toast 一句话）
- 关于页没有 logo / 许可证 / 更新检查入口

### 可见性 / 可访问性 / 一致性

- **0 处 `:focus-visible` 样式**（`grep -c focus-visible` = 0），键盘操作看不到焦点
- `--text-faint #726f69` 在 `--bg #0b0c0e` 上对比度 ≈ **3.9:1**，用于 10.5px 的元信息文字，低于 WCAG AA 的 4.5:1
- 全部提示靠 `title` 属性（"New session (⌘N)"），触控板/键盘都看不到
- 流式输出区域没有 `aria-live`，屏幕阅读器完全不播报
- **中英混排**：侧栏 "New session / Search sessions / No sessions yet"，设置页全中文，toast 一半 "已更新默认模型"、一半 "Could not switch model"
- 没有 `prefers-reduced-motion` 的全局兜底（只有 1 处用到）

---

## 三、优化方案（按批次，带验收标准）

### P0 · 立刻做（半天内，每项都有明确验收）

| 项 | 做法 | 验收 |
| --- | --- | --- |
| 弹层滚动误关 | ✅ 已完成 | 列表可滚动、点选正常、对话滚动时跟随 |
| 菜单键盘导航 | 统一 `useMenuNav`（↑↓/Home/End/Enter/Esc + hover 同步 active + `aria-activedescendant`） | 打开模型菜单后全程不碰鼠标能选中；Esc 后焦点回 chip |
| 启动恢复上次会话 | 记录 `lastSessionPath`（settings），启动时 `openSession(workspace, lastSessionPath)`；会话已删则回落到新会话 | 重启后回到同一会话、messages 一致 |
| stderr 可见 | 侧栏底部状态点点击 → "诊断" 抽屉：pi 版本、路径、最后 200 行 stderr、"复制诊断" 按钮 | 故意写坏 `models.json`，能在 UI 里看到 pi 的原始报错 |
| 默认模型下拉数据源 | 设置页改用 `pi --list-models`（已在手上），没会话也能选 | 不打开会话即可设置默认模型 |

### P1 · 一周内（模型体验 + 键盘 + 会话管理）

1. **模型选择器重做**
   - 顶部「最近使用」+「当前」两行
   - 搜索加权重排序（前缀 > 名称包含 > id 包含）+ 命中高亮
   - `⌘K` 打开命令面板（模型 / 推理强度 / 会话 / 设置 一个入口搜全部）
   - 切换中显示 `switching…`、失败回滚 chip + 保留弹层
   - streaming 中切模型：禁用并提示"等这一轮结束"，或确认后 abort
   - chip 加 `title` 显示完整 `provider/id`
2. **会话管理**
   - 右侧"…"常显（鼠标 hover 之外的场景也能用）+ 右键菜单
   - 置顶 / 摘要（会话首条消息自动成标题，可手动改名）
   - 删除后 `⌘Z` 撤销（把 jsonl 移进 `.trash/` 而不是直接 unlink）
   - 相对时间每 60s 刷新；`⌘1..9` 打开前 9 个会话
3. **可访问性底线**
   - 全局 `:focus-visible` 环
   - `--text-faint` 提到 `#8b8880`（对比度 ≈ 4.6:1）
   - 弹层/菜单补 `role`、`aria-expanded`、焦点归还
   - 流式区 `aria-live="polite"`
4. **交互一致性**
   - 统一语言（建议全中文，或全英文，二选一）
   - 所有 `title` 提示改成 hover 气泡（`kbd` 样式）

### P2 · 两周内（对话能力 + 设置增强）

1. 对话操作：retry / regenerate / 编辑后重发 / fork 分支 / 导出 markdown / 复制整段
2. 错误卡片：原始 error + stderr 片段 + "复制诊断" + "打开设置"
3. 设置页自定义模型：**测试连接**（用 pi 的 `pi auth check --provider X --json` 或发一次最小请求）、key 隐藏、保存前 JSON diff 预览、导入导出
4. 附件：体积/数量上限提示、非图片拖拽提示、粘贴后缩略图可删
5. 长会话虚拟滚动 + markdown 增量渲染

### P3 · 后续（产品级）

1. 系统通知（会话在后台跑完 / 需要审批）
2. 自动更新：`electron-updater` + Apple Developer ID 签名 + 公证（否则每次都要 `xattr`）
3. 多窗口 / 标签页（当前单窗口单会话）
4. 会话索引（SQLite）替代全量扫描
5. Windows / Linux 适配

---

## 四、测试体系（"交互细节没测"这件事本身要解决）

现在仓库里只有 `scripts/smoke.mjs`（启动 + 无 pageerror），交互全靠手点。建议：

### 1. 假 pi（mock RPC）fixture

写一个 `scripts/mock-pi.mjs`：实现 `--mode rpc`，从 stdin 读 JSONL、回放录制的记录，可以按场景切换：

```bash
PI_DESKTOP_PI_PATH=./scripts/mock-pi.mjs SCENARIO=auth-error npm run dev
```

场景至少：正常会话 / 无凭证 / `models.json` 语法错误 / 长流式输出 / 工具调用中 / 超大模型列表（300+）。

好处：**不依赖真 pi、不烧 token、可以断言失败路径**，还能在 CI 的 Linux runner 上跑（不需要登录态）。

### 2. Playwright 交互用例清单（`tests/e2e/*.spec.ts`）

| # | 用例 | 断言 |
| --- | --- | --- |
| 1 | 打开模型菜单 → 列表内滚轮 | 菜单仍在、scrollTop 变化 |
| 2 | 键盘 ↓↓ Enter | 选中第二项、chip 更新、焦点回 chip |
| 3 | Esc / 点外部 / 点其它 chip | 只关当前、不误关 |
| 4 | 切模型失败（mock 返回 success:false） | 弹层不关、chip 不变、toast 报错 |
| 5 | 重启应用 | 回到上次会话、消息条数一致 |
| 6 | 删除会话 → ⌘Z | 会话恢复 |
| 7 | 侧栏 200 条截断 | 有"还有 N 条"提示 |
| 8 | 附件超过 4MB | 明确提示，不静默失败 |
| 9 | 长流式输出中滚动上翻 | 出现"跳到最新"，回到底部后消失 |
| 10 | 写坏 models.json | 诊断抽屉里出现 pi 原始错误 |
| 11 | 浅色主题 + 200% zoom | 无重叠/截断（截图对比） |
| 12 | 全键盘走一遍：打开设置→改主题→关闭 | 无需鼠标 |

### 3. 视觉回归

用现有 `output/*.png` 的截图流程，加 `pixelmatch` 基线（深色/浅色 × 3 个关键页面），专治"改 CSS 顺手压坏别的页面"。

### 4. CI

`.github/workflows/ci.yml`：`typecheck` + `build` + e2e（mock pi）+ 视觉回归，PR 必过。

---

## 五、建议的落地顺序

1. **本周**：P0 五项（滚动已修、键盘导航、恢复上次会话、诊断抽屉、默认模型数据源）+ mock pi + 用例 1/2/5
2. **下周**：P1 全量（模型选择器重做是重点）+ 用例 3/4/9
3. **两周后**：P2，同时补 CI 与视觉回归基线
4. 签名/公证/自动更新放到产品化阶段（要 Apple 开发者账号）

> 结论：当前最影响"手感"的不是功能缺失，而是**弹层系统（关闭/定位/键盘）**、**状态恢复（会话）**、**错误可见性（stderr）**这三件事。把这三块做扎实，再补 P1 的模型选择器，体验会有质的变化。
