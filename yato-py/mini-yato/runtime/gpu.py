"""Coordena as operações que disputam os 8 GB de VRAM do Yato.

O lock é reentrante: uma geração pode carregar o checkpoint dentro da mesma
reserva, e o cérebro pode chamar o modelo de visão durante uma conversa.
"""

import threading
from contextlib import contextmanager
from functools import wraps

import requests

from config import FORGE_URL, OLLAMA_BASE_URL


class GPUError(RuntimeError):
    """Uma troca de modelo não liberou a GPU com segurança."""


_condicao = threading.Condition()
_proxima_senha = 0
_vez = 0
_dono = None
_profundidade = 0
_estado = threading.local()


@contextmanager
def _reservar():
    """Atende as threads pela ordem de chegada, com reentrada na mesma thread."""
    global _proxima_senha, _vez, _dono, _profundidade
    identificador = threading.get_ident()
    with _condicao:
        if _dono == identificador:
            _profundidade += 1
        else:
            senha = _proxima_senha
            _proxima_senha += 1
            _condicao.wait_for(lambda: senha == _vez and _dono is None)
            _dono = identificador
            _profundidade = 1
    try:
        yield
    finally:
        with _condicao:
            _profundidade -= 1
            if _profundidade == 0:
                _dono = None
                _vez += 1
                _condicao.notify_all()


def _modelos_carregados():
    try:
        resposta = requests.get(f"{OLLAMA_BASE_URL}/api/ps", timeout=5)
        resposta.raise_for_status()
        return [m["name"] for m in resposta.json().get("models", []) if m.get("name")]
    except (requests.exceptions.ConnectionError, requests.exceptions.ConnectTimeout):
        return []  # Ollama fechado: não há modelos dele na GPU
    except requests.exceptions.RequestException as erro:
        raise GPUError(f"Não consegui verificar os modelos carregados no Ollama: {erro}") from erro


def _descarregar_ollama(exceto=None):
    for nome in _modelos_carregados():
        if nome == exceto:
            continue
        try:
            resposta = requests.post(
                f"{OLLAMA_BASE_URL}/api/generate",
                json={"model": nome, "keep_alive": 0}, timeout=60)
            resposta.raise_for_status()
        except requests.exceptions.RequestException as erro:
            raise GPUError(f"Não consegui liberar {nome} da GPU: {erro}") from erro


def _descarregar_forge():
    try:
        resposta = requests.post(f"{FORGE_URL}/sdapi/v1/unload-checkpoint",
                                 timeout=(0.5, 90))
        resposta.raise_for_status()
    except (requests.exceptions.ConnectionError, requests.exceptions.ConnectTimeout):
        return  # Forge fechado
    except requests.exceptions.RequestException as erro:
        raise GPUError(f"Não consegui liberar o modelo do Forge: {erro}") from erro


@contextmanager
def usar_ollama(modelo):
    """Espera a GPU, tira o Forge da VRAM e deixa só o modelo pedido."""
    with _reservar():
        if getattr(_estado, "dono", None) != "ollama":
            _descarregar_forge()
        _descarregar_ollama(exceto=modelo)
        anterior = getattr(_estado, "dono", None)
        _estado.dono = "ollama"
        try:
            yield
        finally:
            _estado.dono = anterior


@contextmanager
def usar_forge():
    """Espera as operações do Ollama terminarem antes de abrir/usar o Forge."""
    with _reservar():
        if getattr(_estado, "dono", None) != "forge":
            _descarregar_ollama()
        anterior = getattr(_estado, "dono", None)
        _estado.dono = "forge"
        try:
            yield
        finally:
            _estado.dono = anterior


def operacao_ollama(modelo):
    def decorar(funcao):
        @wraps(funcao)
        def protegida(*args, **kwargs):
            with usar_ollama(modelo()):
                return funcao(*args, **kwargs)
        return protegida
    return decorar


def operacao_forge(funcao):
    @wraps(funcao)
    def protegida(*args, **kwargs):
        with usar_forge():
            return funcao(*args, **kwargs)
    return protegida


def em_uso():
    with _condicao:
        return _dono is not None and _dono != threading.get_ident()


def com_gpu_livre(funcao):
    """Executa mudanças de configuração sem disputar uma operação em curso."""
    with _reservar():
        return funcao()


def liberar_ollama():
    with _reservar():
        _descarregar_ollama()
