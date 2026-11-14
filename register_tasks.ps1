# 注册两个 Windows 计划任务
#   14:50  计算当日定投金额（盘中，用 T-1 分位 + 当日实时涨跌幅）
#   15:30  刷新估值序列、重算分位快照（盘后）
#
# 用法（在项目目录下，用当前用户运行，不需要管理员）：
#   powershell -ExecutionPolicy Bypass -File .\register_tasks.ps1

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$python = (Get-Command python).Source
$batCalc = Join-Path $root "run_1450.bat"
$batUpdate = Join-Path $root "run_1530.bat"

function Register-DcaTask {
    param([string]$Name, [string]$Script, [string]$At, [string]$Desc)

    $action = New-ScheduledTaskAction -Execute "cmd.exe" `
        -Argument "/c `"$Script`"" -WorkingDirectory $root
    $trigger = New-ScheduledTaskTrigger -Weekly `
        -DaysOfWeek Monday, Tuesday, Wednesday, Thursday, Friday `
        -At ([datetime]::Today.Add([timespan]::Parse($At)))
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries -StartWhenAvailable `
        -ExecutionTimeLimit (New-TimeSpan -Minutes 10)

    Unregister-ScheduledTask -TaskName $Name -Confirm:$false -ErrorAction SilentlyContinue
    Register-ScheduledTask -TaskName $Name -Action $action -Trigger $trigger `
        -Settings $settings -Description $Desc | Out-Null
    Write-Host "[OK] 已注册任务：$Name  ->  工作日 $At"
}

Register-DcaTask -Name "IndexDCA-Calc-1450" -Script $batCalc -At "14:50" `
    -Desc "收盘前 10 分钟计算指数估值定投金额"
Register-DcaTask -Name "IndexDCA-Update-1530" -Script $batUpdate -At "15:30" `
    -Desc "盘后刷新估值序列与分位快照"

Write-Host ""
Write-Host "查看：Get-ScheduledTask -TaskName 'IndexDCA-*'"
Write-Host "删除：Unregister-ScheduledTask -TaskName 'IndexDCA-Calc-1450','IndexDCA-Update-1530' -Confirm:`$false"
