# Runs the real tray app on the logged-in desktop, drives it like a user, and records what happened.
# Pictures cover only the HandoffBar panel and the taskbar corner, never the rest of the screen.
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
[Environment]::CurrentDirectory = $PSScriptRoot
$log = Join-Path $PSScriptRoot 'itest.log'
Set-Content $log ("start " + (Get-Date -Format HH:mm:ss))
function Log($m) { Add-Content $log $m }

try {
  # Match HandoffBar.exe, whose manifest makes it per-monitor DPI aware. Without this, PowerShell's
  # scaled coordinates make the screen pictures miss the panel.
  Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class Dpi { [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr v); }'
  Log ("dpi aware: " + [Dpi]::SetProcessDpiAwarenessContext([IntPtr](-4)))
  $fw = "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319"
  $lines = (@('Program.cs','Writer.cs','Handoffs.cs','Popup.cs') | ForEach-Object { Get-Content $_ -Raw -Encoding UTF8 }) -join "`n" -split "`n"
  $usings = $lines | Where-Object { $_ -match '^using [\w.]+;' } | Sort-Object -Unique
  $body = $lines | Where-Object { $_ -notmatch '^using [\w.]+;' -and $_ -notmatch '^\[assembly:' } |
    ForEach-Object { $_ -replace '^class Tray', 'public class Tray' -replace '^class Popup', 'public class Popup' }
  Add-Type -TypeDefinition (($usings + $body) -join "`n") -Language CSharp -WarningAction SilentlyContinue `
    -ReferencedAssemblies System.Drawing, System.Windows.Forms, System.Core, "$fw\System.Web.Extensions.dll"
  Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public static class Mouse {
  [DllImport("user32.dll")] static extern void mouse_event(int f, int x, int y, int d, IntPtr e);
  public static void Click() { mouse_event(2, 0, 0, 0, IntPtr.Zero); mouse_event(4, 0, 0, 0, IntPtr.Zero); }
}
'@
  [System.Windows.Forms.Application]::EnableVisualStyles()
  $tray = New-Object Tray
  $popup = [Tray].GetField('popup', [Reflection.BindingFlags]'NonPublic,Instance').GetValue($tray)
  $icon = [Tray].GetField('icon', [Reflection.BindingFlags]'NonPublic,Instance').GetValue($tray)
  Log ("tray icon visible: " + $icon.Visible)
  $wa = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
  $sb = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  Log ("screen " + $sb + " working area " + $wa)

  function Snap($rect, $name) {
    $bmp = New-Object System.Drawing.Bitmap $rect.Width, $rect.Height
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($rect.Location, [System.Drawing.Point]::Empty, $rect.Size)
    $bmp.Save((Join-Path $PSScriptRoot $name)); $g.Dispose(); $bmp.Dispose()
  }

  $step = 0
  $timer = New-Object System.Windows.Forms.Timer
  $timer.Interval = 1200
  $timer.Add_Tick({
    $script:step++
    try {
      switch ($script:step) {
        1 {
          # Open the panel the way a tray click does, with the pointer near the tray corner.
          [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point ($sb.Right - 120), ($sb.Bottom - 20)
          $popup.Toggle()
          Log ("panel visible: " + $popup.Visible + " bounds " + $popup.Bounds)
        }
        2 {
          Snap $popup.Bounds 'itest-panel.png'
          $list = $popup.Controls | Where-Object { $_.GetType().Name -eq 'SmoothList' }
          $focused = ($popup.Controls | Where-Object { $_.ContainsFocus }) | ForEach-Object { $_.GetType().Name }
          Log ("focus in: " + ($focused -join ','))
          # Click the first chat row (row 0 is the day header).
          $r = $list.GetItemRectangle(1)
          $pt = $list.PointToScreen((New-Object System.Drawing.Point ($r.X + 100), ($r.Y + $r.Height / 2)))
          [System.Windows.Forms.Cursor]::Position = $pt
          [Mouse]::Click()
          Log ("clicked row at " + $pt)
        }
        3 {
          $clip = [System.Windows.Forms.Clipboard]::GetText()
          Log ("clipboard first line: " + ($clip -split "`n")[0])
          Log ("clipboard length: " + $clip.Length)
          Snap $popup.Bounds 'itest-copied.png'
          [System.Windows.Forms.SendKeys]::SendWait('{ESC}')
        }
        4 {
          Log ("panel visible after Esc: " + $popup.Visible)
          Snap (New-Object System.Drawing.Rectangle ($sb.Right - 420), $wa.Bottom, 420, ($sb.Bottom - $wa.Bottom)) 'itest-tray.png'
          $timer.Stop()
          $icon.Visible = $false
          [System.Windows.Forms.Application]::Exit()
        }
      }
    } catch { Log ("STEP " + $script:step + " ERROR: " + $_.Exception.Message); $icon.Visible = $false; [System.Windows.Forms.Application]::Exit() }
  })
  $timer.Start()
  [System.Windows.Forms.Application]::Run($tray)
  Log "done"
} catch {
  $e = $_.Exception; while ($e.InnerException) { $e = $e.InnerException }
  Log ("FAILED: " + $e.Message)
}
