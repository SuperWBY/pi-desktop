$ErrorActionPreference = 'Stop'
$ScriptArgs = $args

function Arg([string]$name) {
  $index = [Array]::IndexOf($ScriptArgs, $name)
  if ($index -ge 0 -and $index + 1 -lt $ScriptArgs.Count) { return $ScriptArgs[$index + 1] }
  return $null
}

function Emit($value, [int]$code = 0) {
  $value | ConvertTo-Json -Depth 20 -Compress
  exit $code
}

function Fail([string]$message) {
  Emit @{ ok = $false; error = $message } 1
}

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class WinInput {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, int data, UIntPtr extra);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
}
"@

$MouseLeftDown = 0x0002
$MouseLeftUp = 0x0004
$MouseRightDown = 0x0008
$MouseRightUp = 0x0010
$MouseWheel = 0x0800
$Screen = [System.Windows.Forms.SystemInformation]::VirtualScreen

function Get-AppProcess([string]$name) {
  $processes = @(Get-Process | Where-Object { $_.MainWindowHandle -ne 0 })
  if ([string]::IsNullOrWhiteSpace($name)) {
    return $processes | Sort-Object StartTime -Descending | Select-Object -First 1
  }
  $normalized = $name.Trim().ToLowerInvariant()
  $match = $processes | Where-Object {
    $_.ProcessName.ToLowerInvariant() -eq $normalized -or
    $_.MainWindowTitle.ToLowerInvariant().Contains($normalized) -or
    $_.Id.ToString() -eq $normalized
  } | Select-Object -First 1
  if (-not $match) { throw "Application not found: $name" }
  return $match
}

function Get-WindowElement($process) {
  $condition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ProcessIdProperty,
    $process.Id
  )
  $windows = [System.Windows.Automation.AutomationElement]::RootElement.FindAll(
    [System.Windows.Automation.TreeScope]::Children,
    $condition
  )
  if ($windows.Count -eq 0) { return $null }
  return $windows[0]
}

function Get-Rect($rect) {
  if ($null -eq $rect) { return $null }
  return @{
    x = [math]::Round($rect.X)
    y = [math]::Round($rect.Y)
    width = [math]::Round($rect.Width)
    height = [math]::Round($rect.Height)
  }
}

function Get-Snapshot([string]$appName, [string]$screenshotPath) {
  $process = Get-AppProcess $appName
  $window = Get-WindowElement $process
  if ($null -eq $window) { throw "No window found for $($process.ProcessName)" }
  $current = $window.Current
  $elements = @()
  $all = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
  for ($i = 0; $i -lt $all.Count -and $elements.Count -lt 250; $i++) {
    $element = $all.Item($i)
    $item = $element.Current
    $role = $item.ControlType.ProgrammaticName -replace '^ControlType\.', ''
    $name = $item.Name
    if ([string]::IsNullOrWhiteSpace($name) -and $role -notmatch 'Button|Edit|Text|MenuItem|Tab|Link|CheckBox|RadioButton') { continue }
    $elements += @{
      id = "e$($elements.Count + 1)"
      role = $role
      title = $name
      description = $null
      value = $null
      identifier = $item.AutomationId
      enabled = $item.IsEnabled
      focused = $item.HasKeyboardFocus
      secure = $item.IsPassword
      bounds = Get-Rect $item.BoundingRectangle
      depth = 0
    }
  }
  if ($screenshotPath) {
    $bitmap = New-Object System.Drawing.Bitmap $Screen.Width, $Screen.Height
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.CopyFromScreen($Screen.Left, $Screen.Top, 0, 0, $bitmap.Size)
    $bitmap.Save($screenshotPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $graphics.Dispose()
    $bitmap.Dispose()
  }
  return @{
    app = $process.ProcessName
    bundleId = $null
    windowTitle = $current.Name
    windowBounds = Get-Rect $current.BoundingRectangle
    screenshot = $screenshotPath
    screenWidth = $Screen.Width
    screenHeight = $Screen.Height
    accessibility = $true
    screenRecording = $true
    elements = $elements
  }
}

function Click-At([int]$x, [int]$y, [bool]$right = $false, [int]$count = 1) {
  [WinInput]::SetCursorPos($x, $y) | Out-Null
  $down = if ($right) { $MouseRightDown } else { $MouseLeftDown }
  $up = if ($right) { $MouseRightUp } else { $MouseLeftUp }
  for ($i = 0; $i -lt $count; $i++) {
    [WinInput]::mouse_event($down, 0, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 35
    [WinInput]::mouse_event($up, 0, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 80
  }
}

function Send-Key([string]$key, [string]$modifiers = '') {
  $parts = @()
  if ($modifiers -match 'control|ctrl') { $parts += '^' }
  if ($modifiers -match 'shift') { $parts += '+' }
  if ($modifiers -match 'option|alt') { $parts += '%' }
  $map = @{
    enter = '{ENTER}'; return = '{ENTER}'; tab = '{TAB}'; escape = '{ESC}'; esc = '{ESC}'
    space = ' '; backspace = '{BACKSPACE}'; delete = '{DELETE}'
    up = '{UP}'; down = '{DOWN}'; left = '{LEFT}'; right = '{RIGHT}'
    home = '{HOME}'; end = '{END}'; pageup = '{PGUP}'; pagedown = '{PGDN}'
  }
  $suffix = if ($map.ContainsKey($key.ToLowerInvariant())) { $map[$key.ToLowerInvariant()] } else { $key }
  if ($parts.Count -gt 0) {
    [System.Windows.Forms.SendKeys]::SendWait(($parts -join '') + $suffix)
  } else {
    [System.Windows.Forms.SendKeys]::SendWait($suffix)
  }
}

try {
  $command = if ($args.Count -gt 0) { $args[0] } else { 'check' }
  switch ($command) {
    'check' { Emit @{ ok = $true; accessibility = $true; screenRecording = $true } }
    'apps' {
      $apps = @(Get-Process | Where-Object { $_.MainWindowHandle -ne 0 } | Sort-Object ProcessName | ForEach-Object {
        @{ name = $_.ProcessName; bundleId = $_.Path; pid = $_.Id; active = $_.MainWindowHandle -ne 0 }
      })
      Emit @{ ok = $true; apps = $apps }
    }
    'observe' {
      $app = Arg '--app'
      $screenshot = Arg '--screenshot'
      $snapshot = Get-Snapshot $app $screenshot
      Emit @{ ok = $true; snapshot = $snapshot }
    }
    'click' {
      $x = [int](Arg '--x'); $y = [int](Arg '--y')
      $right = (Arg '--button') -eq 'right'
      $count = if (Arg '--count') { [int](Arg '--count') } else { 1 }
      Click-At $x $y $right $count
      Emit @{ ok = $true }
    }
    'type' {
      $text = Arg '--text'
      if ($null -eq $text) { Fail 'Missing text' }
      [System.Windows.Forms.Clipboard]::SetText($text)
      [System.Windows.Forms.SendKeys]::SendWait('^v')
      Emit @{ ok = $true }
    }
    'key' {
      $key = Arg '--key'
      if (-not $key) { Fail 'Missing key' }
      Send-Key $key (Arg '--modifiers')
      Emit @{ ok = $true }
    }
    'scroll' {
      $x = [int](Arg '--x'); $y = [int](Arg '--y')
      $delta = [int](Arg '--delta')
      [WinInput]::SetCursorPos($x, $y) | Out-Null
      [WinInput]::mouse_event($MouseWheel, 0, 0, $delta, [UIntPtr]::Zero)
      Emit @{ ok = $true }
    }
    default { Fail "Unknown command: $command" }
  }
} catch {
  Fail $_.Exception.Message
}
