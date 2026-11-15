@echo off
REM Previa independente no monitor 2; usa preferencias separadas do chat.
cd /d "%~dp0avatar-chibi-lab"
set ELECTRON_RUN_AS_NODE=
start "" "..\avatar-electron\node_modules\electron\dist\electron.exe" "%~dp0avatar-chibi-lab" --desktop --chat --bubble-demo --monitor=2
