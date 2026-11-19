# Sandbox and network policy

## Why this exists

Local coding agents normally run with the permissions of the logged-in user.
That means a mistaken `bash` call, a malicious extension, or prompt injection
can read credentials, write outside the project, or send data to any host.

Common desktop agents now add two independent controls:

| Product | Filesystem | Network | Notes |
| --- | --- | --- | --- |
| OpenAI Codex | OS sandbox; default writes only the workspace | Off by default; can be enabled | macOS Seatbelt, Linux Landlock/seccomp |
| Claude Code | Sandboxed Bash; writes only cwd/temp by default | Proxy with empty domain allowlist by default | Uses `@anthropic-ai/sandbox-runtime` |
| Cursor | Seatbelt on macOS; WSL2 on Windows | Blocked by default, allowlist/network mode | Also has run modes and approvals |

The common pattern is:

```
OS sandbox for the process tree
+ filesystem write allowlist
+ network allowlist through a local proxy
+ approvals for actions that need to leave the sandbox
```

Approval prompts alone are not a sandbox.

## What Pi Desktop implements now

Phase 1 is implemented on macOS and Linux using
[`@anthropic-ai/sandbox-runtime`](https://github.com/anthropics/sandbox-runtime):

```text
pi process
  └── srt (Seatbelt / bubblewrap)
        ├── read: allowed (with explicit denyRead for common credential stores)
        ├── write: project + ~/.pi/agent + sessions + temp + computer-use bridge state
        └── network: local proxy, allowlist only
```

Settings → Tools & Skills → Sandbox & Network:

- **Sandbox**: off by default.
- **Filesystem**: `workspace-write` or `read-only`.
- **Network**: `model` (model hosts plus custom domains) or `off`.
- **Extra allowed domains**: comma/newline separated; supports `*.example.com`.

The model host defaults are a convenience list; custom provider `baseUrl`
hosts are also read from `models.json`. If a provider uses another host,
add it explicitly.

The sandbox is applied when a new pi session starts. Existing sessions keep
their original process.

## Unified proxy and audit

The same settings block also accepts an HTTP/HTTPS proxy and `NO_PROXY` for
unsandboxed pi sessions. Proxy values are passed as `HTTP_PROXY`,
`HTTPS_PROXY`, `ALL_PROXY`, and `NO_PROXY`; they are not stored in a separate
credential file.

Sandbox sessions write a local JSONL audit at:

```text
<userData>/sandbox/audit.jsonl
```

Events include sandbox start (cwd, mode, network policy), sandbox exit, and
network denials. The settings audit view exposes the last 200 events. When the
proxy denies an unknown host, Pi Desktop also shows a notice with
**Allow and restart**; the host is appended to `sandboxAllowedDomains` and the
session restarts. This is intentionally a restart flow, not a live permission
grant.

The audit is not a complete request log: allowed requests and HTTP response
status are not recorded per request.

## What this does not do

- Windows sandboxing is not enabled. The current Windows build falls back to
  the unsandboxed process; a future version must use WSL2 or install the srt
  Windows account/WFP filters with an elevated setup step.
- It is not a virtual machine. The process still runs on the host with the
  user's identity; GUI and OS services outside the process tree are outside
  the boundary.
- It does not sandbox model inference or provider credentials inside a
  separate service. The pi process can read its own `auth.json`.
- It does not replace project trust or tool approval.
- It does not provide a network gateway or a complete per-request HTTP log.
  Unknown-domain approval is a notice plus restart, not a live proxy callback.
- It does not provide a Windows WSL2 launcher, plugin process isolation, or a
  container backend yet.

## Failure behavior

If sandboxing is enabled but the runtime or Node.js is missing, opening a
session fails with a clear error instead of silently running unsandboxed.
Turning the setting off restores the previous behavior.

## Verification

`E2E_ONLY=sandbox npm run e2e` starts a session through the sandbox and checks:

- the child process receives the sandbox marker;
- a command can write inside the project;
- a command cannot write outside the project.
