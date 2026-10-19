# 桌面通知（尽力而为）：优先用 Windows 通知中心，失败就静默退出。
#
#   .\scripts\notify.ps1 -Title "标题" -Message "正文"
#
# 告警文件由 scripts/vigil.mjs 同步写，这里只负责弹窗 —— 弹不出来也不影响告警落地。

param(
  [Parameter(Mandatory = $true)][string]$Title,
  [Parameter(Mandatory = $true)][string]$Message
)

$ErrorActionPreference = 'SilentlyContinue'

# 告警文件由守护进程（Node）同步写，这里只负责弹窗

# 通知中心：Windows 10/11 自带，不需要额外模块
try {
  [void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
  $template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
  $texts = $template.GetElementsByTagName('text')
  $texts.Item(0).AppendChild($template.CreateTextNode($Title)) | Out-Null
  $texts.Item(1).AppendChild($template.CreateTextNode($Message)) | Out-Null
  $toast = [Windows.UI.Notifications.ToastNotification]::new($template)
  [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('MankeGpuSuites').Show($toast)
  Write-Host "已发送桌面通知"
} catch {
  Write-Host "通知中心不可用，仅写文件：$alertFile"
}

Write-Host "告警已写入 $alertFile"
