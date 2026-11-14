"""
REMOÇÃO DE FUNDO — o "recorte" de imagens, rodando 100% local (rembg).

Usado em dois lugares:
  - a ferramenta remover_fundo (o Yato tira o fundo de uma imagem no chat);
  - o importador de arte do avatar (a arte do personagem vira transparente).

Detalhe importante: o `import rembg` é PESADO (carrega o onnxruntime e um
modelo de ~170 MB). Se importássemos no topo, o app demoraria pra abrir toda
vez — mesmo quem nunca usa o recorte pagaria o custo. Por isso o import é
PREGUIÇOSO: só acontece na primeira vez que a função é chamada.
"""

import logging
from pathlib import Path

_remove = None   # a função do rembg, carregada sob demanda (cache)


def _carregar_rembg():
    """Importa o rembg na primeira chamada e guarda a função (cache)."""
    global _remove
    if _remove is None:
        from rembg import remove   # import pesado — só agora
        _remove = remove
    return _remove


def remover_fundo_pil(imagem_pil):
    """Recebe uma imagem PIL, devolve uma nova PIL RGBA sem fundo.
    Levanta exceção se o rembg falhar — quem chama decide o que fazer."""
    remove = _carregar_rembg()
    return remove(imagem_pil.convert("RGBA"))


def area_de_trabalho():
    """Acha a Área de Trabalho do usuário (pode estar no OneDrive no Windows)."""
    home = Path.home()
    for candidato in (home / "Desktop", home / "OneDrive" / "Desktop",
                      home / "OneDrive" / "Área de Trabalho",
                      home / "Área de Trabalho"):
        if candidato.is_dir():
            return candidato
    return home   # nada encontrado: a própria pasta do usuário


def esta_disponivel():
    """True se o rembg está instalado (pra a UI avisar em vez de quebrar)."""
    try:
        import rembg  # noqa: F401
        return True
    except ImportError:
        logging.warning("rembg não instalado — recorte de fundo indisponível")
        return False
