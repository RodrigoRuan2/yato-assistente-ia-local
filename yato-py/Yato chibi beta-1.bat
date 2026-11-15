@echo off
cd /d "%~dp0avatar-chibi-beta-1"
set ELECTRON_RUN_AS_NODE=
start "Yato beta-1" "..\avatar-electron\node_modules\electron\dist\electron.exe" "."
