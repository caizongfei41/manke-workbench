# 漫客工作台控制台 · 卸载脚本
#
# 由「卸载.cmd」或「设置 → 应用」调用。
#
# 只删控制台自己装的东西：
#   · 安装目录（launcher / scripts / node / docs / data）
#   · 桌面和开始菜单快捷方式
#   · 注册表卸载项
#
# 不删：
#   · deploy\ 里的分卷 —— 那是 200 GB 数据，误删很痛（除非显式 -Purge）
#   · ComfyUI 和工作台的计划任务 —— 那是运行环境，可能指向你已有的安装
#   · 任何工作台项目目录
#
# 参数：
#   -Silent    不确认，直接卸载
#   -Purge     连 deploy 里的分卷一起删（危险，需要显式指定）

param(
    [switch]$Silent,
    [switch]$Purge
)

$ErrorActionPreference = 'Continue'
$selfId = $PID

# 本脚本位于 <安装根>\launcher\，$PSScriptRoot 是 launcher 而不是安装根。
# install.ps1 会把实际安装目录写进 <根>\.install-location，优先读它。
$here = $PSScriptRoot
$installRoot = Split-Path $here -Parent
$manifest = Join-Path $installRoot '.install-location'
$target = $installRoot
if (Test-Path $manifest) {
    $recorded = (Get-Content $manifest -Raw -ErrorAction SilentlyContinue)
    if ($recorded) { $target = $recorded.Trim() }
}

Write-Host ''
Write-Host '  漫客工作台 · 控制台卸载' -ForegroundColor Cyan
Write-Host '  ============================================'
Write-Host "  安装目录: $target"
Write-Host ''

# 统计与提示
$deployFiles = 0
if (Test-Path $target) {
    $files = @(Get-ChildItem $target -Recurse -File -ErrorAction SilentlyContinue)
    $sizeGb = [math]::Round((($files | Measure-Object Length -Sum).Sum) / 1GB, 2)
    $deployDir = Join-Path $target 'deploy'
    if (Test-Path $deployDir) {
        $deployFiles = @(Get-ChildItem $deployDir -Recurse -File -ErrorAction SilentlyContinue).Count
    }
    Write-Host "  共 $($files.Count) 个文件，$sizeGb GB"
    if ($deployFiles -gt 0) {
        Write-Host "  deploy\ 里有 $deployFiles 个文件（可能是你的分卷）" -ForegroundColor Yellow
    }
    Write-Host ''
} else {
    Write-Host '  目录不存在，清理残留快捷方式和注册表项。' -ForegroundColor Yellow
    Write-Host ''
}

# 确认
if (-not $Silent -and (Test-Path $target)) {
    $msg = "确认卸载？`n`n将删除：$target"
    if ($deployFiles -gt 0 -and -not $Purge) {
        $msg += "`n`n注意：deploy\ 里的 $deployFiles 个文件会被保留。"
    }
    $answer = Read-Host ($msg + "`n`n(y/N)")
    if ($answer -ne 'y') {
        Write-Host '  已取消。'
        exit 0
    }
}

# 1. 先停掉跑在这个目录下的控制台进程，否则文件被占用删不掉
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.ProcessId -ne $selfId -and $_.CommandLine -and $_.CommandLine.Contains($target) } |
    Where-Object { $_.CommandLine -match 'service-console|start-workbench' } |
    ForEach-Object {
        Write-Host "  结束进程 PID $($_.ProcessId)"
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }

# 2. 清快捷方式（先做，避免目录删了之后路径失效）
$lnks = @(
    (Join-Path ([Environment]::GetFolderPath('Desktop')) '漫客工作台 控制台.lnk'),
    (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\漫客工作台 控制台.lnk')
)
foreach ($lnk in $lnks) {
    if (Test-Path $lnk) {
        Remove-Item $lnk -Force -ErrorAction SilentlyContinue
        Write-Host "  ✓ 删除快捷方式 $lnk"
    }
}

# 3. 清注册表卸载项
$regPath = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\MankeWorkbenchConsole'
if (Test-Path $regPath) {
    Remove-Item $regPath -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host '  ✓ 清除注册表卸载项'
}

# 4. 删目录
# 不能在脚本自己所在的目录里边删自己 —— 先把自己复制到临时目录，从那里删。
if (Test-Path $target) {
    if ($Purge) {
        Write-Host '  删除整个目录（含 deploy）…'
        $cleaner = Join-Path $env:TEMP ('manke-uninstall-' + [guid]::NewGuid().ToString('N').Substring(0, 8) + '.ps1')
        $cleanerBody = @"
Start-Sleep -Milliseconds 800
Remove-Item '$target' -Recurse -Force -ErrorAction SilentlyContinue
Write-Host ''
Write-Host '  卸载完成。' -ForegroundColor Green
if ('$Silent' -ne 'True') { Read-Host '  按回车退出' | Out-Null }
"@
        Set-Content $cleaner $cleanerBody -Encoding UTF8
        Start-Process powershell -ArgumentList @(
            '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $cleaner
        ) -Wait
        Remove-Item $cleaner -Force -ErrorAction SilentlyContinue
    } else {
        Write-Host '  删除安装文件，保留 deploy\ …'
        Get-ChildItem $target -ErrorAction SilentlyContinue | ForEach-Object {
            if ($_.Name -eq 'deploy' -and $_.PSIsContainer) {
                # deploy 里只删安装时生成的说明文件
                Get-ChildItem $_.FullName -File -ErrorAction SilentlyContinue |
                    Where-Object { $_.Name -like '*把分卷放这里*' } |
                    ForEach-Object { Remove-Item $_.FullName -Force -ErrorAction SilentlyContinue }
            } else {
                Remove-Item $_.FullName -Recurse -Force -ErrorAction SilentlyContinue
            }
        }
        $left = @(Get-ChildItem $target -ErrorAction SilentlyContinue)
        if ($left.Count -eq 0) {
            Remove-Item $target -Recurse -Force -ErrorAction SilentlyContinue
        } else {
            Write-Host "  保留 $($left.Count) 项在 $target（含你的数据）"
        }
    }
}

Write-Host ''
Write-Host '  卸载完成。' -ForegroundColor Green
Write-Host ''
Write-Host '  以下内容没有被删除（如需清理请手动处理）：'
Write-Host '    · ComfyUI 安装目录（模型和节点都在里面）'
Write-Host '    · 工作台项目目录（.output、node_modules）'
Write-Host '    · 计划任务 BD-ComfyUI / BD-Workbench'
Write-Host ''
if (-not $Silent) { Read-Host '  按回车退出' | Out-Null }
