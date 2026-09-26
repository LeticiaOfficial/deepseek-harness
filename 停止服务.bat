@echo off
setlocal
title Stop DeepSeek Harness

cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop-dsh.ps1"
set "exit_code=%errorlevel%"

if not "%exit_code%"=="0" pause
exit /b %exit_code%
