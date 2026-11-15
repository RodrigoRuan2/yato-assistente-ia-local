@echo off
REM Avatar transparente da caminhada refinada, com perfil separado.
cd /d "%~dp0"
set ELECTRON_RUN_AS_NODE=
start "" "..\avatar-electron\node_modules\electron\dist\electron.exe" "%~dp0." --desktop --monitor=2
