# Pi Desktop Chrome Bridge — Privacy Policy

Last updated: 2026-11-09

Pi Desktop Chrome Bridge is an optional companion extension for the local
Pi Desktop application. It has one purpose: let the user's own Pi Desktop app
observe and operate the active Chrome tab after the user explicitly starts a
browser task.

## What the extension accesses

- The URL, title, and visible interactive elements of the **active tab**.
- Element labels, roles, values (except password fields), and file metadata
  needed to identify a target.
- The page's visible text when Pi Desktop explicitly requests a text read.
- The extension's pairing key, stored in Chrome's extension storage, so it can
  authenticate to the local Pi Desktop bridge.

Password field values are never returned. Typing into password fields is
refused.

## Where data goes

All extension traffic goes to the local bridge started by Pi Desktop:

```
http://127.0.0.1:9317
```

The extension does not send data to an advertisement, analytics, or tracking
server. Pi Desktop may include the observed page content in the conversation
that the user has configured with their chosen model provider. That processing
is governed by the user's Pi Desktop and model-provider settings, not by this
extension.

The extension does not sell data, use data for creditworthiness or lending,
or use data for any purpose unrelated to its single purpose.

## What is stored

The extension stores only its local pairing key and connection state in
Chrome extension storage. It does not keep a page archive, browsing history,
or analytics database. Pi Desktop session transcripts are controlled by the
user and the Pi runtime.

## Permissions

- `activeTab` / `scripting`: inspect and act on the tab after the user invokes
  Pi Desktop for that tab.
- `tabs`: identify the active tab and its URL/title.
- `alarms`: wake the background worker so the local bridge can reconnect.
- `http://127.0.0.1/*`: communicate only with the local Pi Desktop bridge.
- `<all_urls>`: the user may choose any website for a browser task. The
  extension still operates only on the active tab and only while a Pi Desktop
  task is waiting.

## Remote code

The extension does not load or execute remote code. Its JavaScript is bundled
in the extension package.

## Contact

Open an issue at https://github.com/SuperWBY/pi-desktop/issues for privacy or
security questions.
