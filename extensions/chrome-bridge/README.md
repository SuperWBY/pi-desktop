# Pi Desktop Chrome Bridge

This is the optional Chrome extension bridge. It lets Pi use your **existing Chrome login session** through the active tab.

It is separate from the CDP backend:

```text
In-app browser    → WebContentsView
CDP backend       → dedicated Chrome profile, no plugin
Chrome bridge     → your everyday Chrome + this extension
```

## Install

1. Open Chrome.
2. Go to `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select this folder:

```text
extensions/chrome-bridge
```

6. Pin **Pi Desktop Chrome Bridge** to the toolbar.
7. Keep Pi Desktop running.

The extension polls a local bridge on:

```text
http://127.0.0.1:9317
```

It only accepts requests from a `chrome-extension://` origin.

## Use

1. Open the website you want Pi to work with in Chrome.
2. Keep that tab active.
3. Ask Pi to observe the page.
4. Pi uses `computer_use_chrome_observe` and gets candidates `h1`, `h2`, ...
5. Pi uses `computer_use_chrome_act` to click, type, or press.

The extension only operates the active tab. It does not install a native messaging host, change Chrome settings, or enable remote debugging.

## Safety

- Password-field values are never returned.
- Typing into password fields is refused.
- `chrome://` and extension pages are rejected.
- Actions still go through Pi's approval layer.
- The bridge is bound to `127.0.0.1` and only lives while a Pi tool call is waiting.
- Page content is treated as untrusted input.

## Troubleshooting

**"Pi Chrome extension did not connect"**

- Confirm the extension is loaded and enabled in `chrome://extensions`.
- Keep Pi Desktop running.
- Keep the target tab active.
- Click the extension icon once to wake its service worker.
- Check that no other process is using port `9317`.

**Nothing happens on the page**

- Refresh the page after loading the extension.
- Chrome internal pages (`chrome://`) and some browser-owned pages cannot be automated.
- The extension uses the active tab in the last focused Chrome window.
