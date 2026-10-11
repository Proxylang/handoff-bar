#!/bin/sh
# Type-checks, tests and bundles the extension, then packs dist/handoffbar-<version>.vsix for
# `code --install-extension`. The Marketplace upload goes through `npx @vscode/vsce publish`.
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

pack=$(mktemp -d)
mkdir -p "$pack/extension/out" "$pack/extension/media" dist
cp package.json README.md "$pack/extension/"
cp LICENSE "$pack/extension/LICENSE.txt"
cp out/extension.js "$pack/extension/out/"
cp media/icon.png media/hand-light.svg media/hand-dark.svg "$pack/extension/media/"
cat > "$pack/[Content_Types].xml" <<'EOF'
<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension=".json" ContentType="application/json"/><Default Extension=".vsixmanifest" ContentType="text/xml"/><Default Extension=".js" ContentType="application/javascript"/><Default Extension=".svg" ContentType="image/svg+xml"/><Default Extension=".png" ContentType="image/png"/><Default Extension=".md" ContentType="text/markdown"/><Default Extension=".txt" ContentType="text/plain"/></Types>
EOF
cat > "$pack/extension.vsixmanifest" <<EOF
<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
  <Metadata>
    <Identity Language="en-US" Id="handoffbar" Version="$version" Publisher="proxylang" />
    <DisplayName>HandoffBar for Claude Code</DisplayName>
    <Description xml:space="preserve">Copy a Claude Code chat's handoff with one click from the chat tab, and see how long its prompt cache has left.</Description>
    <Tags>claude,claude code,handoff,prompt cache</Tags>
    <Categories>Other</Categories>
    <GalleryFlags>Public</GalleryFlags>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="^1.90.0" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionDependencies" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionPack" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="workspace" />
    </Properties>
    <License>extension/LICENSE.txt</License>
    <Icon>extension/media/icon.png</Icon>
  </Metadata>
  <Installation><InstallationTarget Id="Microsoft.VisualStudio.Code" /></Installation>
  <Dependencies />
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.License" Path="extension/LICENSE.txt" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Icons.Default" Path="extension/media/icon.png" Addressable="true" />
  </Assets>
</PackageManifest>
EOF
rm -f "dist/handoffbar-$version.vsix"
(cd "$pack" && zip -qrX "$OLDPWD/dist/handoffbar-$version.vsix" '[Content_Types].xml' extension.vsixmanifest extension)
rm -rf "$pack"
echo "Built dist/handoffbar-$version.vsix"
