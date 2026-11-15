@echo off
cd /d "%~dp0avatar-chibi-lab"
set ELECTRON_RUN_AS_NODE=
start "Yato laboratorio" "..\avatar-electron\node_modules\electron\dist\electron.exe" "."
