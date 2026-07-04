"""
O CÉREBRO — a parte que conversa com a IA local (Ollama).

Repare que aqui NÃO existe nada de janela/botão. É de propósito: a lógica de
"falar com a IA" fica separada da interface (que está em app.py). Vantagens:
  - dá pra testar o cérebro sozinho, sem abrir a janela (veja o final do arquivo);
  - no futuro, se você trocar o Ollama por outra coisa, mexe só aqui.
"""

import json
import time
from dataclasses import dataclass
from datetime import datetime

import requests

from ferramentas import (FERRAMENTAS, FERRAMENTAS_WEB, FERRAMENTAS_IMAGEM,
                         executar, descrever)
from memoria import carregar_fatos

# Endereço do Ollama na SUA máquina. O Ollama abre esse "servidorzinho" local
# enquanto está aberto (ícone perto do relógio do Windows).
OLLAMA_URL = "http://localhost:11434/api/chat"

# Qual modelo usar. Precisa estar baixado antes: `ollama pull qwen2.5:7b`.
# Trocar de modelo = trocar este nome. (Histórico: começamos no gemma3:4b;
# subimos pro qwen2.5:7b — quase 2x o cérebro, ainda 100% na GPU de 8 GB —
# quando as respostas estavam rasas demais. Modelo maior = mais conhecimento.)
MODELO = "qwen2.5:7b"

# Teto DURO de tokens por resposta — a rede de segurança contra textão
# infinito. 500 dá espaço pra explicações de verdade; a personalidade é
# quem pede proporção (papo curto = resposta curta). Defesa em camadas:
# a regra fina no prompt, o limite bruto na infraestrutura.
MAX_TOKENS_RESPOSTA = 500

# Quantas falas recentes o modelo enxerga (a personalidade não entra na conta).
# Por quê: a "mesa" do modelo é finita (CONTEXTO tokens, logo abaixo). Se
# mandássemos a conversa inteira pra sempre, o excedente seria cortado EM
# SILÊNCIO pelo Ollama — e o corte come do começo, onde mora a PERSONALIDADE.
LIMITE_HISTORICO = 20

# Temperatura padrão: o "grau de ousadia" do modelo ao escolher cada palavra.
# 0.0 = pega sempre a palavra mais provável (previsível, repetitivo).
# 1.5 = se permite palavras improváveis (criativo, às vezes doido).
TEMPERATURA_PADRAO = 0.8

# Tamanho da "mesa de trabalho" (janela de contexto), em tokens. Subimos do
# padrão 4096 pra 8192 porque os RESULTADOS DE BUSCA entram na mesa junto com
# a conversa — sem espaço extra, uma busca grande empurraria o papo pra fora.
# Custo: ~1 GB a mais de VRAM (cabe: sobram ~3 GB na GPU de 8 GB).
CONTEXTO = 8192

# Máximo de "voltas" de ferramenta numa mesma resposta. Trava de segurança:
# sem ela, um modelo confuso poderia buscar -> buscar -> buscar... pra sempre.
# 4 voltas = dá pro ciclo completo (buscar -> ler página -> ler outra ->
# responder) sem abrir espaço pra círculos infinitos.
MAX_VOLTAS_FERRAMENTAS = 4

# Teto da "fonte" guardada entre turnos (o que a última pesquisa trouxe).
# Ela é reinjetada a cada mensagem seguinte da MESMA conversa — precisa
# caber na mesa junto com todo o resto.
MAX_CARACTERES_FONTE = 5000


@dataclass
class Resposta:
    """Uma 'pensada' completa: o texto E os números por trás dele.

    (@dataclass é um atalho do Python: gera sozinho o __init__ e afins de uma
    classe que só carrega dados.) Antes a gente jogava esses números fora;
    agora eles aparecem na tela — cada resposta vira um experimento medido.
    """
    texto: str        # a fala do Yato
    tokens: int       # quantos tokens ele gerou nesta resposta
    segundos: float   # tempo gasto GERANDO (não conta carregar o modelo)
    buscas: int = 0   # quantas idas à web esta resposta precisou
    olhadas: int = 0  # quantas vezes o olho (ver_imagem) foi usado
    fonte: str = ""   # o que as ferramentas trouxeram (pra reusar no próximo turno)

    @property
    def velocidade(self):
        """Tokens por segundo — o 'fôlego' da sua GPU nesta resposta."""
        return self.tokens / self.segundos if self.segundos > 0 else 0.0


class CerebroError(Exception):
    """Erro já traduzido pra uma mensagem amigável, pronta pra mostrar na tela.

    A ideia: quem usa o cérebro (a janela) não precisa entender de HTTP.
    Aqui dentro descobrimos O QUE deu errado e entregamos o recado pronto.
    """


def _podar(mensagens):
    """Devolve: personalidade (system) + só as últimas N falas da conversa.

    O histórico completo continua guardado na janela (pra, no futuro, salvar
    em arquivo). Aqui a gente só decide o que o MODELO enxerga.
    """
    sistema = [m for m in mensagens if m["role"] == "system"]
    conversa = [m for m in mensagens if m["role"] != "system"]
    return sistema + conversa[-LIMITE_HISTORICO:]


def pensar(mensagens, temperatura=TEMPERATURA_PADRAO, ao_receber=None, ao_buscar=None,
           fonte_anterior=None, imagem=None):
    """Manda a conversa pro Ollama e devolve uma Resposta (texto + métricas).

    `mensagens` é uma lista no formato que a IA entende (system/user/assistant).

    Callbacks (funções que você entrega pra serem chamadas de volta):
      - `ao_receber(pedaco)`: cada pedacinho de texto gerado (o streaming);
      - `ao_buscar(termo)`: quando o modelo decide buscar na web — a tela
        usa isso pra mostrar a decisão dele ao vivo.

    O CICLO DO AGENTE: junto da conversa vai a lista de FERRAMENTAS. O
    modelo pode responder direto OU devolver um pedido estruturado
    ("busque X"). Nesse caso, NÓS executamos a busca, anexamos o resultado
    como mensagem de papel "tool", e chamamos o modelo DE NOVO — agora ele
    escreve a resposta final lendo o que a busca trouxe. Pensa → age → lê
    → responde: isso é um agente.

    Detalhe-chave: a IA NÃO tem memória entre chamadas. Cada chamada é uma
    folha em branco. Por isso a conversa inteira vai toda vez.
    """
    conversa = _podar(mensagens)   # cópia de trabalho (não mexe na original)

    buscas_feitas = 0
    olhadas_feitas = 0
    coletado = []   # tudo que as ferramentas trouxerem nesta pensada

    # ---- Complementos dinâmicos do system prompt ----
    # 1) A data: o modelo NÃO sabe que dia é hoje (treino tem data de corte).
    #    Sem isto, ele busca "lançamentos maio 2023" em pleno 2026.
    # 2) A fonte anterior: o que a ÚLTIMA pesquisa trouxe. Sem isto, num
    #    "continua a lista" a fonte já evaporou — e o modelo, mandado a
    #    continuar sem material, continuava INVENTANDO (visto nos prints!).
    extra = f"\n\nData de hoje: {datetime.now().strftime('%d/%m/%Y')}."
    # 3) Os FATOS da memória permanente: relidos do disco a toda chamada
    #    (fato anotado agora já vale na próxima mensagem). É a "cola" que
    #    faz um modelo sem memória parecer que conhece o usuário.
    fatos = carregar_fatos()
    if fatos:
        extra += ("\n\nO que você já sabe sobre o usuário (memória permanente):\n"
                  + "\n".join(f"- {f}" for f in fatos))
    if fonte_anterior:
        extra += (
            "\n\n=== FONTE DA PESQUISA ANTERIOR (desta mesma conversa) ===\n"
            "Use isto para continuar listas e responder perguntas de "
            "acompanhamento SEM inventar. Se não bastar, busque de novo.\n"
            + fonte_anterior
        )
    # 4) A imagem anexada: OLHADA AUTOMÁTICA. Testamos pedir pro modelo
    #    chamar ver_imagem sozinho — ele ignorou o aviso (a eterna falta de
    #    iniciativa do 7B). Doutrina da casa: etapa não-confiável vira
    #    código. Anexou imagem = quer que ele veja; o olho roda JÁ, e a
    #    descrição entra pronta no prompt. A ferramenta segue disponível
    #    pra segundas olhadas com outra pergunta.
    if imagem:
        if ao_buscar:
            ao_buscar("👁️ olhando a imagem anexada")
        pergunta_usuario = next(
            (m["content"] for m in reversed(conversa) if m["role"] == "user"), "")
        visto = executar("ver_imagem", {
            # O qwen2.5vl é um leitor LITERAL: se pedir só "descreva", ele
            # transcreve o texto e ignora o resto. Por isso a pergunta exige
            # as DUAS coisas, numeradas.
            "pergunta": ("Responda em duas partes: "
                         "1) DESCRIÇÃO: tudo que aparece na imagem — objetos, "
                         "pessoas, formas, cores, layout. "
                         "2) TEXTO: transcrição fiel de todo texto visível. "
                         "Pergunta do usuário sobre a imagem: "
                         + pergunta_usuario),
            "imagem_b64": imagem,
        })
        olhadas_feitas += 1
        coletado.append("O QUE A IMAGEM ANEXADA CONTÉM (via ver_imagem):\n" + visto)
        extra += (
            "\n\n=== O QUE HÁ NA IMAGEM ANEXADA (já vista pela ferramenta "
            "ver_imagem) ===\n" + visto +
            "\n(Responda ao usuário com base nesta descrição — ela é "
            "confiável. Precisa de OUTRO detalhe? Chame ver_imagem de novo.)"
        )
    conversa = [
        {**m, "content": m["content"] + extra} if m["role"] == "system" else m
        for m in conversa
    ]

    for _ in range(MAX_VOLTAS_FERRAMENTAS):
        partes = []    # pedaços de texto desta volta
        pedidos = []   # pedidos de ferramenta desta volta
        final = {}     # a linha final do streaming (traz as métricas)

        try:
            resposta = requests.post(
                OLLAMA_URL,
                json={
                    "model": MODELO,
                    # stream=True: o Ollama manda a resposta AOS PEDAÇOS —
                    # a geração palavra-a-palavra ficando visível.
                    "stream": True,
                    "messages": conversa,
                    "tools": FERRAMENTAS,   # a lista de ferramentas disponíveis
                    # Mantém o modelo carregado por 10 min após a última
                    # conversa — sem isso, cada mensagem pagaria a carga (~20s).
                    "keep_alive": "10m",
                    # Ajustes passados direto pro MODELO (não pro servidor):
                    "options": {
                        "num_predict": MAX_TOKENS_RESPOSTA,  # trava de tamanho
                        "temperature": temperatura,          # ousadia da resposta
                        "num_ctx": CONTEXTO,                 # tamanho da "mesa"
                    },
                },
                # Generoso: a 1ª chamada após ligar o PC inclui carregar o
                # modelo na GPU (~20-30s). As seguintes respondem em segundos.
                timeout=300,
                stream=True,   # o do requests: "me entregue aos poucos"
            )
            resposta.raise_for_status()         # erro HTTP vira exceção aqui

            # ---- A leitura do pinga-pinga ----
            for linha in resposta.iter_lines():
                if not linha:
                    continue
                dado = json.loads(linha)
                mensagem = dado.get("message", {})
                pedaco = mensagem.get("content", "")
                if pedaco:
                    partes.append(pedaco)
                    if ao_receber:
                        ao_receber(pedaco)   # avisa a tela: "chegou mais um!"
                # Pedidos de ferramenta chegam por aqui, já estruturados:
                pedidos.extend(mensagem.get("tool_calls") or [])
                if dado.get("done"):
                    final = dado             # a linha final tem as métricas

        # ----- Tradução de erros: de "tecniquês" pra recado claro -----
        except requests.exceptions.ConnectionError:
            raise CerebroError("Meu cérebro tá desligado 💀 (abre o Ollama e tenta de novo)")
        except requests.exceptions.Timeout:
            raise CerebroError("Pensei, pensei... e deu branco 😵 Tenta de novo?")
        except requests.exceptions.HTTPError:
            if resposta.status_code == 404:
                raise CerebroError(
                    f"Cadê meu cérebro?! O modelo '{MODELO}' não está baixado 🤔 "
                    f"(no terminal: ollama pull {MODELO})"
                )
            raise CerebroError(f"O Ollama reclamou: erro {resposta.status_code} 😬")
        except requests.exceptions.RequestException:
            raise CerebroError("Nossa conexão caiu no meio da frase 😵 Tenta de novo?")

        # Sem pedido de ferramenta? Então isto É a resposta final. Fim do ciclo.
        if not pedidos:
            return Resposta(
                texto="".join(partes).strip(),
                tokens=final.get("eval_count", 0),
                # eval_duration vem em NANOssegundos; ÷ 1 bilhão = segundos.
                segundos=final.get("eval_duration", 0) / 1_000_000_000,
                buscas=buscas_feitas,
                olhadas=olhadas_feitas,
                # A fonte desta pensada, cortada no teto — quem chamou pode
                # guardá-la e devolvê-la no próximo turno (fonte_anterior).
                fonte="\n\n".join(coletado)[:MAX_CARACTERES_FONTE],
            )

        # O modelo pediu ferramenta(s): executa cada uma e anexa o resultado
        # na conversa — na próxima volta do laço, ele lê e conclui.
        conversa = conversa + [
            {"role": "assistant", "content": "".join(partes), "tool_calls": pedidos}
        ]
        for pedido in pedidos:
            nome = pedido.get("function", {}).get("name", "")
            argumentos = pedido.get("function", {}).get("arguments", {}) or {}
            if ao_buscar:
                ao_buscar(descrever(nome, argumentos))  # mostra a decisão na tela
            if nome in FERRAMENTAS_IMAGEM:
                # a imagem entra POR FORA: o modelo (cego) só decide a
                # pergunta; quem anexa a imagem de verdade é o código.
                argumentos = {**argumentos, "imagem_b64": imagem}
            resultado = executar(nome, argumentos)
            if nome in FERRAMENTAS_WEB:
                # só idas à web contam na etiqueta e viram "fonte";
                # anotar/esquecer fato é ação local, não pesquisa
                buscas_feitas += 1
                coletado.append(resultado)
            elif nome in FERRAMENTAS_IMAGEM:
                olhadas_feitas += 1
                # a descrição vira "fonte" também: perguntas seguintes sobre
                # a mesma imagem usam o TEXTO, sem pagar outra troca de GPU
                coletado.append("O QUE A IMAGEM ANEXADA CONTÉM (via ver_imagem):\n"
                                + resultado)
            conversa.append({"role": "tool", "content": resultado, "tool_name": nome})

    # Estourou o limite de voltas: melhor parar com uma mensagem honesta
    # do que deixar o modelo buscando em círculos.
    raise CerebroError("Me enrolei nas buscas e não cheguei numa resposta 😵 Tenta de novo?")


def acordar(tentativas=6, espera=5):
    """Pede pro Ollama CARREGAR o modelo na GPU — sem gerar resposta nenhuma.

    Truque documentado da API: um pedido com a lista de mensagens VAZIA só
    carrega o modelo e devolve na hora. A janela chama isto (em segundo
    plano) assim que abre: os ~20s de carregamento acontecem ENQUANTO você
    digita a primeira mensagem, em vez de te fazer esperar depois dela.

    POR QUE AS TENTATIVAS: o atalho "Iniciar Yato" abre o Ollama e a janela
    JUNTOS — e o servidor do Ollama leva alguns segundos pra ficar de pé.
    Se tentássemos uma vez só, o status diria "Ollama fechado" (mentira!)
    só porque chegamos cedo demais. Então insistimos por até ~30s antes
    de desistir de verdade.

    Devolve True se o cérebro ficou pronto, False se o Ollama não respondeu.
    """
    for tentativa in range(tentativas):
        try:
            r = requests.post(
                OLLAMA_URL,
                json={"model": MODELO, "messages": [], "keep_alive": "10m"},
                timeout=180,
            )
            if r.ok:
                return True
        except requests.exceptions.RequestException:
            pass  # servidor ainda subindo (ou fechado) — tenta de novo
        if tentativa < tentativas - 1:   # não dorme depois da última
            time.sleep(espera)
    return False


# ---------------------------------------------------------------------------
# TESTE RÁPIDO (sem janela):
#   abra o terminal na pasta e rode  ->  python cerebro.py
# Serve pra confirmar que o Ollama está no ar e respondendo.
# Este bloco só roda quando você executa ESTE arquivo direto.
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import sys
    # O terminal do Windows usa uma codificação antiga (cp1252) que não imprime
    # emojis. Isto força UTF-8 só na hora de imprimir, pra não quebrar o teste.
    # (Na janela gráfica do app.py isso não é necessário — Tkinter já lida bem.)
    sys.stdout.reconfigure(encoding="utf-8")

    from personalidade import PERSONALIDADE

    conversa = [
        {"role": "system", "content": PERSONALIDADE},
        {"role": "user", "content": "oi, se apresenta rapidinho"},
    ]
    print("Pensando... (a 1ª resposta após ligar o PC demora um pouco)\n")
    r = pensar(conversa)
    print("Yato:", r.texto)
    print(f"({r.tokens} tokens em {r.segundos:.1f}s = {r.velocidade:.0f} tokens/s)")
