
# 漫客工作台控制台 · 安装脚本
#
# 由 Setup.exe 自解压后自动运行；也可以手工执行：
#   powershell -ExecutionPolicy Bypass -File install.ps1
#
# 只做三件事：把文件铺到安装目录、建桌面快捷方式、报告结果。
# 不写注册表，不需要管理员权限，卸载就是删目录。

$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot

# 默认装到 Program Files\漫客工作台，没有写权限时退回用户目录
$defaultRoot = Join-Path $env:LOCALAPPDATA 'Programs\漫客工作台'
$target = $env:MANKE_INSTALL_DIR
if (-not $target) { $target = $defaultRoot }

Write-Host ''
Write-Host '  漫客工作台 · 控制台安装' -ForegroundColor Cyan
Write-Host '  ============================================'
Write-Host "  安装到: $target"
Write-Host ''

# 目标目录里已经有东西就提示，避免覆盖用户数据
if (Test-Path $target) {
    $existing = Get-ChildItem $target -ErrorAction SilentlyContinue
    if ($existing -and $existing.Count -gt 0) {
        Write-Host '  目录已存在且非空。' -ForegroundColor Yellow
        $answer = Read-Host '  覆盖安装？已有文件会被替换 (y/N)'
        if ($answer -ne 'y') {
            Write-Host '  已取消。'
            exit 0
        }
    }
}

New-Item -ItemType Directory -Path $target -Force | Out-Null

# 铺文件
$files = Join-Path $here 'files'
if (-not (Test-Path $files)) {
    Write-Host '  ✗ 找不到 files 目录，安装包不完整' -ForegroundColor Red
    exit 1
}
foreach ($dir in @('launcher', 'scripts', 'docs', 'node')) {
    $src = Join-Path $files $dir
    if (Test-Path $src) {
        Copy-Item $src (Join-Path $target $dir) -Recurse -Force
        Write-Host "    ✓ $dir"
    }
}

# 部署包目录先建出来，用户往里放分卷
$deployDir = Join-Path $target 'deploy'
if (-not (Test-Path $deployDir)) {
    New-Item -ItemType Directory -Path $deployDir -Force | Out-Null
    Set-Content (Join-Path $deployDir '把分卷放这里.txt') @'
把从网盘下载的所有 .7z.001 … .7z.119 分卷解压/复制到本目录，
然后打开「漫客工作台 控制台」点「检查部署包」。

分卷必须全部到位，少一个解不开。
'@ -Encoding UTF8
    Write-Host '    ✓ deploy（空目录，用来放分卷）'
}

# 桌面快捷方式
$iconPath = Join-Path $target 'launcher\launcher-icon.ico'
$shortcutPath = Join-Path ([Environment]::GetFolderPath('Desktop')) '漫客工作台 控制台.lnk'
$shell = New-Object -ComObject WScript.Shell
$sc = $shell.CreateShortcut($shortcutPath)
$sc.TargetPath = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
$sc.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$target\launcher\service-console.ps1`""
$sc.WorkingDirectory = $target
if (Test-Path $iconPath) { $sc.IconLocation = $iconPath }
$sc.Description = '漫客工作台 · 服务控制台'
$sc.Save()
Write-Host '    ✓ 桌面快捷方式'

Write-Host ''
Write-Host '  安装完成。' -ForegroundColor Green
Write-Host ''
Write-Host '  下一步：'
Write-Host '    1. 把网盘下载的分卷放进 deploy 目录'
Write-Host '    2. 双击桌面「漫客工作台 控制台」'
Write-Host "    3. 点「检查部署包」→「一键部署」"
Write-Host ''
Write-Host "  安装目录: $target"
Write-Host ''

$answer = Read-Host '  现在打开控制台？(Y/n)'
if ($answer -ne 'n') {
    Start-Process 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' -ArgumentList @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
        '-File', (Join-Path $target 'launcher\service-console.ps1')
    )
}
