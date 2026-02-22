# Prevents Windows from sleeping while Copilot works
# Run this in a separate terminal before starting

Write-Host "🔒 Keeping system awake until AdAvatar is complete..." -ForegroundColor Green

$signature = @"
[DllImport("kernel32.dll")]
public static extern uint SetThreadExecutionState(uint esFlags);
"@

$type = Add-Type -MemberDefinition $signature -Name "PowerMgmt" -Namespace "Win32" -PassThru
# ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED
$type::SetThreadExecutionState(0x80000003)

Write-Host "✅ System will not sleep. Close this terminal when done." -ForegroundColor Green

# Keep script running
while ($true) {
    Start-Sleep -Seconds 60
    Write-Host "⏳ Still awake... $(Get-Date -Format 'HH:mm:ss')" -ForegroundColor Gray
}