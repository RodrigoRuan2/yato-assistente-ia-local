"""
AS FERRAMENTAS — as "mãos" do Yato.

Conceito central de agentes de IA: o modelo NÃO executa nada. Ele só
DECIDE ("preciso buscar X") e devolve um pedido estruturado; quem executa
é este código Python comum. O modelo pensa; o Python age.

Cada ferramenta tem duas partes:
  1. A função Python de verdade (que faz o trabalho);
  2. A "ficha técnica" (schema) que o MODELO lê pra decidir quando usar.
     A description é a parte mais importante: é ela que ensina o modelo a
     usar a ferramenta na hora certa — nem demais, nem de menos.
"""

import logging

import requests
from bs4 import BeautifulSoup
from ddgs import DDGS

from memoria import anotar_fato, esquecer_fato

# Teto de texto devolvido por página lida. Por quê: a "mesa" do modelo tem
# 8192 tokens no total — uma página inteira de portal facilmente passa disso
# sozinha e expulsaria a conversa. ~6000 caracteres ≈ 1500-2000 tokens: cabe
# a leitura E sobra mesa pro resto.
MAX_CARACTERES_PAGINA = 6000

# Teto MENOR pra leitura embutida na busca enriquecida: ela chega junto com
# os resultados da busca, então o orçamento é dividido entre os dois.
MAX_CARACTERES_BUSCA = 4000

# O OLHO: o modelo de visão. O cérebro (qwen2.5:7b) é CEGO — quando precisa
# enxergar, esta ferramenta chama o modelo abaixo pra traduzir a imagem em
# texto. Trocar de olho = trocar esta constante.
# (Histórico: começamos com gemma3:4b; subimos pro qwen2.5vl:7b após o
# "ringue dos olhos" — em tela densa 1080p ele leu 12/12 itens contra 11/12
# do gemma, que errou justamente um valor em dinheiro. OCR é a prioridade.)
MODELO_VISAO = "qwen2.5vl:7b"

# Mesmo endereço que o cérebro usa (o Ollama serve todos os modelos na
# mesma porta — quem muda é o campo "model" do pedido).
OLLAMA_URL = "http://localhost:11434/api/chat"


def buscar_web(termo, max_resultados=4):
    """BUSCA ENRIQUECIDA: busca no DuckDuckGo E já lê a melhor página.

    Por que "enriquecida": os resuminhos do buscador (2 linhas cada) muitas
    vezes não contêm a resposta — ela mora DENTRO das páginas. O plano era
    o modelo abrir a página sozinho com ler_pagina... mas os testes provaram
    que o 7B não tem essa iniciativa (nem quando mandamos!). Solução de
    engenharia: quando o modelo não é confiável numa etapa, a etapa vira
    CÓDIGO determinístico. Aqui, a leitura acontece SEMPRE, automaticamente.

    Se a busca falhar, o erro vira texto pro modelo avisar com jeito.
    Se só a LEITURA falhar, degrada com elegância: entrega os resuminhos.
    """
    try:
        resultados = DDGS().text(termo, region="br-pt", max_results=max_resultados)
        if not resultados:
            return "(A busca não retornou nenhum resultado.)"
    except Exception as erro:
        logging.warning("Busca na web falhou: %s", erro)
        return (
            "(A busca na web FALHOU — provavelmente falta de internet ou "
            "limite de uso. Avise o usuário disso e responda com o que "
            "você já souber, deixando claro que pode estar desatualizado.)"
        )

    cartoes = "\n\n".join(
        f"[{r['title']}]\n{r['body']}\nFonte: {r['href']}"
        for r in resultados
    )

    # ---- O enriquecimento: abre a 1ª página que der certo (tenta até 2).
    # Sites bloqueiam robôs às vezes; se um falhar, o próximo da lista serve.
    leitura = ""
    for r in resultados[:2]:
        try:
            texto = _baixar_texto(r["href"], MAX_CARACTERES_BUSCA)
            if texto:
                leitura = (
                    f"\n\n===== CONTEÚDO DA PÁGINA MAIS RELEVANTE "
                    f"({r['href']}) =====\n{texto}"
                )
                break
        except Exception as erro:
            logging.warning("Enriquecimento falhou (%s): %s", r["href"], erro)

    return "===== RESULTADOS DA BUSCA =====\n\n" + cartoes + leitura


def _baixar_texto(url, limite):
    """Baixa uma página e devolve só o texto legível (uso interno).

    O trabalho de verdade aqui é a LIMPEZA: uma página crua é 90% HTML de
    layout (menus, scripts, propaganda). O BeautifulSoup tira o código e
    sobra o conteúdo — cortado no `limite` pra caber na "mesa".

    Repare: esta função EXPLODE se algo der errado (deixa a exceção subir).
    Quem decide o que fazer com a falha é quem chamou — a ferramenta pública
    traduz pro modelo; a busca enriquecida tenta a próxima página.
    """
    resposta = requests.get(
        url,
        timeout=15,
        # Alguns sites recusam pedidos "sem identidade"; este cabeçalho
        # nos apresenta como um navegador comum.
        headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"},
    )
    resposta.raise_for_status()
    sopa = BeautifulSoup(resposta.text, "html.parser")

    # MIRA NO MIOLO: páginas têm anatomia — <article>/<main> é o conteúdo;
    # <nav>/<header>/<footer> é a moldura (menus, rodapé). Sem este passo,
    # o teto de caracteres era DEVORADO pelo menu do site e o conteúdo de
    # verdade nem chegava ao modelo (pego no diagnóstico: 170 linhas de
    # "Home / SiteMap / 2015..." antes do guia começar).
    principal = sopa.find("article") or sopa.find("main") or sopa
    for lixo in principal(["script", "style", "noscript",
                           "nav", "header", "footer", "aside", "form"]):
        lixo.decompose()

    # PRESERVA as quebras de linha: um guia tem estrutura (um título por
    # linha, staff embaixo). Esmagar tudo numa linha fazia o modelo amassar
    # títulos e carimbar o staff de um anime nos vizinhos (pego na
    # auditoria). Limpa só os espaços DENTRO de cada linha.
    linhas = (" ".join(l.split()) for l in principal.get_text(separator="\n").splitlines())
    texto = "\n".join(l for l in linhas if l)
    if len(texto) > limite:
        texto = texto[:limite] + " (...página cortada aqui...)"
    return texto


def ler_pagina(url):
    """A ferramenta pública: abre uma página e devolve o texto — ou o erro
    traduzido em recado, pro modelo se virar sem quebrar o app."""
    try:
        texto = _baixar_texto(url, MAX_CARACTERES_PAGINA)
        return texto or "(A página abriu mas não tem texto legível.)"
    except Exception as erro:
        logging.warning("Leitura de página falhou (%s): %s", url, erro)
        return (f"(Não consegui abrir a página {url} — site fora do ar, "
                "bloqueio ou endereço inválido. Tente outra fonte ou avise "
                "o usuário.)")


def ver_imagem(pergunta, imagem_b64=None):
    """O olho emprestado: mostra a imagem anexada pro MODELO_VISAO e devolve
    o que ele viu, em texto.

    Detalhe de arquitetura: a imagem NÃO vem do modelo (ele é cego e não
    pode inventá-la) — o app guarda a imagem anexada e o cérebro a injeta
    aqui por fora, no imagem_b64. O modelo só decide A PERGUNTA.

    keep_alive=0: o olho desocupa a GPU assim que termina — os dois modelos
    não cabem juntos nos 8 GB, então a mesa precisa vagar pro cérebro voltar.
    """
    if not imagem_b64:
        return ("(Não há imagem anexada nesta mensagem. Peça ao usuário "
                "pra colar (Ctrl+V) ou anexar uma imagem.)")
    try:
        r = requests.post(
            OLLAMA_URL,
            json={
                "model": MODELO_VISAO,
                "stream": False,
                "keep_alive": 0,   # libera a VRAM logo após a olhada
                "messages": [{
                    "role": "user",
                    "content": (pergunta or "Descreva esta imagem em detalhes.")
                    + "\n(Responda em português brasileiro. Se houver texto na "
                      "imagem, transcreva-o fielmente.)",
                    "images": [imagem_b64],   # o campo de imagem da API
                }],
                "options": {"num_predict": 700},
            },
            # A 1ª olhada inclui CARREGAR o modelo de visão na GPU (~20-40s,
            # porque o cérebro precisa sair da mesa primeiro).
            timeout=300,
        )
        r.raise_for_status()
        visto = r.json().get("message", {}).get("content", "").strip()
        return visto or "(O olho abriu a imagem mas não devolveu descrição.)"
    except requests.exceptions.RequestException as erro:
        logging.warning("ver_imagem falhou: %s", erro)
        return (f"(Não consegui olhar a imagem — Ollama fora do ar ou o "
                f"modelo de visão '{MODELO_VISAO}' não está baixado.)")


# A ficha técnica, no formato padrão (JSON Schema) que a API entende.
# É ISTO que o modelo lê a cada mensagem pra decidir se busca ou não.
FERRAMENTAS = [
    {
        "type": "function",
        "function": {
            "name": "buscar_web",
            "description": (
                "Busca informações ATUAIS na internet: notícias, preços, "
                "cotações, resultados de jogos, lançamentos e eventos "
                "recentes — qualquer fato que pode ter mudado depois do seu "
                "treino. Devolve os resultados da busca E o conteúdo da "
                "página mais relevante, já aberto pra você. NÃO use para "
                "conversa casual nem para conhecimento estável (conceitos, "
                "história, programação)."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "termo": {
                        "type": "string",
                        "description": "O que buscar, direto e em poucas palavras",
                    }
                },
                "required": ["termo"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "ler_pagina",
            "description": (
                "Abre uma página da web (URL) e devolve o texto dela. Use "
                "DEPOIS de buscar_web, quando os resuminhos da busca não "
                "contêm a resposta e ela deve estar DENTRO de uma das "
                "páginas (listas, tabelas, artigos). Escolha a URL mais "
                "promissora dos resultados da busca."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {
                        "type": "string",
                        "description": "O endereço completo da página (http...)",
                    }
                },
                "required": ["url"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "anotar_fato",
            "description": (
                "Anota um fato DURADOURO sobre o usuário na sua memória "
                "permanente (nome, gostos, projetos, equipamento, "
                "preferências). Use quando o usuário revelar algo sobre si "
                "que valha lembrar em conversas FUTURAS, ou quando ele pedir "
                "explicitamente pra você lembrar. NÃO anote coisas "
                "passageiras (o humor do dia, a pergunta atual)."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "fato": {
                        "type": "string",
                        "description": "O fato, curto e direto. Ex: 'Se chama Ruan e estuda React'",
                    }
                },
                "required": ["fato"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "ver_imagem",
            "description": (
                "Olha a IMAGEM ANEXADA à mensagem do usuário e responde o "
                "que você perguntar sobre ela: descrever a cena, ler/"
                "transcrever texto, traduzir o que está escrito, identificar "
                "erros numa tela. Você é CEGO sem esta ferramenta — use-a "
                "SEMPRE que houver imagem anexada e a conversa se referir a "
                "ela. Só funciona se o usuário anexou imagem."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "pergunta": {
                        "type": "string",
                        "description": ("O que você quer saber da imagem. Ex: "
                                        "'Descreva tudo', 'Transcreva o texto', "
                                        "'Traduza o que está escrito'"),
                    }
                },
                "required": ["pergunta"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "esquecer_fato",
            "description": (
                "Apaga fatos da memória permanente. Use quando o usuário "
                "pedir pra esquecer algo ou corrigir uma informação antiga "
                "sobre ele."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "trecho": {
                        "type": "string",
                        "description": "Uma palavra ou trecho do fato a apagar",
                    }
                },
                "required": ["trecho"],
            },
        },
    },
]

# Mapa nome -> função. Ferramenta nova = escrever a função, a ficha
# técnica acima, e ligar aqui. Três passos, sempre.
_EXECUTORES = {
    "buscar_web": buscar_web,
    "ler_pagina": ler_pagina,
    "anotar_fato": anotar_fato,
    "esquecer_fato": esquecer_fato,
    "ver_imagem": ver_imagem,
}

# Quais ferramentas VÃO À WEB (pro contador da etiqueta e pra "fonte").
# Anotar/esquecer fato mexem só no disco local — não são "idas à web".
FERRAMENTAS_WEB = {"buscar_web", "ler_pagina"}

# Quais ferramentas precisam da IMAGEM anexada (o cérebro injeta por fora).
FERRAMENTAS_IMAGEM = {"ver_imagem"}


def descrever(nome, argumentos):
    """Frase curta do que a ferramenta está fazendo — pro aviso na tela."""
    if nome == "buscar_web":
        # "pesquisando" porque a busca enriquecida também LÊ a melhor página
        return f"🔍 pesquisando na web: {argumentos.get('termo', '?')}"
    if nome == "ler_pagina":
        return f"🔍 lendo a página: {argumentos.get('url', '?')[:60]}"
    if nome == "ver_imagem":
        return f"👁️ olhando a imagem: {argumentos.get('pergunta', '?')[:50]}"
    if nome == "anotar_fato":
        return f"📌 anotando: {argumentos.get('fato', '?')[:60]}"
    if nome == "esquecer_fato":
        return f"🗑️ esquecendo: {argumentos.get('trecho', '?')[:60]}"
    return f"🛠️ usando {nome}"


def executar(nome, argumentos):
    """Executa a ferramenta que o modelo pediu — com rede de proteção.

    O modelo pode alucinar um nome de ferramenta que não existe ou mandar
    argumentos errados. Nunca confie cegamente: devolvemos o problema como
    texto pra ele se corrigir, em vez de deixar o app explodir.
    """
    funcao = _EXECUTORES.get(nome)
    if funcao is None:
        return f"(Ferramenta desconhecida: {nome})"
    try:
        return funcao(**argumentos)
    except TypeError:
        return f"(Argumentos inválidos para {nome}: {argumentos})"
