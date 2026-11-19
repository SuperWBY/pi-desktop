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
4. In Pi Desktop, open the Chrome bridge guide and use its drag-and-drop folder, or click **Load unpacked** and select the Pi Desktop-prepared folder. The source folder is not paired.

5. Pin **Pi Desktop Chrome Bridge** to the toolbar.
6. Keep Pi Desktop running.

The extension polls a local bridge on:

```text
http://127.0.0.1:9317
```

Pi Desktop generates a private per-user pairing key and prepares the extension folder. Each exchange authenticates both endpoints and binds task and result to fresh nonces. A process that can read the same user’s private files can still obtain the key; this is not protection against same-user malware. After an app update, reload the unpacked extension in Chrome. For a Chrome Web Store build, run `npm run package:chrome` and upload `release/pi-desktop-chrome-bridge-<version>.zip`.

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
- Actions request approval by default; the Pi extension permits this to be disabled by configuration.
- The bridge is bound to `127.0.0.1` and only lives while a Pi tool call is waiting.
- The worker registers a periodic wake alarm; clicking the extension icon also wakes it. Reload the extension in Chrome after an update.
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
