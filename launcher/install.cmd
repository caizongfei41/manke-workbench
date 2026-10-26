@echo off
REM 漫客工作台 · 控制台安装器
REM
REM 双击后：把自己所在目录里的 payload.7z 解到临时目录，然后跑 install.ps1。
REM
REM 为什么不用 7z 的 SFX 模块：7z.sfx / 7zCon.sfx 只会解压，不会执行任何东西，
REM 用户解出来还得自己找 install.ps1 右键运行，等于没做安装包。
REM 这个批处理只有十几行，双击就能跑完整个安装。

setlocal
cd /d "%~dp0"

echo.
echo   漫客工作台 · 控制台安装器
echo   ========================================
echo.

REM 找 7z：优先系统安装的，其次同目录便携版
set "SEVENZIP="
if exist "%ProgramFiles%\7-Zip\7z.exe" set "SEVENZIP=%ProgramFiles%\7-Zip\7z.exe"
if exist "%ProgramFiles(x86)%\7-Zip\7z.exe" set "SEVENZIP=%ProgramFiles(x86)%\7-Zip\7z.exe"
if exist "%~dp0files\node\7z.exe" set "SEVENZIP=%~dp0files\node\7z.exe"

if not exist "%~dp0payload.7z" (
    echo   X 找不到 payload.7z，安装包不完整
    pause
    exit /b 1
)

if "%SEVENZIP%"=="" (
    echo   未安装 7-Zip，用内置解压...
    REM 没有 7z 时退回 PowerShell 的 Expand-Archive，
    REM 但它不认 7z 格式，所以这里只能提示
    echo   X 需要 7-Zip 才能解压，请先安装：https://www.7-zip.org/
    pause
    exit /b 1
)

set "TEMP_DIR=%TEMP%\manke-setup-%RANDOM%"
echo   解压到 %TEMP_DIR%
"%SEVENZIP%" x -y -o"%TEMP_DIR%" "%~dp0payload.7z" >nul
if errorlevel 1 (
    echo   X 解压失败
    pause
    exit /b 1
)

echo   运行安装脚本...
powershell -NoProfile -ExecutionPolicy Bypass -File "%TEMP_DIR%\install.ps1"

REM 安装脚本结束后清理临时目录
if exist "%TEMP_DIR%" rd /s /q "%TEMP_DIR%" 2>nul

endlocal
