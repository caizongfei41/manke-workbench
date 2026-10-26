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

$BG      = C '#09090A'   # 窗口底
$CARD    = C '#131416'   # 卡片底
$CARD2   = C '#1A1B1F'   # 次级面（日志）
$LINE    = C '#26272B'   # 描边
$TXT1    = C '#F4F4F5'
$TXT2    = C '#A3A3AB'
$TXT3    = C '#71717A'
$ACCENT  = C '#38BDF8'
$ACCENTD = C '#12242E'
$ACCENTL = C '#1E4C63'
$OK      = C '#34D399'
$WARN    = C '#FBBF24'
$BAD     = C '#F87171'
$BTN     = C '#1C1D21'
$BTNHOV  = C '#26272C'

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
    $p.Add_Paint({
        param($s, $e)
        $pen = New-Object Drawing.Pen($LINE, 1)
        $e.Graphics.DrawRectangle($pen, 0, 0, $s.Width - 1, $s.Height - 1)
        $pen.Dispose()
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
$form.FormBorderStyle = 'None'
$form.StartPosition = 'CenterScreen'
$form.BackColor = $BG
$form.Font = F 9
$form.KeyPreview = $true
$form.ShowInTaskbar = $true

$iconPath = Join-Path $BD 'assets\branding\app-icon.ico'
if (Test-Path $iconPath) { try { $form.Icon = New-Object Drawing.Icon($iconPath) } catch { } }

# ── 自绘标题栏
$bar = New-Object Windows.Forms.Panel
$bar.Location = New-Object Drawing.Point(0, 0)
$bar.Size = New-Object Drawing.Size($W, 44)
$bar.BackColor = $BG
$form.Controls.Add($bar)

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
$y = 62
$form.Controls.Add((New-Label '服务控制台' 20 $y 300 30 16 $TXT1 'Bold'))
$form.Controls.Add((New-Label '本机运行，不随开机启动；需要时在这里手动启停。' 20 ($y + 34) 460 20 9 $TXT3))
$y += 70

# ── 服务卡片
$rows = @{}

foreach ($svc in $SERVICES) {
    $svcCard = New-Card 20 $y 480 84
    $form.Controls.Add($svcCard)

    $dot = New-Object Windows.Forms.Panel
    $dot.Location = New-Object Drawing.Point(18, 26)
    $dot.Size = New-Object Drawing.Size(10, 10)
    $dot.BackColor = $CARD
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

$deployHint = New-Label '把分卷放 deploy\ 下' 352 $y 148 34 8.5 $TXT3
$deployHint.TextAlign = 'MiddleLeft'
$form.Controls.Add($deployHint)

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

$openLogsBtn = New-Button '打开日志目录' 372 ($y - 4) 128 30
$form.Controls.Add($openLogsBtn)

$y += 30
$logBox = New-Object Windows.Forms.TextBox
$logBox.Location = New-Object Drawing.Point(20, $y)
$logBox.Size = New-Object Drawing.Size(480, 104)
$logBox.Multiline = $true
$logBox.ReadOnly = $true
$logBox.ScrollBars = 'Vertical'
$logBox.BorderStyle = 'FixedSingle'
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
    if (Test-PortOpen $svc.Port) { Add-Log "$($svc.Name) 已在运行，跳过。"; return }
    Add-Log "启动 $($svc.Name)（计划任务 $($svc.Task)）…"
    Start-ScheduledTask -TaskName $svc.Task -ErrorAction SilentlyContinue
    Add-Log "已下发。$($svc.Name) 就绪约需 $($svc.ReadySeconds) 秒。"
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
    if (Test-PortOpen $svc.Port) { Stop-One $svc } else { Start-One $svc }
}

foreach ($key in $rows.Keys) {
    $row = $rows[$key]
    $row.Act.Add_Click({ Toggle-One $this.Tag; Update-Status }.GetNewClosure())
}

$startAll.Add_Click({
    foreach ($key in $rows.Keys) { Start-One $rows[$key].Svc }
    Update-Status
}.GetNewClosure())

$stopAll.Add_Click({
    foreach ($key in $rows.Keys) { Stop-One $rows[$key].Svc }
    Update-Status
}.GetNewClosure())

$refreshBtn.Add_Click({ Update-Status; Add-Log '状态已刷新。' }.GetNewClosure())

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
        $mainPath = Join-Path $root 'ComfyUI\main.py'
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
    $answer = [Windows.Forms.MessageBox]::Show(
        "将解压 $needGb GB 到：`n$target`n`n耗时约 20-40 分钟，中途不要关窗口。继续？",
        '确认部署', 'YesNo', 'Question')
    if ($answer -ne 'Yes') { Add-Log '已取消部署。'; return }

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

            # 自检要查「真正在跑的那个工作台」，而不是这个 25 MB 的安装目录。
            # 优先用计划任务里的工作目录（启动工作台就用它），其次找常见位置。
            $wbRoot = $null
            $task = Get-ScheduledTask -TaskName 'BD-Workbench' -ErrorAction SilentlyContinue
            if ($task -and $task.Actions[0].WorkingDirectory) {
                $cand = $task.Actions[0].WorkingDirectory.Trim('"')
                if (Test-Path (Join-Path $cand 'package.json')) { $wbRoot = $cand }
            }
            if (-not $wbRoot -and (Test-Path (Join-Path $BD 'package.json'))) { $wbRoot = $BD }
            if (-not $wbRoot) {
                foreach ($guess in @(
                    (Join-Path $env:USERPROFILE 'Desktop\ComfyUI无线画布'),
                    'C:\Users\Administrator\Desktop\ComfyUI无线画布'
                )) {
                    if (Test-Path (Join-Path $guess 'package.json')) { $wbRoot = $guess; break }
                }
            }
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
$timer.Add_Tick({ Update-Status })
$timer.Start()

$closeBtn.Add_Click({ $form.Close() }.GetNewClosure())
$minBtn.Add_Click({ $form.WindowState = 'Minimized' }.GetNewClosure())

$form.Add_FormClosing({
    $script:closing = $true
    $timer.Stop()
}.GetNewClosure())

$form.Add_Shown({
    Add-Log '就绪。服务不随开机启动，需要时点「全部启动」。'
    Update-Status
    # 换新机器时设 BD_CHECK_ON_START=1，开窗即自检。
    if ($env:BD_CHECK_ON_START -eq '1') { $checkBtn.PerformClick() }
})

$form.Add_KeyDown({
    param($s, $e)
    if ($e.KeyCode -eq 'Escape') { $form.Close() }
}.GetNewClosure())

[void]$form.ShowDialog()

$timer.Stop()
try { $httpClient.Dispose() } catch { }
$form.Dispose()
