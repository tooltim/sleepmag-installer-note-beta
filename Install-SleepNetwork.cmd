@echo off
:: Sleep Network - one-click bootstrap (Windows). Double-click me.
:: Re-launches minimized so you only see the browser UI.
if /I not "%~1"=="__hidden" (
  start "" /min cmd /c "%~f0" __hidden
  exit /b 0
)
powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "Add-Type -AssemblyName System.Windows.Forms; try { irm https://raw.githubusercontent.com/tooltim/sleepmag-installer-note-beta/main/scripts/bootstrap.ps1 | iex } catch { [void][System.Windows.Forms.MessageBox]::Show(($_ | Out-String), 'Sleep Network installer'); exit 1 }"
if errorlevel 1 (
  echo.
  echo Something did not work. If no browser window opened, run this in PowerShell and send Tim the output:
  echo   irm https://raw.githubusercontent.com/tooltim/sleepmag-installer-note-beta/main/scripts/bootstrap.ps1 ^| iex
  echo.
  pause
)
