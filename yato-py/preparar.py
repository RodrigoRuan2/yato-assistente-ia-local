"""
PREPARAR — monta o ambiente do Yato numa máquina nova, com um comando só.

O repositório traz só o CÓDIGO. Os "ingredientes pesados" (bibliotecas, voz,
cérebro) NÃO vão pro Git — este script baixa quase tudo:

  1. cria o ambiente virtual (.venv) e instala as bibliotecas;
  2. baixa a voz do Piper (pt-BR) pra a pasta vozes/;
  3. puxa o modelo do Ollama (o cérebro), se o Ollama já estiver instalado.

O ÚNICO passo manual é instalar o Ollama (é um programa externo) — o script
avisa se faltar. Rode a partir da pasta yato-py/ com:

    python preparar.py
"""

import shutil
import subprocess
import sys
import urllib.request
from pathlib import Path

# Acentos certos em qualquer terminal do Windows (senão "já" vira "j�").
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

RAIZ = Path(__file__).parent
VENV = RAIZ / ".venv"
PASTA_VOZES = RAIZ / "vozes"
MODELO_OLLAMA = "qwen2.5:7b"

# A voz do Piper vem do repositório oficial rhasspy/piper-voices (Hugging Face).
BASE_VOZ = ("https://huggingface.co/rhasspy/piper-voices/resolve/main/"
            "pt/pt_BR/faber/medium/")
ARQUIVOS_VOZ = ["pt_BR-faber-medium.onnx", "pt_BR-faber-medium.onnx.json"]


def _python_do_venv():
    """O python.exe dentro do .venv (Windows)."""
    return VENV / "Scripts" / "python.exe"


def passo_venv():
    print("\n[1/3] Ambiente virtual + bibliotecas")
    if VENV.exists():
        print("  .venv já existe — ok")
    else:
        print("  criando .venv ...")
        subprocess.run([sys.executable, "-m", "venv", str(VENV)], check=True)
    print("  instalando as bibliotecas (pode demorar na 1ª vez) ...")
    subprocess.run([str(_python_do_venv()), "-m", "pip", "install", "-q",
                    "-r", str(RAIZ / "requirements.txt")], check=True)
    print("  bibliotecas prontas  OK")


def _progresso(nome):
    """Mostra o quanto já baixou de um arquivo (callback do urlretrieve)."""
    def _cb(blocos, tam_bloco, total):
        if total > 0:
            pct = min(100, blocos * tam_bloco * 100 // total)
            print(f"\r  baixando {nome} ... {pct}%", end="", flush=True)
    return _cb


def passo_voz():
    print("\n[2/3] Voz do Piper (pt-BR, faber)")
    PASTA_VOZES.mkdir(exist_ok=True)
    for nome in ARQUIVOS_VOZ:
        destino = PASTA_VOZES / nome
        if destino.exists():
            print(f"  {nome} já existe — ok")
            continue
        urllib.request.urlretrieve(BASE_VOZ + nome, destino, _progresso(nome))
        print()   # quebra a linha do progresso
    print("  voz pronta  OK")


def passo_ollama():
    print("\n[3/3] Cérebro (Ollama)")
    if shutil.which("ollama") is None:
        print("  !! Ollama NÃO encontrado.")
        print("     Instale em https://ollama.com/download e depois rode:")
        print(f"       ollama pull {MODELO_OLLAMA}")
        return
    print(f"  puxando o modelo {MODELO_OLLAMA} (~4,7 GB — pode demorar) ...")
    subprocess.run(["ollama", "pull", MODELO_OLLAMA], check=True)
    print("  cérebro pronto  OK")


def main():
    print("=== Preparando o Yato ===")
    try:
        passo_venv()
        passo_voz()
        passo_ollama()
    except subprocess.CalledProcessError as e:
        print(f"\n!! Um passo falhou: {e}")
        print("   Confira a mensagem acima e rode de novo — o script pula o que já ficou pronto.")
        sys.exit(1)
    print("\nTudo pronto! Abra o Yato com um duplo-clique em 'Iniciar Yato.bat'")
    print("(ou:  .venv\\Scripts\\Activate.ps1  e depois  python app.py)")


if __name__ == "__main__":
    main()
