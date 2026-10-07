#!/bin/bash
# Builds the Microsoft Store package on a Windows PC over SSH, from a Mac.
#
#   windows/package/store-build.sh [user@host]
#
# Copies the sources and Microsoft's packaging tool to the PC, builds HandoffBar.exe with
# Windows' own C# compiler, packs HandoffBar.msix, and copies it back to windows/dist/.
# The tool comes from nuget.org (Microsoft.Windows.SDK.BuildTools); fetch it once with:
#   curl -L -o windows/package/tools/sdk-buildtools.nupkg \
#     https://api.nuget.org/v3-flatcontainer/microsoft.windows.sdk.buildtools/10.0.28000.2705/microsoft.windows.sdk.buildtools.10.0.28000.2705.nupkg
set -euo pipefail
cd "$(dirname "$0")/.."

host="${1:-lotusai@100.93.144.22}"
remote=handoffbar-build

ssh -o ConnectTimeout=15 "$host" "powershell -NoProfile -Command \"New-Item -ItemType Directory -Force $remote\\package\\Assets, $remote\\package\\tools | Out-Null\""
scp -q ./*.cs build.ps1 app.manifest HandoffBar.ico "$host:$remote/"
scp -q package/AppxManifest.xml package/package.ps1 package/store-remote.ps1 "$host:$remote/package/"
scp -q package/Assets/*.png "$host:$remote/package/Assets/"
scp -q package/tools/sdk-buildtools.nupkg "$host:$remote/package/tools/"

ssh "$host" "powershell -NoProfile -ExecutionPolicy Bypass -File $remote\\package\\store-remote.ps1"

mkdir -p dist
scp -q "$host:$remote/dist/HandoffBar.msix" dist/
ls -la dist/HandoffBar.msix
