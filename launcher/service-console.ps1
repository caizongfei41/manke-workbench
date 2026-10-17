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
# 界面沿用工作台的深色配色（--beat-bg / --beat-surface / --beat-accent），
# 无系统标题栏，自绘标题栏以便整体保持深色。

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

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
$CARD2   = C '#1A1B1F'   # 次级面（输入框 / 日志）
$LINE    = C '#26272B'   # 描边
$TXT1    = C '#F4F4F5'
$TXT2    = C '#A3A3AB'
$TXT3    = C '#71717A'
$ACCENT  = C '#38BDF8'
$ACCENTD = C '#12242E'   # 强调色的深底
$ACCENTL = C '#1E4C63'
$OK      = C '#34D399'
$WARN    = C '#FBBF24'
$BAD     = C '#F87171'
$BTN     = C '#1C1D21'
$BTNHOV  = C '#26272C'

$FONT     = 'Microsoft YaHei UI'
function F([single]$size, [string]$style = 'Regular') {
    return New-Object Drawing.Font($FONT, $size, [Drawing.FontStyle]::$style)
}

# ---------------------------------------------------------------- 配置

$BD = $PSScriptRoot | Split-Path -Parent

$SERVICES = @(
    [pscustomobject]@{
        Key = 'comfyui';  Name = 'ComfyUI';  Task = 'BD-ComfyUI';  Port = 8188
        Url = 'http://127.0.0.1:8188/system_stats'; UrlLabel = 'ComfyUI'
        ReadySeconds = 90; Desc = '本地推理后端'
    },
    [pscustomobject]@{
        Key = 'workbench'; Name = '工作台';  Task = 'BD-Workbench'; Port = 3020
        Url = 'http://127.0.0.1:3020/zh'; UrlLabel = '工作台'
        ReadySeconds = 30; Desc = '网页界面'
    }
)

# ---------------------------------------------------------------- 工具函数

function Test-PortOpen([int]$Port) {
    $client = New-Object Net.Sockets.TcpClient
    try { $client.Connect('127.0.0.1', $Port); $client.Close(); return $true }
    catch { return $false }
    finally { if ($client) { $client.Dispose() } }
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

# 统一风格的按钮
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

# 卡片：纯色面板 + 1px 描边
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
$closeBtn.BackColor = $BG
$closeBtn.ForeColor = $TXT2
$closeBtn.Font = F 10
$closeBtn.Cursor = [Windows.Forms.Cursors]::Hand
$closeBtn.Add_Click({ $form.Close() }.GetNewClosure())
$bar.Controls.Add($closeBtn)

$minBtn = New-Object Windows.Forms.Button
$minBtn.Text = '—'
$minBtn.Location = New-Object Drawing.Point(($W - 88), 0)
$minBtn.Size = New-Object Drawing.Size(44, 44)
$minBtn.FlatStyle = 'Flat'
$minBtn.FlatAppearance.BorderSize = 0
$minBtn.BackColor = $BG
$minBtn.ForeColor = $TXT2
$minBtn.Font = F 10
$minBtn.Cursor = [Windows.Forms.Cursors]::Hand
$minBtn.Add_Click({ $form.WindowState = 'Minimized' }.GetNewClosure())
$bar.Controls.Add($minBtn)

# 拖动窗口
$drag = @{ Active = $false; X = 0; Y = 0 }
$onDown = {
    param($s, $e)
    if ($e.Button -eq [Windows.Forms.MouseButtons]::Left) {
        $drag.Active = $true
        $drag.X = $e.X
        $drag.Y = $e.Y
    }
}
$onMove = {
    param($s, $e)
    if ($drag.Active) {
        $form.Left += ($e.X - $drag.X)
        $form.Top += ($e.Y - $drag.Y)
    }
}
$onUp = { param($s, $e) $drag.Active = $false }

foreach ($c in @($bar, $barTitle)) {
    $c.Add_MouseDown($onDown)
    $c.Add_MouseMove($onMove)
    $c.Add_MouseUp($onUp)
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

    # 状态圆点（自绘）
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

    $rows[$svc.Key] = [pscustomobject]@{ Svc = $svc; Dot = $dot; Status = $status; Act = $act }
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

# ── 环境自检
$y += 52
$form.Controls.Add((New-Label '环境自检' 20 $y 200 22 10.5 $TXT1 'Bold'))
$envSummary = New-Label '尚未检查' 200 $y 210 22 9 $TXT3
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

$envHint = New-Label '点「检查」看看模板依赖的模型、节点包、构建产物是否就位。' 14 14 440 20 9 $TXT3
$envPanel.Controls.Add($envHint)

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
$logBox.Font = New-Object Drawing.Font('Microsoft YaHei UI', 8.5)
$form.Controls.Add($logBox)

$y += 132
$form.ClientSize = New-Object Drawing.Size($W, ($y + 16))

# ---------------------------------------------------------------- 行为

function Add-Log([string]$Message) {
    $stamp = Get-Date -Format 'HH:mm:ss'
    $logBox.AppendText("[$stamp] $Message`r`n")
    $logBox.SelectionStart = $logBox.TextLength
    $logBox.ScrollToCaret()
    [Windows.Forms.Application]::DoEvents()
}

function Update-Status {
    foreach ($key in $rows.Keys) {
        $row = $rows[$key]
        $svc = $row.Svc
        $open = Test-PortOpen $svc.Port

        if ($open) {
            $healthy = $true
            if ($svc.Url) {
                try { Invoke-WebRequest $svc.Url -TimeoutSec 4 -UseBasicParsing | Out-Null }
                catch { $healthy = $false }
            }
            if ($healthy) {
                $row.Dot.ForeColor = $OK
                $row.Status.Text = '运行中'
                $row.Status.ForeColor = $OK
                $row.Act.Text = '停止'
                $row.Act.BackColor = $BTN
                $row.Act.ForeColor = $TXT1
                $row.Act.FlatAppearance.BorderColor = $LINE
            } else {
                $row.Dot.ForeColor = $WARN
                $row.Status.Text = '启动中…'
                $row.Status.ForeColor = $WARN
                $row.Act.Text = '停止'
                $row.Act.BackColor = $BTN
                $row.Act.ForeColor = $TXT1
                $row.Act.FlatAppearance.BorderColor = $LINE
            }
        } else {
            $row.Dot.ForeColor = $TXT3
            $row.Status.Text = '已停止'
            $row.Status.ForeColor = $TXT3
            $row.Act.Text = '启动'
            $row.Act.BackColor = $ACCENTD
            $row.Act.ForeColor = $ACCENT
            $row.Act.FlatAppearance.BorderColor = $ACCENTL
        }
    }
    [Windows.Forms.Application]::DoEvents()
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
    Start-Sleep -Milliseconds 600
    # 任务的子进程不随任务结束而退出，按端口占用者清理。
    if (Stop-ServiceProcess $svc.Port) { Add-Log "已结束占用端口 $($svc.Port) 的进程。" }
    for ($i = 0; $i -lt 10; $i++) {
        if (-not (Test-PortOpen $svc.Port)) { break }
        Start-Sleep -Milliseconds 500
        if ($i -eq 4) { Stop-ServiceProcess $svc.Port | Out-Null }
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
# 走 --json 而不是文本输出，有两个原因：
#   1) node 输出 UTF-8，GUI 进程的控制台代码页是 936，直接捕获会乱码 ——
#      cmd 重定向到文件再按 UTF-8 读，与代码页无关；
#   2) 文本输出靠空格对齐，字体一变就错位，JSON 由这里排版更稳。
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
    $color = @{ 'pass' = $OK; 'warn' = $WARN; 'fail' = $BAD }
    $mark = @{ 'pass' = '✓'; 'warn' = '!'; 'fail' = '✕' }

    foreach ($chk in $data.checks) {
        $m = New-Label $mark[$chk.status] 14 $y0 18 20 9.5 $color[$chk.status] 'Bold'
        $envPanel.Controls.Add($m)

        $envPanel.Controls.Add((New-Label $chk.label 34 $y0 118 20 8.5 $TXT3))
        $envPanel.Controls.Add((New-Label $chk.detail 156 $y0 306 20 8.5 $TXT2))
        $y0 += 22

        if ($chk.hint -and $chk.status -ne 'pass') {
            $envPanel.Controls.Add((New-Label ('→ ' + $chk.hint) 34 $y0 428 20 8 $TXT3))
            $y0 += 20
        }
    }

    $s = $data.summary
    $envSummary.Text = "通过 $($s.pass) · 警告 $($s.warn) · 失败 $($s.fail)"
    $envSummary.ForeColor = $(if ($data.ok) { $OK } else { $WARN })
    [Windows.Forms.Application]::DoEvents()
}

$checkBtn.Add_Click({
    $this.Enabled = $false
    $this.Text = '检查中'
    [Windows.Forms.Application]::DoEvents()

    $script = Join-Path $BD 'scripts\check-environment.mjs'
    if (-not (Test-Path $script)) {
        Add-Log '✗ 缺少 scripts\check-environment.mjs，无法自检。'
    } else {
        Add-Log '环境自检开始…'
        $tmp = [IO.Path]::GetTempFileName()
        try {
            & cmd /c "node `"$script`" --json > `"$tmp`" 2>&1"
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

# 每 3 秒自动刷新状态
$timer = New-Object Windows.Forms.Timer
$timer.Interval = 3000
$timer.Add_Tick({ Update-Status })
$timer.Start()

$form.Add_Shown({
    Add-Log '就绪。服务不随开机启动，需要时点「全部启动」。'
    Update-Status
    # 换新机器时设 BD_CHECK_ON_START=1，开窗即自检。
    if ($env:BD_CHECK_ON_START -eq '1') { $checkBtn.PerformClick() }
})

# Esc 关闭
$form.Add_KeyDown({
    param($s, $e)
    if ($e.KeyCode -eq 'Escape') { $form.Close() }
}.GetNewClosure())

[void]$form.ShowDialog()

$timer.Stop()
$form.Dispose()
