@echo off
title Farhan AI (online)
cd /d "%~dp0"

rem Install Cloudflare's free tunnel tool the first time.
where cloudflared >nul 2>nul
if errorlevel 1 (
  echo Installing Cloudflare's free tunnel tool. This only happens once...
  winget install --id Cloudflare.cloudflared -e --accept-source-agreements --accept-package-agreements
  if errorlevel 1 (
    echo.
    echo Could not install it automatically. Download "cloudflared-windows-amd64.msi" from
    echo https://github.com/cloudflare/cloudflared/releases/latest , install it, then try again.
    pause
    exit /b 1
  )
  echo.
  echo Installed! Close this window and double-click go-online.bat again.
  pause
  exit /b 0
)

set GO_ONLINE=1
set OPEN_BROWSER=1
node server.js
pause
