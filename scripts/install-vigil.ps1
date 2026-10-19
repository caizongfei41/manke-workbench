# 注册 / 卸载 GPU 套件守护（Windows 计划任务）
#
#   .\scripts\install-vigil.ps1              注册：登录时启动，每 12 小时一轮
#   .\scripts\install-vigil.ps1 -Hours 6     改间隔
#   .\scripts\install-vigil.ps1 -Uninstall   卸载
#
# 守护本身在 scripts/vigil.mjs：ComfyUI 忙或缺席时它会跳过而不是抢卡。
# 本文件必须保存为「带 BOM 的 UTF-8」，否则 Windows PowerShell 5.1 会把中文读坏。

param(
  [int]$Hours = 12,
  [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'
$taskName = 'MankeGpuSuites'

if ($Uninstall) {
  $existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  if ($existing) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    Write-Host "已卸载计划任务 $taskName"
  } else {
    Write-Host "没有找到计划任务 $taskName"
  }
  return
}

$repo = Split-Path -Parent $PSScriptRoot
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCommand) { throw '找不到 node，请先确保 Node 在 PATH 里' }
$node = $nodeCommand.Source

$entry = Join-Path $repo 'scripts\vigil.mjs'
if (-not (Test-Path $entry)) { throw "找不到 $entry" }

$intervalMinutes = $Hours * 60
$action = New-ScheduledTaskAction -Execute $node -Argument "`"$entry`" --interval=$intervalMinutes" -WorkingDirectory $repo

# 登录触发 + 固定间隔重复；StartWhenAvailable 让错过的窗口在机器醒来后补跑
$trigger = New-ScheduledTaskTrigger -AtLogOn
$repetition = New-ScheduledTaskTrigger -Once -At (Get-Date).Date.AddMinutes(5) `
  -RepetitionInterval (New-TimeSpan -Minutes $intervalMinutes) `
  -RepetitionDuration (New-TimeSpan -Days 3650)
$trigger.Repetition = $repetition.Repetition

$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 3)

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
  -Settings $settings -Description '漫客工作台：定期跑 GPU 组 UI 套件' -Force | Out-Null

Write-Host "已注册计划任务 $taskName（每 $Hours 小时一轮，结果写到 .verify/gpu-latest.json）"
Write-Host "查看状态：Get-ScheduledTask -TaskName $taskName | Get-ScheduledTaskInfo"
Write-Host "卸载：.\scripts\install-vigil.ps1 -Uninstall"
