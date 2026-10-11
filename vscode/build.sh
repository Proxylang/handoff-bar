#!/bin/sh
# Type-checks, tests and bundles the extension, then packs dist/handoffbar-<version>.vsix with vsce:
# the file to install with `code --install-extension` and to upload to the Marketplace and Open VSX.
# Tools come from `npm install` in this folder; BIN names another node_modules/.bin instead.
set -e
cd "$(dirname "$0")"
bin=${BIN:-node_modules/.bin}
version=$(node -p 'require("./package.json").version')

"$bin/tsc" -p . --typeRoots "$bin/../@types"

"$bin/esbuild" test/chats.test.ts --bundle --platform=node --format=cjs --outfile=out/test/chats.test.js --log-level=warning
node --test out/test/chats.test.js

# One file with the shared writer inside it. vscode is the host's own module.
"$bin/esbuild" src/extension.ts --bundle --platform=node --format=cjs --target=node18 --external:vscode \
  --outfile=out/extension.js --log-level=warning

mkdir -p dist
# vsce packs what .vscodeignore leaves in; the bundle above already holds every dependency.
"$bin/vsce" package --no-dependencies --out "dist/handoffbar-$version.vsix"
echo "Built dist/handoffbar-$version.vsix"
