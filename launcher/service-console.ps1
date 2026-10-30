# 漫客工作台 · 服务控制台
#
# 一个桌面小窗口，用来一键启停 ComfyUI 与工作台，并检查环境是否就绪。
#
# 服务不设开机自启，由本控制台按需启停。启停走计划任务而不是 HTTP 接口：
# 工作台自己没法通过自己的接口启动自己，而 ComfyUI 也常在工作台没起来时就需要
# 单独启动。计划任务在两种情况下都可用。
#
# 停止时要额外杀进程：Stop-ScheduledTask 只结束任务本身，
# 任务里 cmd.exe 拉起的 node / python 子进程会留下来继续占端口。
#
# ── 关于「卡顿」的两条硬规矩 ────────────────────────────────────────
#
# 1) 状态轮询绝不能在 UI 线程上阻塞。服务没起来时，连一个关闭的本地端口要等
#    防火墙丢包超时（实测约 2 秒），Invoke-WebRequest 同样。两个服务各算一次
#    同步调用，一次 tick 就能冻住界面 8 秒，关窗口也一起卡住。
#    现在：端口探测用 ConnectAsync 加 120ms 上限；HTTP 健康检查是真正的异步
#    task，这个 tick 发起、下个 tick 看结果，从不等待。
#
# 2) 不用 Application::DoEvents()。它会把消息泵再跑一遍，定时器因此在
#    Update-Status 内部重入，越滚越深。需要立刻重绘时用控件的 Refresh()。
#
# 界面沿用工作台的深色配色（--beat-bg / --beat-surface / --beat-accent），
# 无系统标题栏，自绘标题栏以便整体保持深色。

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
# PowerShell 5.1 默认不加载 System.Net.Http。不加载的话 New-Object HttpClient 会
# 静默失败，健康检查的 task 永远是 null，状态就一直停在「启动中」。
Add-Type -AssemblyName System.Net.Http

$ErrorActionPreference = 'Continue'
[System.Windows.Forms.Application]::EnableVisualStyles()

# ---------------------------------------------------------------- 配色


function C([string]$hex) {
    $h = $hex.TrimStart('#')
    return [Drawing.Color]::FromArgb(
        [Convert]::ToInt32($h.Substring(0, 2), 16),
        [Convert]::ToInt32($h.Substring(2, 2), 16),
        [Convert]::ToInt32($h.Substring(4, 2), 16))
}

# ── 浅色玻璃配色
#
# 底色取极浅的冷灰，让白色卡片浮起来；层次靠 1px 描边 + 投影，
# 而不是深色对比。强调色沿用工作台界面的青色，保持同一套产品语言。
$BG      = C '#F1F4F9'   # 窗口底：偏冷的浅灰
$CARD    = C '#FFFFFF'   # 卡片：纯白，玻璃面
$CARD2   = C '#F8FAFC'   # 次级面（日志、内嵌区）
$LINE    = C '#E2E8F0'   # 描边：浅灰蓝
$TXT1    = C '#0F172A'   # 主文字：近黑
$TXT2    = C '#475569'   # 次文字
$TXT3    = C '#94A3B8'   # 弱文字
$ACCENT  = C '#0891B2'   # 强调：青
$ACCENTD = C '#ECFEFF'   # 强调底（浅青，主按钮背景）
$ACCENTL = C '#A5F3FC'   # 强调描边
$OK      = C '#059669'
$WARN    = C '#D97706'
$BAD     = C '#DC2626'
$BTN     = C '#FFFFFF'   # 按钮：白底
$BTNHOV  = C '#F1F5F9'   # 悬停：浅灰

$FONTFACE = 'Microsoft YaHei UI'
function F([single]$size, [string]$style = 'Regular') {
    return New-Object Drawing.Font($FONTFACE, $size, [Drawing.FontStyle]::$style)
}

# ---------------------------------------------------------------- 配置

$BD = $PSScriptRoot | Split-Path -Parent

$SERVICES = @(
    [pscustomobject]@{
        Key = 'comfyui';  Name = 'ComfyUI';  Task = 'BD-ComfyUI';  Port = 8188
        Url = 'http://127.0.0.1:8188/system_stats'
        ReadySeconds = 90; Desc = '本地推理后端'
    },
    [pscustomobject]@{
        Key = 'workbench'; Name = '工作台';  Task = 'BD-Workbench'; Port = 3020
        Url = 'http://127.0.0.1:3020/zh'
        ReadySeconds = 30; Desc = '网页界面'
    }
)

# ---------------------------------------------------------------- 计划任务
#
# 计划任务原来的 Execute 是 cmd.exe。cmd 是控制台程序，每次启动都会弹一个
# 黑窗口闪一下 —— 用户以为是 bug 或者病毒，实际只是任务在跑。
# cmd 没有可靠的自隐藏方式（START /MIN 仍会闪，powershell -WindowStyle Hidden
# 只是隐藏 PowerShell 自己的窗口，它拉起的子进程照样可见）。
#
# 可靠做法：用 wscript.exe 跑一个 VBS，WshShell.Run 的第 3 个参数是窗口样式，
# 传 0 = 完全隐藏。wscript 本身是 GUI 程序，不占控制台。
#
# 这段代码在控制台启动时检查一次，发现任务还指向 cmd.exe 就自动改写。
# 幂等：已经改过的不会再改。

# 生成隐藏启动用的 VBS 包装器。
function New-HiddenLaunchVbs {
    param([string]$Name, [string]$CmdLine, [string]$WorkDir)

    $vbsPath = Join-Path $BD "launcher\run-$Name.vbs"
    $escaped = $CmdLine -replace '"', '""'
    $content = @"
' 隐藏窗口启动 $Name
'
' 计划任务直接跑 cmd.exe 会弹控制台窗口，每次启动闪一下。
' WshShell.Run 的第 3 个参数传 0 = 窗口完全隐藏。
'
' 这个文件由控制台自动生成，不要手改 —— 控制台启动时可能重建。
' 原始命令记录在 run-$Name.cmd.txt 里，重装后靠它还原。
'
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "$WorkDir"
sh.Run "$escaped", 0, False
"@
    Set-Content $vbsPath $content -Encoding Unicode

    # 同时把原始命令行存一份。
    # 计划任务改成 wscript 之后就只剩下 VBS 路径，原始的 cmd 命令行丢了；
    # 而重装控制台会删掉 launcher 目录（含 VBS），任务就指向不存在的文件，
    # 表现为「任务状态 Running 但什么都不启动」。存一份原始命令才能重建。
    $cmdPath = Join-Path $BD "launcher\run-$Name.cmd.txt"
    Set-Content $cmdPath $CmdLine -Encoding UTF8

    return $vbsPath
}

# 把计划任务改成「wscript 跑 VBS」。
# 返回 $true 表示做了修改。
#
# 三种情况都要处理：
#   1. 任务还指向 cmd.exe      → 生成 VBS 并改写
#   2. 指向 wscript 但 VBS 没了 → 用 .cmd.txt 还原后重建（重装控制台会遇到）
#   3. 指向 wscript 且 VBS 在   → 什么都不做
function Repair-TaskWindow([string]$TaskName, [string]$WrapperName, [string]$DefaultCmdLine, [string]$DefaultWorkDir) {
    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if (-not $task) { return $false }
    if ($task.Actions.Count -eq 0) { return $false }

    $action = $task.Actions[0]
    $vbsExpected = Join-Path $BD "launcher\run-$WrapperName.vbs"
    $cmdRecord = Join-Path $BD "launcher\run-$WrapperName.cmd.txt"
    $isWscript = $action.Execute -and $action.Execute.ToLower().EndsWith('wscript.exe')

    if ($isWscript -and (Test-Path $vbsExpected)) {
        # 已经修好且文件在，不用动
        return $false
    }

    if ($isWscript -and -not (Test-Path $vbsExpected)) {
        # 重装后 VBS 丢了。从记录还原原始命令行。
        if (Test-Path $cmdRecord) {
            $cmdLine = (Get-Content $cmdRecord -Raw -Encoding UTF8).Trim()
            $workDir = if ($action.WorkingDirectory) { $action.WorkingDirectory } else { $DefaultWorkDir }
        } else {
            # 没有记录就用内置的默认命令（老部署没有 .cmd.txt）
            $cmdLine = $DefaultCmdLine
            $workDir = $DefaultWorkDir
        }
        $vbs = New-HiddenLaunchVbs -Name $WrapperName -CmdLine $cmdLine -WorkDir $workDir
        # 任务本身指向的路径没变（同一个 $vbsExpected），但保险起见重设一次
        $newAction = New-ScheduledTaskAction `
            -Execute 'wscript.exe' `
            -Argument "`"$vbs`"" `
            -WorkingDirectory $workDir
        Set-ScheduledTask -TaskName $TaskName -Action $newAction | Out-Null
        return $true
    }

    # 还没改过：原本是 cmd.exe
    $cmdLine = $action.Execute
    if ($action.Arguments) { $cmdLine += ' ' + $action.Arguments }
    $workDir = if ($action.WorkingDirectory) { $action.WorkingDirectory } else { $DefaultWorkDir }

    $vbs = New-HiddenLaunchVbs -Name $WrapperName -CmdLine $cmdLine -WorkDir $workDir

    $newAction = New-ScheduledTaskAction `
        -Execute 'wscript.exe' `
        -Argument "`"$vbs`"" `
        -WorkingDirectory $workDir
    Set-ScheduledTask -TaskName $TaskName -Action $newAction | Out-Null
    return $true
}

# 检查并修复两个任务的弹窗问题。失败不影响控制台使用。
# 从零创建一个服务的计划任务。
#
# 场景：重装控制台、手动删过任务、或换了安装位置之后，任务不见了。
# 原来的代码只会「修」已有任务，遇到任务不存在就直接把
# 「系统找不到指定的文件」甩给用户 —— 那是个死胡同，他除了重装没别的办法。
# 这里按当前 ComfyUI 位置现建一个，建完直接能启动。
function New-ServiceTask($svc) {
    $wrapper = if ($svc.Key -eq 'comfyui') { 'comfyui' } else { 'workbench' }
    $wrapperName = $wrapper   # New-HiddenLaunchVbs 内部会加 run- 前缀

    # 优先复用上次记录的命令行；没有就按当前配置拼一条
    $cmdRecord = Join-Path $BD "launcher$wrapperName.cmd.txt"
    $workDir = $BD
    $cmdLine = $null

    if (Test-Path $cmdRecord) {
        $cmdLine = (Get-Content $cmdRecord -Raw -Encoding UTF8).Trim()
    } else {
        if ($svc.Key -eq 'comfyui') {
            # ComfyUI 的根目录从 data\comfyui.config.json 读
            $comfyRoot = $null
            try {
                $cfgPath = Join-Path $BD 'data\comfyui.config.json'
                if (Test-Path $cfgPath) {
                    $cfg = Get-Content $cfgPath -Raw -Encoding UTF8 | ConvertFrom-Json
                    if ($cfg.pythonPath) { $comfyRoot = Split-Path (Split-Path $cfg.pythonPath -Parent) -Parent }
                }
            } catch { }
            if (-not $comfyRoot -and (Test-Path 'E:\ComfyUI')) { $comfyRoot = 'E:\ComfyUI' }
            if (-not $comfyRoot) { return $false }

            # 两种布局都要认：根下直接有 main.py，或者在 ComfyUI 子目录里
            $mainPy = Join-Path $comfyRoot 'main.py'
            if (-not (Test-Path $mainPy)) { $mainPy = Join-Path $comfyRoot 'ComfyUI\main.py' }
            if (-not (Test-Path $mainPy)) { return $false }

            $py = Join-Path $comfyRoot 'python_embeded\python.exe'
            if (-not (Test-Path $py)) { return $false }

            $cmdLine = "`"$py`" -s `"$mainPy`" --listen 127.0.0.1 --port $($svc.Port)"
            $workDir = Split-Path $mainPy -Parent
        } else {
            $nodeExe = Join-Path $BD 'node\node.exe'
            if (-not (Test-Path $nodeExe)) { return $false }
            $entry = Join-Path $BD '.output\server\index.mjs'
            $cmdLine = "`"$nodeExe`" `"$entry`""
        }
    }

    # 生成隐藏窗口的 VBS 包装器（避免每次启动闪一个黑框）
    try {
        $vbs = New-HiddenLaunchVbs -Name $wrapper -CmdLine $cmdLine -WorkDir $workDir
    } catch {
        Add-Log ("  生成启动包装器失败：" + $_.Exception.Message)
        return $false
    }

    $action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "`"$vbs`"" -WorkingDirectory $workDir
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero)
    try {
        Register-ScheduledTask -TaskName $svc.Task -Action $action -Settings $settings -Force -ErrorAction Stop | Out-Null
    } catch {
        Add-Log ("  注册计划任务失败：" + $_.Exception.Message)
        return $false
    }

    Add-Log "  已创建计划任务 $($svc.Task)"
    Add-Log "    命令：$cmdLine"
    return $true
}

function Repair-TaskWindows {
    $changed = @()
    foreach ($svc in $SERVICES) {
        $wrapper = if ($svc.Key -eq 'comfyui') { 'comfyui' } else { 'workbench' }

        # 兜底命令：老部署没有 .cmd.txt 记录时用这个重建。
        # ComfyUI 的路径从 data\comfyui.config.json 读，工作台就是 $BD。
        if ($svc.Key -eq 'comfyui') {
            $comfyRoot = 'E:\ComfyUI'
            try {
                $cfgPath = Join-Path $BD 'data\comfyui.config.json'
                if (Test-Path $cfgPath) {
                    $cfg = Get-Content $cfgPath -Raw -Encoding UTF8 | ConvertFrom-Json
                    $py = [string]$cfg.pythonPath
                    $idx = $py.ToLower().IndexOf('python_embeded')
                    if ($idx -gt 0) { $comfyRoot = $py.Substring(0, $idx).TrimEnd('\', '/') }
                }
            } catch { }
            $logDir = Join-Path $BD 'data\logs'
            # main.py 在部署包是 <root>\main.py，手动安装是 <root>\ComfyUI\main.py
            $comfyMainRel = 'main.py'
            if (-not (Test-Path (Join-Path $comfyRoot 'main.py'))) { $comfyMainRel = 'ComfyUI\main.py' }
            # 节点启动打印 emoji，GBK 下抛 UnicodeEncodeError 会直接退出
            $env:PYTHONUTF8 = '1'
            $fallbackCmd = 'cmd.exe /c set "HF_ENDPOINT=https://hf-mirror.com" && ' +
                'set "HF_HUB_DISABLE_TELEMETRY=1" && ' +
                "`"$comfyRoot\python_embeded\python.exe`" -s $comfyMainRel " +
                '--windows-standalone-build --use-sage-attention --disable-pinned-memory ' +
                "> `"$logDir\comfyui.log`" 2> `"$logDir\comfyui.err.log`""
            $fallbackDir = $comfyRoot
        } else {
            # 工作台的启动命令必须指向「真正的工作台目录」，不是控制台安装目录。
            # 控制台只有 25 MB，里面没有 .output；拿它当 cwd 会让
            # node .output\server\index.mjs 找不到文件，服务起不来 ——
            # 表现为任务状态成功但端口始终不监听。
            $wbDir = $BD
            foreach ($cand in @(
                (Join-Path $env:USERPROFILE 'Desktop\ComfyUI无线画布'),
                'C:\Users\Administrator\Desktop\ComfyUI无线画布',
                'D:\manke\workbench'
            )) {
                if (Test-Path (Join-Path $cand '.output\server\index.mjs')) { $wbDir = $cand; break }
            }
            $logDir = Join-Path $wbDir 'data\logs'
            $fallbackCmd = 'cmd.exe /c set "PATH=C:\Program Files\nodejs;%PATH%" && ' +
                'set PORT=3020 && set BEATDESIGN_GENERATION_PROVIDER=comfyui && ' +
                "cd /d `"$wbDir`" && node .output\server\index.mjs " +
                "> `"$logDir\workbench.log`" 2> `"$logDir\workbench.err.log`""
            $fallbackDir = $wbDir
        }

        try {
            if (Repair-TaskWindow -TaskName $svc.Task -WrapperName $wrapper `
                    -DefaultCmdLine $fallbackCmd -DefaultWorkDir $fallbackDir) {
                $changed += $svc.Name
            }
        } catch {
            # 权限不足或任务被锁定时忽略 —— 弹窗只是观感问题，
            # 不该让整个控制台启动失败
        }
    }
    return $changed
}

# ---------------------------------------------------------------- 探测

# 端口探测：ConnectAsync + 120ms 上限。连接成功通常 <1ms；
# 端口关闭且被防火墙丢包时会等 SYN 重试，绝不能把这段时间加在 UI 上。
function Test-PortOpen([int]$Port) {
    $client = New-Object Net.Sockets.TcpClient
    try {
        $task = $client.ConnectAsync('127.0.0.1', $Port)
        if (-not $task.Wait(120)) { return $false }
        return $task.Status -eq [System.Threading.Tasks.TaskStatus]::RanToCompletion -and $client.Connected
    } catch {
        return $false
    } finally {
        try { $client.Dispose() } catch { }
    }
}

function Get-PortOwner([int]$Port) {
    $conn = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if (-not $conn) { return $null }
    return $conn.OwningProcess
}

function Stop-ServiceProcess([int]$Port) {
    $pid_ = Get-PortOwner $Port
    if ($pid_) { & taskkill /PID $pid_ /T /F 2>&1 | Out-Null; return $true }
    return $false
}

# HTTP 健康检查：异步 task，发起后不等，下次 tick 再看结果。
$httpClient = New-Object System.Net.Http.HttpClient
$httpClient.Timeout = [TimeSpan]::FromMilliseconds(1500)

$health = @{}   # key -> @{ Task = Task; Ok = bool }

function Start-Health([string]$Key, [string]$Url) {
    $st = $health[$Key]
    if (-not $Url -or $st.Task) { return }
    try { $st.Task = $httpClient.GetAsync($Url) } catch { $st.Task = $null }
}

# 返回 $null 表示还在跑；$true/$false 是本次结果
function Poll-Health([string]$Key) {
    $st = $health[$Key]
    if (-not $st.Task) { return $null }
    if (-not $st.Task.IsCompleted) { return $null }
    $ok = $false
    try {
        $resp = $st.Task.Result
        $ok = $resp.IsSuccessStatusCode
        $resp.Dispose()
    } catch {
        $ok = $false
    }
    $st.Task = $null
    $st.Ok = $ok
    return $ok
}

# ---------------------------------------------------------------- 控件工厂

function New-Button([string]$text, [int]$x, [int]$y, [int]$w, [int]$h, [bool]$primary = $false) {
    $b = New-Object Windows.Forms.Button
    $b.Text = $text
    $b.Location = New-Object Drawing.Point($x, $y)
    $b.Size = New-Object Drawing.Size($w, $h)
    $b.FlatStyle = 'Flat'
    # 关掉系统视觉样式背景。默认 True 时 WinForms 会用系统主题给按钮
    # 上色，BackColor 被静默忽略 —— 颜色属性读出来对，屏幕上却是系统蓝。
    $b.UseVisualStyleBackColor = $false
    $b.FlatAppearance.BorderSize = 1
    $b.FlatAppearance.BorderColor = $(if ($primary) { $ACCENTL } else { $LINE })
    $b.FlatAppearance.MouseOverBackColor = $(if ($primary) { $ACCENTD } else { $BTNHOV })
    $b.FlatAppearance.MouseDownBackColor = $CARD2
    $b.BackColor = $(if ($primary) { $ACCENTD } else { $BTN })
    $b.ForeColor = $(if ($primary) { $ACCENT } else { $TXT1 })
    $b.Font = F 9
    $b.Cursor = [Windows.Forms.Cursors]::Hand
    return $b
}

function New-Card([int]$x, [int]$y, [int]$w, [int]$h) {
    $p = New-Object Windows.Forms.Panel
    $p.Location = New-Object Drawing.Point($x, $y)
    $p.Size = New-Object Drawing.Size($w, $h)
    $p.BackColor = $CARD
    # 玻璃层次：圆角 + 1px 浅描边，靠下方的浅灰背景衬托卡片浮起。
    # WinForms 的 Panel 没有原生投影，用圆角描边表达层次比造阴影更轻。
    $p.Add_Paint({
        param($s, $e)
        $g = $e.Graphics
        $g.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
        $w = $s.Width - 1
        $h = $s.Height - 1
        $r = 12
        $path = New-Object Drawing.Drawing2D.GraphicsPath
        $path.AddArc(0, 0, $r, $r, 180, 90)
        $path.AddArc($w - $r, 0, $r, $r, 270, 90)
        $path.AddArc($w - $r, $h - $r, $r, $r, 0, 90)
        $path.AddArc(0, $h - $r, $r, $r, 90, 90)
        $path.CloseFigure()
        $pen = New-Object Drawing.Pen($LINE, 1)
        $g.DrawPath($pen, $path)
        $pen.Dispose()
        $path.Dispose()
    }.GetNewClosure())
    return $p
}

function New-Label([string]$text, [int]$x, [int]$y, [int]$w, [int]$h, [single]$size, [Drawing.Color]$color, [string]$style = 'Regular') {
    $l = New-Object Windows.Forms.Label
    $l.Text = $text
    $l.Location = New-Object Drawing.Point($x, $y)
    $l.Size = New-Object Drawing.Size($w, $h)
    $l.Font = F $size $style
    $l.ForeColor = $color
    $l.BackColor = [Drawing.Color]::Transparent
    $l.AutoEllipsis = $true
    return $l
}

# ---------------------------------------------------------------- 界面

$W = 520
$form = New-Object Windows.Forms.Form
$form.Text = '漫客工作台 · 服务控制台'
# 用系统标题栏，不用无边框 + 自绘。
#
# 无边框窗口会让 DWM 走不同的合成路径，虚拟显示驱动（向日葵 OrayIddDriver、
# GameViewer 等）在这条路径上会把窗口内容画成纯色块 —— 实测 DrawToBitmap
# 离屏渲染完全正常，屏幕上却是蓝色方块，因为问题出在合成而不是绘制。
# 用系统标题栏就没有这个分支，代价是标题栏跟着系统主题走。
$form.FormBorderStyle = 'FixedSingle'
$form.StartPosition = 'CenterScreen'
$form.BackColor = $BG
$form.Font = F 9
$form.KeyPreview = $true
$form.ShowInTaskbar = $true

# 暂停布局直到所有控件加完。不这么做，每加一个控件都会触发一次重排与
# 重绘，用户会看到窗口从空白逐渐长出来 —— 视频里那些蓝色块就是控件
# 外框先画、文字还没渲染时的中间状态。
# 表单也要双缓冲，否则整窗重绘时子控件会逐个闪一下

$form.SuspendLayout()

$iconPath = Join-Path $BD 'assets\branding\app-icon.ico'
if (Test-Path $iconPath) { try { $form.Icon = New-Object Drawing.Icon($iconPath) } catch { } }

# ── 自绘标题栏
$bar = New-Object Windows.Forms.Panel
$bar.Location = New-Object Drawing.Point(0, 0)
$bar.Size = New-Object Drawing.Size($W, 44)
# 系统标题栏已提供关闭/最小化，这个自绘条不再显示。
# 保留控件本身是为了不拆已经有的事件绑定。
$bar.BackColor = $BG
# $form.Controls.Add($bar)

if (Test-Path $iconPath) {
    try {
        $ico = New-Object Drawing.Icon($iconPath)
        $pic = New-Object Windows.Forms.PictureBox
        $pic.Image = $ico.ToBitmap()
        $pic.Location = New-Object Drawing.Point(20, 14)
        $pic.Size = New-Object Drawing.Size(16, 16)
        $pic.SizeMode = 'StretchImage'
        $pic.BackColor = [Drawing.Color]::Transparent
        $bar.Controls.Add($pic)
    } catch { }
}

$barTitle = New-Label '漫客工作台' 46 13 200 20 9.5 $TXT2
$bar.Controls.Add($barTitle)

$closeBtn = New-Object Windows.Forms.Button
$closeBtn.Text = '✕'
$closeBtn.Location = New-Object Drawing.Point(($W - 44), 0)
$closeBtn.Size = New-Object Drawing.Size(44, 44)
$closeBtn.FlatStyle = 'Flat'
    $closeBtn.UseVisualStyleBackColor = $false
$closeBtn.FlatAppearance.BorderSize = 0
$closeBtn.FlatAppearance.MouseOverBackColor = $BAD
$closeBtn.BackColor = $BG
$closeBtn.ForeColor = $TXT2
$closeBtn.Font = F 10
$closeBtn.Cursor = [Windows.Forms.Cursors]::Hand
$bar.Controls.Add($closeBtn)

$minBtn = New-Object Windows.Forms.Button
$minBtn.Text = '—'
$minBtn.Location = New-Object Drawing.Point(($W - 88), 0)
$minBtn.Size = New-Object Drawing.Size(44, 44)
$minBtn.FlatStyle = 'Flat'
    $minBtn.UseVisualStyleBackColor = $false
$minBtn.FlatAppearance.BorderSize = 0
$minBtn.FlatAppearance.MouseOverBackColor = $BTNHOV
$minBtn.BackColor = $BG
$minBtn.ForeColor = $TXT2
$minBtn.Font = F 10
$minBtn.Cursor = [Windows.Forms.Cursors]::Hand
$bar.Controls.Add($minBtn)

$drag = @{ Active = $false; X = 0; Y = 0 }
$onDown = {
    param($s, $e)
    if ($e.Button -eq [Windows.Forms.MouseButtons]::Left) { $drag.Active = $true; $drag.X = $e.X; $drag.Y = $e.Y }
}
$onMove = {
    param($s, $e)
    if ($drag.Active) { $form.Left += ($e.X - $drag.X); $form.Top += ($e.Y - $drag.Y) }
}
$onUp = { param($s, $e) $drag.Active = $false }

foreach ($ctl in @($bar, $barTitle)) {
    $ctl.Add_MouseDown($onDown)
    $ctl.Add_MouseMove($onMove)
    $ctl.Add_MouseUp($onUp)
}

# ── 页头
$y = 24   # 原本 62 是给自绘标题栏留的 44px，现在用系统标题栏
$form.Controls.Add((New-Label '服务控制台' 20 $y 300 30 16 $TXT1 'Bold'))
$form.Controls.Add((New-Label '本机运行，不随开机启动；需要时在这里手动启停。' 20 ($y + 34) 460 20 9 $TXT3))
$y += 70

# ── 服务卡片
# 每个服务一个忙标志，防止启动/停止重入
$script:busy = @{}
$rows = @{}

foreach ($svc in $SERVICES) {
    $svcCard = New-Card 20 $y 480 84
    $form.Controls.Add($svcCard)

    $dot = New-Object Windows.Forms.Panel
    $dot.Location = New-Object Drawing.Point(18, 26)
    $dot.Size = New-Object Drawing.Size(10, 10)
    $dot.BackColor = $CARD   # 与卡片同色，看起来就是透明的
    $dot.Add_Paint({
        param($s, $e)
        $e.Graphics.SmoothingMode = 'AntiAlias'
        $br = New-Object Drawing.SolidBrush($s.ForeColor)
        $e.Graphics.FillEllipse($br, 0, 0, 9, 9)
        $br.Dispose()
    }.GetNewClosure())
    $dot.ForeColor = $TXT3
    $svcCard.Controls.Add($dot)

    $svcCard.Controls.Add((New-Label $svc.Name 36 14 160 22 11 $TXT1 'Bold'))
    $svcCard.Controls.Add((New-Label ("端口 {0} · {1}" -f $svc.Port, $svc.Desc) 36 40 220 18 8.5 $TXT3))

    $status = New-Label '—' 250 18 130 20 9 $TXT3
    $status.TextAlign = 'MiddleRight'
    $svcCard.Controls.Add($status)

    $act = New-Button '启动' 396 26 66 32
    $act.Tag = $svc
    $svcCard.Controls.Add($act)

    $rows[$svc.Key] = [pscustomobject]@{ Svc = $svc; Dot = $dot; Status = $status; Act = $act; PortOpen = $false }
    $health[$svc.Key] = @{ Task = $null; Ok = $false }
    $y += 92
}

# ── 全局操作
$y += 4
$startAll = New-Button '全部启动' 20 $y 110 34 $true
$form.Controls.Add($startAll)

$stopAll = New-Button '全部停止' 138 $y 110 34
$form.Controls.Add($stopAll)

$refreshBtn = New-Button '刷新' 256 $y 84 34
$form.Controls.Add($refreshBtn)

$openBtn = New-Button '打开工作台' 348 $y 152 34
$form.Controls.Add($openBtn)

# ── 一键部署
# 新机器上最费时的是「把那 200 GB 装到该去的地方」。部署包自带分卷和目录结构，
# 这里只负责把解压交给 deploy-bundle.mjs，并把输出实时打进日志。
$y += 44
$deployBtn = New-Button '一键部署' 20 $y 100 34 $false
$form.Controls.Add($deployBtn)

$deployInspectBtn = New-Button '检查部署包' 128 $y 100 34 $false
$form.Controls.Add($deployInspectBtn)

# 换机器时 ComfyUI 可能装在任意盘上，启动前得能指定它在哪
$pickComfyBtn = New-Button 'ComfyUI 位置' 236 $y 108 34 $false
$form.Controls.Add($pickComfyBtn)

$deployHint = New-Label '分卷放 deploy\ 下' 352 $y 148 34 8.5 $TXT3
$deployHint.TextAlign = 'MiddleLeft'
$form.Controls.Add($deployHint)

# ── 工作台更新
# 工作台会持续加功能。更新走 GitHub tarball，不依赖 git，
# 也不重下 210 GB 的部署包。实现在 src/core/update/ 里，
# 这里只负责调脚本并把结果打进日志。
#
# 三个按钮分工：
#   检查更新    只查远程有没有新版，不动文件
#   更新工作台  下载代码并重建，失败自动回滚
#   补齐依赖    新版需要新模型/节点包时才用，体积大，必须手动点
$y += 44
$updateCheckBtn = New-Button '检查更新' 20 $y 100 34 $false
$form.Controls.Add($updateCheckBtn)

$updateApplyBtn = New-Button '更新工作台' 128 $y 100 34 $false
$form.Controls.Add($updateApplyBtn)

$syncDepsBtn = New-Button '补齐依赖' 236 $y 100 34 $false
$form.Controls.Add($syncDepsBtn)

$updateHint = New-Label '只更新代码，不动 data\ 里的作品' 344 $y 156 34 8.5 $TXT3
$updateHint.TextAlign = 'MiddleLeft'
$form.Controls.Add($updateHint)

# ── 环境自检
$y += 52
$form.Controls.Add((New-Label '环境自检' 20 $y 130 22 10.5 $TXT1 'Bold'))

# 换机器部署时最常问的就是「这些文件从哪儿下」，给一个直达文档的入口
$depDocBtn = New-Button '依赖清单' 152 ($y - 4) 76 30 $false
$depDocBtn.Add_Click({
    $doc = Join-Path $BD 'docs\DEPENDENCIES.md'
    if (Test-Path $doc) {
        Start-Process $doc
        Add-Log '已打开依赖清单 docs\DEPENDENCIES.md'
    } else {
        Add-Log '✗ 找不到 docs\DEPENDENCIES.md'
    }
})
$form.Controls.Add($depDocBtn)

$envSummary = New-Label '尚未检查' 232 $y 178 22 9 $TXT3
$envSummary.TextAlign = 'MiddleRight'
$form.Controls.Add($envSummary)

$checkBtn = New-Button '检查' 412 ($y - 4) 88 30 $true
$form.Controls.Add($checkBtn)

$y += 30
$envPanel = New-Object Windows.Forms.Panel
$envPanel.Location = New-Object Drawing.Point(20, $y)
$envPanel.Size = New-Object Drawing.Size(480, 190)
$envPanel.BackColor = $CARD
$envPanel.AutoScroll = $true
$envPanel.Add_Paint({
    param($s, $e)
    $pen = New-Object Drawing.Pen($LINE, 1)
    $e.Graphics.DrawRectangle($pen, 0, 0, $s.Width - 1, $s.Height - 1)
    $pen.Dispose()
}.GetNewClosure())
$form.Controls.Add($envPanel)

$envPanel.Controls.Add((New-Label '点「检查」看看模板依赖的模型、节点包、构建产物是否就位。' 14 14 440 20 9 $TXT3))

# ── 运行日志
$y += 206
$form.Controls.Add((New-Label '运行日志' 20 $y 200 22 10.5 $TXT1 'Bold'))

$openLogsBtn = New-Button '打开日志目录' 286 ($y - 4) 116 30
$form.Controls.Add($openLogsBtn)

# 出问题时让用户一键拿到可发出去的报告，而不是让他自己翻日志目录找关键行
$diagBtn = New-Button '生成诊断报告' 410 ($y - 4) 128 30
$form.Controls.Add($diagBtn)

$y += 30
$logBox = New-Object Windows.Forms.TextBox
$logBox.Location = New-Object Drawing.Point(20, $y)
$logBox.Size = New-Object Drawing.Size(480, 104)
$logBox.Multiline = $true
$logBox.ReadOnly = $true
$logBox.ScrollBars = 'Vertical'
    $logBox.BorderStyle = 'None'   # 浅色主题下系统边框太硬，靠卡片描边分层
$logBox.BackColor = $CARD2
$logBox.ForeColor = $TXT2
$logBox.Font = New-Object Drawing.Font($FONTFACE, 8.5)
$form.Controls.Add($logBox)

$y += 116
$form.ClientSize = New-Object Drawing.Size($W, ($y + 16))

# ---------------------------------------------------------------- 行为

$script:closing = $false

function Add-Log([string]$Message) {
    if ($script:closing) { return }
    $stamp = Get-Date -Format 'HH:mm:ss'
    $logBox.AppendText("[$stamp] $Message`r`n")
    $logBox.SelectionStart = $logBox.TextLength
    $logBox.ScrollToCaret()
    # 同时写文件：GUI 里日志滚没了就查不到，出问题时得有地方翻。
    try {
        $dir = Join-Path $BD 'data\logs'
        if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
        $file = Join-Path $dir ('console-' + (Get-Date -Format 'yyyyMMdd') + '.log')
        Add-Content -Path $file -Value "[$stamp] $Message" -Encoding UTF8
    } catch {
        # 日志写不进去不该影响控制台本身
    }
}

function Set-RowState($Row, [string]$State) {
    switch ($State) {
        'running' {
            $Row.Dot.ForeColor = $OK
            $Row.Status.Text = '运行中'
            $Row.Status.ForeColor = $OK
            $Row.Act.Text = '停止'
            $Row.Act.BackColor = $BTN
            $Row.Act.ForeColor = $TXT1
            $Row.Act.FlatAppearance.BorderColor = $LINE
        }
        'starting' {
            $Row.Dot.ForeColor = $WARN
            $Row.Status.Text = '启动中…'
            $Row.Status.ForeColor = $WARN
            $Row.Act.Text = '停止'
            $Row.Act.BackColor = $BTN
            $Row.Act.ForeColor = $TXT1
            $Row.Act.FlatAppearance.BorderColor = $LINE
        }
        default {
            $Row.Dot.ForeColor = $TXT3
            $Row.Status.Text = '已停止'
            $Row.Status.ForeColor = $TXT3
            $Row.Act.Text = '启动'
            $Row.Act.BackColor = $ACCENTD
            $Row.Act.ForeColor = $ACCENT
            $Row.Act.FlatAppearance.BorderColor = $ACCENTL
        }
    }
}

# 全程不阻塞：端口探测 ≤120ms，HTTP 结果从上一个 tick 的 task 里取。
#
# 状态必须由「上次已知结果」($health[key].Ok) 驱动，不能由「这一 tick 有没有
# 拿到新结果」驱动。Poll-Health 取到结果后会清空 task，若按「没结果就显示
# 启动中」来写，界面会在 运行中 ↔ 启动中 之间每个 tick 跳一次。
function Update-Status {
    if ($script:closing) { return }
    foreach ($key in $rows.Keys) {
        $row = $rows[$key]
        $svc = $row.Svc
        $st = $health[$key]
        $open = Test-PortOpen $svc.Port
        $row.PortOpen = $open

        if (-not $open) {
            # 服务没起来：丢掉在飞的请求，并把已知状态复位 —— 否则下次起来时
            # 会沿用上一轮的「运行中」直接显示绿灯
            $st.Task = $null
            $st.Ok = $false
            Set-RowState $row 'stopped'
            continue
        }

        # 有新结果就更新已知状态；没有就沿用上一次的
        $result = Poll-Health $key
        if ($result -ne $null) { $st.Ok = $result }

        if ($st.Ok) { Set-RowState $row 'running' }
        else { Set-RowState $row 'starting' }

        # 没有在飞的探测就补一个，结果下个 tick 取
        if (-not $st.Task) { Start-Health $key $svc.Url }
    }
}

function Start-One($svc) {
    if (Test-PortOpen $svc.Port) {
        Add-Log "$($svc.Name) 已在运行，跳过。"
        return
    }

    # 立刻切到「启动中」，让用户看到点击生效了。
    # 之前只有 Start-ScheduledTask 一行，端口起来之前界面一直显示「已停止」，
    # 看起来就像按钮没反应 —— ComfyUI 要 30-90 秒才监听端口。
    $row = $rows[$svc.Key]
    if ($row) { Set-RowState $row 'starting' }
    $row.Act.Enabled = $false
    $row.Act.Refresh()
    if ($form) { $form.Update() }

    $startAt = Get-Date
    Add-Log "启动 $($svc.Name)（计划任务 $($svc.Task)）…"

    # 停掉自动刷新定时器。它每 2 秒跑一次 Update-Status，
    # 而下面等待循环里的 DoEvents() 会让它插进来 —— 端口还没开时
    # 它会把状态刷回「已停止」，盖住我们刚设的「启动中」。
    # 等完了再恢复。
    $timerWasRunning = $false
    if ($timer) {
        $timerWasRunning = $timer.Enabled
        if ($timerWasRunning) { $timer.Stop() }
    }
    try {
        Start-ScheduledTask -TaskName $svc.Task -ErrorAction Stop
    } catch {
            # 任务不见了（重装、手动删过、或换了安装位置）。
            # 别直接把错误甩给用户 —— 先尝试按当前配置重建一次任务，
            # 建好了就直接重试启动。
            Add-Log "计划任务 $($svc.Task) 不存在，按当前配置重建…"
            $recreated = $false
            try {
                $recreated = New-ServiceTask $svc
            } catch {
                Add-Log ("  重建出错：" + $_.Exception.Message)
            }
        
            if ($recreated) {
                try {
                    Start-ScheduledTask -TaskName $svc.Task -ErrorAction Stop
                    Add-Log "  ✓ 任务已重建并启动"
                } catch {
                    Add-Log "  ✗ 重建后仍无法启动：$($_.Exception.Message)"
                    if ($row) { Set-RowState $row 'stopped' }
                    if ($row) { $row.Act.Enabled = $true }
                    return
                }
            } else {
                Add-Log "  ✗ 无法重建任务：$($svc.Task)"
                Add-Log "    启动包装器或路径缺失。点「ComfyUI 位置」重新指定后再试。"
                if ($row) { Set-RowState $row 'stopped' }
                if ($row) { $row.Act.Enabled = $true }
                return
            }
        }

    # 等端口真正监听。每 500ms 探一次，最多等 ReadySeconds * 2。
    # 期间保持「启动中」状态，界面上能看出是在等而不是死了。
    $deadline = [DateTime]::Now.AddSeconds($svc.ReadySeconds * 2)
    $opened = $false
    $ticks = 0
    while ([DateTime]::Now -lt $deadline) {
        $ticks++
        if (Test-PortOpen $svc.Port) {
            Add-Log "$($svc.Name) 端口在第 $ticks 次探测时打开"
            $opened = $true
            break
        }
        Start-Sleep -Milliseconds 500
        # 让 WinForms 有机会重绘，否则界面在等待期间完全冻结
        if ($form) { [Windows.Forms.Application]::DoEvents() }
    }
    if (-not $opened) { Add-Log "  已探测 $ticks 次仍未打开端口" }

    if ($row) { $row.Act.Enabled = $true }

    if ($opened) {
        Add-Log "$($svc.Name) 端口 $($svc.Port) 已监听，等待就绪检查…"
        # 端口开了但服务未必能响应（ComfyUI 加载模型要时间）。
        # 这里再等健康检查通过，过程中保持「启动中」。
        $healthOk = $false
        $hDeadline = [DateTime]::Now.AddSeconds($svc.ReadySeconds * 2)
        while ([DateTime]::Now -lt $hDeadline) {
            try {
                $probe = Invoke-WebRequest -Uri $svc.Url -TimeoutSec 3 -UseBasicParsing -ErrorAction Stop
                if ($probe.StatusCode -ge 200 -and $probe.StatusCode -lt 400) { $healthOk = $true; break }
            } catch {
                # 还没准备好，继续等
            }
            Start-Sleep -Milliseconds 700
            if ($form) { [Windows.Forms.Application]::DoEvents() }
        }
        if ($healthOk) {
            Add-Log "$($svc.Name) 已就绪。"
            # 关键：把结果写回全局状态表。不写的话 Update-Status 拿到的还是
            # 上一次的 false，界面会一直停在「启动中…」。
            $st = $health[$svc.Key]
            if ($st) { $st.Ok = $true; $st.Task = $null }
            if ($row) { Set-RowState $row 'running' }
        } else {
            Add-Log "⚠ $($svc.Name) 端口已开但 HTTP 无响应，可能还在加载模型。"
            Add-Log '  界面会保持「启动中」，稍等再点「刷新」。'
        }
    } else {
        Add-Log "✗ $($svc.Name) 在 $($svc.ReadySeconds * 2) 秒内没有监听端口 $($svc.Port)。"
        Add-Log '  查日志：data\logs\ 下对应的 .log 文件。'
        $st = $health[$svc.Key]
        if ($st) { $st.Ok = $false; $st.Task = $null }
        if ($row) { Set-RowState $row 'stopped' }
    }

    Update-Status
}

function Stop-One($svc) {
    if (-not (Test-PortOpen $svc.Port)) { Add-Log "$($svc.Name) 已停止，跳过。"; return }
    Add-Log "停止 $($svc.Name)…"
    Stop-ScheduledTask -TaskName $svc.Task -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 500
    # 任务的子进程不随任务结束而退出，按端口占用者清理。
    if (Stop-ServiceProcess $svc.Port) { Add-Log "已结束占用端口 $($svc.Port) 的进程。" }
    for ($i = 0; $i -lt 8; $i++) {
        if (-not (Test-PortOpen $svc.Port)) { break }
        Start-Sleep -Milliseconds 400
        if ($i -eq 3) { Stop-ServiceProcess $svc.Port | Out-Null }
    }
    if (Test-PortOpen $svc.Port) { Add-Log "⚠ $($svc.Name) 端口仍被占用，可再点一次停止。" }
    else { Add-Log "$($svc.Name) 已停止。" }
}

function Toggle-One($svc) {
    # 防重入：启动过程要等 30-90 秒，这期间用户可能又点一次，
    # 或者界面重绘误触发。不加锁的话会变成「启动 → 立刻停止」，
    # 日志里表现为服务刚就绪就被停掉。
    if ($script:busy -and $script:busy.ContainsKey($svc.Key) -and $script:busy[$svc.Key]) {
        Add-Log "$($svc.Name) 正在处理中，请稍候…"
        return
    }
    if (-not $script:busy) { $script:busy = @{} }
    $script:busy[$svc.Key] = $true
    try {
        if (Test-PortOpen $svc.Port) { Stop-One $svc } else { Start-One $svc }
    } finally {
        $script:busy[$svc.Key] = $false
    }
}

foreach ($key in $rows.Keys) {
    $row = $rows[$key]
    $row.Act.Add_Click({ Toggle-One $this.Tag; Update-Status }.GetNewClosure())
}

$startAll.Add_Click({
    # 全部启动要串行等 60-180 秒，期间按钮必须禁用 ——
    # 否则用户以为没反应会再点，第二次点击看到端口已开就转去停止。
    $this.Enabled = $false
    $this.Text = '启动中'
    $this.Refresh()
    try {
        foreach ($key in $rows.Keys) {
            $svc = $rows[$key].Svc
            if (Test-PortOpen $svc.Port) {
                Add-Log "$($svc.Name) 已在运行，跳过。"
                continue
            }
            Start-One $svc
        }
        Update-Status
    } finally {
        $this.Enabled = $true
        $this.Text = '全部启动'
    }
}.GetNewClosure())

$stopAll.Add_Click({
    $this.Enabled = $false
    $this.Text = '停止中'
    $this.Refresh()
    try {
        foreach ($key in $rows.Keys) { Stop-One $rows[$key].Svc }
        Update-Status
    } finally {
        $this.Enabled = $true
        $this.Text = '全部停止'
    }
}.GetNewClosure())

$refreshBtn.Add_Click({ Update-Status; Add-Log '状态已刷新。' }.GetNewClosure())

# ── 工作台位置
# 控制台安装包只有 25 MB，不含工作台源码；用户机器上的完整工作台可能在别处。
# 自检和更新都必须作用在「真正在跑的那个工作台」上，所以统一在这里解析。
#
# 顺序：
#   1. 计划任务 BD-Workbench 的工作目录 —— 启动工作台就用它，最可信
#   2. 安装目录本身（如果里面有 package.json）
#   3. 几个常见位置兜底
$script:workbenchRoot = $null

function Resolve-WorkbenchRoot {
    if ($script:workbenchRoot) { return $script:workbenchRoot }

    $task = Get-ScheduledTask -TaskName 'BD-Workbench' -ErrorAction SilentlyContinue
    if ($task -and $task.Actions.Count -gt 0 -and $task.Actions[0].WorkingDirectory) {
        $cand = $task.Actions[0].WorkingDirectory.Trim('"')
        if (Test-Path (Join-Path $cand 'package.json')) {
            $script:workbenchRoot = $cand
            return $script:workbenchRoot
        }
    }

    if (Test-Path (Join-Path $BD 'package.json')) {
        $script:workbenchRoot = $BD
        return $script:workbenchRoot
    }

    foreach ($guess in @(
        (Join-Path $env:USERPROFILE 'Desktop\ComfyUI无线画布'),
        'C:\Users\Administrator\Desktop\ComfyUI无线画布',
        'D:\manke\workbench'
    )) {
        if (Test-Path (Join-Path $guess 'package.json')) {
            $script:workbenchRoot = $guess
            return $script:workbenchRoot
        }
    }

    return $null
}

# ── 部署：检查 / 解压
# 部署包默认放 deploy\，也可以在「检查部署包」里选目录。
$script:deployBundleDir = Join-Path $BD 'deploy'

function Get-DeployJson {
    param([string]$BundleDir)
    $script = Join-Path $BD 'scripts\deploy-bundle.mjs'
    if (-not (Test-Path $script)) {
        $script:deployLastError = "找不到 $script"
        return $null
    }
    # 部署包目录不存在时也要说清楚，别让调用方只看到「检查失败」
    if ($BundleDir -and -not (Test-Path $BundleDir)) {
        $script:deployLastError = "部署包目录不存在：$BundleDir"
        return $null
    }
    try {
        # node 的 JSON 是多行输出，PowerShell 会把它拆成字符串数组。
        # ConvertFrom-Json 逐行解析会失败，必须先 join 回一整块。
        $raw = & node $script --bundle $BundleDir --json 2>&1
        $text = ($raw | Out-String).Trim()
        if (-not $text.StartsWith('{')) {
            $script:deployLastError = "脚本输出异常：" + $text.Substring(0, [Math]::Min(120, $text.Length))
            return $null
        }
        $script:deployLastError = $null
        return $text | ConvertFrom-Json
    } catch {
        $script:deployLastError = $_.Exception.Message
        return $null
    }
}

$deployInspectBtn.Add_Click({
    $data = Get-DeployJson $script:deployBundleDir
    if (-not $data) {
        Add-Log ("✗ 检查失败：" + $(if ($script:deployLastError) { $script:deployLastError } else { '未知原因' }))
        return
    }
    if (-not $data.sevenZip) {
        Add-Log '✗ 未安装 7-Zip（解压需要），https://www.7-zip.org/'
        return
    }

    # 新格式：一个档案流切成若干卷，manke-bundle.7z.001 …
    $vol = $data.volumes
    if (-not $vol -or $vol.count -eq 0) {
        Add-Log "✗ $($script:deployBundleDir) 下没有 $($data.archiveBase).7z.001"
        if ($data.legacyBundles -and $data.legacyBundles.Count -gt 0) {
            Add-Log "  ⚠ 发现旧格式的包：$($data.legacyBundles -join '、')"
            Add-Log '    旧包已不再支持，请下载新的一键部署包。'
        }
        Add-Log '  点「检查部署包」可以重新选目录。'
        $dlg = New-Object Windows.Forms.FolderBrowserDialog
        $dlg.Description = "选择包含 $($data.archiveBase).7z.001 的目录"
        if ($dlg.ShowDialog() -eq 'OK') {
            $script:deployBundleDir = $dlg.SelectedPath
            Add-Log "部署包目录已设为 $($script:deployBundleDir)"
        }
        return
    }

    $gb = [math]::Round($vol.bytes / 1GB, 1)
    $state = if ($vol.complete) { '完整' } else { "缺第 $($vol.missing -join ',') 卷" }
    Add-Log "  分卷：$($vol.count) 个 · $gb GB —— $state"
    Add-Log "  解压到：$($data.target)"

    if ($data.freeBytes -ne $null) {
        $freeGb = [math]::Round($data.freeBytes / 1GB, 1)
        $needGb = [math]::Round($vol.bytes / 1GB, 1)
        if ($data.freeBytes -le $vol.bytes * 1.05) {
            Add-Log "  ✗ 目标盘只剩 $freeGb GB，解压需要 $needGb GB"
            Add-Log '    换一个空间足够的盘，或点「一键部署」时指定位置。'
        } else {
            Add-Log "  ✓ 目标盘剩余 $freeGb GB，够用"
        }
    }

    if ($vol.complete -and ($data.freeBytes -eq $null -or $data.freeBytes -gt $vol.bytes * 1.05)) {
        Add-Log '部署包齐全，可以点「一键部署」。'
    }
}.GetNewClosure())

# 选择 ComfyUI 位置
# 换一台机器，ComfyUI 可能装在 D 盘、G 盘或者部署包解出来的 manke\ComfyUI 下，
# 写死路径的话启动按钮必然失败。这里扫一遍所有固定硬盘找出像 ComfyUI 的目录，
# 让用户直接选，选完写进 data\comfyui.config.json。
$pickComfyBtn.Add_Click({
    try {
        Add-Log '▶ 选择 ComfyUI 位置'

        # 先扫描，找到就列出来让用户选；扫不到直接开文件夹对话框。
        # 注意：不用自定义 Form + ShowDialog —— 在事件处理器里创建模态窗体
        # 容易被 GetNewClosure 捕获后失去窗口句柄，表现就是「点了没反应」。
        # 这里全部走系统的 FolderBrowserDialog / InputBox，最稳。
        $candidates = @()
        foreach ($drv in [System.IO.DriveInfo]::GetDrives()) {
            if (-not $drv.IsReady) { continue }
            if ($drv.DriveType -ne [System.IO.DriveType]::Fixed) { continue }
            $roots = @(
                $drv.Name,
                (Join-Path $drv.Name 'ComfyUI'),
                (Join-Path $drv.Name 'manke'),
                (Join-Path $drv.Name 'AI'),
                (Join-Path $drv.Name 'Programs')
            )
            foreach ($r in $roots) {
                if (-not (Test-Path $r)) { continue }
                if (Test-Path (Join-Path $r 'python_embeded\python.exe')) {
                    $candidates += $r
                }
                Get-ChildItem $r -Directory -ErrorAction SilentlyContinue | ForEach-Object {
                    if (Test-Path (Join-Path $_.FullName 'python_embeded\python.exe')) {
                        $candidates += $_.FullName
                    }
                    if (Test-Path (Join-Path $_.FullName 'ComfyUI\python_embeded\python.exe')) {
                        $candidates += (Join-Path $_.FullName 'ComfyUI')
                    }
                }
            }
        }
        $candidates = @($candidates | Sort-Object -Unique)
        Add-Log "  扫描到 $($candidates.Count) 个 ComfyUI"

        $root = $null
        if ($candidates.Count -gt 0) {
            foreach ($c in $candidates) { Add-Log "    · $c" }
            # 只有一个就直接用，多个则列出编号让用户在日志里确认第一个
            if ($candidates.Count -eq 1) {
                $root = $candidates[0]
                Add-Log "  只有一个候选，直接用：$root"
            } else {
                $root = $candidates[0]
                Add-Log "  默认用第一个：$root"
                Add-Log '  要换的话再点一次本按钮，然后手动指定。'
            }
        }

        # 无论扫没扫到，都允许手动指定
        $dlg = New-Object Windows.Forms.FolderBrowserDialog
        $dlg.Description = '选择 ComfyUI 安装目录（里面应有 python_embeded\python.exe）'
        $dlg.ShowNewFolderButton = $false
        if ($root -and (Test-Path $root)) { $dlg.SelectedPath = $root }
        Add-Log '  请在弹出的窗口里确认或另选目录…'
        if ($dlg.ShowDialog() -ne 'OK') {
            if ($root) {
                Add-Log "  已取消选择，沿用扫描结果：$root"
            } else {
                Add-Log '已取消。'
                return
            }
        } else {
            $root = $dlg.SelectedPath
        }

        $pyPath = Join-Path $root 'python_embeded\python.exe'
        $mainPath = Join-Path $root 'main.py'
        $layout = 'bundle'
        if (-not (Test-Path $mainPath)) {
            $altMain = Join-Path $root 'ComfyUI\main.py'
            if (Test-Path $altMain) { $mainPath = $altMain; $layout = 'nested' }
        }
        if (-not (Test-Path $pyPath)) {
            Add-Log "✗ $root 下没有 python_embeded\python.exe"
            Add-Log '  请选 ComfyUI 的根目录（含 python_embeded 和 ComfyUI 两个子目录）。'
            return
        }

        $cfgPath = Join-Path $BD 'data\comfyui.config.json'
        $cfg = @{}
        if (Test-Path $cfgPath) {
            try { $cfg = Get-Content $cfgPath -Raw -Encoding UTF8 | ConvertFrom-Json -AsHashtable } catch { $cfg = @{} }
        }
        $cfg['pythonPath'] = $pyPath
        if (-not $cfg['baseUrl']) { $cfg['baseUrl'] = 'http://127.0.0.1:8188' }
        if (-not $cfg['workflowDir']) { $cfg['workflowDir'] = 'comfyui/workflows' }
        $cfg | ConvertTo-Json -Depth 6 | Set-Content $cfgPath -Encoding UTF8

        # 工作台读它自己目录下的 data/comfyui.config.json。只写控制台这份的话，
        # 新机器上控制台看着配置好了，工作台却还在用默认路径，生成直接失败。
        $wbRoot = Resolve-WorkbenchRoot
        $writtenTo = @($cfgPath)
        if ($wbRoot -and $wbRoot -ne $BD) {
            $wbCfgDir = Join-Path $wbRoot 'data'
            if (Test-Path $wbCfgDir) {
                $wbCfg = Join-Path $wbCfgDir 'comfyui.config.json'
                $cfg | ConvertTo-Json -Depth 6 | Set-Content $wbCfg -Encoding UTF8
                $writtenTo += $wbCfg
            }
        }

        Add-Log "✓ ComfyUI 位置已设为 $root"
        Add-Log "  python: $pyPath"
        Add-Log "  main:   $mainPath $(if (Test-Path $mainPath) { '' } else { '（缺失！）' })"
        Add-Log '  已写入 data\comfyui.config.json，启动时用这个位置。'
        Update-Status
    } catch {
        Add-Log "✗ 选择位置失败：$($_.Exception.Message)"
        Add-Log "   位置：$($_.InvocationInfo.ScriptLineNumber) 行"
    }
}.GetNewClosure())

# 检查更新：只查不动，告诉用户有没有新版本
$updateCheckBtn.Add_Click({
    try {
        Add-Log '▶ 检查工作台更新'
        $script = Join-Path $BD 'scripts\check-update.mjs'
        if (-not (Test-Path $script)) {
            Add-Log '✗ 缺少 scripts\check-update.mjs'
            return
        }
        $nodeExe = Join-Path $BD 'node\node.exe'
        if (-not (Test-Path $nodeExe)) { $nodeExe = 'node' }

        $raw = & cmd /c "`"$nodeExe`" `"$script`" --root `"$script:workbenchRoot`" 2>&1"
        $text = ($raw | Out-String).Trim()
        foreach ($line in ($text -split "`r?`n")) {
            if ($line.Trim()) { Add-Log ('  ' + $line.Trim()) }
        }
    } catch {
        Add-Log "✗ 检查更新失败：$($_.Exception.Message)"
    }
}.GetNewClosure())

# 更新工作台：下载 tarball → 覆盖代码 → pnpm install → pnpm build
# 失败会自动回滚，见 src/core/update/workbench-update.ts
$updateApplyBtn.Add_Click({
    try {
        Add-Log '▶ 更新工作台'
        $script = Join-Path $BD 'scripts\apply-update.mjs'
        if (-not (Test-Path $script)) {
            Add-Log '✗ 缺少 scripts\apply-update.mjs'
            return
        }
        $nodeExe = Join-Path $BD 'node\node.exe'
        if (-not (Test-Path $nodeExe)) { $nodeExe = 'node' }

        Add-Log '  将下载最新代码并重新构建；data\ 里的作品不动，失败自动回滚。'

        $updateApplyBtn.Enabled = $false
        $updateApplyBtn.Text = '更新中'
        $updateApplyBtn.Refresh()

        # 异步执行。原本这里是 & cmd /c 同步等待 apply-update.mjs ——
        # 它内部要跑 pnpm install + pnpm build，一分钟起步、CPU 全程占满，
        # 期间 WinForms 消息泵完全停止，窗口被系统标成「未响应」，
        # 用户只能强制关闭，而关闭会把进行中的构建留在半截状态。
        $logDir = Join-Path $BD 'data\logs'
        if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Force -Path $logDir | Out-Null }
        $script:updateOut = Join-Path $logDir 'update-out.txt'
        $script:updateErr = Join-Path $logDir 'update-err.txt'
        Remove-Item $script:updateOut, $script:updateErr -Force -ErrorAction SilentlyContinue
        $script:updateDeadline = (Get-Date).AddMinutes(30)

        Add-Log '  正在下载并构建，约 1~2 分钟，窗口保持可操作…'

        # 解析工作台目录。
        # $script:workbenchRoot 初值是 $null，只有 Resolve-WorkbenchRoot 会填；
        # 但那个函数在 .GetNewClosure() 闭包里调用不到（返回空）。
        # 直接拿未初始化的变量拼 -ArgumentList 会因数组含 $null 报参数验证失败。
        $wbTarget = $null
        $wbTask = Get-ScheduledTask -TaskName 'BD-Workbench' -ErrorAction SilentlyContinue
        if ($wbTask -and $wbTask.Actions.Count -gt 0 -and $wbTask.Actions[0].WorkingDirectory) {
            $wbCand = $wbTask.Actions[0].WorkingDirectory.Trim('"')
            if (Test-Path (Join-Path $wbCand 'package.json')) { $wbTarget = $wbCand }
        }
        if (-not $wbTarget -and (Test-Path (Join-Path $BD 'package.json'))) { $wbTarget = $BD }
        if (-not $wbTarget) {
            foreach ($wbGuess in @(
                (Join-Path $env:USERPROFILE 'Desktop\ComfyUI无线画布'),
                'C:\Users\Administrator\Desktop\ComfyUI无线画布',
                'D:\manke\workbench'
            )) {
                if (Test-Path (Join-Path $wbGuess 'package.json')) { $wbTarget = $wbGuess; break }
            }
        }
        if (-not $wbTarget) {
            Add-Log 'X 找不到工作台目录，先点「打开工作台」确认位置。'
            $updateApplyBtn.Enabled = $true
            $updateApplyBtn.Text = '更新工作台'
            return
        }
        Add-Log ("  目标：" + $wbTarget)
        Set-Content -Path (Join-Path $logDir '.update-running') -Value (Get-Date -Format 'o') -Encoding UTF8

        $script:updateProc = Start-Process -FilePath $nodeExe `
            -ArgumentList @($script, '--root', $wbTarget) `
            -WorkingDirectory $wbTarget `
            -WindowStyle Hidden -PassThru `
            -RedirectStandardOutput $script:updateOut `
            -RedirectStandardError $script:updateErr
    } catch {
        Add-Log "✗ 更新失败：$($_.Exception.Message)"
    } finally {
        $updateApplyBtn.Enabled = $true
        $updateApplyBtn.Text = '更新工作台'
        Update-Status
    }
}.GetNewClosure())

# 补齐依赖：新版工作台可能需要新模型或节点包
#
# 为什么不跟「更新工作台」合并：
#   代码 12 MB，30 秒。模型 200 GB，6 小时。
#   合在一起会让「更新代码」这个动作变得不可用 ——
#   用户可能磁盘不够、只需要图片功能、或者在流量计费网络上。
#   所以拆成独立按钮，由用户决定什么时候下。
$syncDepsBtn.Add_Click({
    try {
        Add-Log '▶ 检查依赖'
        $script = Join-Path $BD 'scripts\sync-deps.mjs'
        if (-not (Test-Path $script)) {
            Add-Log '✗ 缺少 scripts\sync-deps.mjs'
            return
        }
        $nodeExe = Join-Path $BD 'node\node.exe'
        if (-not (Test-Path $nodeExe)) { $nodeExe = 'node' }
        $wbRoot = Resolve-WorkbenchRoot
        if (-not $wbRoot) {
            Add-Log '✗ 找不到工作台目录'
            return
        }

        # 先只查，把结果打进日志
        $raw = & cmd /c "`"$nodeExe`" `"$script`" --root `"$wbRoot`" --check 2>&1"
        $text = ($raw | Out-String).Trim()
        foreach ($line in ($text -split "`r?`n")) {
            if ($line.Trim()) { Add-Log ('  ' + $line.Trim()) }
        }

        if ($text -match '依赖齐全' -or -not ($text -match '缺 \d+ 个')) {
            Add-Log '依赖齐全，不用补齐。'
            return
        }

        # 有缺失 → 问用户要不要下载
        Add-Log '  将检查并下载缺失的模型/节点包，体积可能很大。'

        Add-Log '开始补齐依赖，进度看日志…'
        $syncDepsBtn.Enabled = $false
        $syncDepsBtn.Text = '补齐中'
        $syncDepsBtn.Refresh()

        $raw2 = & cmd /c "`"$nodeExe`" `"$script`" --root `"$wbRoot`" --sync 2>&1"
        $text2 = ($raw2 | Out-String).Trim()
        foreach ($line in ($text2 -split "`r?`n")) {
            if ($line.Trim()) { Add-Log ('  ' + $line.Trim()) }
        }
        Add-Log '依赖处理结束。'
    } catch {
        Add-Log "✗ 补齐依赖失败：$($_.Exception.Message)"
    } finally {
        $syncDepsBtn.Enabled = $true
        $syncDepsBtn.Text = '补齐依赖'
        Update-Status
    }
}.GetNewClosure())

$deployBtn.Add_Click({
  try {
    Add-Log '▶ 一键部署：开始'
    $data = Get-DeployJson $script:deployBundleDir
    if (-not $data) {
        Add-Log ("✗ " + $(if ($script:deployLastError) { $script:deployLastError } else { '检查失败' }))
        return
    }
    if (-not $data.sevenZip) { Add-Log '✗ 未安装 7-Zip'; return }

    # 找不到分卷时不要让用户自己回去点「检查部署包」——
    # 直接问「部署包在哪」，选完继续，不用重新点一次。
    if (-not $data.volumes -or -not $data.volumes.complete) {
        Add-Log "  默认目录 $($script:deployBundleDir) 里没有完整的分卷"
        Add-Log '  请选择存放 manke-bundle.7z.001 … 的目录'
        $dlg = New-Object Windows.Forms.FolderBrowserDialog
        $dlg.Description = "选择存放 $($data.archiveBase).7z.001 … 的目录"
        $dlg.ShowNewFolderButton = $false
        if ($dlg.ShowDialog() -ne 'OK') { Add-Log '已取消。'; return }

        $script:deployBundleDir = $dlg.SelectedPath
        Add-Log "部署包目录：$($script:deployBundleDir)"
        $data = Get-DeployJson $script:deployBundleDir
        if (-not $data -or -not $data.volumes -or -not $data.volumes.complete) {
            $state = if ($data -and $data.volumes.count -gt 0) { "缺第 $($data.volumes.missing -join ',') 卷" } else { '没有分卷' }
            Add-Log "✗ 这个目录也不行：$state"
            return
        }
    }

    $needBytes = $data.volumes.bytes
    $needGb = [math]::Round($needBytes / 1GB, 1)

    # ── 选盘：列出所有固定硬盘，标出空间够不够
    # 文件夹选择框看不出「这个盘还剩多少」，而解压要 211 GB，
    # 选错盘会在解压到一半时失败，白等半小时。所以直接列盘 + 算余量。
    $drives = @()
    foreach ($d in [System.IO.DriveInfo]::GetDrives()) {
        if (-not $d.IsReady) { continue }
        if ($d.DriveType -ne [System.IO.DriveType]::Fixed) { continue }
        $free = $d.AvailableFreeSpace
        $drives += [PSCustomObject]@{
            Root  = $d.Name
            Free  = $free
            Total = $d.TotalSize
            Ok    = ($free -gt $needBytes * 1.05)
        }
    }
    $drives = $drives | Sort-Object -Property @{ Expression = 'Ok'; Descending = $true }, @{ Expression = 'Free'; Descending = $true }

    if ($drives.Count -eq 0) {
        Add-Log '✗ 没有可用的固定硬盘'
        return
    }

    # 构建选盘窗口
    $pick = New-Object Windows.Forms.Form
    $pick.Text = '选择解压位置'
    $pick.Size = New-Object Drawing.Size(520, 400)
    $pick.StartPosition = 'CenterParent'
    $pick.FormBorderStyle = 'FixedDialog'
    $pick.MaximizeBox = $false
    $pick.MinimizeBox = $false
    $pick.BackColor = $BG
    $pick.Font = New-Object Drawing.Font('Microsoft YaHei UI', 9)

    $tip = New-Label "解压需要约 $needGb GB。绿点表示空间够，灰点不够。" 18 14 470 22 9 $TXT2
    $pick.Controls.Add($tip)

    $list = New-Object Windows.Forms.ListBox
    $list.Location = New-Object Drawing.Point(18, 42)
    $list.Size = New-Object Drawing.Size(468, 240)
    $list.BorderStyle = 'FixedSingle'
    $list.Font = New-Object Drawing.Font('Microsoft YaHei UI', 9.5)
    $pick.Controls.Add($list)

    $pickOk = New-Button '开始解压' 268 296 110 34 $true
    $pickCancel = New-Button '取消' 388 296 98 34 $false
    $pick.Controls.Add($pickOk)
    $pick.Controls.Add($pickCancel)

    $script:pickResult = $null
    $pickOk.Add_Click({
        if ($list.SelectedIndex -ge 0) {
            $script:pickResult = $drives[$list.SelectedIndex].Root
            $pick.Close()
        }
    }.GetNewClosure())
    $pickCancel.Add_Click({ $pick.Close() }.GetNewClosure())

    foreach ($d in $drives) {
        $mark = if ($d.Ok) { '●' } else { '○' }
        $freeGb = [math]::Round($d.Free / 1GB, 1)
        $totalGb = [math]::Round($d.Total / 1GB, 0)
        $suffix = if ($d.Ok) { '可以' } else { "不够（差 $([math]::Round(($needBytes - $d.Free)/1GB)) GB）" }
        $null = $list.Items.Add("$mark  $($d.Root)   可用 $freeGb / $totalGb GB   —— $suffix")
        if ($d.Ok -and $list.SelectedIndex -lt 0) { $list.SelectedIndex = $list.Items.Count - 1 }
    }

    $pick.ShowDialog() | Out-Null
    if (-not $script:pickResult) { Add-Log '已取消部署。'; return }
    $target = $script:pickResult

    Add-Log "解压到：$target\manke"
    Add-Log '  将解压部署包到选定目录，耗时较长，中途不要关闭窗口。'

    Add-Log "开始部署（$needGb GB）→ $target"
    Add-Log '进度看下方日志，完成前不要关闭窗口…'
    $deployBtn.Enabled = $false
    $deployBtn.Text = '部署中'
    $deployBtn.Refresh()

    try {
        $script = Join-Path $BD 'scripts\deploy-bundle.mjs'
        & node $script --bundle $script:deployBundleDir --deploy --to $target 2>&1 | ForEach-Object {
            if ($_ -and $_.ToString().Trim()) { Add-Log $_.ToString().Trim() }
        }
        Add-Log ''
        Add-Log "ComfyUI 在：$target\manke\ComfyUI"
        Add-Log "工作台在：$target\manke\workbench"
        Add-Log '下一步：cd 到工作台目录，跑 pnpm install 和 pnpm build。'
    } catch {
        Add-Log "✗ 部署失败：$($_.Exception.Message)"
    } finally {
        $deployBtn.Enabled = $true
        $deployBtn.Text = '一键部署'
        Update-Status
    }
  } catch {
    Add-Log "✗ 部署按钮异常：$($_.Exception.Message)"
    Add-Log "   位置：$($_.InvocationInfo.ScriptLineNumber) 行"
    $deployBtn.Enabled = $true
    $deployBtn.Text = '一键部署'
  }
}.GetNewClosure())

$openBtn.Add_Click({
    Start-Process 'http://127.0.0.1:3020'
    Add-Log '已在浏览器打开 http://127.0.0.1:3020'
}.GetNewClosure())

$openLogsBtn.Add_Click({
    $logs = Join-Path $BD 'data\logs'
    if (-not (Test-Path $logs)) { New-Item -ItemType Directory -Force -Path $logs | Out-Null }
    Start-Process explorer.exe $logs
    Add-Log "已打开日志目录：$logs"
}.GetNewClosure())

$diagBtn.Add_Click({
    try {
        $diagScript = Join-Path $BD 'scripts\make-diagnostic.mjs'
        if (-not (Test-Path $diagScript)) {
            Add-Log 'X 缺少 scripts\make-diagnostic.mjs'
            return
        }
        $nodeExe = Join-Path $BD 'node\node.exe'
        if (-not (Test-Path $nodeExe)) { $nodeExe = 'node' }

        $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
        $outDir = [Environment]::GetFolderPath('Desktop')
        if (-not (Test-Path $outDir)) { $outDir = $env:USERPROFILE }
        $outFile = Join-Path $outDir "漫客诊断-$stamp.md"

        $root = Resolve-WorkbenchRoot
        if (-not $root) { $root = $BD }
        $env:BEATDESIGN_ROOT = $root

        $logDir = Join-Path $BD 'data\logs'
        if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Force -Path $logDir | Out-Null }
        $stdout = Join-Path $logDir 'diag-out.txt'
        $stderr = Join-Path $logDir 'diag-err.txt'
        Remove-Item $stdout, $stderr -Force -ErrorAction SilentlyContinue

        # 绝不能用 -Wait。
        #
        # 这个按钮跑在 WinForms 的消息泵里。Start-Process -NoNewWindow -Wait
        # 会同步等待子进程，期间不处理任何消息 —— 窗口立刻变成「未响应」，
        # 用户只能强制关掉。诊断脚本正好是最慢的操作：它要跑 powershell
        # 查显卡、查磁盘、查计划任务，还要跑一次完整的环境自检，几十秒起步。
        #
        # 改成 fire-and-forget，然后用已有那个 2 秒 Timer 轮询结果。
        $script:diagOutFile = $outFile
        $script:diagStdout = $stdout
        $script:diagStderr = $stderr
        $script:diagStarted = Get-Date
        $script:diagDeadline = (Get-Date).AddMinutes(5)
        $script:diagFailStreak = 0

        Add-Log '> 正在收集诊断信息（约 30 秒）…'
        $diagBtn.Enabled = $false
        $diagBtn.Text = '收集中…'

        Start-Process -FilePath $nodeExe `
            -ArgumentList @($diagScript, '--out', $outFile) `
            -WorkingDirectory $root `
            -WindowStyle Hidden `
            -RedirectStandardOutput $stdout `
            -RedirectStandardError $stderr | Out-Null
    } catch {
        Add-Log ("X 生成诊断报告失败：" + $_.Exception.Message)
        $diagBtn.Enabled = $true
        $diagBtn.Text = '生成诊断报告'
    }
}.GetNewClosure())

# 环境自检
#
# 走 --json 而不是文本输出：node 输出 UTF-8，GUI 进程的控制台代码页是 936，
# 直接捕获会乱码；cmd 重定向到文件再按 UTF-8 读，与代码页无关。
function Render-Env([string]$json) {
    $envPanel.Controls.Clear()
    $y0 = 12

    if (-not $json.TrimStart().StartsWith('{')) {
        $envPanel.Controls.Add((New-Label '自检没有返回 JSON，看日志里的原始输出。' 14 $y0 440 20 9 $BAD))
        $envSummary.Text = '检查失败'
        $envSummary.ForeColor = $BAD
        return
    }

    $data = $json | ConvertFrom-Json
    $toneMap = @{ 'pass' = $OK; 'warn' = $WARN; 'fail' = $BAD }
    $mark = @{ 'pass' = '✓'; 'warn' = '!'; 'fail' = '✕' }

    foreach ($chk in $data.checks) {
        $envPanel.Controls.Add((New-Label $mark[$chk.status] 14 $y0 18 20 9.5 $toneMap[$chk.status] 'Bold'))
        $envPanel.Controls.Add((New-Label $chk.label 34 $y0 118 20 8.5 $TXT3))
        $envPanel.Controls.Add((New-Label $chk.detail 156 $y0 306 20 8.5 $TXT2))
        $y0 += 22

        if ($chk.hint -and $chk.status -ne 'pass') {
            $envPanel.Controls.Add((New-Label ('→ ' + $chk.hint) 34 $y0 428 20 8 $TXT3))
            $y0 += 20
        }

        # 缺东西时把下载渠道列出来：换机器部署照着点就行，不用再翻文档
        if ($chk.sources -and $chk.status -ne 'pass') {
            foreach ($src in $chk.sources) {
                if (-not $src.url) { continue }
                $cover = ''
                if ($src.covers -and $src.covers.Count -gt 0) {
                    $cover = ($src.covers | Select-Object -First 3) -join '、'
                    if ($src.covers.Count -gt 3) { $cover += ' …' }
                }
                $line = "   [$($src.kind)] $($src.url)"
                $envPanel.Controls.Add((New-Label $line 46 $y0 416 20 7.5 $TXT3))
                $y0 += 18
                if ($cover) {
                    $envPanel.Controls.Add((New-Label ('        ↳ ' + $cover) 46 $y0 416 18 7.5 $TXT3))
                    $y0 += 16
                }
            }
        }
    }

    $s = $data.summary
    $envSummary.Text = "通过 $($s.pass) · 警告 $($s.warn) · 失败 $($s.fail)"
    $envSummary.ForeColor = $(if ($data.ok) { $OK } else { $WARN })
}

$checkBtn.Add_Click({
    $this.Enabled = $false
    $this.Text = '检查中'
    $this.Refresh()

    $checkScript = Join-Path $BD 'scripts\check-environment.mjs'
    if (-not (Test-Path $checkScript)) {
        Add-Log '✗ 缺少 scripts\check-environment.mjs，无法自检。'
    } else {
        Add-Log '环境自检开始…'

        # 刚点过「启动」时 ComfyUI 要 30-90 秒才监听 8188，
        # 立刻自检会误报「无响应」——进程明明在起，看结果却像是坏了。
        # 先等端口，最多 90 秒；等不到也继续检查，让用户看到真实状态。
        if (-not (Test-Port 8188)) {
            $pyProcs = @(Get-CimInstance Win32_Process -Filter "Name='python.exe'" -ErrorAction SilentlyContinue)
            if ($pyProcs.Count -gt 0) {
                Add-Log '  ComfyUI 正在启动，等它就绪（最多 90 秒）…'
                for ($w = 0; $w -lt 30; $w++) {
                    Start-Sleep -Seconds 3
                    if (Test-Port 8188) { Add-Log "  ComfyUI 已就绪（等了 $(($w + 1) * 3) 秒）"; break }
                }
                if (-not (Test-Port 8188)) { Add-Log '  ✗ 90 秒内没起来，继续检查其余项' }
            }
        }

        $tmp = [IO.Path]::GetTempFileName()
        try {
            # 用安装包自带的 node，不依赖系统 PATH
            $nodeExe = Join-Path $BD 'node\node.exe'
            if (-not (Test-Path $nodeExe)) { $nodeExe = 'node' }

            $wbRoot = Resolve-WorkbenchRoot
            if ($wbRoot) { Add-Log "  检查的工作台：$wbRoot" }

            $rootArg = if ($wbRoot) { " --root `"$wbRoot`"" } else { '' }
            & cmd /c "`"$nodeExe`" `"$checkScript`" --json$rootArg > `"$tmp`" 2>&1"
            $text = [IO.File]::ReadAllText($tmp, [Text.Encoding]::UTF8)
            Render-Env $text

            if ($text.TrimStart().StartsWith('{')) {
                $d = $text | ConvertFrom-Json
                $s = $d.summary
                Add-Log ("完成：通过 $($s.pass)  警告 $($s.warn)  失败 $($s.fail)  →  " +
                    $(if ($d.ok) { '可以开工' } else { '先处理失败项' }))
            } else {
                foreach ($l in ($text -split "`r?`n")) { if ($l.Trim()) { Add-Log ('   ' + $l.TrimEnd()) } }
            }
        } catch {
            Add-Log ('✗ 自检出错：' + $_.Exception.Message)
        } finally {
            Remove-Item $tmp -Force -ErrorAction SilentlyContinue
        }
    }

    $this.Text = '检查'
    $this.Enabled = $true
}.GetNewClosure())

# 每 2 秒刷新一次；成本只有端口探测（≤120ms ×2），HTTP 走异步。
$timer = New-Object Windows.Forms.Timer
$timer.Interval = 2000
$timer.Add_Tick({
    Update-Status

    # 诊断报告的异步收尾。
    # 按钮只负责启动进程，结果在这里轮询 —— 主线程要一直能响应消息，
    # 否则窗口会显示「未响应」。
    if ($script:diagOutFile) {
        $done = Test-Path $script:diagOutFile
        $timedOut = (Get-Date) -gt $script:diagDeadline

        if ($done) {
            $size = [math]::Round((Get-Item $script:diagOutFile).Length / 1KB, 0)
            Add-Log "OK 诊断报告已生成（$size KB）"
            Add-Log "  $($script:diagOutFile)"
            Add-Log '  把它整份发给 AI，并说明你遇到的现象。'
            Start-Process explorer.exe "/select,`"$($script:diagOutFile)`""
            $script:diagOutFile = $null
            $diagBtn.Enabled = $true
            $diagBtn.Text = '生成诊断报告'
        } elseif ($timedOut) {
            Add-Log 'X 诊断报告超时（5 分钟）。'
            if (Test-Path $script:diagStderr) {
                Get-Content $script:diagStderr -Tail 5 -ErrorAction SilentlyContinue |
                    ForEach-Object { Add-Log "  $_" }
            }
            $script:diagOutFile = $null
            $diagBtn.Enabled = $true
            $diagBtn.Text = '生成诊断报告'
        }
    }


    # 更新工作台收尾。只看文件不看进程：
    # Start-Process -PassThru 的对象在闭包里可能已失效。
    $updDir = Join-Path $BD 'data\logs'
    $updMark = Join-Path $updDir '.update-running'
    if (Test-Path $updMark) {
        $updOut = Join-Path $updDir 'update-out.txt'
        $idleSec = 999
        if (Test-Path $updOut) {
            $idleSec = ((Get-Date) - (Get-Item $updOut).LastWriteTime).TotalSeconds
        }
        $elapsedMin = ((Get-Date) - (Get-Item $updMark).LastWriteTime).TotalMinutes
        if ($idleSec -gt 20 -or $elapsedMin -gt 30) {
            if (Test-Path $updOut) {
                Get-Content $updOut -Encoding UTF8 -ErrorAction SilentlyContinue |
                    Where-Object { $_.Trim() } |
                    ForEach-Object { Add-Log ('  ' + $_.Trim()) }
            }
            $tailText = ''
            if (Test-Path $updOut) {
                $tailText = ((Get-Content $updOut -Encoding UTF8 -Tail 4 -ErrorAction SilentlyContinue) -join ' ')
            }
            if ($elapsedMin -gt 30) {
                Add-Log 'X 更新超时（30 分钟）。'
            } elseif ($tailText -match '更新完成') {
                Add-Log '更新流程结束。要生效请点「全部停止」再「全部启动」。'
            } else {
                Add-Log 'X 更新未完成，原因见上面的输出。'
            }
            Remove-Item $updMark -Force -ErrorAction SilentlyContinue
            $updateApplyBtn.Enabled = $true
            $updateApplyBtn.Text = '更新工作台'
        }
    }
})
$timer.Start()

$closeBtn.Add_Click({ $form.Close() }.GetNewClosure())
$minBtn.Add_Click({ $form.WindowState = 'Minimized' }.GetNewClosure())

$form.Add_FormClosing({
    $script:closing = $true
    $timer.Stop()
}.GetNewClosure())

$form.Add_Shown({
    Add-Log '就绪。服务不随开机启动，需要时点「全部启动」。'

    # 首次启动时把计划任务改成隐藏窗口启动。
    # 老版本任务直接跑 cmd.exe，每次启动都弹黑窗口 —— 用户会以为出问题了。
    # 幂等：已经改过的不再动。
    try {
        $repaired = Repair-TaskWindows
        if ($repaired -and $repaired.Count -gt 0) {
            Add-Log ("已修正计划任务的弹窗问题：" + ($repaired -join '、'))
            Add-Log '  改为后台隐藏启动，以后不会再闪窗口。'
        }
    } catch {
        # 异常必须说出来。之前这里全静默，导致「修复没生效」和
        # 「不需要修复」在界面上完全一样，排查时毫无线索。
        Add-Log ("计划任务修复失败：" + $_.Exception.Message)
        Add-Log "  位置：$($_.InvocationInfo.ScriptLineNumber) 行"
    }

    # 修完之后再确认一次：任务指向 wscript 但 VBS 不存在 = 一定起不来。
    # 这种状态比弹窗严重得多，必须让用户看到。
    foreach ($svc in $SERVICES) {
        $wrapper = if ($svc.Key -eq 'comfyui') { 'comfyui' } else { 'workbench' }
        $vbs = Join-Path $BD "launcher\run-$wrapper.vbs"
        $task = Get-ScheduledTask -TaskName $svc.Task -ErrorAction SilentlyContinue
        if (-not $task -or $task.Actions.Count -eq 0) { continue }
        $isWscript = $task.Actions[0].Execute -and $task.Actions[0].Execute.ToLower().EndsWith('wscript.exe')
        if ($isWscript -and -not (Test-Path $vbs)) {
            # 只在真的起不来时提示。Repair-TaskWindow 自己会在文件存在时
            # 直接返回（L144），这里再调一次没有意义，反而因为调用时序
            # 产生误报 —— 更新过程中 launcher 被覆盖的那一瞬间正好读不到文件。
            # 改成延迟确认：等一秒再判断，避免和更新写入撞车。
            # 不在这里同步等待 —— Add_Shown 跑在窗口绘制之前，sleep
            # 会让界面卡成一片色块。后台等 1.2 秒再判断并写日志。
            $chkPath = $vbs
            $chkName = $svc.Name
            $chkLog = ${function:Add-Log}
            $null = [System.Threading.Tasks.Task]::Run([Action]{
                Start-Sleep -Milliseconds 1200
                if (-not (Test-Path $chkPath)) {
                    & $chkLog ("X " + $chkName + " 的启动包装器缺失：" + $chkPath)
                    & $chkLog '  点「全部启动」会一直卡在启动中。重装控制台即可（作品不受影响）。'
                }
            })
        }
    }

    Update-Status
    # 换新机器时设 BD_CHECK_ON_START=1，开窗即自检。
    if ($env:BD_CHECK_ON_START -eq '1') { $checkBtn.PerformClick() }
})

$form.Add_KeyDown({
    param($s, $e)
    if ($e.KeyCode -eq 'Escape') { $form.Close() }
}.GetNewClosure())

# 一次性完成布局和绘制，再交给消息循环
$form.ResumeLayout($true)

[void]$form.ShowDialog()

$timer.Stop()
try { $httpClient.Dispose() } catch { }
$form.Dispose()