"""
O AVATAR — a janela do avatar 2D (Live2D), rodando SEPARADA do Yato.

Por que processo separado: o pywebview (esta janela) e o Tkinter (a janela do
Yato) brigam pela 'main thread' — não rodam juntos no mesmo processo. Então o
avatar nasce como um programa à parte; o Yato vai conversar com ele por um
canal simples mais pra frente (Passo 4).

Passo 2.5 (agora): a janela virou MASCOTE — sem moldura, sempre por cima, e
você arrasta o personagem pra mover. Sem a barra do sistema não há 'X', então
o fechar é um botão na página (ou a tecla ESC), que chama de volta o Python
pela _API abaixo.
"""

import http.server
import logging
import socketserver
import threading
from functools import partial
from pathlib import Path

import webview

# NOTA: a transparência de verdade (só o personagem, sem retângulo) foi
# tentada e NÃO funciona com o WebView2 no Windows 11 — ele renderiza por
# GPU/composição, que ignora tanto o modo transparente nativo quanto o
# truque de "color key". Solução adotada: janela JUSTA ao personagem com um
# fundo discreto (um "card"). Sem transparência = o mouse nunca buga.

PASTA_WEB = Path(__file__).with_name("avatar")   # onde está o index.html
PORTA = 8137   # porta local só do avatar (não colide com Ollama nem o dev)

# Diário de bordo do avatar: se algo falhar (aberto pelo atalho, sem terminal),
# o motivo fica aqui em vez de sumir.
logging.basicConfig(
    filename=Path(__file__).with_name("avatar.log"),
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)


_janela = None   # referência à janela, pra a ponte de controle chamar o JS


class _Handler(http.server.SimpleHTTPRequestHandler):
    """Serve os arquivos do avatar E atende a PONTE de controle: o Yato (outro
    processo) manda comandos por HTTP e a gente repassa pro JavaScript da
    página. Ex.: /controle?acao=boca&valor=0.8  →  window.setBoca(0.8).

    Não loga nada (tira ruído e evita quebrar sob o pythonw, que não tem
    'stderr' pra onde o log padrão escreveria)."""

    def log_message(self, *args):
        pass

    def do_GET(self):
        if self.path.startswith("/controle"):
            self._controle()
        else:
            super().do_GET()

    def _controle(self):
        from urllib.parse import urlparse, parse_qs
        consulta = parse_qs(urlparse(self.path).query)
        acao = consulta.get("acao", [""])[0]
        if _janela is not None:
            if acao == "boca":
                valor = float(consulta.get("valor", ["0"])[0])
                _janela.evaluate_js(f"window.setBoca({valor})")
            elif acao == "expressao":
                nome = consulta.get("nome", [""])[0]
                _janela.evaluate_js(f"window.setExpressao({nome!r})")
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"ok")


def _servir():
    """Sobe um servidor HTTP local servindo a pasta do avatar + a ponte.

    Precisamos de contexto http:// (não file://) pra o navegador embutido
    baixar o modelo do CDN sem esbarrar em CORS. Thread daemon: morre junto
    com o programa."""
    handler = partial(_Handler, directory=str(PASTA_WEB))
    with socketserver.TCPServer(("127.0.0.1", PORTA), handler) as servidor:
        servidor.serve_forever()


class _API:
    """A ponte que o JavaScript da página chama de volta (via pywebview.api).
    Por ora só o 'fechar' — como a janela é sem-moldura, não há 'X' do sistema."""

    def fechar(self):
        webview.windows[0].destroy()


def main():
    global _janela
    threading.Thread(target=_servir, daemon=True).start()
    try:
        _janela = webview.create_window(
            "Yato Avatar",
            f"http://127.0.0.1:{PORTA}/index.html",
            js_api=_API(),
            width=320,          # janela JUSTA ao personagem (card estreito)
            height=580,
            frameless=True,     # sem moldura — é um mascote
            easy_drag=False,    # arraste CONTROLADO: só o personagem (a página
                                # marca a drag-region), pra não brigar com o
                                # botão de fechar e o menu
            on_top=True,        # sempre por cima das outras janelas
            background_color="#12121c",
        )
        webview.start()
    except Exception:
        logging.exception("Falha ao abrir o avatar")
        raise


if __name__ == "__main__":
    main()
