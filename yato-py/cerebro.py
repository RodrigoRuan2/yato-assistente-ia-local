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

import requests

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
# Por quê: o modelo só "vê" 4096 tokens por vez. Se mandássemos a conversa
# inteira pra sempre, o excedente seria cortado EM SILÊNCIO pelo Ollama — e o
# corte come do começo, onde mora a PERSONALIDADE. Nós decidimos o corte antes.
LIMITE_HISTORICO = 20

# Temperatura padrão: o "grau de ousadia" do modelo ao escolher cada palavra.
# 0.0 = pega sempre a palavra mais provável (previsível, repetitivo).
# 1.5 = se permite palavras improváveis (criativo, às vezes doido).
TEMPERATURA_PADRAO = 0.8


@dataclass
class Resposta:
    """Uma 'pensada' completa: o texto E os números por trás dele.

    (@dataclass é um atalho do Python: gera sozinho o __init__ e afins de uma
    classe que só carrega dados.) Antes a gente jogava esses números fora;
    agora eles aparecem na tela — cada resposta vira um experimento medido.
    """
    texto: str        # a fala da Yato
    tokens: int       # quantos tokens ela gerou nesta resposta
    segundos: float   # tempo gasto GERANDO (não conta carregar o modelo)

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


def pensar(mensagens, temperatura=TEMPERATURA_PADRAO, ao_receber=None):
    """Manda a conversa pro Ollama e devolve uma Resposta (texto + métricas).

    `mensagens` é uma lista no formato que a IA entende. Exemplo:
        [
            {"role": "system",    "content": "você é a Yato..."},
            {"role": "user",      "content": "oi"},
            {"role": "assistant", "content": "e aí, sumido!"},
            {"role": "user",      "content": "tudo bem?"},
        ]

    `ao_receber` é um CALLBACK (uma função que você entrega pra ser chamada
    de volta): se vier, ela é chamada com cada PEDACINHO de texto assim que
    a IA o gera — é o "streaming", o texto pingando ao vivo. Se não vier,
    o comportamento é o antigo: espera tudo e devolve no final.

    Detalhe-chave de como a IA funciona: ela NÃO tem memória entre chamadas.
    Cada chamada é uma folha em branco pra ela. Por isso mandamos a conversa
    INTEIRA toda vez — é isso que cria a ilusão de que ela "lembra".
    """
    try:
        resposta = requests.post(
            OLLAMA_URL,
            json={
                "model": MODELO,
                # stream=True: o Ollama manda a resposta AOS PEDAÇOS, um
                # token por linha, em vez de tudo de uma vez no final.
                # É a geração palavra-a-palavra ficando visível.
                "stream": True,
                "messages": _podar(mensagens),   # o modelo só vê o que cabe na "mesa"
                # Mantém o modelo carregado na memória por 10 min após a última
                # conversa. Sem isso, ele sai da memória rápido e CADA mensagem
                # paga de novo o carregamento (lento). Com isso, só a 1ª demora.
                "keep_alive": "10m",
                # Ajustes passados direto pro MODELO (não pro servidor):
                "options": {
                    "num_predict": MAX_TOKENS_RESPOSTA,  # trava dura de tamanho
                    "temperature": temperatura,          # ousadia DESTA resposta
                },
            },
            # Generoso de propósito: a PRIMEIRA chamada depois de ligar o PC
            # inclui o carregamento do modelo na placa de vídeo (~20s, e até
            # minutos em casos ruins). As seguintes respondem em segundos.
            timeout=300,
            stream=True,   # o do requests: "não baixe tudo, me dê aos poucos"
        )
        resposta.raise_for_status()             # erro HTTP vira exceção aqui

        # ---- A leitura do pinga-pinga ----
        # Cada linha que chega é um JSON pequeno: {"message": {"content": "pe"},
        # "done": false}. A ÚLTIMA linha vem com done=true E as métricas.
        partes = []
        final = {}
        for linha in resposta.iter_lines():
            if not linha:
                continue
            dado = json.loads(linha)
            pedaco = dado.get("message", {}).get("content", "")
            if pedaco:
                partes.append(pedaco)
                if ao_receber:
                    ao_receber(pedaco)   # avisa a tela: "chegou mais um pedaço!"
            if dado.get("done"):
                final = dado             # guarda a linha final (tem as métricas)

    # ----- Tradução de erros: de "tecniquês" pra recado claro -----
    except requests.exceptions.ConnectionError:
        # Nem conseguiu conectar na porta 11434: o Ollama não está aberto.
        raise CerebroError("Meu cérebro tá desligado 💀 (abre o Ollama e tenta de novo)")
    except requests.exceptions.Timeout:
        # Conectou, mas a resposta não veio a tempo (modelo travado/sobrecarregado).
        raise CerebroError("Pensei, pensei... e deu branco 😵 Tenta de novo?")
    except requests.exceptions.HTTPError:
        if resposta.status_code == 404:
            # 404 aqui significa: o Ollama não achou o modelo pedido.
            raise CerebroError(
                f"Cadê meu cérebro?! O modelo '{MODELO}' não está baixado 🤔 "
                f"(no terminal: ollama pull {MODELO})"
            )
        raise CerebroError(f"O Ollama reclamou: erro {resposta.status_code} 😬")
    except requests.exceptions.RequestException:
        # Qualquer outro tropeço de rede (ex.: conexão caiu NO MEIO do streaming).
        raise CerebroError("Nossa conexão caiu no meio da frase 😵 Tenta de novo?")

    return Resposta(
        texto="".join(partes).strip(),
        tokens=final.get("eval_count", 0),
        # eval_duration vem em NANOssegundos (bilionésimos de segundo);
        # dividir por 1 bilhão converte pra segundos normais.
        segundos=final.get("eval_duration", 0) / 1_000_000_000,
    )


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
