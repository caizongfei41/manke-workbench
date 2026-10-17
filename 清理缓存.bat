@echo off
chcp 65001 >nul
title 漫客工作台 清理缓存并重建

REM 清掉全部构建缓存后从零重建，用于排除「改了没生效」这类缓存干扰。
REM 不会动 data\ （项目、素材、数据库）和 E:\ComfyUI（模型）。
REM
REM 请先关掉桌面上的「漫客工作台 控制台」，本脚本会自己停服务。

echo.
echo ==========================================
echo   清理缓存并重建
echo ==========================================
echo.
echo   会清掉：.output / .vite / .nitro / paraglide / routeTree
echo   不会动：data\  public\  E:\ComfyUI
echo.
pause

cd /d "%~dp0"
node scripts\clean-caches.mjs

echo.
echo ==========================================
echo   完成。浏览器请按 Ctrl + F5 硬刷新一次。
echo ==========================================
echo.
pause
