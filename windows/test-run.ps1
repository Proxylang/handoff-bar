# Runs HandoffBar for testing on a PC where Smart App Control blocks the unsigned HandoffBar.exe.
# It compiles the same source files in memory and starts the real tray app.
#
#   powershell -STA -ExecutionPolicy Bypass -File test-run.ps1
#
# Close it with the tray icon's right-click menu > Quit HandoffBar.
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

$fw = "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319"
$lines = (@('Program.cs', 'Writer.cs', 'Handoffs.cs', 'Popup.cs') | ForEach-Object { Get-Content $_ -Raw -Encoding UTF8 }) -join "`n" -split "`n"
# One combined source: every using line first, assembly attributes dropped, and the
# two types PowerShell starts made public.
$usings = $lines | Where-Object { $_ -match '^using [\w.]+;' } | Sort-Object -Unique
$body = $lines | Where-Object { $_ -notmatch '^using [\w.]+;' -and $_ -notmatch '^\[assembly:' } |
  ForEach-Object { $_ -replace '^class Tray', 'public class Tray' }
Add-Type -TypeDefinition (($usings + $body) -join "`n") -Language CSharp -WarningAction SilentlyContinue `
  -ReferencedAssemblies System.Drawing, System.Windows.Forms, System.Core, "$fw\System.Web.Extensions.dll"

[System.Windows.Forms.Application]::EnableVisualStyles()
[System.Windows.Forms.Application]::Run((New-Object Tray))
