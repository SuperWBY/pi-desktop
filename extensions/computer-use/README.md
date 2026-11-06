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
| `computer_use_act` | Click, double/right click, type, key, scroll, wait |
| `computer_use_batch` | Short action sequence |
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
- window-scoped screenshots
- semantic post-action verification
- per-app allowlist / deny list
- sandbox backend (Cua / Docker)
