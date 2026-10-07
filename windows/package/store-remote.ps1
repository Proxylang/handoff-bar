# Runs on the Windows PC, started by store-build.sh: unpack Microsoft's packaging tool,
# build HandoffBar.exe, and pack HandoffBar.msix.
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot)

# A .nupkg is a zip file.
Copy-Item package\tools\sdk-buildtools.nupkg package\tools\sdk.zip -Force
Expand-Archive package\tools\sdk.zip package\tools\sdk -Force
$makeappx = (Get-ChildItem package\tools\sdk\bin -Recurse -Filter makeappx.exe |
  Where-Object { $_.FullName -match '\\x64\\' } | Select-Object -First 1).FullName
if (-not $makeappx) { throw 'makeappx.exe not found in the tool package' }

& .\build.ps1
& .\package\package.ps1 -MakeAppx $makeappx
