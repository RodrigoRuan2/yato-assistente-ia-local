@echo off
REM Estudio independente do prototipo Rig 2D. Nao altera o beta-1.
cd /d "%~dp0"
set ELECTRON_RUN_AS_NODE=
start "" "..\avatar-electron\node_modules\electron\dist\electron.exe" "%~dp0."
