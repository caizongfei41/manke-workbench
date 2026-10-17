@echo off
chcp 65001 >nul
title 漫客工作台 服务自检

REM 重启后双击本文件，检查两个服务是否已自动恢复。
REM 主要看最后那行结论。全部正常时无需做任何操作。

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0launcher\check-services.ps1"
echo.
pause
