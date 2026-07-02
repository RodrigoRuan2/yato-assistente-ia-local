"""
A MEMÓRIA — salvar e carregar a conversa em arquivo (persistência).

Terceira responsabilidade do projeto, no seu próprio arquivo:
  personalidade.py = quem a Yato é
  cerebro.py       = como ela pensa
  memoria.py       = o que ela lembra  ← você está aqui

Regras de ouro de persistência (valem pra qualquer projeto):
  1. LEITURA SEGURA: arquivo corrompido/ausente NUNCA derruba o app —
     na dúvida, devolve o padrão (lista vazia) e a vida segue.
  2. Validar o que veio do disco antes de usar (não confiar cegamente).
"""

import json
import logging
from pathlib import Path

# A conversa fica ao lado do código, em JSON legível (abra e olhe!).
# Este arquivo está no .gitignore: conversa é dado pessoal, não código.
ARQUIVO_CONVERSA = Path(__file__).with_name("conversa.json")


def salvar_conversa(mensagens):
    """Grava a conversa em disco — SEM a personalidade.

    Por que sem? A personalidade mora no personalidade.py (código). Se ela
    fosse salva junto e você editasse o arquivo depois, a Yato "antiga"
    voltaria do disco. Salvando só as falas, a personalidade atual sempre
    vale. (Princípio: cada dado tem UM dono — nada de cópias.)
    """
    falas = [m for m in mensagens if m["role"] != "system"]
    try:
        ARQUIVO_CONVERSA.write_text(
            json.dumps(falas, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
    except OSError:
        # Disco cheio, sem permissão... anota no diário e segue o baile:
        # perder o "salvar" é chato; derrubar o app por isso seria pior.
        logging.exception("Não consegui salvar a conversa")


def carregar_conversa():
    """Lê a conversa salva. QUALQUER problema → lista vazia (nunca quebra).

    Este é o padrão 'leitura segura': try/except em volta do parse, e
    validação item a item — se alguém editou o JSON na mão e estragou uma
    fala, as outras ainda são aproveitadas.
    """
    try:
        dados = json.loads(ARQUIVO_CONVERSA.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return []          # primeira vez que o app roda: normal não existir
    except (OSError, json.JSONDecodeError):
        logging.exception("conversa.json ilegível — começando do zero")
        return []

    if not isinstance(dados, list):
        return []
    return [
        m for m in dados
        if isinstance(m, dict)
        and m.get("role") in ("user", "assistant")
        and isinstance(m.get("content"), str)
    ]
