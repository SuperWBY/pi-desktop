# Browser Router and Jev Implementation Plan

**Goal:** Provide an explicit, task-scoped browser session and unified approval for the three existing browser backends, with Jev as an optional advisory judge.
**Architecture:** A backend-neutral router owns the selected session, latest observation and action lifecycle. Existing browser implementations remain adapters; Jev never executes actions or bypasses approval. Unauthenticated Chrome bridge risk remains explicit.
**Constraints:** No AppleScript fallback for the router; no default Chrome CDP profile; no silent backend switching; no credentials in source or output; no page values or typed text sent to Jev; preserve existing tools.

1. Test session selection, stale observations, cancellation, concurrent actions and adapter failures; implement router.
2. Connect in-app, CDP and extension adapters and expose session tools with approval and audit.
3. Test and implement optional Jev API client with bounded request, validation, timeout and conservative fallback.
4. Run router tests, real isolated browser integration, typecheck, native observation and build; document any unavailable live service or permission.
