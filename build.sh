#!/bin/bash
# Builds HandoffBar.app for Apple Silicon and Intel Macs.
#
#   ./build.sh                     build, sign, install to ~/Applications, restart
#   ./build.sh release <profile>   also notarize with the notarytool keychain profile
#                                  and write dist/HandoffBar.zip for download
#
# Signs with the first "Developer ID Application" certificate in the keychain.
# Without one it signs ad hoc, which runs only on the Mac that built it.
set -euo pipefail
cd "$(dirname "$0")"

VERSION=1.1.1
# SMAppService (open at login) needs macOS 13.
MIN_MACOS=13.0
app=build/HandoffBar.app

rm -rf build
mkdir -p "$app/Contents/MacOS"
for arch in arm64 x86_64; do
  swiftc -O -target "$arch-apple-macos$MIN_MACOS" Sources/*.swift -o "build/HandoffBar-$arch"
done
lipo -create build/HandoffBar-arm64 build/HandoffBar-x86_64 -output "$app/Contents/MacOS/HandoffBar"
# AppIcon.icns comes from tools/make-icon.swift plus iconutil. See README.
mkdir -p "$app/Contents/Resources"
cp AppIcon.icns "$app/Contents/Resources/"

# LSUIElement keeps it out of the Dock. Menu bar only.
cat > "$app/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>dev.proxylang.handoffbar</string>
  <key>CFBundleName</key><string>HandoffBar</string>
  <key>CFBundleExecutable</key><string>HandoffBar</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundleVersion</key><string>$VERSION</string>
  <key>LSMinimumSystemVersion</key><string>$MIN_MACOS</string>
  <key>LSUIElement</key><true/>
</dict>
</plist>
EOF

identity=$(security find-identity -v -p codesigning | sed -n 's/.*"\(Developer ID Application:.*\)"/\1/p' | head -1)
codesign --force --options runtime --timestamp --sign "${identity:--}" "$app"
codesign --verify --strict "$app"

if [ "${1:-}" = release ]; then
  profile="${2:?usage: ./build.sh release <notarytool keychain profile>}"
  mkdir -p dist
  ditto -c -k --keepParent "$app" dist/HandoffBar.zip
  xcrun notarytool submit dist/HandoffBar.zip --keychain-profile "$profile" --wait
  xcrun stapler staple "$app"
  # Zip again so the download carries the stapled ticket and opens offline.
  rm dist/HandoffBar.zip
  ditto -c -k --keepParent "$app" dist/HandoffBar.zip
  spctl --assess --type execute --verbose "$app"

  # Installer disk image: the app, an Applications shortcut, and a background with an arrow.
  stage=build/dmg
  mkdir -p "$stage/.background"
  cp -R "$app" "$stage/"
  ln -s /Applications "$stage/Applications"
  swift tools/make-dmg-background.swift "$stage/.background/bg.png"
  hdiutil create -quiet -srcfolder "$stage" -volname HandoffBar -fs HFS+ -format UDRW -ov build/rw.dmg
  mount=$(hdiutil attach -readwrite -noverify -noautoopen build/rw.dmg | sed -n 's#.*\(/Volumes/.*\)#\1#p')
  # Icon positions match the arrow in make-dmg-background.swift (640x400 window).
  osascript <<EOF
tell application "Finder"
  tell disk "$(basename "$mount")"
    open
    set current view of container window to icon view
    set toolbar visible of container window to false
    set statusbar visible of container window to false
    set bounds of container window to {200, 120, 840, 520}
    set opts to icon view options of container window
    set arrangement of opts to not arranged
    set icon size of opts to 112
    set text size of opts to 13
    set background picture of opts to file ".background:bg.png"
    set position of item "HandoffBar.app" of container window to {170, 205}
    set position of item "Applications" of container window to {470, 205}
    update without registering applications
    delay 1
    close
  end tell
end tell
EOF
  sync
  hdiutil detach -quiet "$mount"
  rm -f dist/HandoffBar.dmg
  hdiutil convert -quiet build/rw.dmg -format UDZO -o dist/HandoffBar.dmg
  codesign --force --timestamp --sign "${identity:--}" dist/HandoffBar.dmg
  xcrun notarytool submit dist/HandoffBar.dmg --keychain-profile "$profile" --wait
  xcrun stapler staple dist/HandoffBar.dmg
  spctl --assess --type open --context context:primary-signature --verbose dist/HandoffBar.dmg
  echo "dist/HandoffBar.dmg dist/HandoffBar.zip"
  exit 0
fi

pkill -x HandoffBar || true
rm -rf "$HOME/Applications/HandoffBar.app"
mkdir -p "$HOME/Applications"
cp -R "$app" "$HOME/Applications/"
open "$HOME/Applications/HandoffBar.app"
echo "$HOME/Applications/HandoffBar.app"
