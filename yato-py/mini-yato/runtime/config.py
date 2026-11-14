"""Configuração central do Yato.

Os padrões funcionam sem arquivo extra. Para personalizar caminhos, modelos ou
portas, copie ``config.exemplo.json`` para ``config.json``. Variáveis de
ambiente continuam tendo prioridade, o que ajuda em instalações e automação.
"""

import json
import logging
import os
from pathlib import Path

RAIZ = Path(__file__).parent
ARQUIVO_CONFIG = RAIZ / "config.json"

PADROES = {
    "ollama": {
        "url": "http://localhost:11434",
        "modelo": "qwen3:8b",
        "modelo_visao": "qwen2.5vl:7b",
    },
    "forge": {
        "url": "http://127.0.0.1:7860",
        "pasta": "",
    },
    "avatar": {
        "porta": 8137,
        "modelo": "natori",
    },
    "agente": {
        "max_tokens_resposta": 500,
        "limite_historico": 20,
        "contexto": 8192,
        "max_voltas_ferramentas": 4,
        "max_caracteres_fonte": 5000,
    },
}


def _mesclar(base, novo):
    resultado = dict(base)
    for chave, valor in novo.items():
        if isinstance(valor, dict) and isinstance(resultado.get(chave), dict):
            resultado[chave] = _mesclar(resultado[chave], valor)
        else:
            resultado[chave] = valor
    return resultado


def _ler():
    try:
        dados = json.loads(ARQUIVO_CONFIG.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return PADROES
    except (OSError, ValueError):
        logging.exception("config.json inválido — usando os padrões")
        return PADROES
    return _mesclar(PADROES, dados if isinstance(dados, dict) else {})


def salvar_modelo(papel, nome):
    """Persiste a escolha sem apagar as demais preferências do usuário."""
    if papel not in ("modelo", "modelo_visao"):
        raise ValueError("Papel de modelo inválido")
    if not isinstance(nome, str) or not nome.strip():
        raise ValueError("Nome de modelo vazio")
    variavel = "YATO_MODELO" if papel == "modelo" else "YATO_MODELO_VISAO"
    if os.environ.get(variavel):
        raise ValueError(f"{variavel} está definido no ambiente e tem prioridade sobre config.json")
    try:
        atual = json.loads(ARQUIVO_CONFIG.read_text(encoding="utf-8"))
    except FileNotFoundError:
        atual = {}
    if not isinstance(atual, dict):
        raise ValueError("config.json precisa ser um objeto JSON")
    secao = atual.setdefault("ollama", {})
    if not isinstance(secao, dict):
        raise ValueError("A seção ollama de config.json é inválida")
    secao[papel] = nome.strip()
    temporario = ARQUIVO_CONFIG.with_suffix(".json.tmp")
    try:
        temporario.write_text(json.dumps(atual, ensure_ascii=False, indent=2) + "\n",
                               encoding="utf-8")
        temporario.replace(ARQUIVO_CONFIG)
    finally:
        temporario.unlink(missing_ok=True)
    CONFIG["ollama"][papel] = nome.strip()
    globals()["MODELO" if papel == "modelo" else "MODELO_VISAO"] = nome.strip()


CONFIG = _ler()


def salvar_avatar(nome):
    """Salva somente o avatar escolhido, preservando as outras preferências."""
    if nome not in ("natori", "beta1", "lab"):
        raise ValueError("Avatar desconhecido")
    try:
        atual = json.loads(ARQUIVO_CONFIG.read_text(encoding="utf-8"))
    except FileNotFoundError:
        atual = {}
    if not isinstance(atual, dict) or not isinstance(atual.get("avatar", {}), dict):
        raise ValueError("A seção avatar de config.json é inválida")
    atual.setdefault("avatar", {})["modelo"] = nome
    temporario = ARQUIVO_CONFIG.with_suffix(".avatar.tmp")
    try:
        temporario.write_text(json.dumps(atual, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        temporario.replace(ARQUIVO_CONFIG)
    finally:
        temporario.unlink(missing_ok=True)
    CONFIG["avatar"]["modelo"] = nome

OLLAMA_BASE_URL = os.environ.get("YATO_OLLAMA_URL", CONFIG["ollama"]["url"]).rstrip("/")
OLLAMA_CHAT_URL = f"{OLLAMA_BASE_URL}/api/chat"
MODELO = os.environ.get("YATO_MODELO", CONFIG["ollama"]["modelo"])
MODELO_VISAO = os.environ.get("YATO_MODELO_VISAO", CONFIG["ollama"]["modelo_visao"])

FORGE_URL = os.environ.get("YATO_FORGE_URL", CONFIG["forge"]["url"]).rstrip("/")
_pasta_forge = os.environ.get("YATO_FORGE", CONFIG["forge"].get("pasta", ""))
PASTA_FORGE = Path(_pasta_forge).expanduser() if _pasta_forge else None

PORTA_AVATAR = int(os.environ.get("YATO_AVATAR_PORTA", CONFIG["avatar"]["porta"]))

MAX_TOKENS_RESPOSTA = int(CONFIG["agente"]["max_tokens_resposta"])
LIMITE_HISTORICO = int(CONFIG["agente"]["limite_historico"])
CONTEXTO = int(CONFIG["agente"]["contexto"])
MAX_VOLTAS_FERRAMENTAS = int(CONFIG["agente"]["max_voltas_ferramentas"])
MAX_CARACTERES_FONTE = int(CONFIG["agente"]["max_caracteres_fonte"])
