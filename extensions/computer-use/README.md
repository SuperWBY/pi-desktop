# Pi Desktop Computer Use

A native macOS computer-use layer for Pi, built around the Accessibility API, screen capture and CoreGraphics input. An experimental PowerShell UIAutomation backend is included for Windows.

## Install

```bash
cd extensions/computer-use
swiftc -O src/ComputerUseHelper.swift -o bin/computer-use-helper
cd ../..
pi install ./extensions/computer-use
```

Restart Pi Desktop or start a new session after installing.

## Tools

| Tool | Purpose |
|---|---|
| `computer_use_apps` | List running applications |
| `computer_use_observe` | Screenshot + Accessibility tree for the frontmost/target app |
| `computer_use_act` | Click, double/right click, native press, set value, type, key, scroll, wait |
| `computer_use_batch` | Short action sequence |
| `computer_use_browser_observe` | Read interactive DOM candidates from the active Chrome tab |
| `computer_use_browser_act` | Click, type, or press on a browser DOM candidate |
| `computer_use_permissions` | Accessibility / Screen Recording status |

The extension ships a `computer-use` skill that requires observation before action and stops on stale snapshots.

## Permissions

Grant **Accessibility** and **Screen Recording** to Pi Desktop (or the terminal running Pi) in:

```text
System Settings → Privacy & Security → Accessibility
System Settings → Privacy & Security → Screen Recording
```

`computer_use_permissions` reports the current state.

## Safety

- Every action is confirmed in the Pi UI.
- Snapshot element IDs expire after an action; observe again.
- Secure text fields are marked and their values are not returned.
- Screen content is untrusted input; it cannot override the skill or user instructions.
- Actions are appended to `~/.pi/computer-use/audit.jsonl` without text-field values.
- This version operates the local desktop, not a sandbox.

Set `PI_COMPUTER_USE_APPROVAL=never` only for a trusted, isolated machine; default is `always`.

## Architecture

```text
Pi extension (TypeScript)
  └── native helper (Swift)
        ├── Accessibility API: app/window/element tree
        ├── screencapture: PNG, resized to logical screen points
        └── CGEvent: mouse, keyboard, scroll
```

## Remaining layers

- Windows UI Automation backend
- multi-display coordinate mapping
- semantic post-action verification
- per-app allowlist / deny list
- sandbox backend (Cua / Docker)


## Hybrid observation

`computer_use_observe` now compiles Accessibility elements and Vision OCR lines into one candidate list. Each candidate carries `source` (`ax` or `ocr`), `confidence`, bounds, and suggested actions. AX candidates keep their element IDs; OCR-only candidates use `oN` IDs.


## Marked screenshots

Observation draws red boxes for Accessibility elements and blue boxes for OCR-only text, labeled with the candidate ID (`eN` or `oN`). AX actions (`press`, `set_value`) run through Accessibility before falling back to coordinate input.


## Chrome DOM channel

The browser tools read the active Google Chrome tab through AppleScript DOM access. This preserves the user's existing Chrome login instead of launching a separate browser. It requires a one-time Chrome setting:

```text
Chrome → 显示 → 开发者 → 允许 Apple 事件中的 JavaScript
```

If the setting is disabled, the tool returns a clear error instead of guessing coordinates. Password-field values are never returned and typing into password fields is refused.
