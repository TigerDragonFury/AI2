# Master launcher - run this once before bed

Write-Host "🚀 Starting AdAvatar overnight build..." -ForegroundColor Magenta
Write-Host ""

# 1. Keep system awake
Write-Host "1. Starting keep-awake..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-File keep-awake.ps1" -WindowStyle Minimized

# 2. Start auto-continue watcher  
Write-Host "2. Starting auto-continue watcher..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-File auto-continue.ps1" -WindowStyle Minimized

# 3. Open VS Code with the project
Write-Host "3. Opening VS Code..." -ForegroundColor Yellow
Start-Process code -ArgumentList "."
Start-Sleep -Seconds 3

# 4. Copy the master prompt to clipboard
$blueprint = "_blueprint"
$project = Get-Content "$blueprint/project.md" -Raw
$stack = Get-Content "$blueprint/stack.md" -Raw
$schema = Get-Content "$blueprint/schema.md" -Raw
$progress = Get-Content "$blueprint/progress.md" -Raw
$current = Get-Content "$blueprint/current_task.md" -Raw
$errors = Get-Content "$blueprint/errors.md" -Raw

$prompt = @"
#file:_blueprint/project.md
#file:_blueprint/stack.md
#file:_blueprint/schema.md
#file:_blueprint/progress.md
#file:_blueprint/current_task.md
#file:_blueprint/errors.md

You are a senior full-stack developer building AdAvatar autonomously.

RULES:
- Work through every task in project.md from top to bottom
- Start from wherever progress.md says is next
- Build each step completely before moving to the next
- Run all terminal commands yourself
- Fix any errors automatically without asking
- After each step update all blueprint files and commit to Git
- Never stop to ask for confirmation
- Never wait for input
- If you hit an error try to fix it 3 times then log it and move on
- Keep working until every task is complete
- When done create _blueprint/COMPLETE.md

Start now and do not stop until the project is complete.
"@

$prompt | Set-Clipboard

Write-Host ""
Write-Host "✅ Everything is running!" -ForegroundColor Green
Write-Host ""
Write-Host "FINAL STEP (only thing you do):" -ForegroundColor White
Write-Host "1. VS Code is opening" -ForegroundColor White  
Write-Host "2. Press Ctrl+Alt+I to open Copilot Chat" -ForegroundColor White
Write-Host "3. Switch to Agent mode" -ForegroundColor White
Write-Host "4. Press Ctrl+V and hit Enter" -ForegroundColor White
Write-Host "5. Go to sleep 🛏️" -ForegroundColor White
Write-Host ""
Write-Host "Check _blueprint/COMPLETE.md in the morning." -ForegroundColor Cyan