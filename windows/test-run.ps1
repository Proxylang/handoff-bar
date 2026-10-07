# Runs HandoffBar for testing on a PC where Smart App Control blocks the unsigned HandoffBar.exe.
# It compiles the same source files in memory and starts the real tray app.
#
#   powershell -STA -ExecutionPolicy Bypass -File test-run.ps1
#
# Close it with the tray icon's right-click menu > Quit HandoffBar.
param([switch] $Open)  # -Open shows the panel once right after start
$ErrorActionPreference = 'Stop'
# Match HandoffBar.exe, whose manifest makes it per-monitor DPI aware (sharp text on scaled screens).
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class Dpi { [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr v); }'
[void][Dpi]::SetProcessDpiAwarenessContext([IntPtr](-4))
Set-Location $PSScriptRoot
# Set-Location moves only PowerShell. The app reads HandoffBar.ico from .NET's own current folder.
[Environment]::CurrentDirectory = $PSScriptRoot

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
$tray = New-Object Tray
if ($Open) {
  $popup = [Tray].GetField('popup', [Reflection.BindingFlags]'NonPublic,Instance').GetValue($tray)
  $timer = New-Object System.Windows.Forms.Timer
  $timer.Interval = 1000
  $timer.Add_Tick({
    $timer.Stop()
    # Open it where a tray click would: the bottom-right corner of the main screen.
    $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point ($b.Right - 150), ($b.Bottom - 20)
    $popup.Toggle()
  })
  $timer.Start()
}
[System.Windows.Forms.Application]::Run($tray)
