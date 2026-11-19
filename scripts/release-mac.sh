#!/usr/bin/env bash
set -euo pipefail

# Developer ID + notarization are required for a build that other people can
# open without Gatekeeper warnings. Credentials are never stored in the repo.
: "${CSC_NAME:?Set CSC_NAME to a Developer ID Application identity, e.g. 'Developer ID Application: Your Name (TEAMID)'}"
: "${APPLE_ID:?Set APPLE_ID to the Apple ID used for notarization}"
: "${APPLE_TEAM_ID:?Set APPLE_TEAM_ID to the Apple Developer Team ID}"
: "${APPLE_APP_SPECIFIC_PASSWORD:?Set APPLE_APP_SPECIFIC_PASSWORD to an app-specific password}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
APP="release/Pi Desktop-darwin-arm64/Pi Desktop.app"
DMG="release/Pi-Desktop-$(node -p "require('./package.json').version")-arm64.dmg"

if [[ ! -d "$APP" ]]; then
  echo "Missing $APP; run npm run pack first." >&2
  exit 1
fi

echo "==> Signing app with $CSC_NAME"
codesign --deep --force --options runtime --timestamp --sign "$CSC_NAME" "$APP"
codesign --verify --deep --strict --verbose=2 "$APP"

echo "==> Creating notarization archive"
ZIP="release/Pi-Desktop-notarize.zip"
rm -f "$ZIP"
ditto -c -k --keepParent "$APP" "$ZIP"

echo "==> Submitting app for notarization"
xcrun notarytool submit "$ZIP" \
  --apple-id "$APPLE_ID" \
  --team-id "$APPLE_TEAM_ID" \
  --password "$APPLE_APP_SPECIFIC_PASSWORD" \
  --wait
xcrun stapler staple "$APP"
spctl --assess --type execute --verbose=2 "$APP"

echo "==> Building DMG"
node scripts/make-dmg.mjs
codesign --force --timestamp --sign "$CSC_NAME" "$DMG"

echo "==> Submitting DMG for notarization"
xcrun notarytool submit "$DMG" \
  --apple-id "$APPLE_ID" \
  --team-id "$APPLE_TEAM_ID" \
  --password "$APPLE_APP_SPECIFIC_PASSWORD" \
  --wait
xcrun stapler staple "$DMG"
spctl --assess --type open --context context:primary-signature --verbose=2 "$DMG" || true

echo "Release artifact ready: $DMG"
