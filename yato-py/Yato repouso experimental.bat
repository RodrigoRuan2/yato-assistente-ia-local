@echo off
REM Gestos de repouso na copia experimental, somente monitor 2.
cd /d "%~dp0avatar-chibi-walk-lab"
set ELECTRON_RUN_AS_NODE=
start "" "..\avatar-electron\node_modules\electron\dist\electron.exe" "%~dp0avatar-chibi-walk-lab" --monitor=2 --idle-demo
