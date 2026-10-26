$ErrorActionPreference = 'Continue'
$host.UI.RawUI.WindowTitle = '漫客工作台'

# ---------- 可配置路径 ----------
# 工作台根目录 = 本脚本所在 launcher\ 的上一级，所以整个项目可以放在任意位置。
# （旧版写死了某个用户的桌面路径，换机器就无法启动。）
$bd = Split-Path -Parent $PSScriptRoot

# ComfyUI 安装目录，按优先级：
#   1. 环境变量 BEATDESIGN_COMFYUI_HOME（临时覆盖）
#   2. data\comfyui.config.json 里的 pythonPath（控制台「选择位置」会写这里）
#   3. 常见位置猜一个
# 不再写死某个盘符：部署包解到哪个盘由用户在控制台里选。
$comfy = $env:BEATDESIGN_COMFYUI_HOME
if (-not $comfy) {
  $cfgPath = Join-Path $bd 'data\comfyui.config.json'
  if (Test-Path $cfgPath) {
    try {
      $cfg = Get-Content $cfgPath -Raw -Encoding UTF8 | ConvertFrom-Json
      $py = [string]$cfg.pythonPath
      $idx = $py.ToLower().IndexOf('python_embeded')
      if ($idx -gt 0) { $comfy = $py.Substring(0, $idx).TrimEnd('\', '/') }
    } catch { }
  }
}
if (-not $comfy) {
  foreach ($guess in @('E:\ComfyUI', 'D:\ComfyUI', 'C:\ComfyUI')) {
    if (Test-Path (Join-Path $guess 'python_embeded\python.exe')) { $comfy = $guess; break }
  }
}
if (-not $comfy) { $comfy = 'E:\ComfyUI' }
# Node / pnpm 所在目录（用系统安装的 Node.js；可用 BEATDESIGN_NODE_DIR 覆盖）
$nodeDir = $env:BEATDESIGN_NODE_DIR
if (-not $nodeDir -or -not (Test-Path (Join-Path $nodeDir 'node.exe'))) {
  $nodeDir = 'C:\Program Files\nodejs'
}

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
Write-Host '==================================================' -ForegroundColor Cyan
Write-Host '         漫客工作台一键启动器' -ForegroundColor White
Write-Host '    ComfyUI  +  漫客  +  浏览器' -ForegroundColor White
Write-Host '==================================================' -ForegroundColor Cyan

# [0] 环境自检
if (-not (Test-Path (Join-Path $nodeDir 'node.exe'))) {
  Write-Host "[错误] 找不到 node.exe：$nodeDir" -ForegroundColor Red
  Write-Host '       请修改本脚本顶部 $nodeDir 路径，或安装 Node.js 后重试。' -ForegroundColor Yellow
  Read-Host '按回车退出'
  exit 1
}
if (-not (Test-Path (Join-Path $nodeDir 'pnpm.cmd')) -and -not (Test-Path (Join-Path $nodeDir 'pnpx.cmd'))) {
  Write-Host '[提示] 未找到 pnpm.cmd。生产模式启动只需 node.exe，可继续；' -ForegroundColor Yellow
  Write-Host '       若要用 pnpm dev 开发模式，请先执行：npm install -g pnpm' -ForegroundColor Yellow
}

# [0.5] 清理卡死的 ComfyUI 残留进程（占用资源但 8188 端口未开）
$stale = @(Get-CimInstance Win32_Process -Filter "Name='python.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like "*$($comfy.TrimEnd('\'))*ComfyUI*" })
if (-not (Test-Port 8188) -and $stale.Count -gt 0) {
  Write-Host "[清理] 检测到 $($stale.Count) 个卡死的 ComfyUI 进程（资源被占但端口未开），正在终止 ..." -ForegroundColor Yellow
  foreach ($p in $stale) {
    taskkill /PID $p.ProcessId /T /F 2>$null | Out-Null
  }
  Start-Sleep -Seconds 2
}

# [1] ComfyUI
Write-Host '[1/2] 检查 ComfyUI (127.0.0.1:8188) ...' -ForegroundColor Yellow
if (Test-Port 8188) {
  Write-Host '      已运行，跳过启动。' -ForegroundColor Green
} else {
  Write-Host '      未运行，正在后台启动（日志: data\logs\comfyui.log）...'
  $comfyLog = Join-Path $bd 'data\logs\comfyui.log'
  New-Item -ItemType Directory -Force -Path (Split-Path $comfyLog) -ErrorAction SilentlyContinue | Out-Null
  # 直接调用 python，不要走 run_nvidia_gpu.bat：那个 bat 结尾有 pause，
  # 一旦 ComfyUI 退出或启动失败，隐藏窗口会永久卡在等待按键上。
  # 这里与计划任务 BD-ComfyUI 使用完全相同的命令行与环境变量。
  Start-Process -WindowStyle Hidden cmd -ArgumentList '/c', "cd /d `"$comfy`" && set `"HF_ENDPOINT=https://hf-mirror.com`" && set `"HF_HUB_DISABLE_TELEMETRY=1`" && `"$comfy\python_embeded\python.exe`" -s ComfyUI\main.py --windows-standalone-build --use-sage-attention --disable-pinned-memory > `"$comfyLog`" 2>&1"
}

# [2] 漫客
Write-Host '[2/2] 检查 漫客 (127.0.0.1:3020) ...' -ForegroundColor Yellow
if (Test-Port 3020) {
  Write-Host '      已运行，跳过启动。' -ForegroundColor Green
} else {
  Write-Host '      未运行，正在启动（生产模式）...'
  if (-not (Test-Path (Join-Path $bd '.output\server\index.mjs'))) {
    Write-Host '[错误] 缺少 .output\server\index.mjs，请先执行：pnpm build' -ForegroundColor Red
    Start-Sleep -Seconds 10
    exit 1
  }
  # BEATDESIGN_COMFYUI_HOME 让服务端定位到本机 ComfyUI；缺省值只在
  # src/core/services/service-manager.ts 里兜底，显式传入更可靠。
  Start-Process cmd -ArgumentList '/c', "cd /d `"$bd`" && set `"PATH=$nodeDir;%PATH%`" && set PORT=3020 && set BEATDESIGN_COMFYUI_HOME=$comfy && set BEATDESIGN_GENERATION_PROVIDER=comfyui && node .output\server\index.mjs > `"$bd\data\logs\workbench.log`" 2> `"$bd\data\logs\workbench.err.log`""
}

# [3] 等待就绪（ComfyUI 首次加载约 1-2 分钟）
Write-Host ''
Write-Host '正在等待服务就绪（ComfyUI 首次加载约 1 分钟）...' -ForegroundColor Yellow
$wait = 0
$comfyOk = Test-Port 8188
$bdOk = Test-Port 3020
while (-not ($comfyOk -and $bdOk)) {
  $wait++
  if ($wait -ge 180) {
    Write-Host '等待超时（180s），请检查上方两个服务窗口是否有报错。' -ForegroundColor Red
    Start-Sleep -Seconds 20
    break
  }
  Start-Sleep -Seconds 1
  if (-not $comfyOk) { $comfyOk = Test-Port 8188 }
  if (-not $bdOk) { $bdOk = Test-Port 3020 }
}

if ($comfyOk -and $bdOk) {
  Write-Host '全部就绪！正在打开工作台 ...' -ForegroundColor Green
  Start-Process 'http://127.0.0.1:3020'
  Start-Process 'http://127.0.0.1:8188'
  Write-Host '完成，本窗口可关闭。' -ForegroundColor Green
} else {
  Write-Host '部分服务未就绪：ComfyUI(8188)=' -ForegroundColor Yellow
  Write-Host $comfyOk -ForegroundColor $(if ($comfyOk) { 'Green' } else { 'Red' })
  Write-Host ' 漫客(3020)=' -ForegroundColor Yellow
  Write-Host $bdOk -ForegroundColor $(if ($bdOk) { 'Green' } else { 'Red' })
  Start-Sleep -Seconds 20
}
Start-Sleep -Seconds 3
