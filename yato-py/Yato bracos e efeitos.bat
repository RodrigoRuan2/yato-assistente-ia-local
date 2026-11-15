@echo off
REM Previa experimental: bracos completos e efeitos opcionais, somente monitor 2.
REM O Yato principal e o beta-1 permanecem separados.
cd /d "%~dp0avatar-chibi-walk-lab"
set ELECTRON_RUN_AS_NODE=
start "" "..\avatar-electron\node_modules\electron\dist\electron.exe" "%~dp0avatar-chibi-walk-lab" --monitor=2 --demo --effects
