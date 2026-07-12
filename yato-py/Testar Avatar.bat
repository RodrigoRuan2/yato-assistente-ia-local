@echo off
REM ==============================================================
REM   Testar Avatar - de um duplo-clique e a janela do avatar abre.
REM   (o avatar Live2D roda SEPARADO do Yato, agora em Electron -
REM    e uma a unica forma de deixar o fundo TRANSPARENTE no Windows)
REM ==============================================================

REM Entra na pasta do app Electron do avatar. %~dp0 = "a pasta onde
REM este .bat esta" - funciona em qualquer maquina, sem caminho fixo.
cd /d "%~dp0avatar-electron"

REM Abre a janela transparente do avatar (o electron.exe e um app grafico,
REM nao abre tela preta de terminal). Fechar = tecla ESC.
start "" "node_modules\electron\dist\electron.exe" "."
