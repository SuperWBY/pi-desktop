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
ENTITLEMENTS="$ROOT/build/entitlements.mac.plist"

if [[ ! -d "$APP" ]]; then
  echo "Missing $APP; run npm run pack first." >&2
  exit 1
fi
if [[ ! -f "$ENTITLEMENTS" ]]; then
  echo "Missing $ENTITLEMENTS; hardened-runtime Electron cannot start without allow-jit." >&2
  exit 1
fi

sign() {
  codesign --force --options runtime --timestamp --entitlements "$ENTITLEMENTS" --sign "$CSC_NAME" "$1"
}

notarize() {
  # Prefer a keychain profile (xcrun notarytool store-credentials
  # PI_DESKTOP_NOTARY_PROFILE …) so the app-specific password never appears in
  # the process list; fall back to the password env otherwise.
  if [[ -n "${PI_DESKTOP_NOTARY_PROFILE:-}" ]]; then
    xcrun notarytool submit "$1" --keychain-profile "$PI_DESKTOP_NOTARY_PROFILE" --wait
  else
    echo "==> PI_DESKTOP_NOTARY_PROFILE not set; the app-specific password is visible in the process list while notarytool runs." >&2
    xcrun notarytool submit "$1" \
      --apple-id "$APPLE_ID" \
      --team-id "$APPLE_TEAM_ID" \
      --password "$APPLE_APP_SPECIFIC_PASSWORD" \
      --wait
  fi
}

echo "==> Signing app with $CSC_NAME"
# --deep is deprecated and does not propagate entitlements to nested code.
# Sign nested helpers and frameworks explicitly, outermost bundle last.
find "$APP/Contents/Frameworks" -maxdepth 1 -name "Electron Helper*.app" -print0 | \
  while IFS= read -r -d '' helper; do sign "$helper"; done
for framework in "$APP/Contents/Frameworks"/*.framework; do
  if [[ -e "$framework" ]]; then sign "$framework"; fi
done
if [[ -f "$APP/Contents/Resources/dictation.node" ]]; then
  codesign --force --options runtime --timestamp --sign "$CSC_NAME" "$APP/Contents/Resources/dictation.node"
fi
sign "$APP"
codesign --verify --deep --strict --verbose=2 "$APP"

echo "==> Creating notarization archive"
ZIP="release/Pi-Desktop-notarize.zip"
rm -f "$ZIP"
ditto -c -k --keepParent "$APP" "$ZIP"

echo "==> Submitting app for notarization"
notarize "$ZIP"
xcrun stapler staple "$APP"
spctl --assess --type execute --verbose=2 "$APP"

echo "==> Building DMG"
node scripts/make-dmg.mjs
codesign --force --timestamp --sign "$CSC_NAME" "$DMG"

echo "==> Submitting DMG for notarization"
notarize "$DMG"
xcrun stapler staple "$DMG"
spctl --assess --type open --context context:primary-signature --verbose=2 "$DMG" || true

echo "Release artifact ready: $DMG"
