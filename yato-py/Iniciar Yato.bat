@echo off
REM ==============================================================
REM   Iniciar Yato - de um duplo-clique e a IA local abre.
REM   (arquivo .bat = uma listinha de comandos que o Windows roda)
REM ==============================================================

REM 1) Liga o Ollama (o cerebro) SO SE ele ainda nao estiver rodando.
REM    tasklist lista os processos abertos; se "ollama app.exe" ja
REM    estiver la, pulamos - assim nao roubamos o foco a toa.
tasklist /FI "IMAGENAME eq ollama app.exe" | find /I "ollama app.exe" >nul
if errorlevel 1 start "" "%LOCALAPPDATA%\Programs\Ollama\ollama app.exe"

REM 2) Entra na pasta do projeto. %~dp0 = "a pasta onde este .bat esta",
REM    entao funciona em qualquer maquina, sem caminho fixo.
cd /d "%~dp0"

REM 3) Abre a janela da Yato SEM tela preta de terminal (pythonw).
start "" ".venv\Scripts\pythonw.exe" "app.py"
