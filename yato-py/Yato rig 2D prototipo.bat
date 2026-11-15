@echo off
REM Abre apenas o novo laboratorio de rig. As versoes anteriores permanecem intactas.
cd /d "%~dp0"
set ELECTRON_RUN_AS_NODE=
start "" "%~dp0avatar-electron\node_modules\electron\dist\electron.exe" "%~dp0avatar-chibi-rig-lab"
