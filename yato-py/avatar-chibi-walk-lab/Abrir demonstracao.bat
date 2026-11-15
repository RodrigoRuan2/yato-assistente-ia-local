@echo off
REM Estudio independente da caminhada refinada. Nao altera o beta-1.
cd /d "%~dp0"
set ELECTRON_RUN_AS_NODE=
start "" "..\avatar-electron\node_modules\electron\dist\electron.exe" "%~dp0." --monitor=2
