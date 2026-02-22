# Watches for VS Code pause prompts and auto-dismisses them
# Run alongside your Copilot session

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

Write-Host "👀 Watching for pause prompts..." -ForegroundColor Cyan

while ($true) {
    Start-Sleep -Seconds 5
    
    # Simulate pressing Enter to dismiss any confirmation dialogs
    $wshell = New-Object -ComObject wscript.shell
    
    # Check if VS Code is the active window
    $activeWindow = (Get-Process | Where-Object { $_.MainWindowTitle -like "*Visual Studio Code*" })
    
    if ($activeWindow) {
        # Send Enter key to dismiss any prompts
        $wshell.AppActivate("Visual Studio Code")
        Start-Sleep -Milliseconds 500
        
        # Press Enter to continue any paused operations
        [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
        
        Write-Host "✅ Checked for prompts at $(Get-Date -Format 'HH:mm:ss')" -ForegroundColor Gray
    }
}