@echo off
chcp 65001 >nul
title 漫客工作台 一键启动
REM 双击即可启动 ComfyUI + 漫客工作台，并打开浏览器。
REM 脚本本体在 launcher\ 子目录；要改路径就编辑 launcher\start-workbench.ps1。

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0launcher\start-workbench.ps1"