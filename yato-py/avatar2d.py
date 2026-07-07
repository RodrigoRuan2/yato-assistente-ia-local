"""
O AVATAR 2D — o LADO YATO da conversa com o avatar Live2D flutuante.

O avatar roda num PROCESSO separado (avatar_app.py), porque o pywebview (a
janela) e o Tkinter (a janela do Yato) brigam pela 'main thread'. Este módulo
é o "controle remoto" que o Yato usa:

  • mostrar()/esconder()      → abre e fecha a janela flutuante (subprocess);
  • definir_expressao(nome)   → troca a expressão (ociosa/pensando/falando…);
  • lip_sync(forca)           → move a boca conforme a força do som (0..1).

Os comandos viajam pela PONTE HTTP local que o avatar_app expõe na porta 8137
(ex.: /controle?acao=boca&valor=0.8). Se a janela está fechada, tudo é
silenciosamente ignorado — o Yato nunca quebra por causa do avatar.
"""

import logging
import subprocess
import sys
import threading
import urllib.request
from pathlib import Path

PORTA = 8137
_URL = f"http://127.0.0.1:{PORTA}/controle"
_SCRIPT = Path(__file__).with_name("avatar_app.py")
_PASTA_WEB = Path(__file__).with_name("avatar")

# Estados que o avatar entende — os mesmos que o _expressao do app usa.
EXPRESSOES = ("ociosa", "pensando", "falando", "feliz")

_processo = None   # o Popen da janela do avatar, quando aberta


def disponivel():
    """True se dá pra abrir o avatar: o pywebview instalado E a página existe."""
    try:
        import webview  # noqa: F401
    except ImportError:
        return False
    return (_PASTA_WEB / "index.html").exists()


def esta_aberto():
    """True se a janela do avatar está aberta agora (o processo vivo)."""
    return _processo is not None and _processo.poll() is None


def mostrar():
    """Abre a janela do avatar, se ainda não estiver aberta."""
    global _processo
    if esta_aberto():
        return
    # sys.executable = o MESMO Python do Yato (que tem o pywebview). Se o Yato
    # foi aberto com pythonw, o avatar também abre sem terminal.
    _processo = subprocess.Popen([sys.executable, str(_SCRIPT)])


def esconder():
    """Fecha a janela do avatar (encerra o processo)."""
    global _processo
    if _processo is not None:
        _processo.terminate()
        _processo = None


def definir_expressao(nome):
    """Repassa uma mudança de expressão pro avatar (ociosa/pensando/falando/feliz)."""
    if nome not in EXPRESSOES:
        logging.warning("Expressão desconhecida pro avatar: %s", nome)
        return
    _comando(f"acao=expressao&nome={nome}")


def lip_sync(forca):
    """Move a boca do avatar conforme a força do som (0..1) — o lip-sync."""
    _comando(f"acao=boca&valor={forca:.3f}")


def _comando(consulta):
    """Liga pra a ponte do avatar SEM travar quem chamou (dispara numa thread).

    Por que numa thread: o lip_sync é chamado a cada ~55ms durante a fala; se
    esperássemos a resposta HTTP a cada vez, o ritmo da boca atrasaria em
    relação ao som. Fire-and-forget mantém a sincronia. Silencioso se a janela
    estiver fechada."""
    def envia():
        try:
            urllib.request.urlopen(f"{_URL}?{consulta}", timeout=1).read()
        except Exception:
            pass   # avatar fechado/indisponível — o Yato segue normal
    threading.Thread(target=envia, daemon=True).start()
