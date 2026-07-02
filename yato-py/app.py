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
import threading
from pathlib import Path

import customtkinter as ctk

from personalidade import PERSONALIDADE
from cerebro import pensar, acordar, CerebroError, MODELO, TEMPERATURA_PADRAO

# ---- Diário de bordo (yato.log, criado ao lado deste arquivo) ----
# Por que existe: aberto pelo atalho (pythonw), o app NÃO tem terminal —
# qualquer erro sumiria sem deixar rastro. Aqui, tudo fica registrado.
logging.basicConfig(
    filename=Path(__file__).with_name("yato.log"),
    level=logging.INFO,
    format="%(asctime)s  %(levelname)s  %(message)s",
    encoding="utf-8",
)

# Aparência geral: tema escuro e cor de destaque.
ctk.set_appearance_mode("dark")
ctk.set_default_color_theme("blue")


class App(ctk.CTk):
    def __init__(self):
        super().__init__()
        self.title("Yato — IA local")
        self.geometry("520x660")
        self.minsize(420, 480)

        # ---- ESTADO: o histórico da conversa mora aqui ----
        # Começa só com a personalidade (a 1ª mensagem, de papel "system").
        # É a MESMA lista que mandamos pro cérebro a cada envio.
        self.mensagens = [{"role": "system", "content": PERSONALIDADE}]
        self.bolha_pensando = None  # referência ao balão "digitando…"

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

        self._bolha('Manda um "oi" pra Yato…', autor="dica")
        self.entrada.focus()

    def _bolha(self, texto, autor, detalhe=None):
        """Desenha um balão. 'detalhe' é a linha de métricas (opcional)."""
        estilos = {
            "user":   {"cor": "#6c5ce7", "lado": "e"},      # roxo, direita
            "yato": {"cor": "#2a2a3a", "lado": "w"},      # cinza, esquerda
            "dica":   {"cor": "transparent", "lado": "center"},
        }
        est = estilos[autor]

        balao = ctk.CTkFrame(self.area, fg_color=est["cor"], corner_radius=12)
        balao.pack(anchor=est["lado"], pady=4, padx=4)

        rotulo = ctk.CTkLabel(balao, text=texto, wraplength=360, justify="left")
        rotulo.pack(padx=12, pady=(8, 2 if detalhe else 8))

        if detalhe:
            # A "etiqueta de laboratório": números da geração, discretos,
            # embaixo do texto — cada resposta vira um experimento medido.
            ctk.CTkLabel(
                balao, text=detalhe, wraplength=360, justify="left",
                font=ctk.CTkFont(size=10), text_color="#8a8aa0",
            ).pack(padx=12, pady=(0, 6))

        self._rolar_pro_fim()
        return balao

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

        # 2) trava o botão e mostra o "digitando…"
        self.botao.configure(state="disabled", text="...")
        self.bolha_pensando = self._bolha("digitando…", autor="yato")

        # 3) chama a IA numa THREAD de fundo, pra a janela não congelar.
        #    A temperatura é lida AGORA, da posição atual do deslizador —
        #    cada mensagem pode ir com uma temperatura diferente.
        temperatura = round(self.slider_temp.get(), 1)
        threading.Thread(
            target=self._buscar_resposta, args=(temperatura,), daemon=True
        ).start()

    def _buscar_resposta(self, temperatura):
        """Roda NA THREAD DE FUNDO. Daqui NÃO se mexe na tela direto."""
        detalhe = None
        try:
            r = pensar(self.mensagens, temperatura=temperatura)
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

    def _mostrar_resposta(self, texto, detalhe):
        self.bolha_pensando.destroy()        # tira o balão "digitando…"
        self.bolha_pensando = None
        self._bolha(texto, autor="yato", detalhe=detalhe)
        self.mensagens.append({"role": "assistant", "content": texto})
        self.botao.configure(state="normal", text="Enviar")
        self.entrada.focus()


if __name__ == "__main__":
    logging.info("Yato abriu (modelo: %s)", MODELO)
    App().mainloop()
    logging.info("Yato fechou")
