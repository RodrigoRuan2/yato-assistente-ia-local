"""
A IMAGEM — o Yato desenha, gerando arte com o Forge (Stable Diffusion) local.

Sexto módulo do projeto, cada um com sua responsabilidade:
  personalidade.py = quem ele é      voz.py      = como FALA
  cerebro.py       = como pensa      ouvido.py   = como OUVE
  ferramentas.py   = o que faz       avatar2d.py = como aparece
  memoria.py       = o que lembra    imagem.py   = como DESENHA  ← aqui

Como funciona: o Forge (Stable Diffusion WebUI Forge) roda como um programa À
PARTE, aberto com a flag --api — isso expõe um endereço local que este módulo
chama por HTTP, sem chave nenhuma (é local, não é serviço pago). O checkpoint
carregado no Forge (o "Nova Anime XL" no seu caso) é quem desenha de fato.

O PULO DO GATO: modelos de imagem como o Nova Anime XL esperam prompt em
INGLÊS e detalhado — mas você não precisa saber inglês. `melhorar_prompt()`
usa o PRÓPRIO cérebro do Yato (o mesmo Ollama do cerebro.py) pra traduzir sua
descrição em português pra um prompt bom, com as tags de qualidade certas.

A DISPUTA DE VRAM: o Ollama (~5 GB) e o Forge/SDXL (~6-7 GB) NÃO cabem juntos
nos 8 GB da placa. Antes de gerar, `liberar_vram_ollama()` manda o Ollama
SOLTAR o modelo na hora (keep_alive=0) — o mesmo truque que o ver_imagem já
usa em ferramentas.py pra revezar com o olho da visão. Ele recarrega sozinho
na próxima mensagem do chat.
"""

import base64
import hashlib
import json
import logging
import os
import re
import subprocess
import time
from pathlib import Path

import requests

from cerebro import OLLAMA_URL, MODELO

FORGE_URL = "http://127.0.0.1:7860"
CIVITAI_API = "https://civitai.com/api/v1"
DANBOORU_URL = "https://danbooru.donmai.us"
PASTA_IMAGENS = Path(__file__).with_name("imagens_geradas")
# Cache no disco das trigger words dos LoRAs (nome -> {"trigger": "..."}). Cada
# LoRA é hasheado e consultado no Civitai UMA vez; depois vem daqui, instantâneo.
CACHE_TRIGGERS = Path(__file__).with_name("cache_lora_triggers.json")
# Cache do PERFIL de estilo de cada LoRA (nome -> {nome, baseModel, tags, desc}),
# usado pra RECOMENDAR a LoRA que combina com uma imagem.
CACHE_CATALOGO = Path(__file__).with_name("cache_catalogo.json")

# ONDE o Forge está instalado NA SUA MÁQUINA. Ele é um app gigante À PARTE, fora
# do repositório do Yato — por isso o caminho é absoluto e mora aqui (não no
# projeto). Dá pra apontar por variável de ambiente YATO_FORGE; se ela não
# existir, cai no caminho padrão abaixo. Mude se o seu Forge estiver noutro lugar.
PASTA_FORGE = Path(os.environ.get(
    "YATO_FORGE", r"C:\Users\ruanc\projetos\Criando o Yato\webui"))
BAT_FORGE = PASTA_FORGE / "webui-user.bat"
PASTA_LORA = PASTA_FORGE / "models" / "Lora"
PASTA_CHECKPOINTS = PASTA_FORGE / "models" / "Stable-diffusion"

_processo_forge = None   # o Popen do Forge, quando foi o Yato que o abriu

# As tags de qualidade recomendadas para o Nova Anime XL (checkpoint
# Illustrious) — confirmadas na página oficial do modelo no Civitai.
TAGS_QUALIDADE = ("masterpiece, best quality, amazing quality, 4k, "
                  "very aesthetic, high resolution, ultra-detailed, absurdres")
# O peso extra "(...):1.3" diz ao Forge "preste 1.3x mais atenção nisso" — o
# guia oficial do Illustrious recomenda reforçar assim justamente as tags de
# TEXTO, porque modelos de imagem são notoriamente ruins em desenhar letras
# (viram garranchos sem sentido). Sem isso, textos/legendas/logos aparecem do
# nada em cenas como "tela de show" ou "outdoor".
NEGATIVO_PADRAO = (
    "worst quality, low quality, blurry, bad anatomy, bad hands, "
    "(text, watermark, signature, username, logo, speech bubble:1.3)"
)
# CFG = quanto o modelo OBEDECE ao prompt (baixo = mais liberdade criativa,
# alto = mais literal porém "queimado"). 5 é o recomendado pro Illustrious.
# Constante aqui em cima = o "botão de qualidade" já tem lugar pra quando a
# gente for mexer em passos/resolução.
CFG_PADRAO = 5

_PROMPT_SISTEMA_MELHORAR = f"""Você traduz descrições em português para prompts de
geração de imagem em INGLÊS, no estilo de tags separadas por vírgula (padrão
Danbooru/Illustrious), como usado no checkpoint Nova Anime XL.

Regras:
- TODA palavra do prompt final deve estar em INGLÊS — sem NENHUMA palavra em
  português sobrando (nem "cantando", nem "palco", nem nada). Um prompt com
  mistura de idiomas confunde o modelo e gera texto embaralhado na imagem —
  isso é PROIBIDO. Releia sua resposta antes de entregar e troque qualquer
  palavra em português que tiver escapado.
- REGRA DE OURO sobre PERSONAGEM/OBRA CONHECIDA (anime, jogo, etc.): o modelo
  de imagem JÁ FOI TREINADO nesses personagens e sabe a aparência deles PERFEITAMENTE
  — melhor que você. Qualquer descrição física que você adicionar só vai ATRAPALHAR.
  Então, se a pessoa citar um personagem conhecido, seja MINIMALISTA e escreva
  APENAS, nesta ordem:
    <nome do personagem em inglês>, <nome da obra se souber>, <a cena/pose/cenário pedidos>
  PROIBIDO adicionar cabelo, cor dos olhos, roupa ou qualquer traço físico do
  personagem — mesmo que você ache que sabe. Exemplo do jeito CERTO:
    entrada: "satoru gojo em uma sala de aula"
    saída:   "gojo satoru, jujutsu kaisen, classroom, sitting, {TAGS_QUALIDADE}"
  (repare: NENHUMA tag de cabelo/olhos/roupa — o modelo de imagem cuida disso).
- Se NÃO for personagem conhecido (algo genérico, tipo "uma garota qualquer"),
  aí SIM traduza e EXPANDA em tags visuais concretas (aparência, roupas, pose,
  expressão, cenário, luz, cores).
- Termine SEMPRE com: {TAGS_QUALIDADE}
- Responda APENAS com o prompt final, sem explicações, sem aspas, sem markdown.
- Nunca inclua conteúdo adulto/explícito."""

# A instrução da INJEÇÃO (Rodada 12): tarefa MENOR que o melhorar_prompt. Aqui o
# Yato NÃO monta a cena nem as tags de qualidade — isso já vem pronto do preset.
# Ele só traduz UM personagem pra a tag booru canônica, pra encaixar no slot.
_PROMPT_SISTEMA_PERSONAGEM = """Você recebe o nome ou a descrição de UM personagem
(em português) e devolve APENAS as tags em INGLÊS que identificam esse personagem
— NADA de cena, pose, cenário ou qualidade.

Regras:
- Personagem CONHECIDO (anime, jogo, etc.): o modelo de imagem já sabe a
  aparência dele. Devolva SÓ, nesta ordem:
    <nome do personagem em inglês>, <nome da obra>, <1girl ou 1boy>
  Exemplos:
    "gojo"          -> gojo satoru, jujutsu kaisen, 1boy
    "rias gremory"  -> rias gremory, high school dxd, 1girl
  PROIBIDO adicionar cabelo, olhos, roupa ou qualquer traço físico — só ATRAPALHA.
- Descrição GENÉRICA (ex.: "uma garota de cabelo azul"): aí sim traduza pras
  tags visuais concretas. Ex.: "1girl, blue hair, short hair".
- Responda SÓ com as tags, em inglês, separadas por vírgula. Sem explicação, sem
  aspas, sem markdown, sem tags de qualidade, sem ponto final."""

# A instrução do VIRAR MOLDE (generalizar): pega um prompt cheio dos traços de UM
# personagem e devolve um MOLDE reutilizável — mesmo estilo/cena, mas com o slot
# {personagem} no lugar da aparência. Resolve o "quero o estilo, mas com OUTRO
# personagem" (senão o cabelo/olhos do original brigam com o novo).
_PROMPT_SISTEMA_GENERALIZAR = """Você recebe um prompt de imagem em INGLÊS (tags
booru, estilo Illustrious/Nova Anime XL) e transforma ele num MOLDE reutilizável:
mantém o ESTILO e a CENA, mas tira o que é do PERSONAGEM, pra outro personagem
poder entrar no lugar.

Faça assim:
- REMOVA as tags de APARÊNCIA/IDENTIDADE do personagem: nome de personagem;
  cabelo (cor e estilo, ex.: "blue hair", "long hair", "blunt bangs"); olhos
  (cor, ex.: "red eyes"); pele; corpo; chifres/orelhas/cauda de raça; e a
  contagem de gênero ("1girl", "1boy", "2girls"). O personagem novo traz isso.
- MANTENHA tudo que é ESTILO e CENA: qualidade (masterpiece, best quality...);
  tags de artista (ex.: "@sw33t"); enquadramento e pose (upper body, from behind,
  looking back); ângulo de câmera; luz; cenário/fundo; efeitos; clima; roupa
  genérica.
- Comece a resposta com "{personagem}, " e depois as tags mantidas.
- Responda SÓ com o prompt final, em inglês, sem explicação, sem aspas.

Exemplo:
entrada: "masterpiece, best quality, 1girl, solo, @sw33t, upper body, from behind, (white hair:1.2), blue hair, blunt bangs, (blue eyes:1.3), glowing eyes, kimono, snowflakes, dark background"
saída: "{personagem}, masterpiece, best quality, solo, @sw33t, upper body, from behind, glowing eyes, kimono, snowflakes, dark background\""""


class ImagemError(Exception):
    """Erro já traduzido pra mensagem amigável — quem chama não precisa
    entender de HTTP nem de Forge."""


def disponivel():
    """True se o Forge está aberto e respondendo (pra a UI avisar, não travar)."""
    try:
        r = requests.get(f"{FORGE_URL}/sdapi/v1/sd-models", timeout=3)
        return r.ok
    except requests.exceptions.RequestException:
        return False


def forge_instalado():
    """True se dá pra achar o webui-user.bat — ou seja, se o Yato consegue
    abrir o Forge sozinho. (Se der False, o caminho PASTA_FORGE está errado.)"""
    return BAT_FORGE.exists()


def abrir_forge():
    """Abre o Forge (webui-user.bat) numa JANELA DE TERMINAL PRÓPRIA, pra você
    acompanhar o boot (~40s no 1º boot) e os logs. NÃO espera ficar pronto —
    quem chama usa o esperar_disponivel() pra isso. Não abre de novo se já
    estiver no ar ou já estiver abrindo. Retorna False se não achou o .bat."""
    global _processo_forge
    if disponivel():
        return True   # já está no ar — nada a fazer
    if _processo_forge is not None and _processo_forge.poll() is None:
        return True   # já estamos abrindo — não abre uma segunda instância
    if not BAT_FORGE.exists():
        return False
    # Alguns ambientes definem NoDefaultCurrentDirectoryInExePath=1 (um
    # endurecimento de segurança) — isso faz o cmd NÃO procurar comandos na
    # pasta atual, e o webui-user.bat quebra logo no "call webui.bat". Tiramos
    # essa variável SÓ pro processo do Forge, pra ele sempre achar o webui.bat.
    ambiente = {k: v for k, v in os.environ.items()
                if k.lower() != "nodefaultcurrentdirectoryinexepath"}
    # cmd /c <bat> numa CONSOLE NOVA: o Forge ganha o próprio terminal (mostra o
    # boot e os logs) e NÃO morre junto se o Yato fechar. CREATE_NEW_CONSOLE só
    # existe no Windows — o getattr deixa o código não quebrar noutro sistema.
    nova_console = getattr(subprocess, "CREATE_NEW_CONSOLE", 0)
    _processo_forge = subprocess.Popen(
        ["cmd", "/c", str(BAT_FORGE)],
        cwd=str(PASTA_FORGE),
        env=ambiente,
        creationflags=nova_console,
    )
    return True


def esperar_disponivel(timeout=150, intervalo=2):
    """Fica checando até o Forge responder (ou estourar o timeout). Serve pra
    usar DEPOIS do abrir_forge(), porque o boot demora. Retorna True se ficou
    pronto a tempo. Chame numa thread — ela dorme entre as tentativas."""
    limite = time.time() + timeout
    while time.time() < limite:
        if disponivel():
            return True
        time.sleep(intervalo)
    return False


def listar_loras():
    """Os LoRAs (.safetensors) instalados na pasta do Forge. Devolve os NOMES
    como entram na tag <lora:NOME:peso> — o caminho relativo à pasta Lora, sem a
    extensão (subpastas viram 'subpasta/nome'). Lê a PASTA direto (funciona com o
    Forge fechado); vazio se a pasta não existir."""
    if not PASTA_LORA.exists():
        return []
    nomes = [arq.relative_to(PASTA_LORA).with_suffix("").as_posix()
             for arq in PASTA_LORA.rglob("*.safetensors")]
    return sorted(nomes)


def _ler_cache_triggers():
    """O cache de triggers do disco (leitura segura: se não existe ou corrompeu,
    devolve vazio em vez de quebrar)."""
    try:
        return json.loads(CACHE_TRIGGERS.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def _salvar_cache_triggers(dados):
    try:
        CACHE_TRIGGERS.write_text(json.dumps(dados, ensure_ascii=False, indent=2),
                                  encoding="utf-8")
    except OSError as erro:
        logging.warning("nao salvou o cache de triggers: %s", erro)


def _sha256_lora(nome):
    """O SHA256 do arquivo .safetensors do LoRA — o MESMO hash que o Civitai usa
    pra identificar o arquivo. Lê em blocos pra não carregar 200 MB na memória.
    None se o arquivo não existe."""
    # Concatena a extensão em vez de .with_suffix(): nomes com ponto (ex.:
    # "...1.0G") enganariam o with_suffix, que trocaria o ".0G" por ".safetensors".
    caminho = PASTA_LORA / (nome + ".safetensors")
    if not caminho.exists():
        return None
    h = hashlib.sha256()
    with open(caminho, "rb") as arq:
        for bloco in iter(lambda: arq.read(1 << 20), b""):
            h.update(bloco)
    return h.hexdigest()


def _extrair_trigger(trained_words):
    """Do campo `trainedWords` do Civitai (uma LISTA) tira a PALAVRA-gatilho.
    Pega o 1º item e, se for uma frase longa com vírgulas (às vezes o autor cola
    um prompt de exemplo inteiro), fica só com o trecho antes da 1ª vírgula — o
    gatilho de verdade. '' se a lista está vazia."""
    if not trained_words:
        return ""
    primeiro = (trained_words[0] or "").strip()
    if "," in primeiro:
        primeiro = primeiro.split(",")[0].strip()
    return primeiro


def trigger_de_lora(nome):
    """A trigger word de um LoRA (ex.: 'wc_painting'), consultando o Civitai pelo
    HASH do arquivo — casamento EXATO, sem chute pelo nome. O resultado fica em
    cache no disco (cada LoRA é hasheado/consultado uma única vez).

    Devolve '' quando: o LoRA não tem gatilho, não está no Civitai (404), ou não
    deu pra consultar (offline). NUNCA levanta erro — é um extra; se falhar, o
    fluxo segue sem trigger, como era antes."""
    cache = _ler_cache_triggers()
    if nome in cache:
        return cache[nome].get("trigger", "")

    hexhash = _sha256_lora(nome)
    if not hexhash:
        return ""

    trigger = ""
    try:
        r = requests.get(f"{CIVITAI_API}/model-versions/by-hash/{hexhash}",
                         timeout=20, headers={"User-Agent": "yato/1.0"})
        if r.status_code == 200:
            trigger = _extrair_trigger(r.json().get("trainedWords"))
        elif r.status_code != 404:
            logging.warning("Civitai by-hash (%s): HTTP %s", nome, r.status_code)
    except requests.exceptions.RequestException as erro:
        # Offline/timeout: NÃO grava no cache, pra tentar de novo numa próxima.
        logging.warning("trigger_de_lora(%s) falhou: %s", nome, erro)
        return ""

    # Grava mesmo quando vazio ('' = "esse LoRA não tem trigger no Civitai"),
    # senão a gente re-hashearia o arquivo toda vez à toa. 404 é resposta válida.
    cache[nome] = {"trigger": trigger}
    _salvar_cache_triggers(cache)
    return trigger


def injetar_trigger(prompt, trigger):
    """Põe a `trigger` word no INÍCIO do prompt — se ela ainda não estiver lá.
    Devolve o prompt novo (ou o mesmo, quando o trigger é vazio ou já presente).
    A checagem usa limites de palavra pra não confundir com pedaço de outra tag.
    Função pura (sem UI) — dá pra testar sozinha."""
    if not trigger:
        return prompt
    if re.search(rf"(?<!\w){re.escape(trigger)}(?!\w)", prompt):
        return prompt
    return f"{trigger}, {prompt}" if prompt.strip() else trigger


# --- (PARADO) Recomendar a LoRA por estilo — pronto, mas FORA da UI ------------
# O catálogo (perfil de estilo dos LoRAs via Civitai) e a lógica de casar estão
# prontos e testados. NÃO estão ligados na interface porque o elo fraco é o OLHO
# local: o qwen2.5vl chama quase tudo de "digital/anime" e raramente detecta
# estilo fino (aquarela, pintura) — então a recomendação por IMAGEM ficaria quieta
# quase sempre (ou daria match confuso). Guardado aqui pra quando existir um modelo
# de visão local melhor, ou pra virar "você escolhe o estilo → sugiro a LoRA".
def _perfil_civitai(hexhash):
    """{nome, tipo, baseModel, tags, desc} de um arquivo, pelo hash: by-hash dá
    nome/base; /models/{id} dá as TAGS e a descrição (é aí que mora o 'estilo').
    None se não achar ou der erro."""
    try:
        r = requests.get(f"{CIVITAI_API}/model-versions/by-hash/{hexhash}",
                         timeout=20, headers={"User-Agent": "yato/1.0"})
        if r.status_code != 200:
            return None
        v = r.json()
    except requests.exceptions.RequestException:
        return None
    mod = v.get("model") or {}
    perfil = {"nome": mod.get("name"), "baseModel": v.get("baseModel"),
              "tags": [], "desc": ""}
    mid = v.get("modelId")
    if mid:
        try:
            m = requests.get(f"{CIVITAI_API}/models/{mid}", timeout=20,
                             headers={"User-Agent": "yato/1.0"}).json()
            perfil["tags"] = m.get("tags") or []
            limpo = re.sub("<[^>]+>", " ", m.get("description") or "")
            perfil["desc"] = " ".join(limpo.split())[:200]
        except requests.exceptions.RequestException:
            pass
    return perfil


def _catalogo_loras():
    """Perfil de estilo (Civitai) de cada LoRA seu, com cache no disco. Cada LoRA é
    hasheado/consultado UMA vez (arquivos pequenos, ~3s no total). Devolve a lista
    dos que o Civitai reconheceu, cada um com o campo 'arquivo' (o nome do .safetensors)."""
    try:
        cache = json.loads(CACHE_CATALOGO.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        cache = {}
    catalogo, mudou = [], False
    for nome in listar_loras():
        if nome not in cache:
            hexhash = _sha256_lora(nome)
            cache[nome] = _perfil_civitai(hexhash) if hexhash else None
            mudou = True
        perfil = cache[nome]
        if perfil:
            catalogo.append({**perfil, "arquivo": nome})
    if mudou:
        try:
            CACHE_CATALOGO.write_text(json.dumps(cache, ensure_ascii=False, indent=2),
                                      encoding="utf-8")
        except OSError as erro:
            logging.warning("nao salvou o cache do catalogo: %s", erro)
    return catalogo


_SIS_RECOMENDA_LORA = (
    "Você recebe o ESTILO de uma imagem e uma lista de LoRAs (arquivo :: tags :: "
    "descrição). Escolha a ÚNICA LoRA cujo estilo CLARAMENTE combina com a imagem. "
    "Regra de ouro: se NENHUMA combinar com clareza, responda 'nenhum' — é melhor "
    "não sugerir do que sugerir errado. Responda em 2 linhas, exatamente:\n"
    "LORA: <nome do arquivo, ou nenhum>\nPORQUE: <1 frase curta em português>")


def recomendar_lora(descricao_estilo):
    """Dado o ESTILO de uma imagem (texto da visão), sugere a LoRA sua que mais
    combina — ou None se nada combina COM CLAREZA (só sugere com confiança; é uma
    dica, não uma regra). Devolve {'arquivo', 'motivo'} ou None. Nunca levanta erro."""
    if not descricao_estilo:
        return None
    try:
        catalogo = _catalogo_loras()
    except Exception as erro:                       # rede/JSON/o que for: sem dica
        logging.warning("recomendar_lora — catalogo falhou: %s", erro)
        return None
    if not catalogo:
        return None
    linhas = "\n".join(
        f"- {c['arquivo']} :: {', '.join((c.get('tags') or [])[:6])} :: {(c.get('desc') or '')[:90]}"
        for c in catalogo)
    try:
        resp = _perguntar_cerebro(
            _SIS_RECOMENDA_LORA, f"ESTILO DA IMAGEM: {descricao_estilo}\n\nLORAS:\n{linhas}",
            num_predict=120, temperatura=0.2, timeout=90, erro_falha="")
    except ImagemError:
        return None
    achado = re.search(r"LORA:\s*(.+)", resp)
    if not achado:
        return None
    escolha = achado.group(1).strip().strip('".')
    if not escolha or escolha.lower() in ("nenhum", "nenhuma", "none", "-"):
        return None                                 # o cérebro não achou match claro
    arquivo = next((c["arquivo"] for c in catalogo
                    if c["arquivo"].lower() == escolha.lower()
                    or escolha.lower() in c["arquivo"].lower()
                    or c["arquivo"].lower() in escolha.lower()), None)
    if not arquivo:
        return None
    motivo = re.search(r"PORQUE:\s*(.+)", resp)
    return {"arquivo": arquivo, "motivo": motivo.group(1).strip() if motivo else ""}


def listar_modelos():
    """Os checkpoints (modelos de imagem) instalados no Forge — cada um com um
    ponto forte diferente (anime, realismo…). Devolve uma lista de títulos
    (vazia se o Forge estiver fechado ou não tiver nenhum)."""
    try:
        r = requests.get(f"{FORGE_URL}/sdapi/v1/sd-models", timeout=10)
        r.raise_for_status()
        return [m["title"] for m in r.json()]
    except requests.exceptions.RequestException as erro:
        logging.warning("listar_modelos falhou: %s", erro)
        return []


def listar_modelos_disco():
    """Os checkpoints lidos DIRETO da pasta do Forge (models/Stable-diffusion) —
    serve pra você escolher o modelo mesmo com o Forge FECHADO (o listar_modelos
    via API só responde com ele aberto). Devolve os NOMES de arquivo (com extensão,
    como o Forge nomeia no título). Vazio se a pasta não existir."""
    if not PASTA_CHECKPOINTS.exists():
        return []
    nomes = [arq.name for arq in PASTA_CHECKPOINTS.rglob("*")
             if arq.suffix.lower() in (".safetensors", ".ckpt")]
    return sorted(nomes)


def modelo_atual():
    """O checkpoint carregado agora no Forge (None se não der pra saber)."""
    try:
        r = requests.get(f"{FORGE_URL}/sdapi/v1/options", timeout=10)
        r.raise_for_status()
        return r.json().get("sd_model_checkpoint")
    except requests.exceptions.RequestException:
        return None


def trocar_modelo(titulo):
    """Troca o checkpoint ativo no Forge. DEMORA (~10-40s: descarrega o atual
    e carrega o novo do disco) — chame numa thread. Levanta ImagemError se
    o Forge recusar ou estiver fechado."""
    try:
        r = requests.post(f"{FORGE_URL}/sdapi/v1/options",
                          json={"sd_model_checkpoint": titulo}, timeout=120)
        r.raise_for_status()
    except requests.exceptions.ConnectionError:
        raise ImagemError("O Forge está fechado — não dá pra trocar de modelo.")
    except requests.exceptions.RequestException as erro:
        logging.warning("trocar_modelo falhou: %s", erro)
        raise ImagemError("Não consegui trocar o modelo — confira o terminal do Forge.")


def liberar_vram_ollama():
    """Manda o Ollama soltar o modelo da GPU AGORA (sem gerar nada) — o Forge
    precisa da placa inteira. Truque: keep_alive=0 sem mensagens = descarrega
    na hora, em vez de esperar os minutos normais de ociosidade. Se o Ollama
    nem estiver aberto, não tem problema — ignora e segue."""
    try:
        requests.post(OLLAMA_URL, json={"model": MODELO, "messages": [],
                                        "keep_alive": 0}, timeout=10)
    except requests.exceptions.RequestException:
        pass   # Ollama fechado ou ocupado — a geração tenta mesmo assim


def _perguntar_cerebro(sistema, usuario, num_predict, temperatura, timeout,
                       erro_falha):
    """O MIOLO comum das três tarefas de prompt (melhorar / personagem / molde):
    manda uma pergunta ao Ollama e devolve o texto da resposta. As três só
    diferem no system prompt e nos números — o request, os erros e a extração
    são IDÊNTICOS, então moram aqui uma vez só (mudar o cérebro = mudar aqui)."""
    try:
        r = requests.post(
            OLLAMA_URL,
            json={
                "model": MODELO,
                "stream": False,
                "keep_alive": "10m",   # ele segue disponível pro chat depois
                "messages": [
                    {"role": "system", "content": sistema},
                    {"role": "user", "content": usuario},
                ],
                "options": {"num_predict": num_predict, "temperature": temperatura},
            },
            timeout=timeout,
        )
        r.raise_for_status()
    except requests.exceptions.ConnectionError:
        raise ImagemError("Meu cérebro tá desligado 💀 (abre o Ollama e tenta de novo)")
    except requests.exceptions.RequestException as erro:
        logging.warning("cérebro (imagem) falhou: %s", erro)
        raise ImagemError(erro_falha)
    return r.json().get("message", {}).get("content", "").strip()


def melhorar_prompt(descricao_pt):
    """Usa o cérebro (qwen2.5) pra traduzir sua descrição em português pra um
    prompt em inglês, com as tags de qualidade do Nova Anime XL. Devolve o
    prompt pronto — você ainda pode editar antes de gerar."""
    texto = _perguntar_cerebro(
        _PROMPT_SISTEMA_MELHORAR, descricao_pt,
        num_predict=250, temperatura=0.6, timeout=120,
        erro_falha="Não consegui melhorar o prompt — tenta de novo?")
    if not texto:
        raise ImagemError("O cérebro não devolveu nada — tenta descrever de outro jeito?")
    return texto


def buscar_personagens_danbooru(query, limite=8):
    """Autocomplete de PERSONAGEM no Danbooru — a MESMA fonte em que os modelos de
    anime (Illustrious/SDXL) foram treinados. Devolve [{tag, count}]: a tag JÁ com
    espaços (como vai no prompt) e a contagem de imagens (o quanto o modelo
    'conhece' o personagem = quão bem vai desenhar). Só tags de personagem
    (category 4). Lista vazia se a busca é curta demais ou falhou (offline) — NUNCA
    levanta erro; é um extra em cima do campo de texto."""
    query = (query or "").strip()
    if len(query) < 2:
        return []
    try:
        r = requests.get(
            f"{DANBOORU_URL}/autocomplete.json",
            params={"search[query]": query, "search[type]": "tag_query", "limit": 20},
            headers={"User-Agent": "yato/1.0"}, timeout=8)
        r.raise_for_status()
        dados = r.json()
    except (requests.exceptions.RequestException, ValueError):
        return []
    saida = []
    for it in dados:
        if it.get("category") != 4:              # 4 = personagem (ignora artista/etc.)
            continue
        tag = (it.get("value") or "").replace("_", " ")
        if tag:
            saida.append({"tag": tag, "count": it.get("post_count", 0)})
        if len(saida) >= limite:
            break
    return saida


def personagem_para_tags(pedido_pt):
    """Traduz UM personagem (em português) pra a tag booru canônica que entra no
    slot {personagem} de um preset. Ex.: "gojo" -> "gojo satoru, jujutsu kaisen,
    1boy". Tarefa pequena e focada — o preset já cuida da cena e da qualidade.
    Devolve a tag (string). Levanta ImagemError se o cérebro estiver fora."""
    if not pedido_pt or not pedido_pt.strip():
        return ""
    # Poucos tokens e temperatura baixa: tarefa curta e determinística (queremos
    # SEMPRE a mesma tag pro mesmo personagem, sem invenção).
    texto = _perguntar_cerebro(
        _PROMPT_SISTEMA_PERSONAGEM, pedido_pt,
        num_predict=60, temperatura=0.3, timeout=60,
        erro_falha="Não consegui traduzir o personagem — tenta de novo?")
    # Limpa sujeira comum: aspas, ponto final, quebras de linha.
    return texto.strip('".').replace("\n", " ")


# O FILTRO DE APARÊNCIA (determinístico): o cérebro é bom em RECONHECER o nome do
# personagem, mas ruim em APAGAR tags de um prompt longo (modelo pequeno tende a
# copiar tudo). Como tag booru é texto separado por vírgula, a gente apaga as de
# aparência por REGRA — confiável, sem depender do cérebro. Tudo que casar aqui
# sai do molde (o personagem novo traz os traços dele).
_APARENCIA_SUBSTR = ("hair", "eyes", "breasts", "skin")   # casa por pedaço no meio
# Tags que FORÇAM a paleta da imagem inteira — num molde elas pintam até a pele
# do novo personagem (ex.: "(blue theme:1.3)" deixou a Rias azul). Fora todas.
# (Qualquer "<cor> theme" também é pego pela regra endswith(" theme").)
_COR_FORCADA = {
    "monochrome", "greyscale", "grayscale", "limited palette", "spot color",
    "muted colors", "muted color", "sepia", "colored skin",
}
_APARENCIA_EXATAS = {
    "1girl", "1boy", "2girls", "2boys", "3girls", "3boys", "1other",
    "multiple girls", "multiple boys", "6+girls",
    "bangs", "blunt bangs", "swept bangs", "sidelocks", "ponytail", "twintails",
    "twin tails", "braid", "braids", "ahoge", "hime cut", "bob cut",
    "horns", "oni horns", "dragon horns", "pointy ears", "animal ears",
    "cat ears", "fox ears", "dog ears", "rabbit ears", "elf ears",
    "tail", "cat tail", "fox tail", "wings", "angel wings", "demon wings",
    "halo", "fang", "fangs", "heterochromia",
    "pale skin", "dark skin", "tan", "tanlines", "curvy", "flat chest",
    "thick thighs", "wide hips", "petite", "muscular", "slim",
}


def _tag_limpa(tag):
    """Tira peso e parênteses de uma tag: '(white hair:1.2)' -> 'white hair'."""
    t = tag.strip().strip("()")
    t = re.sub(r":[\d.]+$", "", t)   # o peso ":1.2" no fim
    return t.strip("() ").lower()


def _e_aparencia(tag):
    """True se a tag descreve a aparência/identidade do personagem OU força a
    paleta de cor da imagem (que num molde acaba pintando o personagem novo)."""
    limpo = _tag_limpa(tag)
    if limpo in _APARENCIA_EXATAS or limpo in _COR_FORCADA:
        return True
    if limpo.endswith(" theme"):   # "blue theme", "red theme", "dark theme"…
        return True
    return any(p in limpo for p in _APARENCIA_SUBSTR)


def _remover_aparencia(prompt):
    """Filtra as tags de aparência de um prompt, preservando o slot {personagem}
    na frente. É a rede de segurança confiável por cima do cérebro."""
    tem_slot = "{personagem}" in prompt
    tags = [t.strip() for t in prompt.split(",")]
    mantidas = [t for t in tags
                if t and t != "{personagem}" and not _e_aparencia(t)]
    corpo = ", ".join(mantidas)
    return f"{{personagem}}, {corpo}" if tem_slot else corpo


def generalizar_prompt(prompt_en):
    """Transforma um prompt cheio dos traços de UM personagem num MOLDE com o
    slot {personagem} — mantém estilo/cena, tira a aparência. Serve pra reusar o
    mesmo estilo com outro personagem. Devolve o prompt-molde (string).

    Duas camadas: o cérebro tira o NOME do personagem (o que ele faz bem) e um
    filtro no código tira as tags de APARÊNCIA (o que o cérebro faz mal)."""
    if not prompt_en or not prompt_en.strip():
        raise ImagemError("Sem prompt pra virar molde — escolha ou gere algo antes.")
    texto = _perguntar_cerebro(
        _PROMPT_SISTEMA_GENERALIZAR, prompt_en,
        num_predict=300, temperatura=0.4, timeout=90,
        erro_falha="Não consegui virar molde — tenta de novo?").strip('"')
    if not texto:
        raise ImagemError("O cérebro não devolveu o molde — tenta de novo?")
    # Rede de segurança: se o cérebro esquecer o slot, põe na frente.
    if "{personagem}" not in texto:
        texto = "{personagem}, " + texto
    # A CAMADA CONFIÁVEL: apaga as tags de aparência que o cérebro deixou passar.
    return _remover_aparencia(texto)


# --- Recomendador de prompt A PARTIR DE UMA IMAGEM (visão → tags → moldes) ---
_PROMPT_VISAO_ATRIBUTOS = (
    "Liste, em tópicos curtos, os atributos VISÍVEIS desta imagem úteis para "
    "recriá-la num gerador de imagem: número de pessoas, enquadramento/"
    "composição, pose, expressão, cabelo, roupa, iluminação, fundo/cenário e "
    "ESTILO de arte (ex.: aquarela, digital, lineart, pintura). NÃO tente "
    "adivinhar o nome do personagem nem de qual anime é.")

_PROMPT_SISTEMA_DA_IMAGEM = (
    "Você converte a descrição de uma imagem num prompt para Stable Diffusion "
    "(modelos booru/Illustrious).\n"
    "Devolva EXATAMENTE {n} variações, UMA POR LINHA, no formato:\n"
    "PROMPT ||| RESUMO\n"
    "onde PROMPT é o prompt em INGLÊS (só tags booru curtas separadas por "
    "vírgula) e RESUMO é uma frase curtíssima em PORTUGUÊS do que a imagem vai "
    "mostrar (pra quem não lê inglês entender).\n"
    "REGRAS:\n"
    "- No PROMPT, traduza TUDO para inglês. Use tags booru padrão (1girl, solo, "
    "portrait, close-up, long hair, black dress, dramatic lighting, dark "
    "background, digital art...).\n"
    "- Cubra: nº de pessoas, enquadramento, cabelo, roupa, expressão, luz, "
    "fundo e estilo de arte.\n"
    "- NÃO invente nome de personagem nem de anime.\n"
    "- As variações devem diferir no enquadramento ou na ênfase.\n"
    "- Sem numeração, sem texto extra além do formato PROMPT ||| RESUMO.\n"
    "IMPORTANTE: sua resposta deve ter EXATAMENTE {n} LINHAS (uma variação por "
    "linha). NÃO pare depois da primeira — escreva as {n} variações.")


def _parsear_variacoes(bruto, n):
    """Do texto do cérebro (várias linhas no formato 'PROMPT ||| RESUMO') tira até
    `n` pares (prompt_en, resumo_pt), limpos de numeração/bullets. Se uma linha
    não trouxer o resumo, devolve resumo vazio (o app cai num texto padrão)."""
    pares = []
    for ln in bruto.splitlines():
        ln = re.sub(r"^\s*(?:\d+[.\)]|[-*•])\s*", "", ln.strip()).strip()
        if "|||" in ln:
            en, pt = ln.split("|||", 1)
            en, pt = en.strip().strip('"'), pt.strip().strip('"')
        else:
            en, pt = ln.strip('"'), ""
        if en and "," in en:              # linha de prompt tem vírgulas
            pares.append((en, pt))
    return pares[:n]


def prompt_de_imagem(imagem_b64, n=3):
    """A partir de uma IMAGEM (base64), devolve até `n` sugestões — cada uma um
    par (molde, resumo_pt): o MOLDE de prompt (com o slot {personagem}) e um
    resumo curto em português do que vai sair. Três etapas:
      1. o olho (ver_imagem) descreve o que está VISÍVEL na imagem;
      2. o cérebro monta as tags booru em inglês + o resumo em PT (n variações);
      3. o filtro determinístico tira a aparência e põe o {personagem} na frente.
    De propósito NÃO identifica quem é o personagem (o 7B erra nomes) — você
    preenche o slot depois. Levanta ImagemError com recado claro se algo faltar."""
    if not imagem_b64:
        raise ImagemError("Cole (Ctrl+V) ou anexe uma imagem primeiro 🖼️")
    from ferramentas import ver_imagem   # lazy: evita qualquer import circular
    descricao = ver_imagem(_PROMPT_VISAO_ATRIBUTOS, imagem_b64=imagem_b64)
    if descricao.startswith("("):        # ver_imagem devolve os erros entre ()
        raise ImagemError("Não consegui olhar a imagem — o Ollama e o modelo de "
                          "visão estão no ar?")
    usuario = (f"{descricao}\n\nAgora gere as {n} variações (uma por linha, "
               f"formato PROMPT ||| RESUMO):")
    bruto = _perguntar_cerebro(
        _PROMPT_SISTEMA_DA_IMAGEM.replace("{n}", str(n)), usuario,
        num_predict=420, temperatura=0.8, timeout=120,
        erro_falha="Não consegui montar o prompt da imagem — tenta de novo?")
    pares = _parsear_variacoes(bruto, n)
    if not pares:
        raise ImagemError("O cérebro não devolveu um prompt utilizável — tenta outra imagem?")
    sugestoes = []
    for en, pt in pares:
        if "masterpiece" not in en.lower():   # garante as tags de qualidade
            en = f"{en}, {TAGS_QUALIDADE}"
        molde = _remover_aparencia("{personagem}, " + en)
        sugestoes.append((molde, pt))
    return sugestoes


def _detalhe_erro_forge(resposta):
    """O MOTIVO que o Forge mandou no CORPO do erro. O status sozinho ("500") não
    diz nada; o corpo traz o que ele não engoliu (parâmetro inválido, OOM…)."""
    try:
        dados = resposta.json()
    except (ValueError, AttributeError):
        return (getattr(resposta, "text", "") or "")[:200]
    for chave in ("detail", "error", "errors", "msg"):
        if dados.get(chave):
            return str(dados[chave])[:200]
    return str(dados)[:200]


def gerar(prompt, negativo=None, passos=25, largura=1024, altura=1024, hires=False):
    """Gera a imagem: libera a VRAM do Ollama, chama o Forge, salva o PNG em
    imagens_geradas/ e devolve o Path do arquivo.

    hires=True liga o "hires fix": gera na base e faz um 2º passe que AMPLIA
    (~1.5x) e adiciona detalhe — imagem maior e mais nítida (ótimo pra wallpaper),
    mas ~2x mais lenta e mais pesada na VRAM. Os números (escala, upscaler,
    denoise) são um ponto de partida — dá pra afinar aqui."""
    if not prompt or not prompt.strip():
        raise ImagemError("Sem prompt pra gerar — escreva ou melhore uma descrição antes.")

    liberar_vram_ollama()

    payload = {
        "prompt": prompt,
        "negative_prompt": negativo or NEGATIVO_PADRAO,
        "steps": passos,
        "width": largura,
        "height": altura,
        "cfg_scale": CFG_PADRAO,
    }
    if hires:
        payload.update({
            "enable_hr": True,
            "hr_scale": 1.5,          # 1024 -> ~1536; se der OOM nos 8GB, baixe
            # O Forge NÃO tem os upscalers "Latent" do A1111 antigo — passar um
            # nome inválido quebra ele. Esse é o melhor pra anime.
            "hr_upscaler": "R-ESRGAN 4x+ Anime6B",
            "hr_second_pass_steps": 15,
            "denoising_strength": 0.35,   # upscaler ESRGAN pede denoise BAIXO
            # PEGADINHA DO FORGE: campo só dele, que vem None por padrão — e o
            # Forge faz `'Use same choices' not in self.hr_additional_modules`
            # (processing.py:1405). Com None, todo hires morre em 500
            # "argument of type 'NoneType' is not iterable". Este é o padrão da
            # UI dele: o 2º passe usa os MESMOS módulos (VAE etc.) do modelo base.
            "hr_additional_modules": ["Use same choices"],
        })

    try:
        r = requests.post(
            f"{FORGE_URL}/sdapi/v1/txt2img", json=payload,
            # geração normal ~15-30s; com hires o 2º passe dobra — timeout maior.
            timeout=400 if hires else 180,
        )
        r.raise_for_status()
    except requests.exceptions.ConnectionError:
        raise ImagemError(
            "O Forge está fechado 🎨💤 (abra o webui-user.bat com --api e tenta de novo)")
    except requests.exceptions.Timeout:
        raise ImagemError("Demorou demais pra desenhar 😵 Tenta de novo?")
    except requests.exceptions.HTTPError as erro:
        # O Forge manda o MOTIVO no corpo da resposta — sem ler isso, um "500"
        # não diz nada e a gente fica no escuro (foi o que aconteceu no hires).
        detalhe = _detalhe_erro_forge(r)
        logging.warning("gerar (Forge) falhou: %s | resposta: %s", erro, detalhe)
        raise ImagemError(f"O Forge recusou: {detalhe or 'erro sem detalhe'}")
    except requests.exceptions.RequestException as erro:
        logging.warning("gerar (Forge) falhou: %s", erro)
        raise ImagemError("O Forge reclamou de alguma coisa — confira o terminal dele.")

    dados = r.json()
    imagens = dados.get("images") or []
    if not imagens:
        raise ImagemError("O Forge respondeu mas não veio nenhuma imagem — estranho.")

    PASTA_IMAGENS.mkdir(exist_ok=True)
    # Milissegundos no nome: duas gerações no MESMO segundo não se sobrescrevem
    # (com segundos, um lote rápido apagaria a imagem anterior).
    caminho = PASTA_IMAGENS / f"yato_{int(time.time() * 1000)}.png"
    caminho.write_bytes(base64.b64decode(imagens[0]))
    return caminho
