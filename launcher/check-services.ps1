# 漫客工作台 服务自检
#
# 只读检查两个服务与计划任务的状态，不会启动或停止任何东西。
# 只读检查，不会启动或停止任何服务。

$ErrorActionPreference = 'Continue'

function Test-Port([int]$port) {
  try {
    $c = New-Object Net.Sockets.TcpClient
    $c.Connect('127.0.0.1', $port)
    $c.Close()
    return $true
  } catch {
    return $false
  }
}

Write-Host ''
Write-Host '==========================================' -ForegroundColor Cyan
Write-Host '        漫客工作台 服务自检' -ForegroundColor White
Write-Host '==========================================' -ForegroundColor Cyan
Write-Host ''

$ok = $true

# --- 计划任务 -------------------------------------------------------------
Write-Host '[计划任务]' -ForegroundColor Yellow
foreach ($name in 'BD-ComfyUI', 'BD-Workbench') {
  $task = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
  if (-not $task) {
    Write-Host ("  {0,-14} 未注册" -f $name) -ForegroundColor Red
    $ok = $false
    continue
  }
  $state = "$($task.State)"
  $trigger = "$($task.Triggers[0].CimClass.CimClassName)"
  if ($state -eq 'Running') {
    Write-Host ("  {0,-14} {1}   {2}" -f $name, $state, $trigger) -ForegroundColor Green
  } else {
    Write-Host ("  {0,-14} {1}   {2}   <- 任务没在跑" -f $name, $state, $trigger) -ForegroundColor Red
    $ok = $false
  }
}

# --- 端口 -----------------------------------------------------------------
Write-Host ''
Write-Host '[端口监听]' -ForegroundColor Yellow
foreach ($pair in @(@(8188, 'ComfyUI'), @(3020, '漫客工作台'))) {
  $port = $pair[0]; $label = $pair[1]
  if (Test-Port $port) {
    $conn = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue |
      Select-Object -First 1
    $owner = ''
    if ($conn) {
      $owner = (Get-CimInstance Win32_Process -Filter "ProcessId=$($conn.OwningProcess)" -ErrorAction SilentlyContinue |
        Invoke-CimMethod -MethodName GetOwner -ErrorAction SilentlyContinue).User
    }
    Write-Host ("  {0,-12} port {1}  监听中{2}" -f $label, $port, $(if ($owner) { "  ($owner)" } else { '' })) -ForegroundColor Green
  } else {
    Write-Host ("  {0,-12} port {1}  未监听" -f $label, $port) -ForegroundColor Red
    $ok = $false
  }
}

# --- HTTP -----------------------------------------------------------------
Write-Host ''
Write-Host '[HTTP 响应]' -ForegroundColor Yellow
try {
  $r = Invoke-WebRequest 'http://127.0.0.1:3020/zh' -TimeoutSec 10 -UseBasicParsing
  $title = if ($r.Content -match '<title>([^<]*)</title>') { $Matches[1] } else { '(无标题)' }
  Write-Host ("  工作台   HTTP {0}   {1}" -f $r.StatusCode, $title) -ForegroundColor Green
} catch {
  Write-Host '  工作台   无响应' -ForegroundColor Red
  $ok = $false
}
try {
  $s = Invoke-RestMethod 'http://127.0.0.1:8188/system_stats' -TimeoutSec 10
  Write-Host ("  ComfyUI  v{0}   {1}" -f $s.system.comfyui_version, $s.devices[0].name) -ForegroundColor Green
} catch {
  Write-Host '  ComfyUI  无响应' -ForegroundColor Red
  $ok = $false
}

# --- 可用模型 -------------------------------------------------------------
Write-Host ''
Write-Host '[可用模型]' -ForegroundColor Yellow
try {
  $m = Invoke-RestMethod 'http://127.0.0.1:3020/api/app/effects/models' -TimeoutSec 15
  $list = if ($m.models) { $m.models } else { $m }
  $bad = @($list | Where-Object { -not $_.available }).Count
  $image = @($list | Where-Object { $_.workspaceType -eq 'ai-image' }).Count
  $video = @($list | Where-Object { $_.workspaceType -eq 'ai-video' }).Count
  Write-Host ("  共 {0} 个（图像 {1} / 视频 {2}），不可用 {3} 个" -f $list.Count, $image, $video, $bad) -ForegroundColor Green
  if ($bad -gt 0) { $ok = $false }
} catch {
  Write-Host '  查询失败' -ForegroundColor Red
  $ok = $false
}

# --- 结论 -----------------------------------------------------------------
Write-Host ''
Write-Host '==========================================' -ForegroundColor Cyan
if ($ok) {
  Write-Host '  两个服务都在运行。' -ForegroundColor Green
  Write-Host '  打开工作台: http://127.0.0.1:3020' -ForegroundColor White
} else {
  Write-Host '  有项目未就绪（见上方红色行）。' -ForegroundColor Red
  Write-Host '  可以双击项目根目录的「启动工作台.bat」手动拉起。' -ForegroundColor Yellow
}
Write-Host '==========================================' -ForegroundColor Cyan
Write-Host ''
