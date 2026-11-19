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

Packaged Pi Desktop prepares its own runtime when no Computer Use package is configured; an existing package configuration is preserved. Pi itself must still be installed and available. The first desktop observation or action checks the helper's actual Accessibility and Screen Recording permissions. If either is missing, the desktop app offers a setup guide and opens the macOS permission request or settings after the user chooses it. The user must grant access; cancellation stops the action. macOS may require restarting the application. Browser-only sessions do not require these desktop permissions.

In Pi Desktop, desktop Computer Use is off by default. Enable it in Settings → Computer Use; the setting applies to the next desktop tool call without restarting the session and is independent of the browser tools. Turning it off does not interrupt an action already in progress and is not an operating-system sandbox: a separately authorized shell or third-party extension may have its own desktop capabilities. Standalone Pi sessions are not governed by the desktop app setting.

## Tools

| Tool | Purpose |
|---|---|
| `computer_use_apps` | List running applications |
| `computer_use_observe` | Screenshot + Accessibility tree for the frontmost/target app |
| `computer_use_act` | Click, double/right click, native press, set value, type, key, scroll, wait |
| `computer_use_batch` | Short action sequence |
| `computer_use_browser_observe` | Read interactive DOM candidates from the active Chrome tab |
| `computer_use_browser_act` | Legacy unguarded action is unavailable; use the unified browser session |
| `computer_use_session_open` / `observe` / `act` / `close` | Preferred browser flow with observation and target checks |
| `computer_use_cdp_act` | Legacy action is unavailable; use the unified session with `backend: cdp` |
| `computer_use_permissions` | Accessibility / Screen Recording status |

The extension ships a `computer-use` skill that uses the unified browser session for observation and actions. Legacy Chrome AppleScript observation is retained for compatibility, but its unguarded action is disabled.

## Permissions

Grant **Accessibility** and **Screen Recording** to Pi Desktop (or the terminal running Pi) in:

```text
System Settings → Privacy & Security → Accessibility
System Settings → Privacy & Security → Screen Recording
```

`computer_use_permissions` reports the current state.

## Safety

- Actions request confirmation by default; `PI_COMPUTER_USE_APPROVAL=never` disables it.
- Snapshot element IDs expire after an action; observe again.
- Desktop snapshots are consumed before an action starts, including actions whose outcome is uncertain. Concurrent actions cannot reuse the same snapshot. A native AX target is checked again against the observed window and element properties on macOS; a mismatch stops the action. Coordinate and OCR actions do not have the same identity guarantee.
- A failed or timed-out AX action is not automatically retried as a coordinate click or text input. Observe again and decide what to do; the original action may have completed.
- Secure text fields are marked and their values are not returned.
- Observation screenshots use private temporary directories and are removed on normal completion or error; an abrupt process or machine termination may leave temporary files behind.
- Screen content is untrusted input. The skill instructs the model not to follow page instructions, but this is not a technical guarantee against prompt injection.
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

The optional Chrome extension bridge observes the current tab and binds the next action to the observed tab, document, and URL. Observe again after an action, navigation, or tab switch. Each bridge request is delivered at most once; on timeout the outcome may be unknown and the page must be inspected before retrying. Reload the Chrome bridge extension after updating its code. Older versions do not support this observation protocol.

The bridge uses a per-user pairing key and authenticated one-time exchanges. It does not defend against malware able to read the same user’s private files. Chrome may suspend its worker; the extension registers a 30-second wake alarm and clicking its toolbar icon also wakes it, but the alarm is not a guarantee of immediate reconnection. The connection check uses an authenticated ping. Reload the unpacked extension after updating Pi Desktop.

## Unified browser session

Prefer `computer_use_session_open`, `computer_use_session_observe`, `computer_use_session_act`, and `computer_use_session_close`. Choose one of `inapp`, `cdp`, or `extension` when opening; close before switching. Each action requires a fresh observation. Actions request confirmation by default. In-app and CDP sessions bind actions to the observed URL and a document marker; the extension additionally checks the active tab and Chrome document ID. A page can modify DOM markers, so they are not a defense against a malicious page. Older browser tools remain available for compatibility when no unified session is active; the old AppleScript fallback is not used by the new router. The in-app and CDP backends can navigate to HTTP(S) URLs; the extension backend uses the currently active Chrome tab. Closing an in-app or extension session does not close the user's window.

Pi Desktop passes an instance-specific `PI_DESKTOP_BROWSER_BRIDGE_FILE` to its own Pi processes. A separate Pi CLI does not automatically discover a new Desktop instance; it may use an explicitly supplied bridge file, and only falls back to the legacy HOME-based file when no scoped path is provided. A scoped path that is missing never falls back to another instance. Third-party Computer Use packages that only read the legacy global file must be updated to support the scoped environment variable.

For asynchronously loaded UI, `computer_use_session_wait` performs read-only observations until exactly one candidate matches the requested name and optional role, or the bounded wait window expires. It reports elapsed time and observation count; an individual backend observation can run longer than the requested window. It never repeats a write or submit. A match is a fresh observation, not proof of business success; verify the server-side outcome separately. Human verification pauses the session.

`computer_use_session_read` reads up to 8,000 characters of rendered main-document text after a fresh observation, on all three backends. It omits input values, editable regions, iframes and shadow DOM and attempts to skip hidden elements. It is not a privacy filter: visible or obscured page text may contain sensitive data, and the text is untrusted. Results may be incomplete or truncated and cannot by themselves prove a business transaction succeeded. Chrome bridge users must refresh the updated extension.

For in-app browser sessions, `computer_use_session_downloads` reports downloads started since the session opened, with their state and, when available after completion, the user-selected local path and received byte count. These events can also originate from the user or other activity; they are not bound to a particular action. Verify the intended file and its contents independently. The authenticated local bridge keeps only the latest 100 events in memory and reports truncation; a bridge restart invalidates the session's history. CDP and Chrome extension download tracking are not yet supported.

## Optional Jev advisory

The router can optionally use the OpenCode Console limited-time free model: set `PI_JEV_ENABLED=1`, `PI_JEV_PROVIDER=opencode-free`, and `OPENCODE_CONSOLE_API_KEY` in the environment that launches Pi. It sends requests only to `opencode.ai/inference/systemone/v1/systemone` with model `jev-1.13-free`; another model is rejected and there is no paid fallback. An OpenCode Go credential is not assumed to be a Console credential. The offer and availability can change; the user's Go credential returned HTTP 403 during local validation, so a working Console credential and real connectivity are still required. Existing app launches do not automatically inherit variables set in an unrelated Terminal.


Jev uses TypeSafe's System One API. Configure `PI_JEV_ENABLED=1` and `TYPESAFE_API_KEY` in the environment that starts Pi; optionally set `PI_JEV_MODEL` (default `jev-latest`). No key is included. For its automatic risk advisory, the application sends only a fixed-list action type and fixed-list element role to the selected provider; URLs, page text, values, and typed content are not sent. Because the available context is minimal, its risk score is only a weak advisory, not a determination of safety, task completion, or intent. It never bypasses configured user approval. If enabled and unavailable, the router requires confirmation even with approval set to never. Jev cannot execute tools. For optional target suggestions via `computer_use_session_judge`, additionally set `PI_JEV_SHARE_PAGE_TEXT=1`: that explicit opt-in sends the planner-provided goal and up to 50 non-secure candidate labels to the selected provider. It does not send field values. The returned candidate and confidence are advisory and do not grant permission. Live API behavior has not been verified without a key.

The extension bridge authenticates each exchange with the per-user pairing key. This does not protect against same-user malware or malicious page content. Keep sensitive actions behind confirmation.

## Recovery and handoff

The router retries only read-only observations on selected connection errors, once. It never automatically retries a browser action after an uncertain result. After a successful action it observes again and reports `changed`, `no_change`, or `unavailable`; a change is evidence of page activity, not proof of task success. Known challenge text and visible challenge frames pause the unified session; the page is checked again immediately before an action. `computer_use_session_takeover` asks the user to complete the verification and confirm before resuming. Detection is heuristic and can miss challenges or pause on an unrelated visible widget; the agent must still stop when it sees a block or login prompt. Legacy tools do not provide this unified-session protection.

All three unified browser backends check that the candidate is the same connected, visible, enabled element with the same name, role, type, secure-field status and link or form destination as at observation time. A changed element is rejected and must be observed again. This is not a guarantee against malicious pages, changes to other properties, or changes after the check. The in-app and CDP snapshots live in the page's execution context and can be tampered with by the page; they are a correctness check, not a security boundary.

File-input candidates expose up to 20 selected names, sizes and MIME types, total count and a truncation flag; file paths and contents are not returned. The observation also snapshots top-document file inputs and rejects actions when their elements, file objects or metadata change. Pages with more than 100 such inputs or more than 100 selected files in one input fail closed. Metadata is not a content hash: distinct files can share it, a page can alter its state after the check, and iframe/shadow DOM inputs are not covered. Treat file names as potentially sensitive and verify file content and server results separately. Reload the updated Chrome extension to use this behavior.
