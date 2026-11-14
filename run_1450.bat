@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist logs mkdir logs
python -m dca calc >> "logs\calc.log" 2>&1
