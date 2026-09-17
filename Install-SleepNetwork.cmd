@echo off
:: Sleep Network - one-click bootstrap (Windows). Double-click me.
:: Downloads and runs scripts/bootstrap.ps1 from this public repo.
powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/tooltim/sleepmag-installer-note-beta/main/scripts/bootstrap.ps1 | iex"
if errorlevel 1 (
  echo.
  echo Something did not work. Send a screenshot of this window to Tim.
  pause
)
