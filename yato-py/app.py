"""
A JANELA — a interface gráfica do chat (CustomTkinter).

Aqui mora só a TELA e o que o usuário faz nela. Toda a parte de "falar com a
IA" está em cerebro.py. Essa separação (tela de um lado, lógica do outro) é o
que mantém o projeto organizado quando ele cresce.

Conceitos novos que aparecem aqui e valem estudar:
  - CLASSE: 'App' é um molde que junta os dados (o histórico) com as funções
    que mexem na tela. 'self' é "este objeto / esta janela".
  - THREAD: pedir a resposta da IA pode demorar segundos. Se a gente esperasse
    na thread principal, a janela CONGELARIA. Então a chamada roda numa thread
    separada (de fundo) e devolve o resultado pra tela quando termina.
"""

import logging
import re
import threading
from logging.handlers import RotatingFileHandler
from pathlib import Path

import customtkinter as ctk

from personalidade import PERSONALIDADE
from cerebro import pensar, acordar, CerebroError, MODELO, TEMPERATURA_PADRAO
from memoria import salvar_conversa, carregar_conversa

# ---- Diário de bordo (yato.log, criado ao lado deste arquivo) ----
# Por que existe: aberto pelo atalho (pythonw), o app NÃO tem terminal —
# qualquer erro sumiria sem deixar rastro. Aqui, tudo fica registrado.
# RotatingFileHandler = log com teto: ao passar de 500 KB, vira yato.log.1
# e recomeça — o diário nunca cresce pra sempre.
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)s  %(message)s",
    handlers=[RotatingFileHandler(
        Path(__file__).with_name("yato.log"),
        maxBytes=500_000, backupCount=1, encoding="utf-8",
    )],
)

# Aparência geral: tema escuro e cor de destaque.
ctk.set_appearance_mode("dark")
ctk.set_default_color_theme("blue")


def limpar_markdown(texto):
    """Tira a formatação markdown que a janela não sabe desenhar.

    Por quê: modelos adoram responder com **negrito** e ```código``` — e a
    instrução "não use markdown" no prompt não é obedecida sempre. Defesa em
    camadas: o prompt PEDE, esta função GARANTE. E só na hora de EXIBIR — o
    histórico guarda o texto original intocado (apresentação ≠ dado).
    """
    texto = re.sub(r"```[a-zA-Z0-9]*\n?", "", texto)          # cercas de código
    texto = texto.replace("**", "").replace("`", "")           # negrito e crases
    texto = re.sub(r"^#{1,6}\s*", "", texto, flags=re.MULTILINE)  # títulos #
    return texto.strip()


class App(ctk.CTk):
    def __init__(self):
        super().__init__()
        self.title("Yato — IA local")
        self.geometry("520x660")
        self.minsize(420, 480)

        # ---- ESTADO: o histórico da conversa mora aqui ----
        # Personalidade sempre FRESCA (vem do código, nunca do disco) +
        # as falas salvas da última sessão (vêm do conversa.json, se houver).
        self.mensagens = [{"role": "system", "content": PERSONALIDADE}]
        self.mensagens += carregar_conversa()

        self.bolha_pensando = None   # o balão da resposta em andamento
        self.rotulo_pensando = None  # o TEXTO dentro dele (atualiza no streaming)
        self.texto_parcial = ""      # o que já chegou da resposta atual

        self._montar_tela()

        # Acorda o cérebro em SEGUNDO PLANO assim que a janela abre: o modelo
        # carrega na GPU enquanto você digita a 1ª mensagem — em vez de te
        # fazer encarar 20s de "digitando…" depois dela.
        threading.Thread(target=self._acordar_cerebro, daemon=True).start()

    # ----------------------------------------------------------------- tela
    def _montar_tela(self):
        # ---- Topo: título + status do cérebro + botão de nova conversa ----
        topo = ctk.CTkFrame(self, fg_color="transparent")
        topo.pack(fill="x", padx=12, pady=(12, 6))

        ctk.CTkLabel(
            topo,
            text=f"⚔️  Yato  ·  {MODELO}",
            font=ctk.CTkFont(size=16, weight="bold"),
        ).pack(side="left")

        ctk.CTkButton(
            topo, text="🧹 Nova conversa", width=130,
            fg_color="transparent", border_width=1,
            command=self.nova_conversa,
        ).pack(side="right")

        # Status do cérebro. Repare: cor E texto mudam juntos — nunca dependa
        # só da cor (acessibilidade: daltônico também precisa entender).
        self.status = ctk.CTkLabel(topo, text="● acordando…", text_color="#f1c40f")
        self.status.pack(side="right", padx=(0, 10))

        # Área das mensagens: um quadro que ROLA sozinho quando enche.
        self.area = ctk.CTkScrollableFrame(self)
        self.area.pack(fill="both", expand=True, padx=12, pady=(0, 12))

        # ---- O experimento: controle de temperatura ----
        # Temperatura = o quanto o modelo ARRISCA ao escolher cada palavra.
        # Experimente a MESMA pergunta em 0.0 e em 1.5 e compare as respostas.
        linha_temp = ctk.CTkFrame(self, fg_color="transparent")
        linha_temp.pack(fill="x", padx=14, pady=(0, 4))

        self.rotulo_temp = ctk.CTkLabel(
            linha_temp,
            text=f"🌡️ Temperatura: {TEMPERATURA_PADRAO:.1f}",
            font=ctk.CTkFont(size=12),
        )
        self.rotulo_temp.pack(side="left")

        # from_/to = faixa; number_of_steps=15 faz o arrasto "pular" de 0.1
        # em 0.1 (15 degraus entre 0.0 e 1.5), em vez de valores quebrados.
        self.slider_temp = ctk.CTkSlider(
            linha_temp, from_=0.0, to=1.5, number_of_steps=15,
            command=self._temperatura_mudou,
        )
        self.slider_temp.set(TEMPERATURA_PADRAO)
        self.slider_temp.pack(side="left", fill="x", expand=True, padx=(10, 0))

        # Linha de baixo: campo de digitar + botão enviar.
        baixo = ctk.CTkFrame(self, fg_color="transparent")
        baixo.pack(fill="x", padx=12, pady=(0, 12))

        self.entrada = ctk.CTkEntry(baixo, placeholder_text="Fala com a Yato...")
        self.entrada.pack(side="left", fill="x", expand=True)
        self.entrada.bind("<Return>", lambda evento: self.enviar())  # Enter envia

        self.botao = ctk.CTkButton(baixo, text="Enviar", width=90, command=self.enviar)
        self.botao.pack(side="left", padx=(8, 0))

        # Redesenha a conversa restaurada (se existir); senão, a dica padrão.
        falas = [m for m in self.mensagens if m["role"] != "system"]
        for m in falas:
            if m["role"] == "user":
                self._bolha(m["content"], autor="user")
            else:
                self._bolha(limpar_markdown(m["content"]), autor="yato")
        if falas:
            self._bolha("— conversa restaurada · 🧹 pra começar do zero —", autor="dica")
        else:
            self._bolha('Manda um "oi" pra Yato…', autor="dica")
        self.entrada.focus()

    def _bolha(self, texto, autor, detalhe=None):
        """Desenha um balão. 'detalhe' é a linha de métricas (opcional)."""
        estilos = {
            "user":   {"cor": "#6c5ce7", "lado": "e"},      # roxo, direita
            "yato":   {"cor": "#2a2a3a", "lado": "w"},      # cinza, esquerda
            "dica":   {"cor": "transparent", "lado": "center"},
        }
        est = estilos[autor]

        balao = ctk.CTkFrame(self.area, fg_color=est["cor"], corner_radius=12)
        balao.pack(anchor=est["lado"], pady=4, padx=4)

        rotulo = ctk.CTkLabel(balao, text=texto, wraplength=360, justify="left")
        rotulo.pack(padx=12, pady=(8, 2 if detalhe else 8))

        if detalhe:
            self._etiqueta(balao, detalhe)

        self._rolar_pro_fim()
        return balao

    def _etiqueta(self, balao, detalhe):
        """A "etiqueta de laboratório": números da geração, discretos,
        embaixo do texto — cada resposta vira um experimento medido."""
        ctk.CTkLabel(
            balao, text=detalhe, wraplength=360, justify="left",
            font=ctk.CTkFont(size=10), text_color="#8a8aa0",
        ).pack(padx=12, pady=(0, 6))

    def _rolar_pro_fim(self):
        """Rola a área de mensagens até o fim (pra ver a mensagem mais nova)."""
        try:
            self.update_idletasks()
            self.area._parent_canvas.yview_moveto(1.0)
        except Exception:
            pass  # se a API interna mudar, melhor não derrubar o app por isso

    # --------------------------------------------------------------- ações
    def _temperatura_mudou(self, valor):
        """Chamado pelo slider a cada arrasto: atualiza o número no rótulo."""
        self.rotulo_temp.configure(text=f"🌡️ Temperatura: {valor:.1f}")

    def _acordar_cerebro(self):
        """Roda numa thread de fundo ao abrir: carrega o modelo e mostra o status."""
        pronto = acordar()   # demora ~20s se o modelo estiver "frio"
        texto = "● pronta" if pronto else "● Ollama fechado"
        cor = "#2ecc71" if pronto else "#e74c3c"
        # after(0, ...) = "tela, atualiza isso quando puder" (thread-safe)
        self.after(0, lambda: self.status.configure(text=texto, text_color=cor))

    def nova_conversa(self):
        """Zera o papo: histórico volta ao começo (só a personalidade)."""
        if self.bolha_pensando is not None:
            return  # esperando resposta — não puxar o tapete da thread

        self.mensagens = [{"role": "system", "content": PERSONALIDADE}]
        salvar_conversa(self.mensagens)   # apaga a conversa salva no disco também
        for filho in self.area.winfo_children():
            filho.destroy()   # limpa todas as bolhas da tela
        self._bolha('Conversa nova, memória zerada. Manda um "oi"…', autor="dica")
        logging.info("Nova conversa iniciada")

    def enviar(self):
        texto = self.entrada.get().strip()
        if not texto or self.bolha_pensando is not None:
            return  # vazio, ou já estamos esperando uma resposta

        # 1) mostra sua fala e guarda no histórico
        self._bolha(texto, autor="user")
        self.mensagens.append({"role": "user", "content": texto})
        self.entrada.delete(0, "end")

        # 2) trava o botão e cria o balão onde a resposta vai PINGAR ao vivo.
        self.botao.configure(state="disabled", text="...")
        self.texto_parcial = ""
        self.bolha_pensando = self._bolha("digitando…", autor="yato")
        # O rótulo (o texto) é o primeiro filho do balão — guardamos a
        # referência pra ir trocando o texto dele a cada pedaço que chegar.
        self.rotulo_pensando = self.bolha_pensando.winfo_children()[0]

        # 3) chama a IA numa THREAD de fundo, pra a janela não congelar.
        #    A temperatura é lida AGORA, da posição atual do deslizador —
        #    cada mensagem pode ir com uma temperatura diferente.
        temperatura = round(self.slider_temp.get(), 1)
        threading.Thread(
            target=self._buscar_resposta, args=(temperatura,), daemon=True
        ).start()

    def _buscar_resposta(self, temperatura):
        """Roda NA THREAD DE FUNDO. Daqui NÃO se mexe na tela direto."""

        def pinga_na_tela(pedaco):
            # O cérebro chama isto a CADA pedacinho gerado (nesta thread!).
            # after(0, ...) despacha pra thread principal — só ela toca a tela.
            self.after(0, self._pedaco_chegou, pedaco)

        detalhe = None
        try:
            r = pensar(self.mensagens, temperatura=temperatura,
                       ao_receber=pinga_na_tela)
            texto = r.texto
            # A etiqueta de laboratório desta resposta:
            detalhe = (
                f"{r.tokens} tokens · {r.segundos:.1f}s · "
                f"{r.velocidade:.0f} tok/s · 🌡️ {temperatura:.1f}"
            )
        except CerebroError as erro:
            # Falha CONHECIDA (Ollama fechado, modelo faltando, timeout...):
            # o cérebro já mandou a mensagem pronta e amigável — só mostrar.
            logging.warning("Falha conhecida: %s", erro)
            texto = str(erro)
        except Exception:
            # Falha DESCONHECIDA: grava o rastro completo no yato.log
            # (logging.exception anexa o traceback inteiro sozinho).
            logging.exception("Erro inesperado ao falar com o cérebro")
            texto = "Buguei feio aqui 😵 (anotei os detalhes no yato.log)"

        # Volta pra thread principal pra mexer na tela com segurança.
        self.after(0, self._mostrar_resposta, texto, detalhe)

    def _pedaco_chegou(self, pedaco):
        """Roda na thread principal: cola mais um pedaço no balão ao vivo."""
        if self.rotulo_pensando is None:
            return  # a resposta já foi finalizada; pedaço atrasado, ignora
        self.texto_parcial += pedaco
        # Limpamos o ACUMULADO (não o pedaço): um "**" pode chegar partido
        # em dois pedaços, e só o texto juntado revela a formatação inteira.
        self.rotulo_pensando.configure(text=limpar_markdown(self.texto_parcial))
        self._rolar_pro_fim()

    def _mostrar_resposta(self, texto, detalhe):
        # O balão do streaming VIRA o balão final: acertamos o texto
        # definitivo (importante no caso de erro!) e penduramos a etiqueta.
        # Na TELA vai o texto limpo; no HISTÓRICO (abaixo) vai o original.
        self.rotulo_pensando.configure(text=limpar_markdown(texto))
        if detalhe:
            self._etiqueta(self.bolha_pensando, detalhe)
        self.bolha_pensando = None
        self.rotulo_pensando = None

        self.mensagens.append({"role": "assistant", "content": texto})
        salvar_conversa(self.mensagens)   # cada troca completa vai pro disco
        self.botao.configure(state="normal", text="Enviar")
        self._rolar_pro_fim()
        self.entrada.focus()


if __name__ == "__main__":
    logging.info("Yato abriu (modelo: %s)", MODELO)
    App().mainloop()
    logging.info("Yato fechou")
