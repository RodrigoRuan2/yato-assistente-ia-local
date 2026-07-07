@echo off
REM ==============================================================
REM   Testar Avatar - de um duplo-clique e a janela do avatar abre.
REM   (fase de desenvolvimento: o avatar Live2D roda SEPARADO do Yato)
REM ==============================================================

REM Entra na pasta do projeto (caminho absoluto = funciona de qualquer lugar).
cd /d "C:\Users\ruanc\projetos\Chat bot\yato-py"

REM Abre a janela do avatar SEM tela preta de terminal (pythonw).
REM Se algo der errado, o motivo fica no avatar.log (mesma pasta).
start "" ".venv\Scripts\pythonw.exe" "avatar_app.py"
