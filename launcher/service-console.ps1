# 漫客工作台 · 服务控制台
#
# 一个桌面小窗口，用来一键启停 ComfyUI 与工作台。
#
# 服务不设开机自启，由本控制台按需启停。启停走计划任务而不是 HTTP 接口：
# 工作台自己没法通过自己的接口启动自己，而 ComfyUI 也常在工作台没起来时就需要
# 单独启动。计划任务在两种情况下都可用。
#
# 停止时要额外杀进程：Stop-ScheduledTask 只结束任务本身，
# 任务里 cmd.exe 拉起的 node / python 子进程会留下来继续占端口。

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$ErrorActionPreference = 'Continue'
[System.Windows.Forms.Application]::EnableVisualStyles()

# ---------------------------------------------------------------- 配置

$BD = $PSScriptRoot | Split-Path -Parent

# 名称、计划任务、端口、探测用的 URL（空则不探测 HTTP）
$SERVICES = @(
    [pscustomobject]@{
        Key = 'comfyui';  Name = 'ComfyUI';  Task = 'BD-ComfyUI';  Port = 8188
        Url = 'http://127.0.0.1:8188/system_stats'; UrlLabel = 'ComfyUI'
        ReadySeconds = 90
    },
    [pscustomobject]@{
        Key = 'workbench'; Name = '工作台';  Task = 'BD-Workbench'; Port = 3020
        Url = 'http://127.0.0.1:3020/zh'; UrlLabel = '工作台'
        ReadySeconds = 30
    }
)

# ---------------------------------------------------------------- 工具函数

function Test-PortOpen([int]$Port) {
    $client = New-Object Net.Sockets.TcpClient
    try {
        $client.Connect('127.0.0.1', $Port)
        $client.Close()
        return $true
    } catch {
        return $false
    } finally {
        if ($client) { $client.Dispose() }
    }
}

function Get-PortOwner([int]$Port) {
    $conn = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if (-not $conn) { return $null }
    return $conn.OwningProcess
}

function Stop-ServiceProcess([int]$Port) {
    # 任务本身先停，再清理它留下的子进程。
    $pid_ = Get-PortOwner $Port
    if ($pid_) {
        # /T 连同子进程一起结束
        & taskkill /PID $pid_ /T /F 2>&1 | Out-Null
        return $true
    }
    return $false
}

# ---------------------------------------------------------------- 界面

$font     = New-Object Drawing.Font('Microsoft YaHei UI', 9)
$fontBold = New-Object Drawing.Font('Microsoft YaHei UI', 10, [Drawing.FontStyle]::Bold)
$fontSmall= New-Object Drawing.Font('Microsoft YaHei UI', 8.5)

$form = New-Object Windows.Forms.Form
$form.Text = '漫客工作台 · 服务控制台'
$form.Size = New-Object Drawing.Size(460, 500)
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedSingle'
$form.MaximizeBox = $false
$form.Font = $font
$form.BackColor = [Drawing.Color]::FromArgb(248, 249, 251)

# 标题
$title = New-Object Windows.Forms.Label
$title.Text = '服务控制台'
$title.Font = $fontBold
$title.Location = New-Object Drawing.Point(18, 14)
$title.Size = New-Object Drawing.Size(220, 22)
$form.Controls.Add($title)

$subtitle = New-Object Windows.Forms.Label
$subtitle.Text = '服务不随开机启动，需要时在这里手动启停。'
$subtitle.Font = $fontSmall
$subtitle.ForeColor = [Drawing.Color]::FromArgb(130, 136, 148)
$subtitle.Location = New-Object Drawing.Point(18, 36)
$subtitle.Size = New-Object Drawing.Size(400, 18)
$form.Controls.Add($subtitle)

# 每个服务一行
$rows = @{}
$y = 68
foreach ($svc in $SERVICES) {
    $nameLabel = New-Object Windows.Forms.Label
    $nameLabel.Text = $svc.Name
    $nameLabel.Font = $font
    $nameLabel.Location = New-Object Drawing.Point(18, ($y + 4))
    $nameLabel.Size = New-Object Drawing.Size(70, 20)
    $form.Controls.Add($nameLabel)

    $portLabel = New-Object Windows.Forms.Label
    $portLabel.Text = "端口 $($svc.Port)"
    $portLabel.Font = $fontSmall
    $portLabel.ForeColor = [Drawing.Color]::FromArgb(140, 146, 158)
    $portLabel.Location = New-Object Drawing.Point(88, ($y + 6))
    $portLabel.Size = New-Object Drawing.Size(64, 18)
    $form.Controls.Add($portLabel)

    # 状态圆点（用一个实心圆角 Label 模拟）
    $dot = New-Object Windows.Forms.Label
    $dot.Text = [char]0x25CF
    $dot.Font = New-Object Drawing.Font('Microsoft YaHei UI', 12)
    $dot.ForeColor = [Drawing.Color]::FromArgb(190, 195, 205)
    $dot.Location = New-Object Drawing.Point(156, ($y + 1))
    $dot.Size = New-Object Drawing.Size(20, 22)
    $form.Controls.Add($dot)

    $statusLabel = New-Object Windows.Forms.Label
    $statusLabel.Text = '—'
    $statusLabel.Font = $fontSmall
    $statusLabel.Location = New-Object Drawing.Point(178, ($y + 6))
    $statusLabel.Size = New-Object Drawing.Size(96, 18)
    $form.Controls.Add($statusLabel)

    $startBtn = New-Object Windows.Forms.Button
    $startBtn.Text = '启动'
    $startBtn.Font = $fontSmall
    $startBtn.Location = New-Object Drawing.Point(280, $y)
    $startBtn.Size = New-Object Drawing.Size(70, 28)
    $startBtn.FlatStyle = 'System'
    $startBtn.Tag = $svc
    $form.Controls.Add($startBtn)

    $stopBtn = New-Object Windows.Forms.Button
    $stopBtn.Text = '停止'
    $stopBtn.Font = $fontSmall
    $stopBtn.Location = New-Object Drawing.Point(358, $y)
    $stopBtn.Size = New-Object Drawing.Size(70, 28)
    $stopBtn.FlatStyle = 'System'
    $stopBtn.Tag = $svc
    $form.Controls.Add($stopBtn)

    $rows[$svc.Key] = [pscustomobject]@{
        Svc = $svc; Dot = $dot; Status = $statusLabel
        Start = $startBtn; Stop = $stopBtn
    }
    $y += 40
}

# 分隔线
$line = New-Object Windows.Forms.Label
$line.BorderStyle = 'Fixed3D'
$line.Location = New-Object Drawing.Point(18, ($y + 4))
$line.Size = New-Object Drawing.Size(400, 1)
$form.Controls.Add($line)

# 全部启停。宽度按标签实际长度分配，否则「打开工作台」会折成两行。
$y += 18
$startAll = New-Object Windows.Forms.Button
$startAll.Text = '全部启动'
$startAll.Location = New-Object Drawing.Point(18, $y)
$startAll.Size = New-Object Drawing.Size(96, 32)
$startAll.FlatStyle = 'System'
$form.Controls.Add($startAll)

$stopAll = New-Object Windows.Forms.Button
$stopAll.Text = '全部停止'
$stopAll.Location = New-Object Drawing.Point(120, $y)
$stopAll.Size = New-Object Drawing.Size(96, 32)
$stopAll.FlatStyle = 'System'
$form.Controls.Add($stopAll)

$refreshBtn = New-Object Windows.Forms.Button
$refreshBtn.Text = '刷新'
$refreshBtn.Location = New-Object Drawing.Point(222, $y)
$refreshBtn.Size = New-Object Drawing.Size(78, 32)
$refreshBtn.FlatStyle = 'System'
$form.Controls.Add($refreshBtn)

$openBtn = New-Object Windows.Forms.Button
$openBtn.Text = '打开工作台'
$openBtn.Location = New-Object Drawing.Point(306, $y)
$openBtn.Size = New-Object Drawing.Size(112, 32)
$openBtn.FlatStyle = 'System'
$form.Controls.Add($openBtn)

# 第二行：环境自检。查的是「模板依赖的东西在不在」—— 节点包、模型文件、
# 构建产物、ComfyUI 可达性，清单来自 docs/DEPENDENCIES.json。
$y += 40
$checkBtn = New-Object Windows.Forms.Button
$checkBtn.Text = '检查模型 / 节点 / 插件'
$checkBtn.Location = New-Object Drawing.Point(18, $y)
$checkBtn.Size = New-Object Drawing.Size(186, 32)
$checkBtn.FlatStyle = 'System'
$form.Controls.Add($checkBtn)

$openLogsBtn = New-Object Windows.Forms.Button
$openLogsBtn.Text = '打开日志目录'
$openLogsBtn.Location = New-Object Drawing.Point(212, $y)
$openLogsBtn.Size = New-Object Drawing.Size(110, 32)
$openLogsBtn.FlatStyle = 'System'
$form.Controls.Add($openLogsBtn)

# 日志
$y += 44
$logBox = New-Object Windows.Forms.TextBox
$logBox.Location = New-Object Drawing.Point(18, $y)
$logBox.Size = New-Object Drawing.Size(400, 150)
$logBox.Multiline = $true
$logBox.ReadOnly = $true
$logBox.ScrollBars = 'Vertical'
$logBox.BackColor = [Drawing.Color]::FromArgb(28, 30, 36)
$logBox.ForeColor = [Drawing.Color]::FromArgb(200, 206, 214)
$logBox.Font = New-Object Drawing.Font('Consolas', 8.5)
$form.Controls.Add($logBox)

$form.Size = New-Object Drawing.Size(460, ($y + 200))

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
                try {
                    Invoke-WebRequest $svc.Url -TimeoutSec 4 -UseBasicParsing | Out-Null
                } catch {
                    $healthy = $false
                }
            }
            if ($healthy) {
                $row.Dot.ForeColor = [Drawing.Color]::FromArgb(34, 160, 90)
                $row.Status.Text = '运行中'
                $row.Status.ForeColor = [Drawing.Color]::FromArgb(34, 130, 76)
            } else {
                $row.Dot.ForeColor = [Drawing.Color]::FromArgb(230, 160, 40)
                $row.Status.Text = '启动中…'
                $row.Status.ForeColor = [Drawing.Color]::FromArgb(180, 125, 30)
            }
        } else {
            $row.Dot.ForeColor = [Drawing.Color]::FromArgb(190, 195, 205)
            $row.Status.Text = '已停止'
            $row.Status.ForeColor = [Drawing.Color]::FromArgb(140, 146, 158)
        }
    }
    [Windows.Forms.Application]::DoEvents()
}

function Start-One($svc) {
    $open = Test-PortOpen $svc.Port
    if ($open) {
        Add-Log "$($svc.Name) 已在运行，跳过。"
        return
    }
    Add-Log "启动 $($svc.Name)（计划任务 $($svc.Task)）…"
    Start-ScheduledTask -TaskName $svc.Task -ErrorAction SilentlyContinue
    Add-Log "已下发。$($svc.Name) 就绪约需 $($svc.ReadySeconds) 秒，状态会自动更新。"
}

function Stop-One($svc) {
    $open = Test-PortOpen $svc.Port
    if (-not $open) {
        Add-Log "$($svc.Name) 已停止，跳过。"
        return
    }
    Add-Log "停止 $($svc.Name)…"
    Stop-ScheduledTask -TaskName $svc.Task -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 600
    # 任务的子进程不随任务结束而退出，按端口占用者清理。
    if (Stop-ServiceProcess $svc.Port) {
        Add-Log "已结束占用端口 $($svc.Port) 的进程。"
    }
    for ($i = 0; $i -lt 10; $i++) {
        if (-not (Test-PortOpen $svc.Port)) { break }
        Start-Sleep -Milliseconds 500
        if ($i -eq 4) { Stop-ServiceProcess $svc.Port | Out-Null }
    }
    if (Test-PortOpen $svc.Port) {
        Add-Log "⚠ $($svc.Name) 端口仍被占用，可再点一次停止。"
    } else {
        Add-Log "$($svc.Name) 已停止。"
    }
}

foreach ($key in $rows.Keys) {
    $row = $rows[$key]
    $row.Start.Add_Click({ Start-One $this.Tag; Update-Status }.GetNewClosure())
    $row.Stop.Add_Click({  Stop-One  $this.Tag; Update-Status }.GetNewClosure())
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

# 环境自检：跑 scripts/check-environment.mjs，把结果写进日志框。
# 输出里的 ANSI 颜色码要剥掉，文本框不认识转义序列。
$checkBtn.Add_Click({
    $this.Enabled = $false
    $original = $this.Text
    $this.Text = '检查中…'
    $form.Refresh()

    $script = Join-Path $BD 'scripts\check-environment.mjs'
    if (-not (Test-Path $script)) {
        Add-Log "✗ 缺少 scripts\check-environment.mjs，无法自检。"
    } else {
        Add-Log '开始环境自检（模型 / 节点包 / 插件 / 配置）…'
        try {
            $raw = & node $script 2>&1 | Out-String
            $esc = [string][char]27
            foreach ($line in ($raw -split "`r?`n")) {
                # 剥掉 \e[32m 这类颜色码
                $clean = ($line -replace ($esc + '\[[0-9;]*m'), '').TrimEnd()
                if ($clean) { Add-Log $clean }
            }
        } catch {
            Add-Log ('✗ 自检出错：' + $_.Exception.Message)
        }
    }

    $this.Text = $original
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
})

[void]$form.ShowDialog()

$timer.Stop()
$form.Dispose()
