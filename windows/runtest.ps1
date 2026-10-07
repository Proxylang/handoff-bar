# Test only. Starts interactive-test.ps1 on the logged-in desktop through a one-time scheduled
# task (SSH sessions cannot show tray icons), waits for it, deletes the task, and prints the log.
Set-Location $HOME\handoffbar-build
Remove-Item itest* -ErrorAction SilentlyContinue
$tr = 'powershell.exe -STA -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "C:\Users\synap\handoffbar-build\interactive-test.ps1"'
"create: " + (schtasks /Create /TN HandoffBarTest /TR $tr /SC ONCE /ST 23:59 /IT /F 2>&1)
"run: " + (schtasks /Run /TN HandoffBarTest 2>&1)
$n = 0
while (-not (Test-Path itest.log) -or -not (Select-String -Path itest.log -Pattern 'done|FAILED|ERROR' -Quiet)) { Start-Sleep 1; $n++; if ($n -gt 60) { 'timed out'; break } }
"delete: " + (schtasks /Delete /TN HandoffBarTest /F 2>&1)
if (Test-Path itest.log) { Get-Content itest.log }
