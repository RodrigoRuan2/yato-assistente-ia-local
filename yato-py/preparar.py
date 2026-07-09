"""
PREPARAR — monta o ambiente do Yato numa máquina nova, com um comando só.

O repositório traz só o CÓDIGO. Os "ingredientes pesados" (bibliotecas, voz,
cérebro, avatar) NÃO vão pro Git — este script baixa quase tudo:

  1. cria o ambiente virtual (.venv) e instala as bibliotecas;
  2. baixa a voz do Piper (pt-BR) e o modelo do Whisper (ouvir);
  3. baixa o avatar Live2D (Cubism Core + modelo Natori) pra local;
  4. puxa o modelo do Ollama (o cérebro), se o Ollama já estiver instalado.

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

# O avatar: as libs MIT (avatar/lib/) vêm no repo; o Cubism Core (proprietário)
# e o modelo Natori (Free Material License) NÃO — este script baixa os dois.
PASTA_AVATAR = RAIZ / "avatar"
URL_CUBISM_CORE = ("https://cubism.live2d.com/sdk-web/cubismcore/"
                   "live2dcubismcore.min.js")
BASE_MODELO = ("https://cdn.jsdelivr.net/gh/Live2D/CubismWebSamples@develop/"
               "Samples/Resources/Natori/")
# A Live2D bloqueia download "sem cara de navegador" (403) — daí o User-Agent.
_UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}


def _python_do_venv():
    """O python.exe dentro do .venv (Windows)."""
    return VENV / "Scripts" / "python.exe"


def passo_venv():
    print("\n[1/5] Ambiente virtual + bibliotecas")
    if VENV.exists():
        print("  .venv já existe — ok")
    else:
        print("  criando .venv ...")
        subprocess.run([sys.executable, "-m", "venv", str(VENV)], check=True)
    print("  instalando as bibliotecas (pode demorar na 1ª vez) ...")
    subprocess.run([str(_python_do_venv()), "-m", "pip", "install", "-q",
                    "-r", str(RAIZ / "requirements.txt")], check=True)
    print("  bibliotecas prontas  OK")
    _desbloquear_dlls()


def _desbloquear_dlls():
    """Tira a marca 'baixado da internet' das DLLs das libs. Sem isso, o
    Controle de Aplicativo/SmartScreen do Windows pode bloquear alguma — foi o
    que aconteceu com o PyAV (do Whisper). Só no Windows; falhas são ignoradas."""
    if sys.platform != "win32":
        return
    libs = VENV / "Lib" / "site-packages"
    print("  desbloqueando as DLLs (Windows) ...")
    subprocess.run(
        ["powershell", "-NoProfile", "-Command",
         f"Get-ChildItem -LiteralPath '{libs}' -Recurse -File "
         "-Include *.dll,*.pyd | Unblock-File -ErrorAction SilentlyContinue"],
        check=False,
    )


def _progresso(nome):
    """Mostra o quanto já baixou de um arquivo (callback do urlretrieve)."""
    def _cb(blocos, tam_bloco, total):
        if total > 0:
            pct = min(100, blocos * tam_bloco * 100 // total)
            print(f"\r  baixando {nome} ... {pct}%", end="", flush=True)
    return _cb


def passo_voz():
    print("\n[2/5] Voz do Piper (pt-BR, faber)")
    PASTA_VOZES.mkdir(exist_ok=True)
    for nome in ARQUIVOS_VOZ:
        destino = PASTA_VOZES / nome
        if destino.exists():
            print(f"  {nome} já existe — ok")
            continue
        urllib.request.urlretrieve(BASE_VOZ + nome, destino, _progresso(nome))
        print()   # quebra a linha do progresso
    print("  voz pronta  OK")


def passo_whisper():
    print("\n[3/5] Reconhecimento de voz (Whisper small)")
    print("  baixando o modelo (~460 MB na 1ª vez) ...")
    subprocess.run(
        [str(_python_do_venv()), "-c",
         "from faster_whisper import WhisperModel; "
         "WhisperModel('small', device='cpu', compute_type='int8')"],
        check=True,
    )
    print("  reconhecimento pronto  OK")


def _baixar(url, destino):
    """Baixa um arquivo com 'cara de navegador' (a Live2D exige) pra 'destino'."""
    destino.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(url, headers=_UA)
    destino.write_bytes(urllib.request.urlopen(req, timeout=60).read())


def passo_avatar():
    import json
    print("\n[4/5] Avatar Live2D (Cubism Core + modelo Natori)")
    core = PASTA_AVATAR / "live2dcubismcore.min.js"
    if core.exists():
        print("  Cubism Core já existe — ok")
    else:
        print("  baixando o Cubism Core ...")
        _baixar(URL_CUBISM_CORE, core)
    modelo = PASTA_AVATAR / "modelos" / "Natori"
    if (modelo / "Natori.model3.json").exists():
        print("  modelo Natori já existe — ok")
    else:
        print("  baixando o modelo Natori (~3 MB) ...")
        _baixar(BASE_MODELO + "Natori.model3.json", modelo / "Natori.model3.json")
        # o model3.json LISTA todos os outros arquivos — baixa cada um deles
        fr = json.loads((modelo / "Natori.model3.json")
                        .read_text(encoding="utf-8"))["FileReferences"]
        caminhos = []
        if fr.get("Moc"):
            caminhos.append(fr["Moc"])
        caminhos += fr.get("Textures", [])
        for chave in ("Physics", "Pose", "DisplayInfo"):
            if fr.get(chave):
                caminhos.append(fr[chave])
        for e in fr.get("Expressions", []):
            caminhos.append(e["File"])
        for grupo in fr.get("Motions", {}).values():
            for m in grupo:
                caminhos.append(m["File"])
        for c in caminhos:
            _baixar(BASE_MODELO + c, modelo / c)
    print("  avatar pronto  OK")


def passo_ollama():
    print("\n[5/5] Cérebro (Ollama)")
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
        passo_whisper()
        passo_avatar()
        passo_ollama()
    except subprocess.CalledProcessError as e:
        print(f"\n!! Um passo falhou: {e}")
        print("   Confira a mensagem acima e rode de novo — o script pula o que já ficou pronto.")
        sys.exit(1)
    print("\nTudo pronto! Abra o Yato com um duplo-clique em 'Iniciar Yato.bat'")
    print("(ou:  .venv\\Scripts\\Activate.ps1  e depois  python app.py)")


if __name__ == "__main__":
    main()
