
# 漫客工作台控制台 · 安装脚本
#
# 由 Setup.exe 自解压后自动运行；也可以手工执行：
#   powershell -ExecutionPolicy Bypass -File install.ps1
#
# 参数：
#   -Silent              不交互（Setup.exe 调用时用），覆盖安装直接进行
#   -NoLaunch            装完不自动打开控制台
#   -Target <path>       指定安装目录
#
# 只做三件事：把文件铺到安装目录、建桌面快捷方式、报告结果。
# 不写注册表，不需要管理员权限，卸载就是删目录。

param(
    [switch]$Silent,
    [switch]$NoLaunch,
    [string]$Target
)

$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot

# 默认装到 %LOCALAPPDATA%\Programs\漫客工作台，不需要管理员权限
$defaultRoot = Join-Path $env:LOCALAPPDATA 'Programs\漫客工作台'
$target = if ($Target) { $Target } elseif ($env:MANKE_INSTALL_DIR) { $env:MANKE_INSTALL_DIR } else { $defaultRoot }

Write-Host ''
Write-Host '  漫客工作台 · 控制台安装' -ForegroundColor Cyan
Write-Host '  ============================================'
Write-Host "  安装到: $target"
Write-Host ''

# 目标目录里已经有东西就提示，避免覆盖用户数据。
# 静默模式下直接覆盖 —— Setup.exe 是用户主动双击的，意图已经很明确；
# 而且此时没有控制台可以读输入，Read-Host 会永久阻塞。
if (Test-Path $target) {
    $existing = Get-ChildItem $target -ErrorAction SilentlyContinue
    if ($existing -and $existing.Count -gt 0) {
        if ($Silent) {
            Write-Host '  目录已存在，静默模式直接覆盖。' -ForegroundColor Yellow
        } else {
            Write-Host '  目录已存在且非空。' -ForegroundColor Yellow
            $answer = Read-Host '  覆盖安装？已有文件会被替换 (y/N)'
            if ($answer -ne 'y') {
                Write-Host '  已取消。'
                exit 0
            }
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

# 记录安装位置，卸载脚本靠它找回目录
Set-Content (Join-Path $target '.install-location') $target -Encoding UTF8

# 卸载入口。
#
# 这里刻意不生成 .cmd：批处理文件用 ANSI/GBK 保存，一旦路径里有中文
# （安装目录叫「漫客工作台」）cmd 解码就对不上，报「文件不存在」。
# 实测过 chcp 65001 也救不回来 —— 那是控制台输出编码，不是参数解码。
#
# 改成两个纯 powershell 入口：
#   卸载.vbs                 双击用，隐藏窗口启动脚本（VBS 是 UTF-16，中文安全）
#   launcher\uninstall-silent.vbs   给「设置 → 应用」用
#
# VBS 替 powershell 传参，路径以字符串字面量出现，不经过 cmd 的 ANSI 解码。
$uninstPs1 = Join-Path $target 'launcher\uninstall.ps1'
if (Test-Path $uninstPs1) {
    # 双击版：会弹确认
    $vbsVisible = @"
' 漫客工作台 · 控制台卸载
' 用 VBS 而不是 .cmd：cmd 的 ANSI 解码会把中文路径变成乱码。
Set sh = CreateObject("WScript.Shell")
sh.Run "powershell -NoProfile -ExecutionPolicy Bypass -File ""$uninstPs1""", 1, False
"@
    Set-Content (Join-Path $target '卸载.vbs') $vbsVisible -Encoding Unicode

    # 静默版：设置里点卸载走这个
    $vbsSilent = @"
' 漫客工作台 · 控制台卸载（静默，供「设置 → 应用」调用）
Set sh = CreateObject("WScript.Shell")
sh.Run "powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""$uninstPs1"" -Silent", 0, True
"@
    Set-Content (Join-Path $target 'launcher\uninstall-silent.vbs') $vbsSilent -Encoding Unicode

    # 保留一份 .cmd 方便命令行用户，但内容只写相对路径，不含中文
    $cmdBody = "@echo off`r`ncd /d `"%~dp0`"`r`npowershell -NoProfile -ExecutionPolicy Bypass -File `"%~dp0launcher\uninstall.ps1`"`r`npause`r`n"
    Set-Content (Join-Path $target 'uninstall.cmd') $cmdBody -Encoding ASCII

    Write-Host '    ✓ 卸载.vbs / uninstall.cmd'
}

# 注册表卸载项：让「设置 → 应用」和控制面板里能看到并卸载。
# 不写这个的话用户根本找不到卸载入口，只能自己翻 AppData 删目录。
try {
    $regPath = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\MankeWorkbenchConsole'
    New-Item -Path $regPath -Force | Out-Null
    $sizeKb = [int]((Get-ChildItem $target -Recurse -File -ErrorAction SilentlyContinue |
        Measure-Object Length -Sum).Sum / 1KB)
    Set-ItemProperty -Path $regPath -Name 'DisplayName'     -Value '漫客工作台 · 服务控制台'
    Set-ItemProperty -Path $regPath -Name 'DisplayIcon'     -Value $iconPath
    Set-ItemProperty -Path $regPath -Name 'DisplayVersion'  -Value '1.0.0'
    Set-ItemProperty -Path $regPath -Name 'Publisher'       -Value '漫客工作台'
    Set-ItemProperty -Path $regPath -Name 'InstallLocation' -Value $target
    Set-ItemProperty -Path $regPath -Name 'EstimatedSize'   -Value $sizeKb -Type DWord
    Set-ItemProperty -Path $regPath -Name 'NoModify'        -Value 1 -Type DWord
    Set-ItemProperty -Path $regPath -Name 'NoRepair'        -Value 1 -Type DWord
    # 「设置 → 应用」点卸载是无窗口启动的，必须用静默版，
    # 否则 Read-Host 拿不到输入会被当成取消，用户看到「点了没反应」。
    # 用 wscript 拉起 VBS：VBS 是 UTF-16，中文路径不会像 .cmd 那样被 GBK 解坏。
    $silentVbs = Join-Path $target 'launcher\uninstall-silent.vbs'
    if (Test-Path $silentVbs) {
        Set-ItemProperty -Path $regPath -Name 'UninstallString' -Value "wscript.exe `"$silentVbs`""
        Set-ItemProperty -Path $regPath -Name 'QuietUninstallString' -Value "wscript.exe `"$silentVbs`""
    } else {
        # 没有 VBS 时退回直接调 powershell
        Set-ItemProperty -Path $regPath -Name 'UninstallString' -Value "powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$uninstPs1`" -Silent"
        Set-ItemProperty -Path $regPath -Name 'QuietUninstallString' -Value "powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$uninstPs1`" -Silent"
    }
    Write-Host '    ✓ 已注册到「设置 → 应用」'
} catch {
    Write-Host '    ! 注册表写入失败，卸载时请手动删除安装目录' -ForegroundColor Yellow
}

# 开始菜单快捷方式，和桌面那个并列
try {
    $startDir = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
    $smLnk = Join-Path $startDir '漫客工作台 控制台.lnk'
    $sc2 = $shell.CreateShortcut($smLnk)
    $sc2.TargetPath = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
    $sc2.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$target\launcher\service-console.ps1`""
    $sc2.WorkingDirectory = $target
    if (Test-Path $iconPath) { $sc2.IconLocation = $iconPath }
    $sc2.Save()
    Write-Host '    ✓ 开始菜单快捷方式'
} catch {
    Write-Host '    ! 开始菜单快捷方式创建失败' -ForegroundColor Yellow
}

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

# 装完自动打开控制台。静默模式下不询问（此时没有控制台可读输入，
# Read-Host 会永久阻塞，安装看起来像卡死），除非显式传了 -NoLaunch。
$shouldLaunch = -not $NoLaunch
if (-not $Silent -and -not $NoLaunch) {
    $answer = Read-Host '  现在打开控制台？(Y/n)'
    $shouldLaunch = ($answer -ne 'n')
}
if ($shouldLaunch) {
    Start-Process 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' -ArgumentList @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
        '-File', (Join-Path $target 'launcher\service-console.ps1')
    )
}
