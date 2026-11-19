// Only application-owned UI strings are translated. User content, model output,
// tool output, paths and provider-supplied labels are always left untouched.
const pairs: Array<[string, string]> = [
  ['已连接并验证本机配对。', 'Connected with verified local pairing.'],
  ['如果之前安装过扩展，更新后请在 Chrome 扩展页点击重新加载。', 'If the extension was already installed, reload it on the Chrome extensions page after an update.'],
  ['未收到扩展响应。请确认扩展已启用；如刚更新，请在 Chrome 扩展页重新加载，然后点击扩展图标并重试。', 'No response from the extension. Make sure it is enabled; after an update, reload it on the Chrome extensions page, click its icon, and try again.'],
  ['未收到扩展响应。请确认已启用扩展，点击 Chrome 工具栏的扩展图标后重试。', 'No response from the extension. Make sure it is enabled, click its icon in Chrome, and try again.'],
  ['网页浏览', 'Web browsing'],
  ['桌面操作', 'Desktop interaction'],
  ['使用内置 Computer Use 扩展观察和操作桌面应用；已有扩展配置会继续使用。', 'Use the bundled Computer Use extension to observe and interact with desktop apps. Existing extension configurations are preserved.'],
  ['macOS 权限', 'macOS permissions'],
  ['开启桌面操作权限', 'Enable desktop access'],
  ['允许 Pi 观察和操作桌面应用', 'Allow Pi to observe and interact with desktop apps'],
  ['仅在执行桌面任务时需要。请在系统设置中开启所需权限，然后返回这里重新检测。', 'These permissions are needed for desktop tasks. Enable them in System Settings, then return here to check again.'],
  ['辅助功能', 'Accessibility'],
  ['用于识别并操作应用中的按钮和输入框', 'Recognize and interact with controls in apps'],
  ['打开辅助功能设置', 'Open Accessibility Settings'],
  ['已开启', 'Enabled'],
  ['初步已开启', 'Enabled, pending task check'],
  ['这是初步检测；任务开始时会复核实际使用的组件。', 'This is a preliminary check. The component used by the task will be checked again when it starts.'],
  ['屏幕录制', 'Screen Recording'],
  ['用于查看当前应用窗口，帮助确认操作结果', 'View the current app window and check results'],
  ['打开屏幕录制设置', 'Open Screen Recording Settings'],
  ['权限由 macOS 管理。如果开启后仍未生效，请重启 Pi Desktop 再试。', 'macOS manages these permissions. If access is still unavailable after enabling it, restart Pi Desktop and try again.'],
  ['任务开始时会再次检测实际使用的组件。如果开启后仍未生效，请重启 Pi Desktop 再试。', 'The component used by the task is checked again before it runs. If access is still unavailable, restart Pi Desktop and try again.'],
  ['重新检测', 'Check Again'],
  ['启用 Computer Use', 'Enable Computer Use'],
  ['允许 Pi 观察和操作桌面应用。默认关闭，网页浏览不受影响。', 'Allow Pi to observe and interact with desktop apps. Off by default; web browsing is unaffected.'],
  ['桌面操作需要辅助功能与屏幕录制权限，可随时检查并前往系统设置。', 'Desktop use needs Accessibility and Screen Recording. Check permissions or open System Settings at any time.'],
  ['检查权限', 'Check permissions'],
  ['正在检测权限…', 'Checking permissions…'],
  ['无法检测权限，请重试。', 'Could not check permissions. Try again.'],
  ['桌面操作需要辅助功能与屏幕录制权限。可在对话中让 Pi 检查 Computer Use 权限。', 'Desktop interaction requires Accessibility and Screen Recording permissions. Ask Pi to check Computer Use permissions in a chat.'],
  ['在 Chrome 右上角打开「开发者模式」。', 'Turn on Developer mode in the top right of Chrome.'],
  ['把扩展拖到 Chrome 页面', 'Drag the extension onto the Chrome page'],
  ['将 Pi Desktop 和 Chrome 并排放置，按住下方文件夹，拖到 Chrome 扩展页的空白处后松开。', 'Place Pi Desktop and Chrome side by side. Drag the folder below onto an empty area of the Chrome extensions page and release.'],
  ['拖到页面空白处', 'Drop onto the page'],
  ['按住这里拖动', 'Drag from here'],
  ['窗口', 'Window'], ['操作', 'Action'], ['目标', 'Target'], ['取消操作', 'Cancel action'], ['确认执行', 'Confirm action'],
  ['确认桌面操作', 'Confirm desktop action'], ['点击', 'Click'], ['双击', 'Double-click'], ['右键点击', 'Right-click'], ['悬停', 'Hover'], ['按下控件', 'Press control'], ['填写内容', 'Fill'], ['输入文字', 'Type'], ['按键', 'Key press'], ['滚动', 'Scroll'],
  ['正在查看桌面', 'Observing desktop'], ['已查看桌面', 'Desktop observed'], ['查看桌面失败', 'Desktop observation failed'], ['查看桌面 {count} 次', 'Observed desktop {count} times'],
  ['正在操作桌面', 'Acting on desktop'], ['已执行桌面操作', 'Desktop action sent'], ['桌面操作失败', 'Desktop action failed'], ['桌面操作 {count} 次', '{count} desktop actions'],
  ['正在查看网页', 'Observing page'], ['已查看网页', 'Page observed'], ['查看网页失败', 'Page observation failed'], ['查看网页 {count} 次', 'Observed page {count} times'],
  ['正在操作网页', 'Acting on page'], ['已执行网页操作', 'Page action sent'], ['网页操作失败', 'Page action failed'], ['网页操作 {count} 次', '{count} page actions'],
  ['正在等待网页元素', 'Waiting for page element'], ['网页等待结束', 'Page wait finished'], ['网页等待失败', 'Page wait failed'], ['等待网页元素 {count} 次', '{count} page waits'],
  ['等待人工接管', 'Waiting for your help'], ['人工接管已处理', 'Handoff handled'], ['人工接管中断', 'Handoff interrupted'], ['人工接管 {count} 次', '{count} handoffs'],
  ['已取消', 'Cancelled'], ['等待人工处理', 'Waiting for your help'], ['目标已出现', 'Target appeared'], ['未等到目标', 'Target not found'],
  ['选择上传文件', 'Choose a file to upload'], ['已完成选择', 'File selected'], ['等待选择文件', 'Waiting for file selection'], ['取消文件选择', 'Cancel file selection'], ['已取消选择', 'File selection cancelled'],
  ['如果没有看到系统文件选择窗口，请在网页中点击文件选择按钮。使用应用内浏览器时，可先打开工作面板。', 'If no system file picker appears, click the file selection button on the page. For the in-app browser, open the work panel first.'],
  ['打开工作面板', 'Open work panel'],
  ['文件内容摘要已匹配', 'File content hash matched'], ['仅核对文件信息', 'File information checked only'],
  ['已打开 Chrome 扩展页，请刷新已安装的扩展。', 'Chrome extensions is open. Refresh the installed extension.'],
  ['Chrome 正在使用旧版扩展。请打开扩展页，找到 Pi Desktop Chrome Bridge，点击卡片上的刷新按钮，然后重新检测。', 'Chrome is using an older extension. Open the extensions page, find Pi Desktop Chrome Bridge, click its refresh button, then check again.'],
  ['已连接，但无法确认扩展版本。请在 Chrome 扩展页刷新 Pi Desktop Chrome Bridge，然后重新检测。', 'Connected, but the extension version could not be verified. Refresh Pi Desktop Chrome Bridge on the Chrome extensions page, then check again.'],
  ['正在核对所选文件', 'Checking the selected file'], ['已读取文件信息', 'File information read'], ['文件核对未完成', 'File check incomplete'], ['核对所选文件 {count} 次', 'Checked selected files {count} times'],
  ['等待取消文件选择', 'Waiting to cancel file selection'], ['文件选择已取消', 'File selection cancelled'], ['取消文件选择未完成', 'File selection cancellation incomplete'], ['取消文件选择 {count} 次', 'Cancelled file selection {count} times'],
  ['操作结果未知，请核对', 'Action outcome unknown; check before continuing'],
  ['目标已变化，请重新观察', 'Target changed; observe again'],
  ['目标被遮挡，请重新观察', 'Target is obscured; observe again'],
  ['执行结束', 'Execution ended'],
  ['确认网页操作', 'Confirm browser action'], ['输入预览', 'Input preview'], ['输入内容', 'Input text'],
  ['独立 Chrome', 'Dedicated Chrome'], ['日常 Chrome', 'Everyday Chrome'],
  ['页面', 'Page'], ['已选文件', 'Selected files'], ['提示', 'Note'], ['（当前页面可见文件，不一定属于此操作）', ' (visible selections on this page; not necessarily used by this action)'],
  ['正在读取网页内容', 'Reading page content'], ['已读取网页内容', 'Read page content'], ['读取网页内容失败', 'Page content read failed'], ['读取网页内容 {count} 次', 'Read page content {count} times'],
  ['下载已取消', 'Download cancelled'],
  ['正在检查下载记录', 'Checking downloads'], ['已检查下载记录', 'Checked downloads'], ['检查下载记录失败', 'Download check failed'], ['检查下载记录 {count} 次', 'Checked downloads {count} times'],
  ['按钮', 'Button'], ['输入框', 'Text field'], ['复选框', 'Checkbox'],
  ['研究一个问题', 'Research a question'], ['整理文件资料', 'Organize files'], ['规划并执行任务', 'Plan a task'], ['了解这个项目', 'Explore this project'],
  ['帮我研究这个问题，先确认范围，再整理资料、来源和结论：', 'Help me research this question. First confirm the scope, then organize the information, sources, and conclusions:'],
  ['帮我整理这些文件，先说明发现了什么，再给出整理建议：', 'Help me organize these files. First explain what you find, then suggest how to organize them:'],
  ['我想完成这个目标，请先拆解步骤、说明需要的信息和验收方式：', 'I want to achieve this goal. First break down the steps, required information, and how to verify the result:'],
  ['请介绍当前项目的用途、主要内容和建议从哪里开始。', 'Explain the purpose and main contents of this project, and suggest where to start.'],
  ['告诉 Pi 你想完成什么。它可以协助研究、处理文件、规划任务和编写代码。发出第一条消息后，对话会保存下来。', 'Tell Pi what you want to accomplish. It can help with research, files, planning, and coding. The conversation is saved when you send your first message.'],
  ['打开一个项目，让 Pi 帮你研究问题、处理文件、规划任务或编写代码。', 'Open a project and let Pi help with research, files, planning, or coding.'],
  ['界面有变化，结果待核对', 'Interface changed; verify the outcome'], ['未发现变化，结果待核对', 'No change detected; verify the outcome'], ['结果待核对', 'Outcome needs verification'],
  ['无法检查命令', 'Cannot check commands'],
  ['暂时无法读取命令列表，请稍后重试。输入内容仍在输入框中。', 'The command list is unavailable. Try again; your input has been kept.'],
  ['查看排查步骤', 'Troubleshooting'], ['排查项目命令', 'Troubleshoot project commands'],
  ['命令可能拼写有误、对应扩展未启用，或项目资源因未信任而未加载。', 'The command may be misspelled, its extension disabled, or project resources not loaded because the project is untrusted.'],
  ['在终端进入项目目录，运行 pi，然后输入 /trust 并自行决定是否信任。', 'In a terminal, enter the project directory, run pi, then enter /trust and decide whether to trust it.'],
  ['项目信任可能允许该目录中的扩展执行代码。只信任你了解的项目；处理后回到 Pi Desktop 新建会话，再重试原命令。', 'Project trust may allow extensions in this folder to run code. Trust only projects you know; then return to Pi Desktop, start a new session, and retry the command.'],
  ['当前项目', 'Current project'], ['复制项目路径', 'Copy project path'], ['路径已复制', 'Path copied'],
  ['复制失败，请手动选择路径。', 'Copy failed; select the path manually.'],
  ['新建会话前，请先复制并清空输入框中的草稿，以便稍后重试。', 'Before starting a new session, copy and clear the draft so you can retry it later.'],
  ['命令未找到', 'Command not found'],
  ['该命令未加载，可能需要信任项目或启用对应扩展。输入内容仍在输入框中。', 'This command is not loaded. You may need to trust the project or enable its extension. Your input has been kept.'],
  ['权限检查完成。桌面任务开始时会再次检查实际使用的组件。', 'Permission check complete. The component used for a desktop task will be checked when it starts.'],
  ['仅在执行桌面任务时需要。请在系统设置中开启所需权限，我们会自动检测。', 'Desktop tasks require these permissions. Enable them in System Settings and we will check automatically.'],
  ['按住拖动 Pi Desktop', 'Drag Pi Desktop'],
  ['把图标拖到系统设置的权限列表中，然后打开开关。拖动无效时，请点击列表下方的「＋」选择 Pi Desktop。', 'Drag the icon into the permission list in System Settings, then enable it. If dragging does not work, use the + button below the list to select Pi Desktop.'],
  ['Pi Desktop 扩展文件夹', 'Pi Desktop extension folder'],
  ['拖不动？试试其他方式', 'Cannot drag? Try another way'],
  ['在 Finder 中显示文件夹', 'Show folder in Finder'],
  ['打开 Chrome 扩展页，并开启右上角的开发者模式。', 'Open Chrome extensions and turn on Developer mode in the top right.'],
  ['将下方的扩展文件夹拖到 Chrome 扩展页中。', 'Drag the extension folder below onto the Chrome extensions page.'],
  ['返回这里，点击「检测连接」。', 'Return here and select Check connection.'],
  ['拖动扩展文件夹到 Chrome', 'Drag the extension folder to Chrome'],
  ['按住拖动到扩展页，然后松开', 'Drag to the extensions page and release'],
  ['无法拖动？在 Finder 中显示文件夹', 'Cannot drag? Show the folder in Finder'],
  ['也可在 Chrome 点击「加载未打包的扩展程序」，选择 Finder 中显示的文件夹。', 'Alternatively, select Load unpacked in Chrome and choose the folder shown in Finder.'],
  ['操作是否需要确认取决于 Computer Use 的审批设置。', 'Whether actions require approval depends on your Computer Use settings.'],
  ['扩展可读取和操作当前标签页，请只在信任的网站使用。', 'The extension can read and interact with the active tab. Use it only on sites you trust.'],
  ['先打开文件夹；在 Chrome 点击「加载已解压的扩展程序」，将 Finder 中选中的文件夹拖入选择窗口，再点击「打开」。', 'Open the folder first. In Chrome, click Load unpacked, drag the selected folder from Finder into the file picker, then click Open.'],
  ['扩展目录由 Pi Desktop 自动准备。', 'Pi Desktop prepares the extension folder automatically.'],
  ['这是内测安装方式，需要你手动加载扩展。使用扩展桥时，Pi 可以操作当前 Chrome 标签页。', 'This test installation requires you to load the extension manually. The bridge lets Pi interact with the active Chrome tab.'],
  ['无法打开会话', 'Could not open session'], ['没有打开项目', 'No project open'], ['先选择一个文件夹再发送。', 'Choose a folder before sending.'], ['会话正在启动', 'Session is starting'], ['稍等一下再发送。', 'Please wait before sending.'], ['消息未发送', 'Message not sent'], ['pi 没有响应。', 'Pi did not respond.'], ['无法重命名会话', 'Could not rename session'], ['已恢复会话', 'Session restored'], ['恢复失败', 'Restore failed'], ['已删除会话', 'Session deleted'], ['撤销', 'Undo'], ['无法删除会话', 'Could not delete session'], ['无法切换模型', 'Could not switch model'], ['无法修改推理强度', 'Could not change reasoning effort'], ['无法修改 steering 模式', 'Could not change steering mode'], ['无法修改 follow-up 模式', 'Could not change follow-up mode'], ['无法修改自动压缩', 'Could not change automatic compaction'], ['无法修改自动重试', 'Could not change automatic retry'], ['正在压缩上下文…', 'Compacting context…'], ['压缩失败', 'Compaction failed'], ['上下文已压缩', 'Context compacted'],
  ['Not connected', '尚未连接'], ['Wait for the session to finish starting.', '请等待会话启动完成。'], ['Stopped', '已停止'], ['Queued messages were returned to the composer.', '排队的消息已返回输入框。'], ['sending…', '发送中…'],
  ['Show all {count} lines', '展开全部 {count} 行'], ['{count} lines', '{count} 行'], ['change {count}', '修改 {count}'], ['{count} messages', '{count} 条消息'], ['pi needs your input', 'pi 需要你的输入'], ['Compact context ({percent}% used)', '压缩上下文（已使用 {percent}%）'],
  ['Copy', '复制'], ['Retrying {attempt}/{max}', '正在重试 {attempt}/{max}'], ['Compacting context…', '正在压缩上下文…'],
  ['Bash', '终端'], ['Read', '读取'], ['Write', '写入'], ['Edit', '编辑'],
  ['Give me a tour of this codebase: what it does, the main modules, and where I should start.', '请介绍这个代码库：它的用途、主要模块，以及我应该从哪里开始。'],
  ['Run the test suite, find the first failure, and fix it.', '运行测试套件，找到第一个失败的测试并修复。'],
  ['Review my uncommitted changes for bugs, risky patterns, and missing tests.', '审查我尚未提交的改动，找出错误、风险和缺失的测试。'],
  ['快捷键', 'Shortcuts'], ['版本', 'Version'], ['平台', 'Platform'], ['思维', 'Reasoning'], ['图片', 'Images'],
  ['Off', '关闭'], ['Minimal', '极低'], ['Medium', '中'], ['Extra high', '极高'], ['Max', '最大'],
  ['读取文件内容', 'Read file contents'], ['执行 shell 命令', 'Run shell commands'], ['按片段修改文件', 'Edit parts of a file'], ['写入或覆盖文件', 'Write or overwrite a file'], ['按内容搜索文件', 'Search file contents'], ['按名称查找文件', 'Find files by name'], ['列出目录', 'List directory contents'],
  ['自定义', 'Custom'], ['Anthropic 兼容', 'Anthropic compatible'], ['Google 兼容', 'Google compatible'], ['OpenAI 兼容 (openai-completions)', 'OpenAI compatible (openai-completions)'], ['Anthropic 兼容 (anthropic-messages)', 'Anthropic compatible (anthropic-messages)'], ['Google 兼容 (google-generative-ai)', 'Google compatible (google-generative-ai)'],
  ['Deliver after the current tool calls', '当前工具调用结束后插话'], ['Deliver after pi finishes', '当前任务结束后发送'], ['Steer', '插话'], ['Follow-up', '后续消息'], ['Dismiss', '关闭'], ['Session actions', '会话操作'], ['Delete session?', '删除会话？'], ['No', '否'], ['Yes', '是'], ['Submit', '提交'], ['This extension uses an interface the desktop app cannot render yet.', '此扩展使用的界面暂不支持在桌面端显示。'], ['failed', '失败'], ['running…', '运行中…'], ['Session token usage', '会话 token 用量'],
  ['复制失败', 'Copy failed'], ['剪贴板不可用', 'Clipboard is unavailable'], ['暂时只能附加图片', 'Only images can be attached'], ['拖进来的是文件，pi 的图片输入只接受图片。', 'Pi only accepts image attachments.'], ['最多添加 6 张图片', 'Up to 6 images'], ['已跳过这张图片', 'Image skipped'], ['无法读取图片', 'Unable to read image'],
  ['已更新 pi 路径', 'Pi path updated'], ['重启会话后生效。', 'Restart the session to apply.'], ['已更新默认模型', 'Default model updated'], ['新建会话时生效。', 'Applies to new sessions.'], ['模型目录已更新', 'Model catalog updated'], ['模型目录更新失败', 'Could not update model catalog'], ['缺少服务商 ID', 'Provider ID is required'], ['例如 ollama、my-gateway。', 'For example, ollama or my-gateway.'], ['已写入 models.json', 'Saved to models.json'], ['保存失败', 'Save failed'], ['删除失败', 'Delete failed'],
  ['设置', 'Settings'], ['返回对话', 'Back to chat'], ['搜索设置', 'Search settings'], ['清空搜索', 'Clear search'],
  ['没有匹配的设置', 'No matching settings'], ['搜索结果', 'Search results'], ['换个关键词试试，比如「压缩」「工具」「模型」。', 'Try another search, such as “compaction”, “tools” or “models”.'],
  ['个人', 'Personal'], ['应用', 'App'], ['常规', 'General'], ['模型', 'Models'], ['工具与技能', 'Tools & skills'], ['外观', 'Appearance'], ['会话', 'Sessions'], ['键盘快捷键', 'Keyboard shortcuts'], ['关于', 'About'],
  ['界面语言', 'Interface language'], ['选择应用界面显示的语言。', 'Choose the language used in the app interface.'], ['语言', 'Language'],
  ['新建会话', 'New session'], ['新建会话 (⌘N)', 'New session (⌘N)'], ['打开项目', 'Open project'], ['打开文件夹…', 'Open folder…'], ['未选择项目', 'No project selected'], ['选择一个文件夹开始', 'Choose a folder to get started'], ['搜索会话', 'Search sessions'], ['没有匹配的会话。', 'No matching sessions.'], ['还没有会话，新建一个开始。', 'No sessions yet. Start a new one.'], ['重命名', 'Rename'], ['在 Finder 中显示', 'Show in Finder'], ['删除', 'Delete'], ['取消', 'Cancel'],
  ['pi 运行状态与诊断', 'Pi status and diagnostics'], ['输入消息', 'Message'], ['添加图片', 'Add images'], ['选择模型', 'Select model'], ['推理强度', 'Reasoning effort'], ['发送方式', 'Send mode'], ['上下文', 'Context'], ['Enter 发送 · Shift+Enter 换行', 'Enter to send · Shift+Enter for a new line'],
  ['插话（steer）或排队一条后续消息…', 'Steer or queue a follow-up message…'], ['让 pi 帮你写代码、查问题、解释代码…', 'Ask pi to write code, investigate issues, or explain code…'], ['搜索模型…', 'Search models…'], ['pi 还没就绪，稍等一下…', 'Pi is starting, please wait…'], ['没有匹配的模型', 'No matching models'], [' · 推理', ' · Reasoning'], ['松手添加图片', 'Drop to add images'], ['本轮结束后可切换模型', 'Change models after this turn'], ['本轮结束后可切换推理强度', 'Change reasoning effort after this turn'],
  ['运行中…', 'Working…'], ['回到最新', 'Jump to latest'], ['讲讲这个代码库', 'Explain this codebase'], ['修一个失败的测试', 'Fix a failing test'], ['帮我 review 改动', 'Review my changes'], ['pi 能读写文件、跑命令、搜网页。发出第一条消息后，这个会话就会被保存下来。', 'Pi can read and write files, run commands, and search the web. This session will be saved when you send your first message.'],
  ['把 pi 装进桌面。打开一个项目，然后让 pi 读代码、改文件、跑命令。', 'Bring pi to your desktop. Open a project and let pi read code, edit files, and run commands.'], ['pi 没有在运行', 'Pi is not running'], ['检查设置', 'Check settings'], ['Recent projects', '最近项目'],
  ['Pi 运行时', 'Pi runtime'], ['Pi 可执行文件', 'Pi executable'], ['启动 pi 子进程时使用；更换后需要重启会话。', 'Used to start the pi process. Restart the session after changing it.'], ['更改', 'Change'], ['检测到的版本', 'Detected version'], ['来自当前 pi 可执行文件。', 'Reported by the current pi executable.'], ['未检测到', 'Not detected'], ['重启会话', 'Restart session'], ['会话行为', 'Session behavior'],
  ['Steering 消息投递', 'Steering delivery'], ['运行中插入的指令：一次性全部投递，还是每轮投递一条。', 'Deliver steering messages all at once or one per turn.'], ['Steering 模式', 'Steering mode'], ['逐条投递', 'One at a time'], ['全部投递', 'All at once'], ['Follow-up 消息投递', 'Follow-up delivery'], ['任务结束后排队的消息：一次性全部投递，还是每轮投递一条。', 'Deliver queued follow-ups all at once or one per turn.'], ['Follow-up 模式', 'Follow-up mode'], ['自动压缩上下文', 'Automatic context compaction'], ['上下文接近上限时自动摘要历史，避免请求被截断。', 'Summarize history as the context approaches its limit.'], ['自动重试', 'Automatic retry'], ['遇到限流、过载或 5xx 时按指数退避重试。', 'Retry rate limits, overloads, and 5xx errors with exponential backoff.'],
  ['主题', 'Theme'], ['界面主题', 'Interface theme'], ['深色为暖调纸墨；浅色适合白天和投屏。', 'Choose a dark or light appearance.'], ['深色', 'Dark'], ['浅色', 'Light'], ['新会话默认值', 'Defaults for new sessions'], ['默认模型', 'Default model'], ['新建会话时使用；当前会话仍可在输入框里随时切换。', 'Used for new sessions. You can change the current session in the composer.'], ['跟随 pi 配置', 'Use pi settings'], ['默认推理强度', 'Default reasoning effort'], ['新会话启动时的 thinking level，可在底部选择器临时覆盖。', 'Used for new sessions; change it temporarily in the composer.'], ['当前模型', 'Current model'], ['模型信息', 'Model information'], ['未选择模型', 'No model selected'], ['支持', 'Supported'], ['不支持', 'Not supported'], ['打开一个会话后显示', 'Available after opening a session'], ['pi 支持的模型', 'Models supported by pi'], ['搜索模型或服务商', 'Search models or providers'], ['清除', 'Clear'], ['重新读取', 'Reload'], ['更新目录', 'Update catalog'], ['没有匹配的模型。', 'No matching models.'],
  ['{count} 次操作', '{count} operations'],
  ['自定义服务商与模型', 'Custom providers and models'], ['添加模型', 'Add model'], ['还没有自定义服务商。pi 默认使用内置目录与登录凭证。', 'No custom providers. Pi uses its built-in catalog and credentials by default.'], ['跟随内置端点', 'Use built-in endpoint'], ['跟随内置协议', 'Use built-in protocol'], ['移除', 'Remove'], ['添加服务商 / 模型', 'Add provider / model'], ['服务商 ID *', 'Provider ID *'], ['显示名', 'Display name'], ['可选', 'Optional'], ['API 协议', 'API protocol'], ['$MY_API_KEY 或直接填 key；本地服务可留空或填占位', '$MY_API_KEY or a literal key; local services can use an empty or placeholder value'], ['模型 ID（每行一个，或用逗号分隔）*', 'Model IDs (one per line or comma-separated) *'], ['上下文窗口', 'Context window'], ['最大输出', 'Maximum output'], ['支持推理 / 思维链', 'Supports reasoning'], ['支持推理', 'Supports reasoning'], ['支持图片输入', 'Supports image input'], ['保存中…', 'Saving…'], ['保存到 models.json', 'Save to models.json'], ['保存后会重启当前会话，让 pi 重新加载模型。', 'Saving restarts the current session so pi reloads models.'],
  ['内置工具', 'Built-in tools'], ['已自定义工具列表，重启会话后按新列表加载。', 'A custom tool list is configured. Restart the session to apply it.'], ['当前使用 pi 默认工具集；修改后会写入 pi 设置，重启会话生效。', 'Using the default pi tools. Changes are saved to pi settings and applied after restarting the session.'], ['桌面显示', 'Desktop display'], ['工具调用默认展开', 'Expand tool calls by default'], ['工具卡片显示完整输出，而不是折叠成一行。', 'Show full tool output instead of a collapsed row.'], ['流式输出自动跟随', 'Follow streaming output'], ['新内容到达时保持滚动在底部；关闭后只在你发送消息时跳转。', 'Keep the view at the bottom as content arrives. When off, jump only when you send a message.'],
  ['存储', 'Storage'], ['会话存储目录', 'Session storage directory'], ['每次对话都会写成一个 JSONL 会话文件。', 'Each conversation is stored in a JSONL session file.'], ['显示', 'Show'], ['会话数量', 'Session count'], ['已缓存的会话文件，由最近修改时间排序。', 'Cached session files, sorted by most recently modified.'], ['刷新', 'Refresh'], ['当前工作区', 'Current workspace'], ['未打开项目', 'No project open'], ['新会话会在这个目录下运行 pi。', 'New sessions run pi in this directory.'], ['当前会话', 'Current session'], ['尚未开始', 'Not started'], ['配置文件', 'Configuration files'], ['pi 设置文件', 'Pi settings file'], ['链接', 'Links'], ['对话中的链接', 'Links in chat'], ['链接打开方式', 'Open links in'], ['右侧浏览器', 'Side browser'], ['系统浏览器', 'System browser'], ['默认在右侧应用内浏览器打开；按住 ⌘/Ctrl 点击可改用系统浏览器。', 'Open links in the side browser by default; hold ⌘/Ctrl to use the system browser.'], ['pi 官网与文档', 'Pi website and documentation'], ['协议、模型与扩展的完整说明。', 'Documentation for protocols, models, and extensions.'],
  ['诊断', 'Diagnostics'], ['pi 的运行状态与最后 60 行 stderr', 'Pi status and the last 60 lines of stderr'], ['状态', 'Status'], ['Agent 目录', 'Agent directory'], ['会话目录', 'Session directory'], ['models.json 有问题', 'Problem with models.json'], ['没有输出，一切正常。', 'No output. Everything looks good.'], ['已复制', 'Copied'], ['复制诊断信息', 'Copy diagnostics'], ['关闭', 'Close'], ['收起', 'Collapse'], ['读取中…', 'Reading…'], ['写入中…', 'Writing…'], ['参数', 'Arguments'], ['结果', 'Result'], ['你', 'You'],
  ['新建会话', 'New session'], ['打开设置', 'Open settings'], ['切换主题', 'Toggle theme'], ['发送消息', 'Send message'], ['换行', 'New line'], ['停止运行 / 关闭面板', 'Stop / close panel'], ['收起 / 展开侧栏', 'Hide / show sidebar'], ['极低', 'Minimal'], ['低', 'Low'], ['中', 'Medium'], ['高', 'High'], ['极高', 'Extra high'], ['最大', 'Maximum'],
  ['Projects', '项目'], ['No recent projects', '没有最近项目'], ['Session', '会话'], ['New session', '新建会话'], ['No project', '未选择项目'], ['Rename session', '重命名会话'], ['Settings', '设置'], ['Hide sidebar (⌘B)', '收起侧栏 (⌘B)'], ['Show sidebar (⌘B)', '展开侧栏 (⌘B)'], ['Toggle theme (⌘⇧L)', '切换主题 (⌘⇧L)'], ['New session (⌘N)', '新建会话 (⌘N)'], ['Clear search', '清空搜索'], ['Thinking…', '正在思考…'], ['Thought process', '思考过程'], ['Queued', '排队中'], ['Send (Enter)', '发送 (Enter)'], ['Stop (Esc)', '停止 (Esc)'],
  ['{count} 步', '{count} steps'],
  ['{count} 个文件', '{count} files'],
  ['{count} 次调用', '{count} calls'],
  ['{count} thinking lines', '{count} thinking lines'],
  ['运行中', 'running'],
  ['展开/收起过程', 'Expand / collapse process'],
  ['完整记录', 'Full transcript'],
  ['只看摘要', 'Summary only'],
  ['显示结论', 'Show answer'],
  ['重新发送这条问题', 'Send this question again'],
  ['复制本轮', 'Copy turn'],
  ['已复制', 'Copied'],
  ['更早的 {count} 轮', '{count} earlier turns'],
  ['展开', 'Expand'],
  ['搜索这段对话…', 'Search this conversation…'],
  ['上一处', 'Previous match'],
  ['下一处', 'Next match'],
  ['还没有内容。', 'Nothing here yet.'],
  ['… 前面省略 {count} 行', '… {count} lines above hidden'],
  ['… 还有 {count} 行 · 显示全部', '… {count} more lines · show all'],
  ['只看前几行', 'Show fewer lines'],
  ['对话显示', 'Conversation display'],
  ['结论出现后收起过程', 'Fold process once the answer lands'],
  ['每一步工具调用仍可展开；收起状态会按会话记住。', 'Every tool call can still be expanded; fold state is remembered per session.'],
  ['更早的轮次聚合', 'Aggregate older turns'],
  ['主视图只保留最近几轮，更早的收成一行。', 'Keep only recent turns in the main view; older ones collapse into one row.'],
  ['3 轮', '3 turns'],
  ['5 轮', '5 turns'],
  ['8 轮', '8 turns'],
  ['12 轮', '12 turns'],
  ['不聚合', 'Never aggregate'],
  ['思考内容', 'Thinking content'],
  ['summary 折叠成一行，full 直接展开，off 完全不显示。', 'summary folds it into one line, full expands it, off hides it entirely.'],
  ['折叠显示', 'Folded'],
  ['总是展开', 'Always expanded'],
  ['完全隐藏', 'Hidden'],
  ['变更', 'Changes'],
  ['执行中', 'Running'], ['过程有错误', 'Errors in process'], ['已完成', 'Completed'],
  ['文件', 'Files'],
  ['终端', 'Terminal'],
  ['产物', 'Artifacts'],
  ['本会话', 'This session'],
  ['工作区', 'Workspace'],
  ['跳过测试', 'Skip tests'],
  ['折叠测试文件', 'Collapse test files'],
  ['{count} 个文件', '{count} files'],
  ['本次会话还没有改动文件。', 'No files changed in this session yet.'],
  ['工作区是干净的。', 'The working tree is clean.'],
  ['当前目录不是 git 仓库，或读不到 git 状态。', 'This folder is not a git repository, or git status failed.'],
  ['提示：工作区模式需要项目是 git 仓库；本会话模式只看 pi 的改动。', 'Workspace mode needs a git repository; session mode only shows pi changes.'],
  ['数据来自本会话的工具调用参数，可能和磁盘最终状态略有差异。', 'Data comes from tool-call arguments and may differ slightly from the final file state.'],
  ['执行', 'Run'],
  ['停止', 'Stop'],
  ['清空', 'Clear'],
  ['在项目目录里运行命令。默认不会写进模型上下文。', 'Run commands in the project folder. Output stays out of the model context by default.'],
  ['默认不写进上下文，需要 pi 看到时再打开', 'Kept out of context by default; enable when pi should see it'],
  ['同步给 pi', 'Share with pi'],
  ['输入命令，⏎ 执行', 'Type a command, ⏎ to run'],
  ['先打开一个项目。', 'Open a project first.'],
  ['过滤文件名…', 'Filter file names…'],
  ['无法读取目录', 'Could not read the folder'],
  ['无法预览这个文件', 'Cannot preview this file'],
  ['二进制文件不支持预览', 'Binary files cannot be previewed'],
  ['只显示前 200 KB。', 'Only the first 200 KB are shown.'],
  ['返回', 'Back'],
  ['打开', 'Open'], ['已打开 Chrome 扩展页，请在那里完成安装。', 'Chrome extensions page opened. Finish installation there.'], ['已打开扩展目录。', 'Extension folder opened.'], ['点击这一行，或手动打开 chrome://extensions。', 'Click this row, or open chrome://extensions manually.'],
  ['定位到轮次', 'Jump to turn'],
  ['读取 diff…', 'Loading diff…'],
  ['这个会话还没有图片或写出的文件。', 'No images or written files in this session yet.'],
  ['附件图片', 'Attached image'],
  ['生成的图片', 'Generated image'],
  ['用默认应用打开', 'Open with the default app'],
  ['展开全文件', 'Show the whole file'],
  ['只看上下文', 'Show context only'],
  ['全文', 'Full'],
  ['完成时发系统通知', 'Notify when a run finishes'],
  ['窗口在后台时，长任务结束会发一条系统通知。', 'Send a desktop notification when a long run ends while the window is in the background.'],
  ['导出 Markdown', 'Export Markdown'],  ['导出 HTML', 'Export HTML'],
  ['已导出 Markdown', 'Exported Markdown'],
  ['已导出 HTML', 'Exported HTML'],
  ['导出失败', 'Export failed'],
  ['轮次导航', 'Turn navigator'],
  ['第 {count} 轮', 'Turn {count}'],
  ['无提问', 'No prompt'],
  ['正在运行', 'Running'], ['已运行', 'Ran'], ['运行失败', 'Run failed'],
  ['正在读取', 'Reading'], ['已读取', 'Read'], ['读取失败', 'Read failed'],
  ['正在写入', 'Writing'], ['已写入', 'Wrote'], ['写入失败', 'Write failed'],
  ['正在编辑', 'Editing'], ['已编辑', 'Edited'], ['编辑失败', 'Edit failed'],
  ['正在调用', 'Calling'], ['已调用', 'Called'], ['调用失败', 'Call failed'],
  ['运行了 {count} 条命令', 'Ran {count} commands'],
  ['读取了 {count} 个文件', 'Read {count} files'],
  ['写入了 {count} 个文件', 'Wrote {count} files'],
  ['编辑了 {count} 个文件', 'Edited {count} files'],
  ['调用了 {count} 次 {name}', 'Called {name} {count} times'],
  ['思考中', 'Thinking'], ['思考了', 'Thought for'], ['思考了片刻', 'Thought for a moment'],
  ['一条回答', 'One answer'],
  ['最近对话', 'Recent conversations'],
  ['执行中', 'Running'],
  ['技能与工具', 'Skills & tools'], ['技能', 'Skills'], ['插件', 'Plugins'],
  ['应用连接', 'Connections'], ['搜索应用连接', 'Search connections'],
  ['手动添加', 'Add manually'], ['手动添加连接器', 'Add a connector'], ['编辑连接器', 'Edit connector'],
  ['连接 MCP 服务，让 Pi 在对话中使用它提供的工具。', 'Connect an MCP server to use its tools in chat.'],
  ['连接名称', 'Connection name'], ['例如：GitHub MCP', 'e.g. GitHub MCP'],
  ['服务器 URL', 'Server URL'], ['接入方式', 'Connection method'],
  ['接入方式：MCP（Streamable HTTP）', 'Connection method: MCP (Streamable HTTP)'],
  ['自定义请求头', 'Custom headers'], ['添加请求头', 'Add header'],
  ['服务方提供了认证信息时再填写，例如 Authorization。', 'Add these when required by the service, such as Authorization.'],
  ['请求头名称', 'Header name'], ['请求头值', 'Header value'],
  ['已保存，填写可替换', 'Enter a new value to replace'], ['移除请求头', 'Remove header'],
  ['未测试', 'Not tested'], ['测试通过', 'Test passed'], ['正在测试…', 'Testing…'], ['测试连接', 'Test connection'],
  ['连接失败', 'Connection failed'], ['需要授权', 'Authorization required'], ['当前 Pi 版本无法测试', 'Test unavailable with this Pi version'],
  ['已连接，发现 {count} 个工具。', 'Connected. Found {count} tools.'],
  ['服务需要授权，请检查请求头或服务方的登录说明。', 'Authorization required. Check your headers or the service’s sign-in instructions.'],
  ['当前 Pi 版本无法测试，请检查 Pi 版本。', 'This test is unavailable with your version of Pi.'],
  ['未能连接，请检查服务器地址和网络。', 'Could not connect. Check the server URL and network.'],
  ['未安装', 'Not installed'], ['已停用', 'Disabled'],
  ['无法读取 MCP 连接。', 'Could not read MCP connections.'],
  ['没有匹配的连接', 'No matching connections'], ['还没有应用连接', 'No connections yet'],
  ['飞书', 'Feishu'], ['通过飞书访问文档、日程和多维表格', 'Access Feishu docs, calendars and tables'],
  ['通过 GitHub 访问仓库和拉取请求', 'Access GitHub repositories and pull requests'],
  ['MCP 服务', 'MCP server'], ['本机 MCP 服务', 'Local MCP server'], ['本机依赖', 'Local dependencies'],
  ['连接已保存。', 'Connection saved.'], ['连接已移除。', 'Connection removed.'],
  ['新建或重启会话后生效。', 'Applies when you start or restart a chat.'], ['移除此连接？', 'Remove this connection?'],
  ['已检测到命令行工具。登录与授权由对应应用管理。', 'The command is installed. Sign-in and authorization are managed by the service.'],
  ['安装此工具后，即可使用依赖它的技能。', 'Install this tool to use skills that depend on it.'],
  ['技能标识', 'Skill ID'], ['缺少依赖', 'Missing dependencies'],
  ['搜索网页与社交平台', 'Search the web and social platforms'], ['搜索帖子、查看评论或读取视频字幕。', 'Find posts, read comments, or fetch video captions.'],
  ['录制产品演示', 'Record a product demo'], ['录制操作过程，可添加旁白。', 'Capture a workflow and add optional narration.'],
  ['制作产品宣传片', 'Create a product video'], ['用产品画面和动效介绍应用功能。', 'Present app features with screen footage and motion graphics.'],
  ['制作数字人口播', 'Create a talking avatar'], ['用照片或数字人形象生成口播视频。', 'Generate a spoken video from a photo or avatar.'],
  ['生成与编辑图片', 'Generate or edit images'], ['生成封面、海报或剪辑需要的图片。', 'Create covers, posters, and images for videos.'],
  ['视频口型同步', 'Lip-sync a video'], ['让视频里人物的嘴型匹配新的音频。', 'Match the speaker’s lips to new audio.'],
  ['制作视频动效', 'Create motion graphics'], ['在剪辑项目中添加动态文字和图形。', 'Add animated text and graphics to a video.'],
  ['制作字幕样式', 'Create a caption style'], ['创建可在剪辑中重复使用的动态字幕。', 'Create reusable animated captions.'],
  ['制作音频效果', 'Create audio effects'], ['调整音质，添加音效和转场。', 'Adjust audio, add sound effects, and create transitions.'],
  ['选择视频角色', 'Cast video characters'], ['为视频场景制作或选择角色形象。', 'Create or select characters for a video scene.'],
  ['制作画面效果', 'Create visual effects'], ['为视频画面添加遮罩、色彩或特效。', 'Add masks, color treatments, and effects to footage.'],
  ['排查 ChatCut 问题', 'Troubleshoot ChatCut'], ['诊断连接、项目打开或导出失败。', 'Diagnose connection, project, and export issues.'],
  ['整理素材与文字稿', 'Organize media and transcripts'], ['整理字幕、文案及音视频素材信息。', 'Organize captions, scripts, and media details.'],
  ['改进界面设计', 'Improve an interface'], ['检查界面布局与交互，提出具体修改。', 'Review layouts and interactions and identify specific improvements.'],
  ["Pi 的 MCP 配置格式有误，请检查 mcp.json。", "Pi MCP configuration must contain a valid mcpServers object."],
  ["请填写连接名称和有效的服务器地址。", "Enter a connector name and a valid URL."],
  ["连接名称需要 1–80 个字符。", "Enter a connection name of 1–80 characters."],
  ["请输入包含 https:// 或 http:// 的完整服务器地址。", "Enter a complete server URL, including https:// or http://."],
  ["远程地址请使用 HTTPS，本机地址可使用 HTTP。请将认证信息填写在请求头里。", "Use HTTPS for remote servers or HTTP on localhost, without embedded credentials or a fragment."],
  ["请填写有效的请求头名称和值。", "Enter a valid header name and value."],
  ["请求头名称需有效、互不重复，协议保留的请求头由 Pi 设置。", "Use unique header names and leave protocol headers to Pi."],
  ["服务器地址已变更，请重新填写请求头。", "Re-enter the saved headers when changing the server URL."],
  ["保存过的请求头已变更，请重新打开编辑器。", "A saved header changed. Reopen the editor and try again."],
  ["请填写单行请求头值。命令表达式只能在 Pi 的配置文件里设置。", "Enter a header value using a single line. Command expressions are unavailable here."],
  ["找不到这个 HTTP 连接。", "This HTTP connector could not be found."],
  ["请选择要移除的连接。", "Select the connection to remove."],
  ['用户', 'User'], ['全部', 'All'], ['来源', 'Source'], ['需要', 'Requires'], ['缺少', 'missing'],
  ['搜索技能或描述', 'Search skills'], ['搜索插件', 'Search plugins'],
  ['在对话中使用', 'Use in chat'], ['复制路径', 'Copy path'], ['没有描述', 'No description'],
  ['没有 SKILL.md', 'No SKILL.md'], ['没有匹配的技能', 'No matching skills'],
  ['读取技能失败', 'Could not read skills'], ['安装', 'Install'], ['安装插件', 'Install plugin'],
  ['支持 GitHub、npm 与本地目录', 'GitHub, npm, or a local folder'],
  ['安装中…', 'Installing…'], ['只安装到当前项目（.pi/settings.json）', 'Install for this project only (.pi/settings.json)'],
  ['插件会执行代码（包括安装脚本）。只安装你信任的来源。', 'Plugins run code, including install scripts. Only install sources you trust.'],
  ['已安装', 'Installed'], ['安装失败', 'Install failed'], ['已移除', 'Removed'], ['移除失败', 'Remove failed'],
  ['已更新', 'Updated'], ['更新失败', 'Update failed'], ['重启会话', 'Restart session'],
  ['还没有安装插件', 'No plugins installed'], ['更新', 'Update'], ['移除', 'Remove'],
  ['作用域', 'Scope'], ['路径', 'Path'], ['扩展', 'Extensions'], ['提示词', 'Prompts'], ['主题', 'Themes'],
  ['连接器', 'Connectors'], ['已连接', 'Connected'], ['未连接', 'Not connected'], ['状态', 'Status'],
  ['搜索连接器', 'Search connectors'], ['还没有连接器', 'No connectors yet'], ['重新检测', 'Check again'],
  ['外部命令行工具，由技能调用。', 'External CLI invoked by skills.'],
  ['已连接：技能可以通过命令行调用它。', 'Connected: skills can invoke it from the command line.'],
  ['未连接：使用它的技能无法正常执行。', 'Not connected: skills that need it cannot run.'],
  ['使用它的技能', 'Used by'], ['{count} 个技能', '{count} skills'],
  ['信息', 'Info'], ['说明', 'Documentation'], ['包含', 'Included'], ['依赖', 'Requires'],
  ['定时任务', 'Scheduled tasks'], ['个启用', 'active'], ['个暂停', 'paused'], ['个运行中', 'running'],
  ['登录时启动', 'Launch at login'], ['新建任务', 'New task'], ['还没运行', 'Not run yet'],
  ['运行中', 'Running'], ['成功', 'Success'], ['失败', 'Failed'], ['超时', 'Timed out'],
  ['已中断', 'Interrupted'], ['已错过', 'Missed'], ['已跳过', 'Skipped'],
  ['立即运行', 'Run now'], ['暂停', 'Pause'], ['恢复', 'Resume'], ['编辑', 'Edit'],
  ['启用', 'Enabled'], ['频率', 'Schedule'], ['下次运行', 'Next run'], ['运行方式', 'Run mode'],
  ['继续同一会话', 'Continue same session'], ['每次新会话', 'New session each run'],
  ['上次运行', 'Last run'], ['运行历史', 'Run history'], ['还没有运行记录', 'No runs yet'],
  ['打开会话', 'Open session'], ['查看日志', 'Open log'], ['还没有定时任务', 'No scheduled tasks yet'],
  ['下次', 'Next'], ['编辑定时任务', 'Edit scheduled task'], ['新建定时任务', 'New scheduled task'],
  ['任务会在后台启动一个独立的 pi 会话', 'Each run starts an isolated pi session in the background'],
  ['名称', 'Name'], ['例如：每日早报', 'e.g. Daily brief'],
  ['每次运行时要执行的完整指令', 'The full instruction for each run'], ['选择', 'Choose'],
  ['每小时', 'Hourly'], ['每天', 'Daily'], ['工作日', 'Weekdays'], ['每周', 'Weekly'],
  ['一次性', 'One time'],
  ['分钟', 'Minute'], ['时间', 'Time'], ['星期', 'Weekday'],
  ['错过时补跑一次（24 小时内）', 'Catch up once if missed (within 24h)'],
  ['完成后发送通知', 'Notify when finished'], ['接下来', 'Next up'],
  ['定时任务会在无人确认的情况下读写项目文件、执行命令。只给可信的 prompt 和项目。', 'Scheduled tasks read and write project files and run commands unattended. Only use trusted prompts and projects.'],
  ['删除定时任务？', 'Delete scheduled task?'],
  ['等待补跑', 'Catch-up pending'],
  ['自定义 cron', 'Custom cron'], ['文件变化', 'File change'], ['监听目录', 'Watch folder'],
  ['表达式', 'Expression'], ['时区', 'Timezone'], ['工具白名单', 'Tool allowlist'],
  ['默认工具', 'Default tools'], ['关闭后继续运行', 'Keep running when closed'],
  ['安装系统级调度，应用完全关闭也会按计划启动', 'Install a system scheduler so tasks run even when the app is closed'],
  ['系统级调度没有启用', 'System scheduler not enabled'],
  ['格式：分 时 日 月 周，例如 0 9 * * 1-5 表示工作日 09:00', 'Format: minute hour day month weekday, e.g. 0 9 * * 1-5 for weekdays at 09:00'],
  ['目录内任意文件变化后触发，800ms 内合并多次变化', 'Runs when any file in the folder changes; bursts within 800ms are merged'],
  ['按该时区的本地时间运行，夏令时自动跟随', 'Runs in this timezone’s local time and follows DST'],
  ['逗号分隔，留空使用 pi 默认工具集', 'Comma separated; leave empty to use pi’s default tools'],
  ['文件或目录路径', 'File or folder path'],
  ['在 /schedule 后面写要定时执行的内容', 'Write the task after /schedule'],
  ['未来 8 年没有匹配的运行时间', 'No matching run time in the next 8 years'],
  ['无效的时区', 'Invalid timezone'],
  ['更多选项', 'More options'],
  ['错过补跑', 'Catch up missed runs'],
  ['完成通知', 'Completion notification'],
  ['监听当前项目，800ms 内合并多次变化', 'Watch the current project; merge bursts within 800ms'],
  ['定时任务会在无人确认的情况下读写当前项目、执行命令。只给可信的 prompt。', 'Scheduled tasks read and write the current project and run commands unattended. Only use trusted prompts.'],
  ['也可以直接在对话里说「5 分钟后…」，pi 会创建定时任务', 'You can also say “in 5 minutes…” in chat and pi will create a scheduled task'],
  ['已创建定时任务', 'Scheduled task created'],
  ['定时任务运行完成', 'Scheduled task finished'],
  ['定时任务运行失败', 'Scheduled task failed'],
  ['查看结果', 'View result'],
  ['临时对话', 'Temporary chat'],
  ['不关联项目，出现在最近对话', 'No project; appears in recent conversations'],
  ['选择文件夹…', 'Choose folder…'],
  ['选择项目', 'Choose project'],
  ['搜索项目', 'Search projects'],
  ['新建项目', 'New project'],
  ['选择一个文件夹', 'Choose a folder'],
  ['不在项目中工作', 'Work without a project'],
  ['不关联项目', 'No project'],
  ['出现在最近对话', 'Appears in recent conversations'],
  ['任务和运行记录会被删除，已生成的会话保留。', 'The task and its run history will be deleted. Generated sessions remain.'],
  ['保存中…', 'Saving…'], ['保存', 'Save'],
  ['使用情况与费用', 'Usage & cost'],
  ['统计范围', 'Range'],
  ['本机估算', 'Local estimate'],
  ['正在统计本地用量…', 'Computing local usage…'],
  ['没有可用数据', 'No usage data'],
  ['总费用', 'Total cost'],
  ['按模型单价估算', 'Estimated from model pricing'],
  ['请求数', 'Requests'],
  ['平均', 'Avg'],
  ['缓存命中', 'Cache hit'],
  ['缓存读取', 'Cache read'],
  ['每日费用', 'Daily cost'],
  ['按本机时区统计', 'In local timezone'],
  ['每日费用图表', 'Daily cost chart'],
  ['这个范围内还没有用量记录。', 'No usage recorded in this range.'],
  ['用量明细', 'Usage details'],
  ['按模型', 'By model'],
  ['按项目', 'By project'],
  ['按会话', 'By session'],
  ['请求', 'Req'],
  ['费用', 'Cost'],
  ['缓存', 'Cache'],
  ['费用来自本地会话记录中的 usage.cost，按模型单价估算；没有 usage 的旧会话只统计 Token。实际账单以服务商后台为准。', 'Costs come from local session usage.cost and are estimated from model pricing. Old sessions without usage only contribute token counts. Your provider invoice is authoritative.'],
  ['排队中', 'Queued'],
  ['到当前任务结束后发送', 'Sent after the current run'],
  ['拖动调整排队顺序', 'Drag to reorder the queue'],
  ['引导', 'Guide'],
  ['引导中', 'Guiding'],
  ['把这条消息作为引导，当前工具结束后立即发送', 'Guide the run after the current tool call'],
  ['无法引导', 'Could not guide'],
  ['移除插件？', 'Remove plugin?'],
  ['插件会从 pi 设置中移除，技能目录与项目文件不受影响。', 'The plugin is removed from pi settings. Skill folders and project files are untouched.'],
  ['浏览器', 'Browser'], ['浏览器自动化', 'Browser automation'], ['当前默认', 'Default'], ['可用', 'Available'], ['安装指引', 'Setup guide'], ['打开', 'Open'], ['已打开 Chrome 扩展页，请在那里完成安装。', 'Chrome extensions page opened. Finish installation there.'], ['已打开扩展目录。', 'Extension folder opened.'], ['点击这一行，或手动打开 chrome://extensions。', 'Click this row, or open chrome://extensions manually.'], ['打开文件夹', 'Open folder'], ['扩展目录已准备好', 'Extension folder is ready'], ['由 Pi Desktop 自动准备；其他用户会使用自己的目录。', 'Prepared by Pi Desktop; other users get their own folder.'], ['高级：复制路径', 'Advanced: copy path'], ['检测连接', 'Check connection'], ['检测中…', 'Checking…'], ['已连接，可以开始使用', 'Connected. Ready to use.'], ['未检测到扩展', 'Extension not detected'], ['端口被占用，请关闭其他 Pi 任务后重试', 'Port is busy; close other Pi tasks and retry'], ['无法打开扩展目录，请手动复制上面的路径。', 'Could not open the extension folder; copy the path above.'], ['启用日常 Chrome 登录态', 'Use your everyday Chrome session'], ['只需安装一次扩展，之后 Pi 可以直接操作你当前登录的网页。', 'Install the extension once; then Pi can act on pages you are already signed in to.'], ['直接使用你已登录的网站，不用重新登录。', 'Use sites you are already signed in to; no second login.'], ['只操作当前标签页，密码框不会被读取。', 'Acts on the active tab only; password fields are never read.'], ['点击、提交等敏感动作仍会先请求你的确认。', 'Clicks, submits, and other sensitive actions still ask for your approval.'], ['打开扩展页', 'Open extensions page'], ['点击下方按钮，或手动打开 chrome://extensions。', 'Use the button below, or open chrome://extensions manually.'], ['打开开发者模式', 'Enable Developer mode'], ['打开页面右上角的「开发者模式」开关。', 'Turn on the Developer mode switch in the top-right corner.'], ['加载已解压的扩展', 'Load unpacked'], ['点击「加载已解压的扩展程序」，选择下面的目录。', 'Click Load unpacked and choose the directory below.'], ['正在读取扩展目录…', 'Reading extension path…'], ['复制路径', 'Copy path'], ['已复制', 'Copied'], ['复制失败，请手动选择上面的路径。', 'Copy failed; select the path manually.'], ['无法打开 Chrome，请手动打开 chrome://extensions。', 'Could not open Chrome; open chrome://extensions manually.'], ['稍后再说', 'Later'], ['打开 Chrome 扩展页', 'Open Chrome extensions'], ['Chrome 不允许应用自动安装扩展，这一步需要你亲手确认一次。安装后，Pi 会优先使用当前 Chrome 标签页的登录态。', 'Chrome does not allow apps to install extensions automatically; confirm this once yourself. After installation, Pi uses the active Chrome tab session.'], ['规划中', 'Planned'], ['默认方式。登录状态保留在右侧面板，Agent 读取 DOM 后按元素操作。', 'Default mode. The session stays in the side panel; the agent reads the DOM and acts on elements.'], ['使用专用 Chrome profile，适合隔离任务、并行测试和自动化验证。首次使用需在专用窗口登录。', 'Uses a dedicated Chrome profile for isolated tasks, parallel tests, and automation verification. Sign in once in the dedicated window.'], ['复用日常 Chrome 登录态；在 chrome://extensions 加载 extensions/chrome-bridge。', 'Reuses your everyday Chrome session; load extensions/chrome-bridge from chrome://extensions.'], ['后退', 'Back'], ['前进', 'Forward'], ['停止加载', 'Stop loading'], ['输入网址', 'Enter a URL'], ['网址', 'Address'], ['在系统浏览器中打开', 'Open in system browser'], ['关闭浏览器', 'Close browser'], ['重试', 'Retry'], ['应用内浏览器', 'In-app browser'], ['从对话中点击链接，或在上方输入网址。', 'Click a link in the chat, or type a URL above.'], ['使用前请了解', 'Before you start'], ['在这个面板里登录目标网站，登录状态会保留。', 'Sign in to the target site in this panel; the session is kept.'], ['让 Pi 观察页面时，会读取页面 DOM，而不是猜截图坐标。', 'When Pi observes the page it reads the DOM instead of guessing from pixels.'], ['密码框的值不会返回；操作是否需要确认取决于审批设置。', 'Password field values are not returned; whether actions require approval depends on your settings.'], ['下载完成', 'Download complete'], ['下载未完成', 'Download incomplete'],
  ['每日趋势', 'Daily trend'], ['按套餐 + 模型', 'Plan + model'], ['套餐', 'Plan'], ['趋势', 'Trend'], ['柱状', 'Bars'], ['图表类型', 'Chart type'], ['趋势指标', 'Trend metric'], ['费用', 'Cost'], ['峰值', 'Peak'], ['每日趋势图表', 'Daily trend chart'], ['次调用', 'requests'], ['Chrome 登录状态', 'Chrome sign-in'], ['只把选中的站点 Cookie 导入内置浏览器；不会导入密码或 Passkey。', 'Import cookies for selected sites only. Passwords and passkeys are never imported.'], ['从 Chrome 导入…', 'Import from Chrome…'], ['从 Chrome 导入登录状态', 'Import sign-in from Chrome'], ['只导入 Cookie，不导入密码、Passkey 或扩展数据。', 'Cookies only. Passwords, passkeys and extension data are not imported.'], ['这会让 Pi Desktop 以你的身份访问所选站点。只导入你信任的站点，导入的数据仅保存在本机。', 'This lets Pi Desktop visit the selected sites as you. Only import sites you trust; data stays on this Mac.'], ['Chrome 配置文件', 'Chrome profile'], ['Google Chrome 正在运行。请退出 Chrome 后再导入。', 'Google Chrome is running. Quit Chrome before importing.'], ['重新检查', 'Check again'], ['搜索站点…', 'Search sites…'], ['全选', 'Select all'], ['取消全选', 'Clear all'], ['已选', 'Selected'], ['个站点', 'sites'], ['正在读取 Chrome 配置…', 'Reading Chrome profiles…'], ['没有匹配的站点。', 'No matching sites.'], ['导入中…', 'Importing…'], ['导入所选站点', 'Import selected sites'], ['已导入', 'Imported'], ['个 Cookie；跳过', 'cookies; skipped'], ['个；失败', '; failed'], ['个。', '.'], ['已导入 Chrome 登录状态', 'Chrome sign-in imported'],
 ]

const english = new Map<string, string>()
const chinese = new Map<string, string>()
for (const [left, right] of pairs) {
  if (/[\u3400-\u9fff]/.test(left)) { english.set(left, right); chinese.set(right, left) }
  else { chinese.set(left, right); english.set(right, left) }
}
english.set('电脑操作', 'Computer use')
english.set('高级：运行环境与会话行为', 'Advanced: Runtime and session behavior')
english.set('启用电脑操作', 'Enable computer use')
english.set('允许 Pi 查看和操作桌面应用。关闭时不会影响网页浏览。', 'Allow Pi to view and interact with desktop apps. Turning this off does not affect web browsing.')
english.set('浏览器连接状态', 'Browser connection status')
english.set('检查应用内浏览器和 Chrome 的连接状态。是否能使用网站还取决于登录状态和权限。', 'Check browser connections. Website access also depends on sign-in and permissions.')
english.set('在右侧面板打开网页，可在这里登录并让 Pi 操作网页。', 'Open and sign in to websites in the side panel for Pi to use.')
english.set('独立浏览器', 'Separate browser')
english.set('使用单独的 Chrome 窗口和登录状态；首次使用时需要在该窗口登录。', 'Uses a separate Chrome window and sign-in. Sign in to that window the first time.')
english.set('使用我的 Chrome', 'Use my Chrome')
english.set('连接日常使用的 Chrome，操作已登录的网站。需要先安装扩展。', 'Connect your everyday Chrome to use signed-in websites. Install the extension first.')
english.set('高级：独立浏览器', 'Advanced: Separate browser')
english.set('查看可用模型列表', 'View available models')
english.set('高级：判断服务与内置工具', 'Advanced: Decision service and built-in tools')
english.set('选择是否显示思考内容，以及默认展开还是收起。', 'Choose whether to show thinking and whether it starts expanded or collapsed.')
english.set('仅确认高风险命令', 'Confirm high-risk commands only')
english.set('默认仅对识别出的高风险终端命令请求确认，不能覆盖所有风险。其他操作可能有独立的确认规则。新建会话生效。', 'By default, confirmation is requested only for identified high-risk terminal commands; not all risks are covered. Other actions may have separate approval rules. Applies to new sessions.')
english.set('沙箱当前未启用，下方文件和网络限制不会生效。', 'The sandbox is off. The file and network restrictions below are not active.')
english.set('管理 Pi 任务可以修改哪些文件、访问哪些网络。设置修改后，对新建会话生效。', 'Control which files Pi tasks can modify and which networks they can access. Changes apply to new sessions.')
english.set('运行限制', 'Task restrictions')
english.set('开启后限制 Pi 任务可以修改的文件和访问的网络。它不能隔离所有电脑操作；开启后可能需要额外允许任务所需的网站。', 'Limit which files Pi tasks can modify and which networks they can access. This does not isolate all desktop operations; you may need to allow websites used by your tasks.')
english.set('沙箱未开启。下面的文件和网络限制暂不生效，网络代理仍可单独使用。', 'The sandbox is off. File and network restrictions below are inactive; the network proxy can still be used separately.')
english.set('选择任务能否修改当前项目；会话、日志和临时文件仍可写入。仅在沙箱开启时生效。', 'Choose whether tasks can modify the current project. Sessions, logs, and temporary files remain writable. Applies only when the sandbox is on.')
english.set('选择沙箱内的任务可以连接哪些服务。完全关闭网络也会阻断在线模型，适合离线任务。', 'Choose which services sandboxed tasks can connect to. Turning networking off also blocks online models and is suitable for offline tasks.')
english.set('如果任务需要访问其他服务，在这里填写域名；多个域名用逗号或换行分隔。仅在沙箱开启时生效。', 'Enter domains for other services your task needs, separated by commas or new lines. Applies only when the sandbox is on.')
english.set('网络代理', 'Network proxy')
english.set('代理地址', 'Proxy address')
english.set('通常留空。需要通过代理连接时填写地址；此设置主要用于未开启沙箱的 Pi 会话，不代表浏览器也使用该代理。', 'Usually leave blank. Enter a proxy address if needed. This mainly applies to Pi sessions without the sandbox; browsers do not necessarily use it.')
english.set('不使用代理的地址', 'Addresses bypassing the proxy')
english.set('通常留空。填写需要直接连接的域名或地址，多个地址用逗号分隔。', 'Usually leave blank. Enter domains or addresses to connect to directly, separated by commas.')
english.set('运行记录', 'Activity log')
english.set('沙箱运行记录', 'Sandbox activity')
english.set('查看沙箱启动、退出以及被拦截的操作，排查任务受限的原因。记录保存在本机。', 'View sandbox starts, exits, and blocked actions to troubleshoot restrictions. Logs are stored locally.')
english.set('沙箱不是虚拟机：电脑界面、辅助功能权限和部分系统服务仍可能被访问。', 'The sandbox is not a virtual machine: desktop interfaces, accessibility permissions, and some system services may remain accessible.')
english.set('新会话审批方式', 'Approval for new sessions')
english.set('新会话', 'New sessions')
english.set('逐次确认', 'Confirm each tool')
english.set('高风险命令确认', 'Confirm high-risk commands')
english.set('工具不确认', 'No tool confirmations')
english.set('只影响之后新建或重新启动的会话，当前会话保持原样。', 'Applies only to sessions started or restarted later. The current session is unchanged.')
english.set('每次工具调用都确认', 'Confirm every tool call')
english.set('执行工具前都需要你确认。', 'Ask you before every tool call.')
english.set('仅确认高风险命令', 'Confirm high-risk commands only')
english.set('只对识别出的高风险终端命令询问，并不能识别所有风险。', 'Ask only for identified high-risk terminal commands; not all risks are detected.')
english.set('工具调用不确认', 'No tool-call confirmations')
english.set('不再进行这层工具审批，沙箱及浏览器、电脑操作的独立限制仍然生效。', 'Skip this tool approval. Sandbox, browser, and computer-use restrictions still apply.')
english.set('项目资源尚未启用', 'Project resources are not enabled')
english.set('此文件夹包含项目配置或扩展。信任后才能加载；这与工具操作的审批方式是两回事。', 'This folder contains project configuration or extensions that require trust. Tool approvals are controlled separately.')
english.set('信任会允许加载此文件夹里的配置、扩展和技能；其中部分内容可能执行代码。它不会自动改变工具审批或沙箱设置。', 'Trust allows this folder’s configuration, extensions and skills to load; some may run code. It does not change tool approvals or sandbox settings.')
english.set('始终信任此项目', 'Always trust this project')
english.set('保存决定，之后打开此文件夹时也会加载项目资源。', 'Save this choice and load project resources when reopening this folder.')
english.set('范围更广：父目录下的其他项目也可能继承此信任。', 'Broader scope: other projects under the parent folder may inherit this trust.')
english.set('手动确认', 'Manual')
english.set('标准', 'Standard')
english.set('不逐次确认', 'No per-tool prompts')
english.set('每次工具调用前都询问你。', 'Ask before each tool call.')
english.set('仅询问识别出的高风险终端命令，不能识别所有风险。', 'Ask only for identified high-risk terminal commands; not all risks are detected.')
english.set('跳过工具审批；沙箱、浏览器和电脑操作的独立限制仍然生效。', 'Skip tool approvals. Sandbox, browser and computer-use restrictions still apply.')
english.set('项目资源待确认', 'Project resources need review')
english.set('项目资源需要信任', 'Project resources require trust')
english.set('添加项目', 'Add project')
english.set('项目名称', 'Project name')
english.set('例如：经营分析', 'e.g. Business analysis')
english.set('项目文件夹', 'Project folder')
english.set('选择此电脑上的文件夹', 'Choose a folder on this computer')
english.set('更换文件夹', 'Change folder')
english.set('这个文件夹已在项目列表中。', 'This folder is already in Projects.')
english.set('项目操作', 'Project actions')
english.set('从列表移除', 'Remove from list')
english.set('项目信任', 'Project trust')
english.set('信任此项目？', 'Trust this project?')
english.set('信任并加载', 'Trust and load')
english.set('继续，不加载', 'Continue without loading')
english.set('信任后，Pi 可以加载这个文件夹里的项目设置、技能和连接器。项目扩展也可能执行代码。', 'Trust lets Pi load this folder’s project settings, skills, and connectors. Project extensions may run code.')
english.set('选择「继续，不加载」后，仍可查看文件和开始对话。之后可以在项目菜单里调整信任。', 'You can view files and start conversations without loading project resources. Change trust later in the project menu.')
english.set('无法读取项目信任状态。', 'Could not read project trust.')
english.set('项目扩展未启用', 'Project extensions are off')
english.set('项目资源将在新建会话时加载。', 'Project resources will load in new conversations.')
english.set('新建会话时将跳过项目自带的配置和扩展。', 'New conversations will skip this project’s settings and extensions.')
english.set('检测到项目配置或扩展；信任后可加载。', 'Project configuration or extensions were found; trust this folder to load them.')
english.set('查看并信任', 'Review trust')
english.set('收起提示', 'Dismiss notice')
english.set('检测到的项目资源', 'Detected project resources')
english.set('更多选项', 'More options')
english.set('自动', 'Automatic')
english.set('按规则自动执行；仅对识别出的高风险终端命令询问，不是 AI 逐项审核。', 'Execute using rules; ask only for identified high-risk terminal commands. This is not AI review of each action.')
english.set('错过时间后补跑', 'Run missed tasks')
english.set('只补跑尚未开始的任务；运行中断后会暂停并等待核对。', 'Only runs tasks that never started. Interrupted runs are paused for review.')
english.set('中断 · 待核对', 'Interrupted · Review needed')
english.set('任务运行时被中断，结果可能已经产生。请先核对实际结果，再决定是否重新运行或启用。', 'The run was interrupted and may have produced results. Check the actual outcome before running again or re-enabling.')
english.set('附件无法读取', 'Attachment unavailable')
english.set('附件没有可用路径或文本内容，请重新选择文件。', 'The attachment has no usable path or text. Please choose the file again.')
english.set('通过路径读取', 'Read from file')
english.set('无法读取', 'Unavailable')
english.set('部分内容，需读取文件', 'Partial text; read the file')
english.set('部分内容，无文件路径', 'Partial text; no file path')
english.set('已内嵌全文', 'Full text included')
english.set('当前会话权限', 'Current session permissions')
english.set('正在准备会话…', 'Preparing conversation…')
english.set('会话权限', 'Session permissions')
english.set('询问审批', 'Ask for approval')
english.set('自动审核', 'Automatic review')
english.set('完全访问', 'Full access')
english.set('每次调用工具前询问你。', 'Ask before each tool call.')
english.set('按本地规则检查终端命令，识别到高风险操作时询问你。', 'Check terminal commands against local rules and ask before detected high-risk actions.')
english.set('本会话的 Pi 可访问系统允许的文件和网络，工具调用无需审批。', 'Pi can access files and networks allowed by the system. Tool calls run without approval.')
english.set('正在切换权限…', 'Switching permissions…')
english.set('无法切换权限', 'Could not change permissions')
english.set('网络已关闭', 'Network off')
english.set('联网受限', 'Network restricted')
english.set('沙箱未开启', 'Sandbox off')
english.set('权限状态加载中…', 'Loading permissions…')
english.set('文件与网络', 'Files and network')
english.set('任务结束后可切换权限。', 'You can change permissions when the task finishes.')
english.set('在设置中启用完全访问', 'Enable Full access in Settings')
english.set('允许使用完全访问', 'Allow Full access')
english.set('为当前会话启用完全访问？', 'Enable Full access for this conversation?')
english.set('启用完全访问', 'Enable Full access')
english.set('本会话会关闭 Pi 沙箱并跳过工具审批。Pi 可读写系统允许的文件并联网。浏览器和电脑操作仍由各自的权限设置管理。', 'This disables the Pi sandbox and skips tool approvals for this conversation. Pi can read and write files permitted by your system and use the network. Browser and computer use have their own controls.')
english.set('新会话的默认权限', 'Default permissions for new conversations')
english.set('自动审核按本地规则检查终端命令。识别到高风险操作时会询问你。', 'Automatic review checks terminal commands against local rules and asks before detected high-risk actions.')
english.set('启用后，可以在对话菜单为单个会话选择完全访问。该会话的 Pi 沙箱和工具审批会关闭。', 'Enables Full access in the conversation menu. It turns off the Pi sandbox and tool approvals for the selected conversation.')
english.set('当前审批', 'Current approval mode')
english.set('状态不可用', 'Unavailable')
english.set('无法读取当前会话的权限状态。', 'Could not read the current session permissions.')
// Distinguish the settings navigation label from the singular session title.
english.set('会话', 'Sessions')
english.set('后台任务等待确认', 'Background task needs confirmation')
english.set('等待核对桌面操作', 'Waiting for desktop action review')
english.set('桌面操作核对已处理', 'Desktop action review handled')
english.set('桌面操作核对未完成', 'Desktop action review incomplete')
english.set('核对桌面操作 {count} 次', 'Reviewed desktop action {count} times')
english.set('任务在等待确认时中断', 'Task interrupted while awaiting confirmation')
english.set('请先核对实际结果，再决定是否重新发起。', 'Check the actual outcome before deciding whether to start again.')
english.set('确认记录不可用，请检查应用数据目录。', 'Confirmation records are unavailable. Check the app data folder.')
english.set('无法更新中断提示', 'Could not update the interruption notice')
english.set('查看', 'View')

english.set('操作已结束，结果待核对', 'Operation ended, check the result')
english.set('等待网页画面', 'Waiting for the page preview')
english.set('内置网页画面', 'In-app page preview')
english.set('网页画面', 'Page preview')
english.set('最近观察的窗口', 'Last observed window')
english.set('电脑操作预览', 'Computer use preview')
english.set('查看网页', 'Show page')
english.set('等待你确认', 'Waiting for confirmation')
english.set('停止任务', 'Stop task')
english.set('网页操作', 'Browser activity')

english.set('跟随操作页面', 'Follow active page')
english.set('选择预览页面', 'Choose preview page')
english.set('上一页', 'Previous page')
english.set('下一页', 'Next page')

export function translate(language: 'zh-CN' | 'en', text: string): string {
  return (language === 'en' ? english : chinese).get(text) ?? text
}

english.set('收起步骤', 'Hide steps')
english.set('查看步骤', 'View steps')
english.set('正在处理任务', 'Working on the task')
english.set('正在连接浏览器', 'Connecting to the browser')
english.set('浏览器已就绪', 'Browser ready')
english.set('连接浏览器失败', 'Browser connection failed')
english.set('正在结束网页操作', 'Finishing browser actions')
english.set('网页操作已结束', 'Browser actions finished')
english.set('结束网页操作失败', 'Could not finish browser actions')
english.set('连接浏览器 {count} 次', 'Connected to the browser {count} times')
english.set('结束网页操作 {count} 次', 'Finished browser actions {count} times')

english.set('自动模式', 'Auto mode')
english.set('想让 Pi 帮你做什么？', 'What would you like Pi to do?')
english.set('例如，帮我比较两个网页的内容…', 'For example, compare two web pages…')
english.set('新会话权限', 'New chat permissions')
english.set('识别到高风险终端命令时询问你。', 'Ask when a terminal command is identified as high risk.')
english.set('跳过工具确认。沙箱和电脑操作权限仍然生效。', 'Skip tool prompts. Sandbox and desktop permissions still apply.')
english.set('新建或重启会话后生效。', 'Applies to new or restarted chats.')
english.set('新标签页', 'New tab')
english.set('搜索文件或输入网址', 'Search files or enter a URL')
english.set('网页', 'Web page')
english.set('打开网址', 'Open URL')
english.set('没有匹配的文件', 'No matching files')
english.set('正在跟随 Pi', 'Following Pi')
english.set('跟随 Pi', 'Follow Pi')
english.set('固定当前网页', 'Pin this page')
english.set('跟随 Pi 切换网页', 'Follow Pi between pages')
english.set('本次会话', 'This chat')
english.set('全部产物', 'All artifacts')
english.set('恢复右上角位置', 'Return to top right')
english.set('工具返回的图片', 'Image from tool')

// First-run and settings copy (kept close to the product's actual terms).
english.set('准备 Pi', 'Prepare Pi')
english.set('正在准备 Pi…', 'Preparing Pi…')
english.set('准备失败，请检查网络后重试。', 'Could not prepare Pi. Check your connection and try again.')
english.set('还没有找到 Pi。请先完成准备，或检查设置里的 Pi 路径。', 'Pi was not found. Finish preparing it, or check the Pi path in Settings.')
english.set('先选择 AI 模型，再打开项目开始对话。', 'Choose an AI model before opening a project and starting a conversation.')
english.set('Pi 是这个应用的 AI 引擎，负责理解问题、使用工具和处理文件。首次启动会自动准备，通常不需要你操作。', 'Pi is the AI engine behind this app. It understands requests, uses tools, and works with files. It is prepared automatically on first launch; you usually do not need to do anything.')
english.set('正在准备…', 'Preparing…')
english.set('立即准备', 'Prepare now')
english.set('重试准备', 'Try preparing again')
english.set('正在自动准备，通常需要一两分钟。请不要关闭窗口。', 'Preparing automatically. This usually takes a minute or two; please keep this window open.')
english.set('还差一步：选择 AI 模型', 'One more step: choose an AI model')
english.set('Pi 已准备好。选择一个 AI 服务商并填写 API Key 即可使用。', 'Pi is ready. Choose an AI provider and enter an API Key to get started.')
english.set('Pi 已安装。选择一个 AI 服务商并填写 API Key 即可使用。', 'Pi is installed. Choose an AI provider and enter an API Key to get started.')
english.set('选择模型', 'Choose model')
english.set('限制 Pi 只能修改当前项目、只访问允许的网站。不会影响你电脑上的其他应用。', 'Limit Pi to the current project and the websites you allow. Other apps on your computer are unaffected.')
english.set('当前平台暂不支持沙箱。', 'The sandbox is not supported on this platform yet.')
english.set('允许 Pi 修改当前项目，还是只能读取文件？无论哪种，Pi 都可以写会话记录和临时文件。', 'Allow Pi to modify the current project, or only read files? In both cases, Pi can write session records and temporary files.')
english.set('允许 Pi 连接 AI 服务和指定网站，或完全离线。完全离线时，在线模型也无法使用。', 'Allow Pi to connect to AI services and allowed websites, or work fully offline. Offline mode also blocks online models.')
english.set('Pi 需要访问其他网站时，在这里填写；多个网站用逗号或换行分隔。', 'Add websites Pi may need, separated by commas or new lines.')
english.set('公司网络或本机代理需要时填写；普通用户留空。沙箱开启时由安全层管理网络，此项主要用于未开启沙箱的对话。', 'Fill this in only if your network or a local proxy requires it. The sandbox manages networking when it is on; this mainly applies to conversations without the sandbox.')
english.set('不经过代理的地址，多个用逗号分隔。', 'Addresses that bypass the proxy, separated by commas.')
english.set('查看 Pi 被允许和阻止了哪些操作。记录保存在本机。', 'See which actions Pi was allowed or blocked from performing. Records stay on this computer.')
english.set('选择 Pi 在执行操作前是否询问你。修改后新建对话生效。', 'Choose whether Pi asks before performing actions. Changes apply to new conversations.')

// Settings status summaries.
english.set('当前：执行前确认', 'Current: confirm before actions')
english.set('每一步操作都会先询问你。', 'Pi asks before every action.')
english.set('高风险操作会先询问你。', 'Pi asks before high-risk actions.')
english.set('每一步询问', 'Ask every step')
english.set('高风险询问', 'Ask for high risk')
english.set('当前：受保护', 'Current: protected')
english.set('当前：未开启保护', 'Current: protection off')
english.set('只能读取项目文件', 'Project files are read-only')
english.set('可以修改当前项目', 'Can modify the current project')
english.set('完全离线', 'Fully offline')
english.set('仅访问 AI 服务和允许的网站', 'Only AI services and allowed websites')
english.set('Pi 可以修改项目文件并访问网络。开启保护后可以限制文件和网络范围。', 'Pi can modify project files and access the network. Turn on protection to limit files and network access.')
english.set('已开启', 'On')
english.set('未开启', 'Off')

english.set('第一次使用，先完成准备工作', 'First time here: finish a short setup')
english.set('正在完成准备工作', 'Finishing setup')
english.set('准备工作没有完成', 'Setup did not finish')
english.set('这是应用自己的准备步骤，一般不需要你操作。', 'This is the app’s own setup step. You usually do not need to do anything.')
english.set('通常一两分钟，请不要关闭窗口。', 'This usually takes a minute or two. Please keep this window open.')
english.set('开始准备', 'Start setup')
english.set('再试一次', 'Try again')
english.set('请检查网络后再试一次。', 'Check your connection, then try again.')
english.set('还是没有准备好。可以再试一次，或打开高级选项查看详情。', 'Still not ready. Try again, or open Advanced for details.')
english.set('高级', 'Advanced')
english.set('手动指定程序位置', 'Choose the program location')
english.set('检测到的版本', 'Detected version')
english.set('连接一个 AI 模型后就可以开始聊天。不一定要先选文件夹。', 'Connect an AI model and you can start chatting. You do not have to pick a folder first.')
english.set('可以直接开始聊天。如果要处理某个文件夹里的文件，再选择文件夹。', 'You can start chatting now. Choose a folder later if you want to work with its files.')
english.set('还差一步：连接 AI 模型', 'One more step: connect an AI model')
english.set('API Key 是服务商给你的一串密钥，只保存在这台电脑上。也可以用账号登录。连接后就能开始聊天，不需要先选文件夹。', 'An API Key is a secret from your provider. It stays on this computer. You can also sign in with an account. After connecting, you can chat without choosing a folder.')
english.set('连接模型', 'Connect a model')
english.set('我还没有密钥', 'I do not have a key yet')
english.set('到服务商网站的 API keys 页面创建。常见的有 OpenAI、Anthropic、Google AI Studio 和 DeepSeek。创建后回到这里粘贴。', 'Create one on the provider’s API keys page. Common choices are OpenAI, Anthropic, Google AI Studio, and DeepSeek. Then come back and paste it.')
english.set('开始聊天', 'Start chatting')
english.set('选择文件夹', 'Choose a folder')
english.set('用账号登录，或粘贴服务商给你的 API Key。密钥只保存在这台电脑上。', 'Sign in, or paste the API Key from your provider. The key stays on this computer.')
english.set('用账号登录（推荐）', 'Sign in (recommended)')
english.set('粘贴 API Key', 'Paste API Key')
english.set('已保存登录或 API Key 的模型', 'Models with a saved sign-in or API Key')
english.set('个服务商', 'providers')
english.set('还没有自定义服务商。需要对接自己的接口时再添加。', 'No custom providers yet. Add one when you need to connect your own endpoint.')
english.set('新建对话时的思考深度，聊天时仍可以临时调整。', 'How deeply new conversations think. You can still change it while chatting.')
english.set('密钥只保存在这台电脑上，不会上传，界面里也不会再次显示。', 'The key stays on this computer. It is not uploaded, and it will not be shown again.')
english.set('技术详情', 'Technical details')
english.set('写入本机的凭证文件，只有当前用户可以读取。', 'Saved in a credential file on this computer that only the current user can read.')
english.set('在 platform.openai.com 的 API keys 页面创建。', 'Create one on the API keys page at platform.openai.com.')
english.set('在 console.anthropic.com 的 API keys 页面创建。', 'Create one on the API keys page at console.anthropic.com.')
english.set('在 aistudio.google.com 的 API key 页面创建。', 'Create one on the API key page at aistudio.google.com.')
english.set('在 openrouter.ai 的 Keys 页面创建。', 'Create one on the Keys page at openrouter.ai.')
english.set('在 platform.deepseek.com 的 API keys 页面创建。', 'Create one on the API keys page at platform.deepseek.com.')
english.set('在 console.groq.com 的 API keys 页面创建。', 'Create one on the API keys page at console.groq.com.')
english.set('在 console.x.ai 的 API keys 页面创建。', 'Create one on the API keys page at console.x.ai.')
english.set('在 console.mistral.ai 的 API keys 页面创建。', 'Create one on the API keys page at console.mistral.ai.')
english.set('在 OpenCode 账号的 API keys 页面创建。', 'Create one on the API keys page of your OpenCode account.')
english.set('到服务商网站的 API keys 页面创建，然后粘贴到这里。', 'Create one on the provider’s API keys page, then paste it here.')
english.set('临时对话', 'Temporary chat')
english.set('这次对话没有关联文件夹', 'This chat is not tied to a folder')
english.set('不关联文件夹', 'No folder')
english.set('只聊天，不选文件夹', 'Just chat, without a folder')
english.set('对话会出现在「最近对话」里', 'The chat will appear in Recent')
english.set('已就绪', 'Ready')
english.set('需要检查', 'Needs attention')
english.set('正在准备', 'Preparing')
english.set('pi 运行状态与诊断', 'Pi status and diagnostics')
english.set('未命名会话', 'Untitled chat')
english.set('打开保护', 'Turn on protection')
english.set('打开后，只能修改当前文件夹里的文件，并且只能访问允许的网站。不会影响电脑上的其他应用。', 'When this is on, only files in the current folder can be changed, and only allowed websites can be reached. Other apps on this computer are unaffected.')
english.set('现在没有额外限制。打开保护后，才能限制能改哪些文件、能访问哪些网站。', 'Nothing extra is restricted right now. Turn on protection to limit which files can be changed and which websites can be reached.')
english.set('高级：网络代理', 'Advanced: network proxy')
english.set('留空即可', 'Leave blank')
english.set('留空即可，多个网站用逗号分隔', 'Leave blank, or separate websites with commas')
english.set('打开后，可以让某一次对话不再逐次询问。那次对话可以修改电脑上的文件并联网。', 'When this is on, one conversation can stop asking each time. That conversation can change files on this computer and use the network.')
english.set('这一次对话', 'This conversation')
english.set('只影响正在进行的这次对话。', 'This only affects the conversation you are in.')
english.set('每次先问我', 'Ask me first')
english.set('做任何操作之前都会先问你。', 'Ask before doing anything.')
english.set('通常直接做', 'Usually just do it')
english.set('一般操作直接进行；发现危险命令时再问你。', 'Ordinary actions proceed; you are asked when a command looks dangerous.')
english.set('不再询问', 'Stop asking')
english.set('可以修改这台电脑上的文件并联网，不再逐次询问。只在你完全信任这次任务时使用。', 'Files on this computer can be changed and the network can be used, without asking each time. Use this only when you fully trust the task.')
english.set('保护已开启', 'Protection is on')
english.set('保护未开启', 'Protection is off')
english.set('查看保护设置', 'View protection settings')
english.set('之后的新对话', 'New conversations later')
english.set('这里的选择不会改变以后新建对话的默认方式。', 'This choice does not change the default for conversations you start later.')
english.set('更改新对话的默认方式', 'Change the default for new conversations')
english.set('这次对话不再询问？', 'Stop asking in this conversation?')
english.set('可以修改这台电脑上的文件并联网，不再逐次询问。只在你完全信任当前任务时使用。', 'Files on this computer can be changed and the network can be used, without asking each time. Use this only when you fully trust the current task.')
english.set('这次不再询问', 'Stop asking this time')
english.set('查看环境信息', 'Check environment info')
english.set('查看文件列表', 'Look through files')
english.set('搜索文件内容', 'Search file contents')
english.set('一条命令', 'A command')
english.set('文件', 'File')
english.set('正在处理', 'Working')
english.set('已完成一步', 'Finished a step')
english.set('这一步失败', 'This step failed')
english.set('完成了 {count} 步', 'Finished {count} steps')
english.set('第 {start}–{end} 行', 'Lines {start}–{end}')
english.set('从第 {start} 行', 'From line {start}')
english.set('设计落地页', 'Design a landing page')
english.set('按说明调整页面、作品集和改版，避免套用模板。', 'Adjust pages, portfolios, and redesigns from a brief, without a template look.')
english.set('设计界面', 'Design an interface')
english.set('做新界面或改现有界面时，给出具体的视觉方案。', 'Propose a concrete visual design for a new or existing interface.')
english.set('生成演示文稿', 'Make a presentation')
english.set('把内容做成可以翻页的演示。', 'Turn content into a presentation you can page through.')
english.set('读取表格', 'Read a spreadsheet')
english.set('读取表格里的记录、字段和视图。', 'Read records, fields, and views in a spreadsheet.')
english.set('整理长内容', 'Summarize long text')
english.set('把很长的文字整理成摘要。', 'Turn a long piece of text into a summary.')
english.set('处理飞书审批', 'Handle Feishu approvals')
english.set('查看和处理审批待办。', 'See and handle approval tasks.')
english.set('使用飞书应用', 'Use Feishu apps')
english.set('查看和操作飞书里的应用。', 'Open and work with Feishu apps.')
english.set('查看考勤', 'Check attendance')
english.set('查看自己的考勤打卡记录。', 'See your own attendance records.')
english.set('使用多维表格', 'Use a Feishu base')
english.set('查看和整理飞书多维表格。', 'View and organize a Feishu base.')
english.set('管理日历', 'Manage the calendar')
english.set('查看日程，创建或更新会议。', 'See events, and create or update meetings.')
english.set('查找联系人', 'Find contacts')
english.set('按姓名或部门查找飞书联系人。', 'Find Feishu contacts by name or department.')
english.set('查找资料', 'Find information')
english.set('办公协作', 'Work together')
english.set('设计与呈现', 'Design and present')
english.set('其他能力', 'Other abilities')
english.set('未命名技能', 'Untitled skill')
english.set('要做的事情', 'What to do')
english.set('到时间后会在后台自动做这件事。', 'When the time comes, this runs in the background.')
english.set('写下到时候要完成的事，例如：汇总昨天的订单并写成一段摘要', 'Write what should be done, for example: summarize yesterday’s orders.')
english.set('使用 cron 表达式', 'Use a cron expression')
english.set('自定义时间', 'Custom time')
english.set('文件有变化时', 'When files change')
english.set('已选择', 'Selected')
english.set('改用这个', 'Use this instead')
english.set('当前文件夹里的文件有变化后触发，短时间内的多次变化会合并成一次。', 'Runs when files in the current folder change. Several changes close together count as one.')
english.set('例如 0 9 * * 1-5 表示每个工作日 09:00。下面会显示接下来的运行时间。', 'For example, 0 9 * * 1-5 means 09:00 on weekdays. Upcoming run times are shown below.')
english.set('将按这个时间运行：', 'Runs on this schedule: ')
english.set('到点后会自动执行，请只填写你信任的任务。', 'This runs on its own. Only enter a task you trust.')
english.set('例如，比较两个网页、整理一份资料，或安排一件待办。', 'For example, compare two web pages, organize some notes, or set a reminder.')
english.set('新对话的默认方式', 'Default for new conversations')
english.set('只影响之后新建的对话。正在进行的对话不会跟着改变。', 'This only affects conversations you start later. The one you are in stays as it is.')
