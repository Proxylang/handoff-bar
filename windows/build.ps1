# Builds HandoffBar.exe with the C# compiler that ships with Windows (.NET Framework 4.8).
# Nothing to install. Run from this folder:  powershell -ExecutionPolicy Bypass -File build.ps1
# Output: dist\HandoffBar.exe and dist\HandoffBar-Windows.zip
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

$fw = "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319"
New-Item -ItemType Directory -Force dist | Out-Null

& "$fw\csc.exe" /nologo /target:winexe /optimize+ /platform:anycpu /codepage:65001 `
  /out:dist\HandoffBar.exe /win32icon:HandoffBar.ico /win32manifest:app.manifest `
  /resource:HandoffBar.ico,HandoffBar.ico `
  /reference:System.dll /reference:System.Core.dll /reference:System.Drawing.dll `
  /reference:System.Windows.Forms.dll /reference:"$fw\System.Web.Extensions.dll" `
  Program.cs Writer.cs Handoffs.cs Popup.cs
if ($LASTEXITCODE -ne 0) { throw "csc failed" }

Remove-Item -Force dist\HandoffBar-Windows.zip -ErrorAction SilentlyContinue
Compress-Archive -Path dist\HandoffBar.exe -DestinationPath dist\HandoffBar-Windows.zip
Get-Item dist\HandoffBar.exe, dist\HandoffBar-Windows.zip | Select-Object Name, Length
