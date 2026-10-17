@echo off
chcp 65001 >nul
REM 打开漫客工作台的服务控制台（可视化启停 ComfyUI 与工作台）。
REM 桌面上的快捷方式指向同一个脚本。

powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0launcher\service-console.ps1"
