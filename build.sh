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

VERSION=1.0.0
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
  <key>CFBundleIdentifier</key><string>io.github.titusdecali.handoffbar</string>
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
  echo "dist/HandoffBar.zip"
  exit 0
fi

pkill -x HandoffBar || true
rm -rf "$HOME/Applications/HandoffBar.app"
mkdir -p "$HOME/Applications"
cp -R "$app" "$HOME/Applications/"
open "$HOME/Applications/HandoffBar.app"
echo "$HOME/Applications/HandoffBar.app"
