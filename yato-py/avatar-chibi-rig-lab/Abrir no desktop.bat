@echo off
REM Prototipo Rig 2D no desktop, com perfil e porta separados.
cd /d "%~dp0"
set ELECTRON_RUN_AS_NODE=
start "" "..\avatar-electron\node_modules\electron\dist\electron.exe" "%~dp0." --desktop
