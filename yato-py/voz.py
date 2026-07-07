"""
A VOZ — o Yato falando em voz alta (TTS), 100% local com o Piper.

Quinto módulo do projeto, cada um com sua responsabilidade:
  personalidade.py = quem ele é      cerebro.py     = como pensa
  ferramentas.py   = o que faz       memoria.py     = o que lembra
  fundo.py         = recorta imagem  voz.py         = como FALA  ← aqui

Como funciona: o Piper transforma texto em áudio (um modelo de voz .onnx que
roda na CPU). A gente gera o WAV na memória e toca com o winsound (embutido
no Windows — zero dependência a mais).

Import PREGUIÇOSO de novo: o `from piper import PiperVoice` e o carregamento
do modelo de voz (~60 MB) só acontecem na PRIMEIRA fala — quem nunca liga a
voz não paga esse custo ao abrir o app.
"""

import array
import io
import logging
import re
import tempfile
import time
import wave
from pathlib import Path

PASTA_VOZES = Path(__file__).with_name("vozes")
MODELO_VOZ = "pt_BR-faber-medium.onnx"   # a voz escolhida (masculina, pt-BR)

_voz = None       # PiperVoice, carregada sob demanda (cache)
_geracao = 0      # "número" da fala atual: muda quando outra fala ou o parar()
                  # chega, e o lip-sync da fala antiga percebe que foi cortado

# Tira emojis e símbolos que a voz falaria de forma estranha ("carinha
# piscando"...). Fala só o que é texto de verdade.
_SO_FALA = re.compile(
    "[\U0001F000-\U0001FAFF"   # emojis e pictogramas suplementares
    "\U00002600-\U000026FF"    # símbolos diversos
    "\U00002700-\U000027BF"    # dingbats
    "\U0001F1E6-\U0001F1FF"    # bandeiras
    "\U00002190-\U000021FF"    # setas
    "\U00002B00-\U00002BFF]",  # setas/símbolos suplementares
    flags=re.UNICODE,
)


def disponivel():
    """True se o modelo de voz está baixado (pra a UI avisar em vez de quebrar)."""
    return (PASTA_VOZES / MODELO_VOZ).exists()


def _carregar():
    global _voz
    if _voz is None:
        from piper import PiperVoice   # import pesado — só agora
        _voz = PiperVoice.load(str(PASTA_VOZES / MODELO_VOZ))
    return _voz


def _limpar(texto):
    """Deixa o texto pronto pra fala: sem emojis, espaços normalizados."""
    return " ".join(_SO_FALA.sub("", texto).split())


def _envelope(dados_wav, ms_por_janela=55):
    """Mede a FORÇA do som ao longo do tempo — o coração do lip-sync.

    Devolve (forcas, ms_por_janela):
    - forcas: lista de valores 0..1, um por janela de ~55ms (0 = silêncio,
      1 = o pico da fala). Som forte → boca mais aberta.
    - ms_por_janela: quanto tempo cada valor "dura", pra percorrer no ritmo.

    Como: agrupa as amostras em janelas e calcula o RMS (a energia média) de
    cada uma; depois normaliza pelo pico, pra a boca usar toda a sua abertura.
    """
    with wave.open(io.BytesIO(dados_wav), "rb") as w:
        canais = w.getnchannels()
        largura = w.getsampwidth()
        taxa = w.getframerate()
        frames = w.readframes(w.getnframes())

    if largura != 2:            # o Piper entrega 16-bit; se mudar, não arrisca
        logging.warning("WAV não é 16-bit (largura=%s) — sem lip-sync", largura)
        return [], ms_por_janela

    amostras = array.array("h", frames)   # 'h' = 16-bit com sinal
    if canais > 1:
        amostras = amostras[::canais]     # fica com um canal só (mono)

    por_janela = max(1, int(taxa * ms_por_janela / 1000))
    forcas = []
    for i in range(0, len(amostras), por_janela):
        janela = amostras[i:i + por_janela]
        if not janela:
            break
        rms = (sum(a * a for a in janela) / len(janela)) ** 0.5
        forcas.append(rms / 32768.0)      # normaliza 16-bit → 0..1

    pico = max(forcas, default=0.0)
    if pico > 0:
        forcas = [min(1.0, f / pico) for f in forcas]   # usa toda a faixa
    return forcas, ms_por_janela


def falar(texto, ao_falar=None):
    """Gera o áudio da fala e TOCA. Bloqueia até o fim (chamar numa thread).

    'ao_falar' liga o LIP-SYNC: se você passar uma função, ela é chamada com a
    força do som (0..1) no ritmo da fala — é o que move a boca do avatar junto.
    Sem ela, toca simples como na Rodada 8. Para qualquer fala anterior.
    """
    import winsound
    parar()
    texto = _limpar(texto)
    if not texto:
        return
    modelo = _carregar()
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav:
        modelo.synthesize_wav(texto, wav)
    dados = buffer.getvalue()

    if ao_falar is None:
        # Sem lip-sync: toca da memória, síncrono (não precisa de arquivo).
        winsound.PlaySound(dados, winsound.SND_MEMORY)
    else:
        _falar_com_boca(dados, ao_falar)


def _falar_com_boca(dados, ao_falar):
    """Toca o áudio SEM bloquear (async, de um arquivo temporário — porque o
    winsound não toca async da memória) e, em paralelo, percorre a envelope no
    ritmo, chamando 'ao_falar' pra mover a boca junto com o som."""
    import winsound
    minha = _geracao
    forcas, ms = _envelope(dados)
    temp = Path(tempfile.gettempdir()) / f"yato_fala_{minha}.wav"
    temp.write_bytes(dados)
    try:
        winsound.PlaySound(str(temp), winsound.SND_FILENAME | winsound.SND_ASYNC)
        inicio = time.perf_counter()
        for i, forca in enumerate(forcas):
            if _geracao != minha:
                return                       # interrompido — a nova fala assume
            alvo = inicio + i * (ms / 1000.0)
            espera = alvo - time.perf_counter()
            if espera > 0:
                time.sleep(espera)
            ao_falar(forca)
        if _geracao == minha:
            ao_falar(0.0)                    # terminou: fecha a boca
    finally:
        try:
            temp.unlink()
        except OSError:
            pass                             # ainda tocando/travado: deixa pra lá


def parar():
    """Silencia qualquer fala em andamento e AVISA o lip-sync pra parar (via o
    número de geração). Chamável de outra thread — é como a janela corta a voz
    numa nova mensagem."""
    global _geracao
    _geracao += 1
    import winsound
    winsound.PlaySound(None, winsound.SND_PURGE)
