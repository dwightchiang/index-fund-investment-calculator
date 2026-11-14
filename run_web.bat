@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 正在启动本地定投网页...
echo 手机连同一个 Wi-Fi，用下面显示的 IP 打开即可。
echo.
python tools\serve.py
pause
