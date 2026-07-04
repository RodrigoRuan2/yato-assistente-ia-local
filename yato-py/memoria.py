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
from datetime import datetime
from pathlib import Path

# ===========================================================================
#  HISTÓRICO DE CONVERSAS — cada conversa é um arquivo em conversas/.
#
#  Antes era UM conversa.json (o 🧹 apagava a anterior pra sempre). Agora
#  cada conversa vira um arquivo com timestamp no nome, e guardamos as N
#  mais recentes — um histórico navegável, como o do ChatGPT. Ao passar do
#  teto, a MAIS ANTIGA é apagada (rotação, igual ao yato.log).
#  Tudo no .gitignore: conversa é dado pessoal, não código.
# ===========================================================================

PASTA_CONVERSAS = Path(__file__).with_name("conversas")
MAX_CONVERSAS = 10
_CONVERSA_ANTIGA = Path(__file__).with_name("conversa.json")  # formato v1, p/ migrar


def _garantir_pasta():
    PASTA_CONVERSAS.mkdir(exist_ok=True)


def _so_falas(itens):
    """Mantém só falas válidas de user/assistant (a personalidade mora no
    código, nunca no disco — se fosse salva, uma "Yato antiga" voltaria)."""
    if not isinstance(itens, list):
        return []
    return [m for m in itens
            if isinstance(m, dict) and m.get("role") in ("user", "assistant")
            and isinstance(m.get("content"), str)]


def _titulo(falas):
    """Título da conversa = a 1ª fala do usuário, curtinha (pro histórico)."""
    for m in falas:
        if m["role"] == "user":
            t = " ".join(m["content"].split())
            return (t[:38] + "…") if len(t) > 38 else t
    return "(conversa vazia)"


def _rotacionar():
    """Abre espaço pra uma conversa nova apagando as mais antigas além do teto."""
    arqs = sorted(PASTA_CONVERSAS.glob("*.json"), key=lambda a: a.stat().st_mtime)
    while len(arqs) >= MAX_CONVERSAS:
        try:
            arqs.pop(0).unlink()
        except OSError:
            break


def novo_arquivo_conversa():
    """Caminho de uma conversa NOVA (nome = timestamp) + aplica a rotação.

    O %f (microssegundos) evita colisão de nome se duas conversas nascerem
    no mesmo segundo — senão a segunda sobrescreveria a primeira (pego no teste).
    """
    _garantir_pasta()
    _rotacionar()
    return PASTA_CONVERSAS / (datetime.now().strftime("%Y%m%d-%H%M%S-%f") + ".json")


def salvar_conversa_em(arquivo, mensagens):
    """Grava as falas (sem a personalidade) num arquivo de conversa + título.

    Leitura segura na escrita: se o disco falhar, anota no diário e segue —
    perder um "salvar" é chato, derrubar o app por isso seria pior.
    """
    falas = _so_falas(mensagens)
    if not falas:
        return   # conversa ainda vazia: nada pra gravar
    try:
        Path(arquivo).write_text(
            json.dumps({"titulo": _titulo(falas), "mensagens": falas},
                       ensure_ascii=False, indent=2),
            encoding="utf-8")
    except OSError:
        logging.exception("Não consegui salvar a conversa")


def carregar_falas_de(arquivo):
    """Lê as falas de um arquivo de conversa. Qualquer problema → lista vazia."""
    try:
        dados = json.loads(Path(arquivo).read_text(encoding="utf-8"))
    except (FileNotFoundError, OSError, json.JSONDecodeError):
        return []
    # aceita o formato novo ({"mensagens": [...]}) e o v1 (lista direta)
    return _so_falas(dados.get("mensagens") if isinstance(dados, dict) else dados)


def _migrar_conversa_antiga():
    """Importa o conversa.json v1 (se existir) como uma conversa da pasta nova,
    pra não perder o que o usuário já tinha. Roda uma vez e some com o v1."""
    if not _CONVERSA_ANTIGA.exists():
        return
    try:
        falas = carregar_falas_de(_CONVERSA_ANTIGA)
        if falas:
            salvar_conversa_em(novo_arquivo_conversa(), falas)
        _CONVERSA_ANTIGA.unlink()
    except OSError:
        pass


def listar_conversas():
    """Todas as conversas salvas: lista de (arquivo, título), da + recente."""
    _migrar_conversa_antiga()
    _garantir_pasta()
    itens = []
    for arq in PASTA_CONVERSAS.glob("*.json"):
        try:
            dados = json.loads(arq.read_text(encoding="utf-8"))
            titulo = (dados.get("titulo") if isinstance(dados, dict) else None) \
                or "(sem título)"
        except (OSError, json.JSONDecodeError):
            continue
        itens.append((arq, titulo, arq.stat().st_mtime))
    itens.sort(key=lambda x: x[2], reverse=True)
    return [(arq, titulo) for arq, titulo, _ in itens]


# ===========================================================================
#  MEMÓRIA DE FATOS — o que o Yato sabe sobre VOCÊ, entre sessões.
#
#  Diferença crucial pro conversa.json: conversa é o PAPO (o 🧹 apaga);
#  fatos são CONHECIMENTO duradouro ("estuda React", "tem RTX 4060 Ti") —
#  sobrevivem à limpeza e entram no system prompt de toda conversa.
#  É o mesmo mecanismo de qualquer assistente com "memória": um amnésico
#  com um caderno — anota, relê, parece que lembra.
# ===========================================================================

ARQUIVO_FATOS = Path(__file__).with_name("fatos.json")

# Teto de fatos. Por quê: TODOS entram no prompt a cada mensagem — memória
# grande demais devora a "mesa" de contexto. 20 fatos curtos ≈ baratíssimo.
MAX_FATOS = 20


def carregar_fatos():
    """Lê os fatos salvos. Qualquer problema → lista vazia (leitura segura)."""
    try:
        dados = json.loads(ARQUIVO_FATOS.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return []
    except (OSError, json.JSONDecodeError):
        logging.exception("fatos.json ilegível — seguindo sem fatos")
        return []
    if not isinstance(dados, list):
        return []
    return [f.strip() for f in dados if isinstance(f, str) and f.strip()][:MAX_FATOS]


def salvar_fatos(fatos):
    try:
        ARQUIVO_FATOS.write_text(
            json.dumps(fatos, ensure_ascii=False, indent=2), encoding="utf-8"
        )
    except OSError:
        logging.exception("Não consegui salvar os fatos")


def anotar_fato(fato):
    """Anota um fato novo. Devolve um recado (vai pro modelo, como ferramenta).

    Proteções: fato vazio, repetido (ignorando maiúsculas) e memória cheia —
    o modelo recebe o motivo em texto e se explica pro usuário.
    """
    fato = " ".join(str(fato).split())
    if not fato:
        return "(Fato vazio — nada anotado.)"
    fatos = carregar_fatos()
    if any(fato.lower() == f.lower() for f in fatos):
        return "(Esse fato já estava anotado.)"
    if len(fatos) >= MAX_FATOS:
        return (f"(Memória cheia: já são {MAX_FATOS} fatos. "
                "Peça ao usuário qual esquecer antes de anotar outro.)")
    fatos.append(fato)
    salvar_fatos(fatos)
    return f"(Anotado na memória permanente: {fato})"


def esquecer_fato(trecho):
    """Apaga fatos que contenham o trecho. Devolve o resultado como recado."""
    trecho = str(trecho).strip().lower()
    if not trecho:
        return "(Diga qual fato esquecer.)"
    fatos = carregar_fatos()
    restantes = [f for f in fatos if trecho not in f.lower()]
    removidos = len(fatos) - len(restantes)
    if removidos == 0:
        return "(Não achei nenhum fato com esse trecho.)"
    salvar_fatos(restantes)
    return f"({removidos} fato(s) esquecido(s).)"
