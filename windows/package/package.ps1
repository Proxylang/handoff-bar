# Builds HandoffBar.msix for the Microsoft Store. The Store signs it, so no certificate is needed here.
#
#   powershell -ExecutionPolicy Bypass -File package.ps1 -IdentityName <name> -Publisher "CN=..." -PublisherDisplayName <name>
#
# The three values are on Partner Center > the app > Product identity.
# Needs makeappx.exe from the Windows SDK. Run ..\build.ps1 first.
param(
  [Parameter(Mandatory)] [string] $IdentityName,
  [Parameter(Mandatory)] [string] $Publisher,
  [Parameter(Mandatory)] [string] $PublisherDisplayName,
  [string] $MakeAppx
)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

if (-not $MakeAppx) {
  $MakeAppx = Get-ChildItem 'C:\Program Files (x86)\Windows Kits\10\bin' -Filter makeappx.exe -Recurse -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match '\\x64\\' } | Sort-Object FullName -Descending | Select-Object -First 1 -ExpandProperty FullName
}
if (-not $MakeAppx) { throw 'makeappx.exe not found. Install the Windows SDK, or pass -MakeAppx <path>.' }

# Version comes from the app itself, as Major.Minor.Build.0 (the Store needs the last part to be 0).
$version = (Select-String -Path ..\Program.cs -Pattern 'public const string Version = "([0-9.]+)"').Matches[0].Groups[1].Value + '.0'

$stage = Join-Path $env:TEMP 'handoffbar-msix'
Remove-Item -Recurse -Force $stage -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force "$stage\Assets" | Out-Null
Copy-Item ..\dist\HandoffBar.exe $stage
Copy-Item Assets\*.png "$stage\Assets"
(Get-Content AppxManifest.xml -Raw) `
  -replace '\{\{IdentityName\}\}', $IdentityName `
  -replace '\{\{Publisher\}\}', $Publisher `
  -replace '\{\{PublisherDisplayName\}\}', $PublisherDisplayName `
  -replace '\{\{Version\}\}', $version |
  Set-Content "$stage\AppxManifest.xml" -Encoding UTF8

New-Item -ItemType Directory -Force ..\dist | Out-Null
& $MakeAppx pack /o /d $stage /p ..\dist\HandoffBar.msix
if ($LASTEXITCODE -ne 0) { throw 'makeappx failed' }
Get-Item ..\dist\HandoffBar.msix | Select-Object Name, Length
