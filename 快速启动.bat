@echo off
setlocal
title DeepSeek Harness

cd /d "%~dp0"

where powershell.exe >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Windows PowerShell was not found.
  pause
  exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0launch-dsh.ps1"
set "exit_code=%errorlevel%"

if not "%exit_code%"=="0" (
  echo.
  echo [ERROR] DeepSeek Harness could not be started.
  pause
)
exit /b %exit_code%
