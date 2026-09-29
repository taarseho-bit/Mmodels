@echo off
chcp 65001 >nul
cd /d "%~dp0"
node scripts\start-clean.cjs %*
if errorlevel 1 pause