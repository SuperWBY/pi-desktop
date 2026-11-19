# macOS live Computer Use fixture

`node scripts/prepare-computer-use-live-fixture.mjs` creates a fresh private temporary workspace, a local Cocoa test application, and a Pi extension in that workspace. It does not grant permissions, change project trust, launch an application, or access a website.

To reproduce the live check, launch the printed fixture app with the printed evidence file as its argument, open the printed workspace in the normally launched installed Pi Desktop, and explicitly trust only this generated workspace's extension. Confirm the slash command is listed before sending `/pi-cua-local-fixture`; an unrecognized slash command must not be treated as a test. Approve the single click on the fixture's `Pi Fixture Start` button. The extension reads the evidence file created by that button and makes another observation; the printed result file must report `ok: true` and `afterContainsDone: true`.

The app's Pi subprocess must have Computer Use enabled and both macOS permissions. A process launched from Terminal or Codex can have a different TCC responsible application; those results do not prove permissions for the installed app. After the test, close the fixture and remove the trust entry for this exact temporary workspace. Do not grant trust to its parent directory.

This fixture verifies a single local AX button. It does not establish business-task success rates or exercise coordinate/OCR targeting, web uploads, external systems, recovery, or multi-display behavior.
