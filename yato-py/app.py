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

import base64
import io
import logging
import os
import re
import socket
import sys
import threading
import time
from logging.handlers import RotatingFileHandler
from pathlib import Path
import tkinter as tk
from tkinter import filedialog

import customtkinter as ctk
from PIL import Image, ImageGrab, ImageTk

from personalidade import PERSONALIDADE
from cerebro import pensar, acordar, garantir_ollama, CerebroError, MODELO
from memoria import (carregar_fatos, listar_conversas, novo_arquivo_conversa,
                     salvar_conversa_em, carregar_falas_de,
                     renomear_conversa, excluir_conversa)
import voz
import ouvido
import avatar2d
import imagem
import presets

# ---- Os MODOS: nomes amigáveis pra temperatura ----
# Temperatura é o "grau de ousadia" na escolha de cada palavra — mas um
# número cru (0.8?) não diz nada pra quem nunca mexeu com IA. Então o
# número virou MODO com nome de USO. O valor real continua aparecendo na
# etiqueta de cada resposta: o laboratório segue vivo, e você aprende o
# mapeamento vendo.
MODOS = {
    "🎯 Preciso": 0.2,   # fatos, listas, buscas — quase sem sorteio
    "💬 Natural": 0.7,   # papo do dia a dia — equilíbrio (padrão)
    "🎭 Lúdico": 1.2,    # histórias e zoeira — criativo (fatos, não!)
}
MODO_PADRAO = "💬 Natural"

DICAS_MODO = {
    "🎯 Preciso": "fatos, listas e buscas",
    "💬 Natural": "papo do dia a dia",
    "🎭 Lúdico": "histórias e zoeira — não confie em fatos aqui!",
}

# ---- Tamanhos de imagem oferecidos ----
# O SDXL/Nova Anime XL gosta de proporções em torno de ~1 megapixel. Estes três
# cabem nos 8 GB de VRAM e cobrem os casos comuns. Um preset "lembra" o tamanho
# em que foi feito (vem embutido no PNG), então ao escolher um favorito o seletor
# já se ajusta sozinho.
# Resoluções no "sweet spot" do SDXL (~1024px de lado) — gerar abaixo disso
# (ex.: 768) deixa a imagem mais mole. Proporções recomendadas do SDXL.
TAMANHOS_IMAGEM = {
    "Quadrado": (1024, 1024),
    "Retrato": (832, 1216),
    "Paisagem": (1216, 832),
}

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
    # links [Nome](url) viram "Nome (url)" — legível sem renderizador
    texto = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r"\1 (\2)", texto)
    return texto.strip()


class DropdownInterno(ctk.CTkButton):
    """Um seletor no lugar do CTkOptionMenu — mas cuja lista abre num CARTÃO
    DENTRO da janela (place + lift), em vez do menu NATIVO do Tk, que "vaza" pra
    fora da janela e só fecha clicando fora. Mesma ideia do menu ⋮.

    API compatível com CTkOptionMenu: `get()`, `set(v)`, `configure(values=…)`,
    `cget("values")` — pra trocar sem mexer em quem usa. O cartão se posiciona
    logo abaixo do botão e é CLAMPADO na janela (se não cabe embaixo, abre pra
    cima; se passa da direita, encosta na borda)."""

    def __init__(self, master, values=None, command=None, width=140, **kw):
        self._valores = list(values or [])
        self._comando = command
        self._valor = self._valores[0] if self._valores else ""
        self._cartao = None
        self._fechado_em = 0.0
        self._bind_id = None
        super().__init__(master, width=width, anchor="w",
                         text=self._rotulo(self._valor), command=self._toggle, **kw)

    def _rotulo(self, v):
        return f"{v}   ▾"

    def get(self):
        return self._valor

    def set(self, valor):
        self._valor = valor
        super().configure(text=self._rotulo(valor))

    def cget(self, key):
        return self._valores if key == "values" else super().cget(key)

    def configure(self, **kw):
        if "values" in kw:
            self._valores = list(kw.pop("values"))
        if "command" in kw:
            self._comando = kw.pop("command")
        if kw:
            super().configure(**kw)

    def _toggle(self):
        if self._cartao is not None:
            self._fechar()
        elif time.monotonic() - self._fechado_em >= 0.25:   # não reabre no mesmo clique
            self._abrir()

    def _abrir(self):
        if not self._valores:
            return
        topo = self.winfo_toplevel()
        cartao = ctk.CTkFrame(
            topo, corner_radius=10,
            fg_color=ctk.ThemeManager.theme["CTkFrame"]["fg_color"],
            border_width=1, border_color=("gray60", "#5c5c6a"))
        for v in self._valores:
            marcado = (v == self._valor)
            ctk.CTkButton(
                cartao, text=("✓  " if marcado else "     ") + v, anchor="w",
                height=28, corner_radius=6, fg_color="transparent",
                hover_color=("gray82", "#3a3a46"), text_color=("gray10", "#e6e6f0"),
                font=ctk.CTkFont(size=11),
                command=lambda vv=v: self._escolher(vv)).pack(fill="x", padx=6, pady=1)
        self._cartao = cartao
        cartao.update_idletasks()
        bx = self.winfo_rootx() - topo.winfo_rootx()
        by = self.winfo_rooty() - topo.winfo_rooty()
        cw, ch = cartao.winfo_reqwidth(), cartao.winfo_reqheight()
        x = max(4, min(bx, topo.winfo_width() - cw - 4))          # não vaza à direita
        y = by + self.winfo_height() + 3
        if y + ch > topo.winfo_height() - 4:                       # não cabe embaixo → abre pra cima
            y = max(4, by - ch - 3)
        cartao.place(x=x, y=y)
        cartao.lift()
        self._bind_id = topo.bind("<Button-1>", self._clique_fora, add="+")

    def _escolher(self, v):
        self.set(v)
        self._fechar()
        if self._comando:
            self._comando(v)

    def _clique_fora(self, evento):
        cartao = self._cartao
        if cartao is None:
            return
        w = evento.widget
        while w is not None:                 # clicou dentro do cartão ou no botão? ignora
            if w is cartao or w is self:
                return
            w = getattr(w, "master", None)
        self._fechar()

    def _fechar(self):
        if self._cartao is None:
            return
        topo = self.winfo_toplevel()
        if self._bind_id:
            topo.unbind("<Button-1>", self._bind_id)
            self._bind_id = None
        self._cartao.destroy()
        self._cartao = None
        self._fechado_em = time.monotonic()


class App(ctk.CTk):
    def __init__(self):
        super().__init__()
        self.title("Yato — IA local")
        self.geometry("1100x820")
        self.minsize(760, 560)

        # Sem isto, o Windows agrupa a janela sob o ícone do 'pythonw' na barra
        # de tarefas (porque é ele que roda o app). Dar um "AppUserModelID"
        # próprio faz o Windows tratar o Yato como um app à parte e usar O NOSSO
        # ícone na barra. (Só no Windows; se falhar, seguimos sem.)
        if sys.platform.startswith("win"):
            try:
                import ctypes
                ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID("yato.ia.local")
            except Exception:
                pass

        # Ícone da janela (aparece no título e na barra de tarefas). Só aplica
        # se o .ico existir — nunca deixamos isso quebrar a abertura do app. O
        # CustomTkinter define o ícone DELE ~200ms depois de abrir, sobrescrevendo
        # o nosso; por isso reforçamos com um after() pra o do Yato prevalecer.
        icone = Path(__file__).parent / "assets" / "yato.ico"
        if icone.exists():
            try:
                self.iconbitmap(str(icone))
                self.after(300, lambda: self.iconbitmap(str(icone)))
            except Exception:
                pass   # sistema sem suporte a .ico — segue sem ícone custom

        # ---- ESTADO: o histórico da conversa mora aqui ----
        # Personalidade sempre FRESCA (vem do código, nunca do disco). O app
        # SEMPRE abre numa conversa NOVA (arquivo_conversa=None, nasce na 1ª
        # mensagem) — as conversas anteriores ficam guardadas no histórico 📜.
        self.mensagens = [{"role": "system", "content": PERSONALIDADE}]
        self.arquivo_conversa = None

        self.bolha_pensando = None   # o balão da resposta em andamento
        self.rotulo_pensando = None  # o TEXTO dentro dele (atualiza no streaming)
        self.texto_parcial = ""      # o que já chegou da resposta atual
        self.fonte_atual = ""        # o que a última pesquisa trouxe (pro "continua")
        self.imagem_anexada = ""     # a imagem colada/anexada (base64), 1 por mensagem
        self.imagem_ref_b64 = ""     # imagem de referência da aba Imagem (pro "🔍 Prompt da imagem")
        self.modo_view = "chat"      # "chat" ou "imagem" (avatar virou on/off à parte)
        self.voz_ligada = False      # o Yato lê as respostas em voz alta?
        self.ouvindo = False         # o microfone está gravando agora?

        self._montar_tela()

        # Acorda o cérebro em SEGUNDO PLANO assim que a janela abre: o modelo
        # carrega na GPU enquanto você digita a 1ª mensagem — em vez de te
        # fazer encarar 20s de "digitando…" depois dela.
        threading.Thread(target=self._acordar_cerebro, daemon=True).start()

    # ----------------------------------------------------------------- tela
    def _montar_tela(self):
        # ---- Topo (LINHA 1): identidade (esquerda) + status (direita) ----
        # A barra vive em DUAS linhas: coisa demais numa fileira só espremia e
        # cortava os nomes numa janela pequena. Aqui em cima ficam só os itens
        # curtos — o nome, o badge do modelo e o status — que sempre cabem.
        topo = ctk.CTkFrame(self, fg_color="transparent")
        topo.pack(fill="x", padx=12, pady=(12, 2))

        ctk.CTkLabel(
            topo, text="⚔️  Yato",
            font=ctk.CTkFont(size=16, weight="bold"),
        ).pack(side="left")

        # O modelo num "badge" discreto ao lado do nome (refinamento do design).
        ctk.CTkLabel(
            topo, text=f" {MODELO} ", font=ctk.CTkFont(size=11),
            text_color="#9a9ab0", fg_color="#242430", corner_radius=6,
        ).pack(side="left", padx=(8, 0))

        # Status do cérebro. Repare: cor E texto mudam juntos — nunca dependa
        # só da cor (acessibilidade: daltônico também precisa entender).
        self.status = ctk.CTkLabel(topo, text="● acordando…", text_color="#f1c40f")
        self.status.pack(side="right", padx=(0, 2))

        # ---- Barra (LINHA 2): navegação (esquerda) + ações (direita) ----
        barra = ctk.CTkFrame(self, fg_color="transparent")
        barra.pack(fill="x", padx=12, pady=(0, 6))

        # O TOGGLE da área central: só Chat e Imagem. O Avatar SAIU daqui —
        # ele não é um "modo de tela", é uma janela flutuante que fica POR CIMA
        # de tudo. Virou um liga/desliga próprio (o switch ao lado).
        self.toggle_view = ctk.CTkSegmentedButton(
            barra, values=["💬 Chat", "🎨 Imagem"],
            command=self._view_mudou, width=160,
        )
        self.toggle_view.set("💬 Chat")
        self.toggle_view.pack(side="left")

        # O AVATAR agora é on/off INDEPENDENTE: pode ficar aberto tanto no Chat
        # quanto na Imagem. O switch controla e reflete a janela flutuante.
        self.switch_avatar = ctk.CTkSwitch(
            barra, text="🎭 Avatar", command=self._toggle_avatar,
        )
        self.switch_avatar.pack(side="left", padx=(12, 0))

        # À direita: em vez de uma FILEIRA de ícones crípticos (que obrigava a
        # clicar em cada um pra descobrir o que faz), fica só o microfone
        # visível — a ação que você usa NO MEIO da conversa e que mostra
        # estado (🔴 gravando) — e um menu "⋮" com as demais funções NOMEADAS.
        # Empacotados side="right" (direita→esquerda): o ⋮ vai primeiro, então
        # aparece na ponta direita; o 🎤 fica à esquerda dele.

        # ⋮ Menu de funções: Nova conversa, Histórico, Memória, Voz, pasta…
        self.botao_menu = ctk.CTkButton(
            barra, text="⋮", width=40,
            font=ctk.CTkFont(size=18, weight="bold"),
            fg_color="transparent", border_width=1,
            command=self._abrir_menu_funcoes,
        )
        self.botao_menu.pack(side="right", padx=(6, 0))

        # 🎤 Microfone: grava sua fala, transcreve (Whisper local) e envia
        # direto. Clica pra gravar, clica de novo pra mandar (mostra 🔴).
        self.botao_ouvir = ctk.CTkButton(
            barra, text="🎤", width=40,
            fg_color="transparent", border_width=1,
            command=self._toggle_ouvir,
        )
        self.botao_ouvir.pack(side="right", padx=(6, 0))

        # ---- Corpo: painel lateral (recolhível) + área principal ----
        corpo = ctk.CTkFrame(self, fg_color="transparent")
        corpo.pack(fill="both", expand=True)

        # O painel do histórico começa RECOLHIDO (não empacotado). Largura
        # fixa; pack_propagate(False) impede os filhos de "esticarem" ele.
        self.painel = ctk.CTkFrame(corpo, width=215)
        self.painel.pack_propagate(False)
        self.painel_visivel = False
        ctk.CTkLabel(self.painel, text="📜 Conversas",
                     font=ctk.CTkFont(size=13, weight="bold")).pack(pady=(10, 4))
        self.lista_conversas = ctk.CTkScrollableFrame(
            self.painel, fg_color="transparent")
        self.lista_conversas.pack(fill="both", expand=True, padx=6, pady=(0, 8))

        # A área principal (tudo o que já existia) fica À DIREITA do painel.
        self.principal = ctk.CTkFrame(corpo, fg_color="transparent")
        self.principal.pack(side="left", fill="both", expand=True)

        # ---- A área de mensagens (a conversa) — fica SEMPRE visível. ----
        # O modo Avatar não troca mais esta área: ele só abre/fecha a janela
        # flutuante do avatar Live2D (por cima da tela), num processo à parte.
        self.area = ctk.CTkScrollableFrame(self.principal)
        self.area.pack(fill="both", expand=True, padx=12, pady=(0, 12))

        # ---- O seletor de MODO (a temperatura com nome de gente) ----
        # Guardado em self.* porque o toggle usa ele como âncora (before=).
        self.linha_modo = ctk.CTkFrame(self.principal, fg_color="transparent")
        self.linha_modo.pack(fill="x", padx=14, pady=(0, 4))
        linha_modo = self.linha_modo

        ctk.CTkLabel(linha_modo, text="Modo:", font=ctk.CTkFont(size=12)).pack(side="left")

        # SegmentedButton = botões "grudados" onde um fica selecionado.
        self.seletor_modo = ctk.CTkSegmentedButton(
            linha_modo, values=list(MODOS.keys()), command=self._modo_mudou,
        )
        self.seletor_modo.set(MODO_PADRAO)
        self.seletor_modo.pack(side="left", padx=(8, 8))

        # A dica do modo atual — muda junto com a seleção.
        self.rotulo_dica = ctk.CTkLabel(
            linha_modo, text=DICAS_MODO[MODO_PADRAO],
            font=ctk.CTkFont(size=11), text_color="#8a8aa0",
        )
        self.rotulo_dica.pack(side="left")

        # O "chip" da imagem anexada — só aparece quando tem imagem.
        self.linha_anexo = ctk.CTkFrame(self.principal, fg_color="transparent")
        self.chip_anexo = ctk.CTkLabel(
            self.linha_anexo, text="🖼️ imagem anexada — clique pra remover",
            text_color="#8ab4f8", cursor="hand2", font=ctk.CTkFont(size=11),
        )
        self.chip_anexo.bind("<Button-1>", lambda e: self._remover_imagem())
        self.chip_anexo.pack(side="left")

        # Linha de baixo: anexar + campo de digitar + botão enviar.
        self.linha_baixo = ctk.CTkFrame(self.principal, fg_color="transparent")
        self.linha_baixo.pack(fill="x", padx=12, pady=(0, 12))
        baixo = self.linha_baixo

        ctk.CTkButton(
            baixo, text="📎", width=36,
            fg_color="transparent", border_width=1,
            command=self._escolher_imagem,
        ).pack(side="left", padx=(0, 6))

        # O campo é um TEXTBOX (multi-linha): o texto QUEBRA a linha em vez de
        # sumir pro lado, e a caixa CRESCE conforme você escreve (até um teto —
        # aí ela rola por dentro). Enter envia; Shift+Enter quebra a linha.
        self._DICA_ENTRADA = "Fala com o Yato..."
        self._MAX_LINHAS_ENTRADA = 6
        self.entrada = ctk.CTkTextbox(baixo, height=34, wrap="word")
        self.entrada.pack(side="left", fill="x", expand=True)
        # Guarda a cor normal do texto ANTES de pintar a dica de cinza.
        self._cor_texto_entrada = self.entrada.cget("text_color")
        self._dica_ativa = False
        self._mostrar_dica_entrada()
        self.entrada.bind("<Return>", self._enter_envia)      # Enter = enviar
        self.entrada.bind("<Shift-Return>", lambda e: None)   # Shift+Enter = linha nova
        self.entrada.bind("<KeyRelease>", self._ajustar_altura_entrada)
        self.entrada.bind("<FocusIn>", self._entrada_focou)
        self.entrada.bind("<FocusOut>", self._entrada_desfocou)
        # Ctrl+V com IMAGEM no clipboard anexa; com texto, cola normal.
        self.entrada.bind("<Control-v>", self._colar)
        self.entrada.bind("<Control-V>", self._colar)

        self.botao = ctk.CTkButton(baixo, text="Enviar", width=90, command=self.enviar)
        self.botao.pack(side="left", padx=(8, 0))

        # ---- Modo IMAGEM: o laboratório de geração (Forge + Nova Anime XL) ----
        # Nasce OCULTO (nunca empacotado) — só aparece quando o modo é trocado.
        self.view_imagem = ctk.CTkFrame(self.principal, fg_color="transparent")
        self._montar_view_imagem()

        self._redesenhar_conversa()
        self.entrada.focus()

    # ------------------------------------------------------- modo avatar
    def _view_mudou(self, valor):
        """Chamado pelo toggle do topo: alterna a área central entre chat e imagem."""
        self.trocar_modo_view("imagem" if "Imagem" in valor else "chat")

    # -------------------------------------------------------------- voz
    def _toggle_voz(self):
        """Liga/desliga a voz. Ao ligar, AQUECE o modelo em segundo plano
        (carregar leva alguns segundos — como o cérebro, evita a espera na
        1ª fala). O estado (ligada/desligada) aparece no menu ⋮."""
        if not voz.disponivel():
            self._bolha("Voz indisponível — o modelo do Piper não está na "
                        "pasta vozes/.", autor="dica")
            return
        self.voz_ligada = not self.voz_ligada
        if self.voz_ligada:
            threading.Thread(target=voz._carregar, daemon=True).start()  # aquece
        else:
            voz.parar()   # cala a boca na hora se desligou no meio de uma fala
            if avatar2d.esta_aberto():
                avatar2d.lip_sync(0.0)   # e fecha a boca do avatar

    # ------------------------------------------------- menu de funções (⋮)
    def _abrir_menu_funcoes(self):
        """Abre/fecha o menu ⋮ — um cartão DENTRO da própria janela do Yato.

        Por que dentro (e não um Toplevel separado): num Toplevel com fundo
        transparente o CustomTkinter NÃO desenha os cantos arredondados nem as
        linhas (testado). Como filho da janela, ele renderiza de verdade E anda
        junto quando você move o Yato. Fica por cima do chat via place()+lift().

        TOGGLE: clicar no ⋮ de novo fecha; clicar fora do cartão também. O
        carimbo de tempo evita que o mesmo clique que fechou reabra na hora.
        """
        if getattr(self, "_menu_cartao", None) is not None:
            self._fechar_menu_funcoes()          # já aberto → este clique fecha
            return
        if time.monotonic() - getattr(self, "_menu_fechado_em", 0) < 0.25:
            return   # o clique que ACABOU de fechar chegou no ⋮ — não reabre

        cartao = ctk.CTkFrame(
            self, corner_radius=12,
            fg_color=ctk.ThemeManager.theme["CTkFrame"]["fg_color"],
            border_width=1, border_color=("gray60", "#5c5c6a"),
        )

        def _item(texto, comando, marcado=False):
            ctk.CTkButton(
                cartao, text=("✓   " if marcado else "      ") + texto,
                anchor="w", height=30, corner_radius=6,
                fg_color="transparent", hover_color=("gray82", "#3a3a46"),
                text_color=("gray10", "#e6e6f0"),
                command=lambda: (self._fechar_menu_funcoes(), comando()),
            ).pack(fill="x", padx=6, pady=1)

        def _separador():
            # Linha VISÍVEL de ponta a ponta (como no menu do Claude). O
            # corner_radius=0 é ESSENCIAL: com o padrão (6), o arredondamento
            # "come" uma linha de 1px e ela some.
            ctk.CTkFrame(cartao, height=2, corner_radius=0,
                         fg_color=("#9a9aa6", "#70707e")).pack(fill="x", padx=8, pady=7)

        ctk.CTkFrame(cartao, height=4, fg_color="transparent").pack()  # respiro
        _item("Nova conversa", self.nova_conversa)
        _item("Histórico de conversas", self.toggle_painel)
        _item("Memória", self.mostrar_memoria)
        _separador()   # {Nova, Histórico, Memória}  |  {Ler, Abrir pasta}
        _item("Ler respostas em voz alta", self._toggle_voz, marcado=self.voz_ligada)
        _item("Abrir pasta do projeto", self._abrir_pasta_projeto)
        ctk.CTkFrame(cartao, height=4, fg_color="transparent").pack()  # respiro
        self._menu_cartao = cartao

        # Posiciona com place() em coords RELATIVAS à janela: borda direita do
        # cartão alinhada com a do botão ⋮ (abre pra dentro), logo abaixo dele.
        cartao.update_idletasks()
        larg = cartao.winfo_reqwidth()
        bx = self.botao_menu.winfo_rootx() - self.winfo_rootx()
        by = self.botao_menu.winfo_rooty() - self.winfo_rooty()
        x = bx + self.botao_menu.winfo_width() - larg
        y = by + self.botao_menu.winfo_height() + 4
        cartao.place(x=x, y=y)
        cartao.lift()

        # Fecha ao clicar em qualquer lugar FORA do cartão.
        self._menu_bind = self.bind("<Button-1>", self._clique_fora_menu, add="+")

    def _clique_fora_menu(self, evento):
        """Fecha o menu se o clique NÃO caiu dentro do cartão (nem num item dele)."""
        cartao = getattr(self, "_menu_cartao", None)
        if cartao is None:
            return
        # Sobe a árvore do widget clicado: se topar no cartão, foi DENTRO.
        w = evento.widget
        while w is not None:
            if w == cartao:
                return
            w = getattr(w, "master", None)
        self._fechar_menu_funcoes()

    def _fechar_menu_funcoes(self):
        """Fecha o cartão e carimba o instante (pro toggle não reabrir na hora)."""
        cartao = getattr(self, "_menu_cartao", None)
        if cartao is not None:
            self._menu_cartao = None
            self._menu_fechado_em = time.monotonic()
            bind_id = getattr(self, "_menu_bind", None)
            if bind_id:
                self.unbind("<Button-1>", bind_id)
                self._menu_bind = None
            cartao.destroy()

    def _abrir_pasta(self, pasta):
        """Abre uma pasta no Explorer do Windows (os.startfile só existe lá)."""
        try:
            Path(pasta).mkdir(parents=True, exist_ok=True)
            os.startfile(str(pasta))
        except (OSError, AttributeError):
            logging.exception("Não consegui abrir a pasta: %s", pasta)

    def _abrir_pasta_projeto(self):
        """📁 do menu ⋮: abre a pasta do projeto (onde mora o app.py)."""
        self._abrir_pasta(Path(__file__).parent)

    def _abrir_pasta_imagens(self):
        """📁 da aba Imagem: abre a pasta das imagens que o Yato gerou."""
        self._abrir_pasta(imagem.PASTA_IMAGENS)

    # ------------------------------------------------------------- ouvir
    def _toggle_ouvir(self):
        """O microfone: 1º clique começa a gravar; 2º clique para, transcreve
        (Whisper local, numa thread) e envia a mensagem direto."""
        if not ouvido.disponivel():
            self._bolha("Ouvir indisponível — faltam as libs (faster-whisper, "
                        "sounddevice). Rode o preparar.py.", autor="dica")
            return
        if not self.ouvindo:
            self.ouvindo = True
            self.botao_ouvir.configure(text="🔴", fg_color="#c0392b")
            ouvido.iniciar()
        else:
            self.ouvindo = False
            self.botao_ouvir.configure(text="⏳", fg_color="transparent")

            def transcrever():
                try:
                    texto = ouvido.parar_e_transcrever()
                except Exception:
                    logging.exception("Falha ao transcrever")
                    texto = ""
                self.after(0, lambda: self._fala_transcrita(texto))

            threading.Thread(target=transcrever, daemon=True).start()

    def _fala_transcrita(self, texto):
        """Recebe o texto do que você disse: joga no campo e ENVIA direto."""
        self.botao_ouvir.configure(text="🎤", fg_color="transparent")
        if not texto:
            self._bolha("Não entendi o áudio — tenta de novo, mais perto do "
                        "microfone.", autor="dica")
            return
        self._set_entrada(texto)
        self.enviar()

    # ---------------------------------------------- campo de digitar
    # O campo é um CTkTextbox (multi-linha), que NÃO tem placeholder nativo
    # como o CTkEntry. Então a "dica cinza" e o crescer-com-o-texto são feitos
    # na mão aqui. Todo acesso ao texto passa por estes helpers — assim o
    # resto do código não precisa saber dos detalhes do Textbox.
    def _mostrar_dica_entrada(self):
        """Põe a dica cinza no campo (quando ele está vazio e sem foco)."""
        self._dica_ativa = True
        self.entrada.delete("1.0", "end")
        self.entrada.insert("1.0", self._DICA_ENTRADA)
        self.entrada.configure(text_color="#6a6a78")

    def _esconder_dica_entrada(self):
        """Tira a dica pra você escrever de verdade (texto na cor normal)."""
        if self._dica_ativa:
            self._dica_ativa = False
            self.entrada.delete("1.0", "end")
            self.entrada.configure(text_color=self._cor_texto_entrada)

    def _entrada_focou(self, evento=None):
        self._esconder_dica_entrada()

    def _entrada_desfocou(self, evento=None):
        if not self.entrada.get("1.0", "end").strip():
            self._mostrar_dica_entrada()
            self._ajustar_altura_entrada()

    def _texto_entrada(self):
        """O texto REAL do campo (vazio se estiver mostrando só a dica cinza)."""
        return "" if self._dica_ativa else self.entrada.get("1.0", "end")

    def _set_entrada(self, texto):
        """Escreve um texto no campo (usado pela transcrição de voz)."""
        self._esconder_dica_entrada()
        self._dica_ativa = False
        self.entrada.delete("1.0", "end")
        self.entrada.insert("1.0", texto)
        self._ajustar_altura_entrada()

    def _limpar_entrada(self):
        """Esvazia o campo e o encolhe de volta pra uma linha."""
        self._dica_ativa = False
        self.entrada.delete("1.0", "end")
        self._ajustar_altura_entrada()

    def _enter_envia(self, evento=None):
        """Enter envia; o 'break' impede o Textbox de inserir a quebra de linha
        (o Shift+Enter, esse sim, quebra — tem bind próprio)."""
        self.enviar()
        return "break"

    def _ajustar_altura_entrada(self, evento=None):
        """Faz o campo CRESCER conforme o texto: conta as linhas EXIBIDAS (já
        contando as quebras por palavra) e ajusta a altura, até o teto — daí
        pra frente ele rola por dentro. O 20/14 são altura-de-linha e folga;
        como o CustomTkinter escala esses números junto com a fonte, a conta
        acompanha o DPI da tela sozinha."""
        conta = self.entrada._textbox.count("1.0", "end", "displaylines")
        linhas = conta[0] if conta else 1
        linhas = max(1, min(linhas, self._MAX_LINHAS_ENTRADA))
        self.entrada.configure(height=linhas * 20 + 14)

    def _falar(self, texto):
        """Fala o texto numa thread (não trava a janela). Com o avatar aberto,
        liga o LIP-SYNC: a boca dele mexe junto com a voz. Ao terminar, volta
        pra 'ociosa'."""
        self._expressao("falando")
        # Só liga o lip-sync se o avatar está aberto; senão, fala normal.
        boca = avatar2d.lip_sync if avatar2d.esta_aberto() else None

        def tocar():
            try:
                voz.falar(texto, ao_falar=boca)   # bloqueia até a fala acabar
            except Exception:
                logging.exception("Falha ao falar")
            self.after(0, lambda: self._expressao("ociosa"))

        threading.Thread(target=tocar, daemon=True).start()

    def trocar_modo_view(self, modo):
        """Troca SÓ a área central: a conversa (chat) ou o laboratório de
        imagem. O avatar não entra mais aqui — ele é uma janela flutuante com
        liga/desliga próprio (_toggle_avatar) e SOBREVIVE à troca de modo."""
        if modo == "imagem":
            self.modo_view = "imagem"
            self._area_chat_visivel(False)
            self.view_imagem.pack(fill="both", expand=True, padx=12, pady=(0, 12))
            self._atualizar_lista_modelos()   # reflete o que está no Forge AGORA
            self._recarregar_loras()          # pega LoRAs novos na pasta
        else:
            self.modo_view = "chat"
            self.view_imagem.pack_forget()
            self._area_chat_visivel(True)

    def _toggle_avatar(self):
        """Liga/desliga a janela flutuante do avatar — INDEPENDENTE do modo de
        tela. Aberto, ele fica por cima de tudo e ganha lip-sync/expressões
        quando o Yato fala (o _falar/_expressao checam avatar2d.esta_aberto())."""
        if self.switch_avatar.get():           # ligou o switch → tentar abrir
            if not avatar2d.disponivel():
                self._bolha("Avatar indisponível — falta instalar o Electron "
                            "(rode: npm install em avatar-electron/) ou a pasta "
                            "avatar/.", autor="dica")
                self.switch_avatar.deselect()  # não abriu → desliga o switch
                return
            avatar2d.mostrar()
        else:                                  # desligou → fecha a janela
            avatar2d.esconder()

    def _area_chat_visivel(self, visivel):
        """Mostra ou esconde TODA a interface do chat (mensagens + barra de
        digitar + seletor de modo) — usado ao entrar/sair do modo Imagem."""
        if visivel:
            self.area.pack(fill="both", expand=True, padx=12, pady=(0, 12))
            self.linha_modo.pack(fill="x", padx=14, pady=(0, 4))
            self.linha_baixo.pack(fill="x", padx=12, pady=(0, 12))
        else:
            self.area.pack_forget()
            self.linha_modo.pack_forget()
            self.linha_baixo.pack_forget()
            self.linha_anexo.pack_forget()   # o chip de anexo some junto

    def _expressao(self, nome):
        """Repassa a expressão (ociosa/pensando/falando/feliz) pro avatar
        flutuante — só faz efeito se ele estiver aberto agora."""
        if avatar2d.esta_aberto():
            avatar2d.definir_expressao(nome)

    # ------------------------------------------------------- modo imagem
    def _montar_view_imagem(self):
        """O laboratório de geração, em DUAS COLUNAS: à esquerda os controles
        (favoritos, personagem, prompt, ações), à direita a imagem GRANDE. O
        'modo livre' (descrever em PT) segue disponível, encolhido."""
        v = self.view_imagem

        # ---- TOPO (largura toda): Modelo + Tamanho ----
        # self._modelos_disponiveis mapeia nome amigável -> título completo.
        topo = ctk.CTkFrame(v, fg_color="transparent")
        topo.pack(fill="x", pady=(0, 8))
        ctk.CTkLabel(topo, text="Modelo:", font=ctk.CTkFont(size=12)).pack(side="left")
        self._modelos_disponiveis = {}
        self._modelo_desejado = None   # modelo que você escolheu (aplica ao gerar)
        self.seletor_modelo_imagem = DropdownInterno(
            topo, values=["(carregando…)"], width=240,
            command=self._trocar_modelo_click,
        )
        self.seletor_modelo_imagem.pack(side="left", padx=(8, 8))
        ctk.CTkButton(
            topo, text="🔄", width=32, fg_color="transparent", border_width=1,
            command=self._atualizar_lista_modelos,
        ).pack(side="left")
        self.seletor_tamanho = DropdownInterno(
            topo, values=list(TAMANHOS_IMAGEM.keys()), width=112,
            font=ctk.CTkFont(size=11),
        )
        self.seletor_tamanho.set("Quadrado")
        self.seletor_tamanho.pack(side="right")
        ctk.CTkLabel(topo, text="Tamanho:",
                     font=ctk.CTkFont(size=11)).pack(side="right", padx=(0, 6))
        # ✨ Alta resolução (hires fix): 2º passe que amplia e detalha. Mais lento
        # e pesado — desligado por padrão; ligue pra wallpaper.
        self.switch_hires = ctk.CTkSwitch(topo, text="✨ Alta res.",
                                          font=ctk.CTkFont(size=11))
        self.switch_hires.pack(side="right", padx=(0, 14))

        # ---- CORPO: duas colunas (controles | painel de abas) ----
        corpo = ctk.CTkFrame(v, fg_color="transparent")
        corpo.pack(fill="both", expand=True)
        # Coluna esquerda de largura FIXA (pack_propagate(False) faz ela respeitar
        # os 430px e não encolher/esticar conforme o conteúdo).
        col_esq = ctk.CTkFrame(corpo, fg_color="transparent", width=430)
        col_esq.pack(side="left", fill="y")
        col_esq.pack_propagate(False)
        col_dir = ctk.CTkFrame(corpo, fg_color="transparent")
        col_dir.pack(side="left", fill="both", expand=True, padx=(12, 0))

        # ===== ESQUERDA: só os controles (agora com folga) =====
        ctk.CTkLabel(col_esq, text="Personagem (opcional — o Yato encaixa no preset):",
                     font=ctk.CTkFont(size=12), anchor="w").pack(fill="x", pady=(0, 4))
        self.campo_personagem = ctk.CTkEntry(
            col_esq, height=36,
            placeholder_text="gojo, rias gremory, uma garota de cabelo azul…")
        self.campo_personagem.pack(fill="x", pady=(0, 16))
        # Autocomplete de personagem com as tags REAIS do Danbooru (nome certo +
        # contagem de imagens = quão bem o modelo desenha). Enquanto você digita.
        self._ac_after = self._ac_card = self._ac_resultado = self._ac_bind = None
        self.campo_personagem.bind("<KeyRelease>", self._ac_ao_digitar)

        ctk.CTkLabel(col_esq, text="Prompt (inglês — pode editar antes de gerar):",
                     font=ctk.CTkFont(size=12), anchor="w").pack(fill="x", pady=(0, 4))
        self.campo_prompt = ctk.CTkTextbox(col_esq, height=150)
        self.campo_prompt.pack(fill="x")

        linha_molde = ctk.CTkFrame(col_esq, fg_color="transparent")
        linha_molde.pack(fill="x", pady=(10, 0))
        ctk.CTkButton(linha_molde, text="🎭 Virar molde", width=120, height=26,
                      fg_color="transparent", border_width=1, text_color="#c9b8ff",
                      font=ctk.CTkFont(size=11), command=self._virar_molde_click).pack(side="left")
        ctk.CTkLabel(linha_molde, text="reusa o estilo com outro personagem",
                     font=ctk.CTkFont(size=10), text_color="#6a6a80").pack(side="left", padx=8)

        # ---- LoRA: escolhe da pasta + peso, e injeta <lora:nome:peso> no prompt
        linha_lora = ctk.CTkFrame(col_esq, fg_color="#1f1f2a", corner_radius=8)
        linha_lora.pack(fill="x", pady=(14, 0))
        ctk.CTkLabel(linha_lora, text="LoRA:", font=ctk.CTkFont(size=11),
                     text_color="#8a8aa0").pack(side="left", padx=(8, 4), pady=6)
        self.seletor_lora = DropdownInterno(
            linha_lora, values=["(nenhum)"], width=140, font=ctk.CTkFont(size=11))
        self.seletor_lora.pack(side="left", pady=6)
        ctk.CTkButton(linha_lora, text="➕", width=30,
                      command=self._adicionar_lora).pack(side="right", padx=(4, 8), pady=6)
        self.rotulo_peso_lora = ctk.CTkLabel(linha_lora, text="0.8",
                                             font=ctk.CTkFont(size=10), width=24)
        self.rotulo_peso_lora.pack(side="right")
        # Trava em 0 → 1.0 (força cheia): acima de 1.0 costuma "queimar"/distorcer.
        self.peso_lora = ctk.CTkSlider(linha_lora, from_=0, to=1, number_of_steps=10,
                                       width=78, command=self._atualizar_peso_lora)
        self.peso_lora.set(0.8)
        self.peso_lora.pack(side="right", padx=(6, 2), pady=6)
        self._recarregar_loras()

        linha_livre = ctk.CTkFrame(col_esq, fg_color="#1f1f2a", corner_radius=8)
        linha_livre.pack(fill="x", pady=(14, 8))
        ctk.CTkLabel(linha_livre, text="Modo livre:", font=ctk.CTkFont(size=11),
                     text_color="#8a8aa0").pack(side="left", padx=(8, 6), pady=6)
        self.campo_descricao = ctk.CTkEntry(
            linha_livre, placeholder_text="descreva em português…")
        self.campo_descricao.pack(side="left", fill="x", expand=True, pady=6)
        ctk.CTkButton(linha_livre, text="✨ Melhorar", width=90,
                      command=self._melhorar_prompt_click).pack(side="left", padx=6, pady=6)

        # ---- Prompt A PARTIR DE UMA IMAGEM: cola/anexa uma imagem e o Yato
        #      "engenharia reversa" um molde de prompt (com {personagem}) dela.
        linha_daimg = ctk.CTkFrame(col_esq, fg_color="#1f1f2a", corner_radius=8)
        linha_daimg.pack(fill="x", pady=(0, 14))
        ctk.CTkButton(linha_daimg, text="🔍 Prompt da imagem", width=150, height=28,
                      font=ctk.CTkFont(size=11),
                      command=self._prompt_de_imagem_click).pack(side="left", padx=(8, 6), pady=6)
        ctk.CTkButton(linha_daimg, text="📎", width=32, height=28, fg_color="transparent",
                      border_width=1, command=self._anexar_ref_imagem).pack(side="left", pady=6)
        # Miniatura da imagem carregada (feedback de "o que está na referência" e
        # de que a troca funcionou) — fica escondida até você colar/anexar algo.
        self.thumb_ref = ctk.CTkLabel(linha_daimg, text="", width=40, height=40,
                                      fg_color="#14141c", corner_radius=6)
        self._thumb_ref_img = None     # segura a PhotoImage viva
        self.rotulo_ref_img = ctk.CTkLabel(linha_daimg, text="cole (Ctrl+V) ou anexe 📎",
                                           font=ctk.CTkFont(size=10), text_color="#6a6a80")
        self.rotulo_ref_img.pack(side="left", padx=8)
        # Ctrl+V no campo de prompt: se o clipboard tem IMAGEM, vira referência;
        # senão, deixa colar texto normal (mesma ideia do Ctrl+V do chat).
        self.campo_prompt.bind("<Control-v>", self._colar_ref)
        self.campo_prompt.bind("<Control-V>", self._colar_ref)

        linha_gerar = ctk.CTkFrame(col_esq, fg_color="transparent")
        linha_gerar.pack(fill="x", pady=(8, 4))
        ctk.CTkButton(linha_gerar, text="🎨 Gerar",
                      command=self._gerar_imagem_click).pack(side="left")
        ctk.CTkButton(linha_gerar, text="⭐ Favoritar", width=110,
                      fg_color="transparent", border_width=1,
                      command=self._favoritar_click).pack(side="left", padx=(8, 0))
        ctk.CTkButton(linha_gerar, text="📁", width=40, fg_color="transparent",
                      border_width=1, command=self._abrir_pasta_imagens).pack(side="right")

        # ===== DIREITA: painel com ABAS [🖼️ Imagem | ⭐ Favoritos] =====
        # Um espaço, dois usos: a imagem grande OU a galeria de favoritos. Cada
        # aba usa o painel inteiro, então nada fica apertado.
        self.abas_dir = ctk.CTkSegmentedButton(
            col_dir, values=["🖼️ Imagem", "⭐ Favoritos", "🔍 Sugestões"],
            command=self._trocar_aba_dir)
        self.abas_dir.set("🖼️ Imagem")
        self.abas_dir.pack(fill="x", pady=(0, 6))

        # -- painel IMAGEM (corner_radius=0: imagem retangular, sem "buraco") --
        self.painel_imagem = ctk.CTkFrame(col_dir, fg_color="transparent")
        self.rotulo_imagem_gerada = ctk.CTkLabel(
            self.painel_imagem, text="🖼️ a imagem gerada / referência aparece aqui",
            text_color="#6a6a80", fg_color="#14141c", corner_radius=0)
        self.rotulo_imagem_gerada.pack(fill="both", expand=True)
        # BUG DA IMAGEM CORRIGIDO: em vez de medir o painel só uma vez (que dava
        # tamanho errado se o layout não tinha assentado), re-encaixo a imagem
        # quando o painel muda de tamanho (evento <Configure>) — com DEBOUNCE:
        # arrastar a borda da janela dispara dezenas de <Configure> por segundo,
        # e cada encaixe relê o PNG do disco; então espero 100ms de "silêncio" e
        # encaixo UMA vez, quando você solta o mouse.
        self.rotulo_imagem_gerada.bind("<Configure>", self._agendar_reencaixe)
        self.status_imagem = ctk.CTkLabel(
            self.painel_imagem, text="", font=ctk.CTkFont(size=11), text_color="#8a8aa0")
        self.status_imagem.pack(fill="x", pady=(6, 0))

        # -- painel FAVORITOS (grade 2 colunas + paginação, sem rolagem) --
        self.painel_favoritos = ctk.CTkFrame(col_dir, fg_color="transparent")
        self.galeria_favoritos = ctk.CTkFrame(
            self.painel_favoritos, fg_color="#20202c", corner_radius=8)
        self.galeria_favoritos.pack(fill="both", expand=True)
        self.galeria_favoritos.grid_columnconfigure((0, 1), weight=1)
        barra_pag = ctk.CTkFrame(self.painel_favoritos, fg_color="transparent")
        barra_pag.pack(fill="x", pady=(6, 0))
        self.btn_pag_ant = ctk.CTkButton(barra_pag, text="◀", width=40, height=26,
                                          fg_color="transparent", border_width=1,
                                          command=self._pagina_anterior)
        self.btn_pag_ant.pack(side="left")
        self.btn_pag_prox = ctk.CTkButton(barra_pag, text="▶", width=40, height=26,
                                           fg_color="transparent", border_width=1,
                                           command=self._pagina_proxima)
        self.btn_pag_prox.pack(side="right")
        self.rotulo_pagina = ctk.CTkLabel(barra_pag, text="", font=ctk.CTkFont(size=11),
                                          text_color="#8a8aa0")
        self.rotulo_pagina.pack()

        # -- painel SUGESTÕES (as 2-3 variações do "🔍 Prompt da imagem") --
        self.painel_sugestoes = ctk.CTkFrame(col_dir, fg_color="transparent")
        self.lista_sugestoes = ctk.CTkFrame(
            self.painel_sugestoes, fg_color="#20202c", corner_radius=8)
        self.lista_sugestoes.pack(fill="both", expand=True)
        self._placeholder_sugestoes()

        self.painel_imagem.pack(fill="both", expand=True)   # começa na aba Imagem

        # ---- estado + primeira carga dos favoritos ----
        self._pagina_favoritos = 0
        self._cards_preset = {}        # id -> card (pra marcar o selecionado)
        # Cache de miniaturas: ler o PNG + reduzir (LANCZOS) custa; sem cache,
        # CADA troca de página refazia o trabalho todo. Aqui cada miniatura é
        # feita UMA vez (o dict também segura as PhotoImage vivas — senão o Tk
        # as esquece e elas somem da tela).
        self._cache_thumbs = {}        # nome do arquivo de ref -> PhotoImage
        self._preset_escolhido = None  # o preset (dict) escolhido agora
        self._img_grande_path = None   # imagem exibida agora (pro re-encaixe no resize)
        self._imagem_gerada_ctk = None
        self._ultima_imagem = None     # Path da última imagem gerada (pro Favoritar)
        self._ultimo_prompt = ""       # o prompt final usado (pro Favoritar)
        presets.preencher_modelos_faltando()   # backfill do modelo nos favoritos antigos
        self._recarregar_favoritos()

    def _trocar_aba_dir(self, valor):
        """Alterna o painel direito entre a imagem, os favoritos e as sugestões."""
        self.painel_imagem.pack_forget()
        self.painel_favoritos.pack_forget()
        self.painel_sugestoes.pack_forget()
        if "Favoritos" in valor:
            self.painel_favoritos.pack(fill="both", expand=True)
        elif "Sugestões" in valor:
            self.painel_sugestoes.pack(fill="both", expand=True)
        else:
            self.painel_imagem.pack(fill="both", expand=True)
            self._reencaixar_imagem()   # o painel pode ter mudado enquanto oculto

    def _ir_para_aba_imagem(self):
        """Traz a aba 🖼️ Imagem pra frente (usado ao escolher um favorito e ao
        terminar uma geração — o resultado sempre aparece pra você)."""
        self.abas_dir.set("🖼️ Imagem")
        self._trocar_aba_dir("🖼️ Imagem")

    def _recarregar_favoritos(self):
        """Lê os presets do disco e (re)desenha os cards da galeria. Chamado no
        início e toda vez que um favorito é adicionado."""
        for filho in self.galeria_favoritos.winfo_children():
            filho.destroy()
        self._cards_preset = {}

        lista = presets.carregar()
        if not lista:
            ctk.CTkLabel(
                self.galeria_favoritos,
                text="nenhum favorito ainda — gere e clique em ⭐",
                font=ctk.CTkFont(size=11), text_color="#6a6a80",
            ).grid(row=0, column=0, columnspan=2, padx=8, pady=40)
            self.btn_pag_ant.configure(state="disabled")
            self.btn_pag_prox.configure(state="disabled")
            self.rotulo_pagina.configure(text="")
            return

        # Só a página atual vai pra tela (grade 2 colunas, sem rolagem).
        POR_PAGINA = 4
        total_paginas = (len(lista) + POR_PAGINA - 1) // POR_PAGINA
        self._pagina_favoritos = max(0, min(self._pagina_favoritos, total_paginas - 1))
        inicio = self._pagina_favoritos * POR_PAGINA
        for i, p in enumerate(lista[inicio:inicio + POR_PAGINA]):
            self._criar_card_preset(p, i)

        # As setas ficam desligadas nas pontas (nada de página inválida).
        self.btn_pag_ant.configure(
            state="disabled" if self._pagina_favoritos == 0 else "normal")
        self.btn_pag_prox.configure(
            state="disabled" if self._pagina_favoritos >= total_paginas - 1 else "normal")
        self.rotulo_pagina.configure(
            text=f"{self._pagina_favoritos + 1} / {total_paginas}" if total_paginas > 1 else "")

    def _pagina_anterior(self):
        if self._pagina_favoritos > 0:
            self._pagina_favoritos -= 1
            self._recarregar_favoritos()

    def _pagina_proxima(self):
        self._pagina_favoritos += 1          # o clamp no _recarregar segura o limite
        self._recarregar_favoritos()

    # tamanho dos cards grandes da galeria (2×2 cabe no painel a 1100px)
    CARD_W, CARD_H = 296, 278

    def _thumb_card(self, caminho, w, h):
        """Miniatura que PREENCHE o card (corta pra cobrir, tipo object-fit:cover)
        com um degradê escuro assado no rodapé — pro título/chips por cima ficarem
        legíveis (o Tkinter não compõe transparência de widget sobre imagem, então
        o degradê vai NA imagem)."""
        img = Image.open(caminho).convert("RGB")
        escala = max(w / img.width, h / img.height)          # cobre (não deixa borda)
        img = img.resize((max(1, round(img.width * escala)),
                          max(1, round(img.height * escala))), Image.LANCZOS)
        esq, topo = (img.width - w) // 2, (img.height - h) // 2   # corte centralizado
        img = img.crop((esq, topo, esq + w, topo + h)).convert("RGBA")
        # scrim: transparente no topo, escurece até ~#080810 no rodapé
        grad = Image.new("L", (1, h), 0)
        px = grad.load()
        ini, cheio = int(h * 0.40), int(h * 0.72)
        for y in range(h):
            px[0, y] = 0 if y <= ini else min(240, int(240 * (y - ini) / max(1, cheio - ini)))
        scrim = Image.new("RGBA", (w, h), (8, 8, 16, 255))
        scrim.putalpha(grad.resize((w, h)))
        return ImageTk.PhotoImage(Image.alpha_composite(img, scrim))

    def _criar_card_preset(self, preset, indice):
        """Um card GRANDE da galeria (estilo Opção B): a imagem preenche o card e
        o nome + chips de modelo/LoRA ficam POR CIMA, no rodapé. ✏️ renomear no
        topo-esquerda, ✕ apagar no topo-direita. Clicar seleciona."""
        w, h = self.CARD_W, self.CARD_H
        ref = preset.get("referencia")
        thumb = self._cache_thumbs.get(ref) if ref else None
        if thumb is None and ref:
            caminho = presets.PASTA_REFS / ref
            if caminho.exists():
                try:
                    thumb = self._thumb_card(caminho, w, h)
                    self._cache_thumbs[ref] = thumb
                except (OSError, ValueError):
                    thumb = None

        card = ctk.CTkFrame(
            self.galeria_favoritos, width=w, height=h, corner_radius=10,
            fg_color="#14141c", border_width=1, border_color="#34343f")
        card.grid(row=indice // 2, column=indice % 2, padx=6, pady=6, sticky="n")
        card.grid_propagate(False)
        card.pack_propagate(False)

        # imagem preenchendo o card (ou placeholder se faltar a referência)
        if thumb is not None:
            fundo = tk.Label(card, image=thumb, bd=0, highlightthickness=0, bg="#14141c")
        else:
            fundo = ctk.CTkLabel(card, text="sem imagem", text_color="#6a6a80",
                                 font=ctk.CTkFont(size=11), fg_color="#14141c")
        fundo.place(x=0, y=0, relwidth=1, relheight=1)

        # rodapé (nome + chips) por cima do degradê assado
        info = ctk.CTkFrame(card, fg_color="#080810", corner_radius=0)
        info.place(relx=0, rely=1.0, anchor="sw", relwidth=1)
        rot_nome = ctk.CTkLabel(
            info, text=preset["nome"], font=ctk.CTkFont(size=14, weight="bold"),
            text_color="#ffffff", fg_color="#080810", anchor="w", justify="left",
            wraplength=w - 24)
        rot_nome.pack(fill="x", padx=10, pady=(6, 2))
        chips = ctk.CTkFrame(info, fg_color="#080810")
        chips.pack(fill="x", padx=8, pady=(0, 9))
        modelo = self._nome_amigavel_modelo(preset["modelo"]) if preset.get("modelo") else "—"
        chip_mod = ctk.CTkLabel(
            chips, text=f" {modelo} ", font=ctk.CTkFont(size=10, weight="bold"),
            text_color="#c9b8ff", fg_color="#2f2a4a", corner_radius=8)
        chip_mod.pack(side="left", padx=(2, 4))
        # LoRA(s) do próprio prompt_base (<lora:nome:peso>), peso em %.
        loras = re.findall(r"<lora:([^:>]+):([0-9.]+)>", preset.get("prompt_base", ""))
        chip_lora = None
        if loras:
            curto = loras[0][0].split(" - ")[0].replace("_", " ").strip()
            if len(curto) > 14:
                curto = curto[:14] + "…"
            txt = f" {curto} {int(round(float(loras[0][1]) * 100))}% "
            if len(loras) > 1:
                txt = txt[:-1] + f"+{len(loras) - 1} "
            chip_lora = ctk.CTkLabel(
                chips, text=txt, font=ctk.CTkFont(size=10, weight="bold"),
                text_color="#7fd4c1", fg_color="#1f3a35", corner_radius=8)
            chip_lora.pack(side="left")

        # clicar em qualquer área "morta" do card = selecionar
        for wid in (card, fundo, info, rot_nome, chips, chip_mod):
            wid.bind("<Button-1>", lambda e, p=preset: self._selecionar_preset(p))
        if chip_lora is not None:
            chip_lora.bind("<Button-1>", lambda e, p=preset: self._selecionar_preset(p))

        # ✏ renomear (topo-esq, pílula) e ✕ apagar (topo-dir)
        ctk.CTkButton(
            card, text="✏ renomear", width=94, height=24, corner_radius=12,
            fg_color="#161620", hover_color="#3a3358", text_color="#c9b8ff",
            font=ctk.CTkFont(size=11),
            command=lambda p=preset: self._renomear_favorito(p),
        ).place(relx=0.0, rely=0.0, x=8, y=8, anchor="nw")
        ctk.CTkButton(
            card, text="✕", width=26, height=24, corner_radius=8,
            fg_color="#161620", hover_color="#c0392b", text_color="#ffffff",
            font=ctk.CTkFont(size=12, weight="bold"),
            command=lambda p=preset: self._apagar_favorito(p),
        ).place(relx=1.0, rely=0.0, x=-8, y=8, anchor="ne")
        self._cards_preset[preset["id"]] = card

    def _selecionar_preset(self, preset):
        """Carrega o prompt_base do preset no campo e destaca o card. Se você
        clicar no card JÁ selecionado, DESSELECIONA (limpa destaque e prompt)."""
        ja_era = self._preset_escolhido and self._preset_escolhido["id"] == preset["id"]
        if ja_era:
            self._preset_escolhido = None
            for card in self._cards_preset.values():
                card.configure(border_color="#34343f", border_width=1)
            self.campo_prompt.delete("1.0", "end")
            self.campo_personagem.delete(0, "end")   # limpa TUDO, sem sobra
            self._limpar_imagem_grande()   # volta o painel pro placeholder
            self.status_imagem.configure(text="Seleção limpa.")
            return
        self._preset_escolhido = preset
        for id_, card in self._cards_preset.items():
            escolhido = (id_ == preset["id"])
            card.configure(border_color="#6c5ce7" if escolhido else "#34343f",
                           border_width=2 if escolhido else 1)
        self.campo_prompt.delete("1.0", "end")
        self.campo_prompt.insert("1.0", preset["prompt_base"])
        # O seletor de tamanho segue o preset (ele lembra em que proporção foi
        # feito). Se o tamanho salvo não for um dos três, deixa como está.
        larg, alt = preset.get("tamanho", [768, 768])
        nome_tam = next((n for n, (w, h) in TAMANHOS_IMAGEM.items()
                         if w == larg and h == alt), None)
        if nome_tam:
            self.seletor_tamanho.set(nome_tam)
        # Mostra a imagem de REFERÊNCIA grande na direita (pra você ver bem antes
        # de gerar). Não mexe em self._ultima_imagem — o ⭐ Favoritar continua
        # salvando só o que você GEROU, não a referência.
        ref = preset.get("referencia")
        # Clicar num favorito PULA pra aba Imagem (pra você ver a referência
        # grande e já gerar). Troca a aba ANTES de exibir, pra o painel já estar
        # visível e medido quando a imagem for encaixada.
        self._ir_para_aba_imagem()
        if ref_existe := (ref and (presets.PASTA_REFS / ref).exists()):
            self._exibir_imagem_grande(presets.PASTA_REFS / ref)
        else:
            self._limpar_imagem_grande()
        info_modelo = (f" · {self._nome_amigavel_modelo(preset['modelo'])}"
                       if preset.get("modelo") else "")
        rotulo = "Referência" if ref_existe else "Base"
        self.status_imagem.configure(
            text=f"{rotulo}: {preset['nome']}{info_modelo} — diga um personagem ou gere direto.")

    def _renomear_favorito(self, preset):
        """Troca o nome de um favorito (o ✏️ do card)."""
        dialogo = ctk.CTkInputDialog(
            title="Renomear favorito", text=f"Novo nome:\n(atual: {preset['nome']})")
        novo = dialogo.get_input()
        if novo is None or not novo.strip():
            return
        novo = novo.strip()
        presets.renomear(preset["id"], novo)
        if self._preset_escolhido and self._preset_escolhido["id"] == preset["id"]:
            self._preset_escolhido["nome"] = novo
        self._recarregar_favoritos()
        self.status_imagem.configure(text=f"✏️ renomeado: {novo}")

    def _apagar_favorito(self, preset):
        """Apaga um favorito (com confirmação). Some da galeria na hora."""
        from tkinter import messagebox
        if not messagebox.askyesno("Apagar favorito", f'Apagar "{preset["nome"]}"?'):
            return
        presets.remover(preset["id"])
        # Tira a miniatura do cache: se o mesmo id renascer depois com OUTRA
        # imagem, não pode aparecer a antiga.
        if preset.get("referencia"):
            self._cache_thumbs.pop(preset["referencia"], None)
        if self._preset_escolhido and self._preset_escolhido["id"] == preset["id"]:
            self._preset_escolhido = None
            self.campo_prompt.delete("1.0", "end")
        self._recarregar_favoritos()
        self.status_imagem.configure(text=f'🗑️ apagado: {preset["nome"]}')

    def _virar_molde_click(self):
        """Generaliza o prompt do campo: tira os traços do personagem e põe o
        slot {personagem}, pra reusar o estilo com outro personagem. Roda numa
        thread (usa o cérebro)."""
        base = self.campo_prompt.get("1.0", "end").strip()
        if not base:
            self.status_imagem.configure(text="Sem prompt pra virar molde — escolha ou gere algo.")
            return
        self.status_imagem.configure(text="🎭 generalizando o estilo…")

        def trabalhar():
            try:
                molde = imagem.generalizar_prompt(base)
                self.after(0, lambda: self._molde_pronto(molde))
            except imagem.ImagemError as erro:
                self.after(0, lambda: self.status_imagem.configure(text=str(erro)))

        threading.Thread(target=trabalhar, daemon=True).start()

    def _molde_pronto(self, molde):
        self.campo_prompt.delete("1.0", "end")
        self.campo_prompt.insert("1.0", molde)
        self.status_imagem.configure(
            text="🎭 virou molde — diga um personagem e gere (ou ⭐ salve o molde).")

    def _recarregar_loras(self):
        """(Re)varre a pasta de LoRAs do Forge e popula o seletor. Chamado ao
        montar a aba e toda vez que você entra no modo Imagem (pega LoRAs novos
        que você jogou na pasta com o Yato aberto)."""
        loras = imagem.listar_loras()
        if loras:
            self.seletor_lora.configure(values=loras)
            if self.seletor_lora.get() not in loras:
                self.seletor_lora.set(loras[0])
        else:
            self.seletor_lora.configure(values=["(nenhum na pasta)"])
            self.seletor_lora.set("(nenhum na pasta)")

    def _atualizar_peso_lora(self, valor):
        """Mostra o peso do LoRA (0.0–1.0) ao lado do slider."""
        self.rotulo_peso_lora.configure(text=f"{float(valor):.1f}")

    def _adicionar_lora(self):
        """Injeta <lora:nome:peso> no fim do prompt — o mesmo que digitar na mão,
        mas sem errar o nome. Se ESSE LoRA já está no prompt, só ATUALIZA o peso
        (clicar 2x não duplica); LoRAs diferentes podem ser empilhados."""
        nome = self.seletor_lora.get()
        if not nome or nome.startswith("("):
            self.status_imagem.configure(text="Nenhum LoRA na pasta pra adicionar.")
            return
        peso = round(self.peso_lora.get(), 1)
        tag = f"<lora:{nome}:{peso}>"
        atual = self.campo_prompt.get("1.0", "end").strip()
        ja_tinha = re.search(rf"<lora:{re.escape(nome)}:[0-9.]+>", atual)
        if ja_tinha:
            novo = atual.replace(ja_tinha.group(0), tag)
            aviso = f"LoRA atualizado: {nome} ({peso})"
        else:
            novo = f"{atual}, {tag}" if atual else tag
            aviso = f"LoRA adicionado: {nome} ({peso})"
        self.campo_prompt.delete("1.0", "end")
        self.campo_prompt.insert("1.0", novo)
        self.status_imagem.configure(text=aviso)
        # Só pra LoRA NOVO no prompt: busca a trigger word no Civitai e injeta
        # sozinha (senão o LoRA carrega mas o estilo não "ativa"). Hashear o
        # arquivo (~200 MB) + consultar leva ~1-2s na 1ª vez, então roda numa
        # thread. A thread SÓ guarda o resultado (não toca na UI); quem aplica é
        # o poller `_checar_trigger`, agendado por `after` na thread principal —
        # o jeito à prova de balas de conversar com o Tkinter de outra thread.
        if not ja_tinha:
            self.status_imagem.configure(text=f"{aviso} · buscando trigger…")
            self._trigger_resultado = None
            threading.Thread(target=self._buscar_trigger_lora,
                             args=(nome,), daemon=True).start()
            self.after(150, lambda: self._checar_trigger(aviso))

    def _buscar_trigger_lora(self, nome):
        """(thread) Só busca a trigger word e deixa numa gaveta — NÃO mexe na UI."""
        self._trigger_resultado = (nome, imagem.trigger_de_lora(nome))

    def _checar_trigger(self, aviso):
        """(thread principal) Espera o resultado da busca e injeta no prompt. A
        regra de injeção mora em imagem.injetar_trigger (pura, testável)."""
        res = self._trigger_resultado
        if res is None:                            # ainda buscando: tenta de novo
            self.after(150, lambda: self._checar_trigger(aviso))
            return
        _nome, trigger = res
        if not trigger:
            self.status_imagem.configure(text=f"{aviso} · (sem trigger)")
            return
        atual = self.campo_prompt.get("1.0", "end").strip()
        novo = imagem.injetar_trigger(atual, trigger)
        if novo == atual:                          # já estava lá: não mexe
            self.status_imagem.configure(text=aviso)
            return
        self.campo_prompt.delete("1.0", "end")
        self.campo_prompt.insert("1.0", novo)
        self.status_imagem.configure(text=f"{aviso} · trigger: {trigger}")

    def _favoritar_click(self):
        """Salva a última imagem gerada como um novo favorito. Pergunta só o
        nome; o prompt e a miniatura saem da própria imagem (que já guarda o
        prompt embutido). É a 'cópia fiel' — virar molde com {personagem} fica
        pra depois, editando o meus.json."""
        if not self._ultima_imagem or not Path(self._ultima_imagem).exists():
            self.status_imagem.configure(text="Gere uma imagem antes de favoritar ⭐")
            return
        sugestao = ", ".join(self._ultimo_prompt.split(",")[:2]).strip()[:40] or "Favorito"
        dialogo = ctk.CTkInputDialog(
            title="Salvar favorito", text=f"Nome do favorito:\n(ex.: {sugestao})")
        nome = dialogo.get_input()
        if nome is None or not nome.strip():
            return   # cancelou ou deixou vazio
        nome = nome.strip()
        id_ = presets.id_unico(nome)
        preset = presets.importar_de_png(self._ultima_imagem, nome=nome, id_=id_)
        if preset is None:
            self.status_imagem.configure(text="Não consegui ler o prompt dessa imagem 🤔")
            return
        # Salva o que está NO CAMPO (não o prompt embutido na imagem): assim, se
        # você virou molde antes, o favorito guarda o molde com {personagem} —
        # sem o nome do personagem grudado. Só cai no embutido se o campo vazio.
        do_campo = self.campo_prompt.get("1.0", "end").strip()
        if do_campo:
            preset["prompt_base"] = do_campo
        presets.adicionar(preset)
        self._recarregar_favoritos()
        self.status_imagem.configure(text=f"⭐ salvo: {nome}")

    def _melhorar_prompt_click(self):
        """Manda o cérebro traduzir/expandir a descrição em português pra um
        prompt de verdade — roda numa thread (não trava a janela)."""
        descricao = self.campo_descricao.get().strip()
        if not descricao:
            self.status_imagem.configure(text="Escreva uma descrição primeiro.")
            return
        self.status_imagem.configure(text="✨ melhorando o prompt…")

        def trabalhar():
            try:
                prompt = imagem.melhorar_prompt(descricao)
                self.after(0, lambda: self._prompt_melhorado(prompt))
            except imagem.ImagemError as erro:
                self.after(0, lambda: self.status_imagem.configure(text=str(erro)))

        threading.Thread(target=trabalhar, daemon=True).start()

    def _prompt_melhorado(self, prompt):
        self.campo_prompt.delete("1.0", "end")
        self.campo_prompt.insert("1.0", prompt)
        self.status_imagem.configure(text="Prompt pronto — revise e gere quando quiser.")

    # ---- Autocomplete de personagem (tags reais do Danbooru) ----
    def _ac_ao_digitar(self, evento):
        """Cada tecla no campo Personagem dispara a busca — com um respiro
        (debounce de 300ms) pra não bater no Danbooru a cada letra. Esc fecha;
        setas/enter não disparam."""
        if evento.keysym == "Escape":
            self._ac_fechar()
            return
        if evento.keysym in ("Up", "Down", "Left", "Right", "Return", "Tab", "Shift_L",
                             "Shift_R", "Control_L", "Control_R"):
            return
        if self._ac_after:
            self.after_cancel(self._ac_after)
        self._ac_after = self.after(300, self._ac_disparar)

    def _ac_disparar(self):
        texto = self.campo_personagem.get().strip()
        if len(texto) < 2:
            self._ac_fechar()
            return
        self._ac_resultado = None
        threading.Thread(target=self._ac_buscar, args=(texto,), daemon=True).start()
        self.after(120, lambda: self._ac_checar(texto))

    def _ac_buscar(self, texto):
        """(thread) Só busca no Danbooru e guarda — não toca na UI."""
        self._ac_resultado = (texto, imagem.buscar_personagens_danbooru(texto))

    def _ac_checar(self, texto):
        """(thread principal) Mostra a lista quando a busca volta — se o campo
        ainda tiver o mesmo texto (senão era uma busca velha, ignora)."""
        res = self._ac_resultado
        if res is None:
            self.after(120, lambda: self._ac_checar(texto))
            return
        query, itens = res
        if query != self.campo_personagem.get().strip():
            return
        if itens:
            self._ac_mostrar(itens)
        else:
            self._ac_fechar()

    @staticmethod
    def _fmt_contagem(n):
        return f"{n / 1000:.1f}k" if n >= 1000 else str(n)

    def _ac_mostrar(self, itens):
        """Desenha o cartão de sugestões logo abaixo do campo (dentro da janela):
        cada linha = a tag + a contagem de imagens. Clicar preenche o campo."""
        self._ac_fechar()
        topo = self.winfo_toplevel()
        card = ctk.CTkFrame(
            topo, corner_radius=8,
            fg_color=ctk.ThemeManager.theme["CTkFrame"]["fg_color"],
            border_width=1, border_color=("gray60", "#5c5c6a"))
        for it in itens:
            linha = ctk.CTkFrame(card, fg_color="transparent", height=36)
            linha.pack(fill="x", padx=5, pady=2)
            linha.pack_propagate(False)          # respeita a altura maior
            lbl_tag = ctk.CTkLabel(linha, text=it["tag"], font=ctk.CTkFont(size=15),
                                   text_color=("gray10", "#e6e6f0"), anchor="w")
            lbl_tag.pack(side="left", padx=(10, 0))
            lbl_cnt = ctk.CTkLabel(linha, text=self._fmt_contagem(it["count"]),
                                   font=ctk.CTkFont(size=13, weight="bold"),
                                   text_color="#7fb0d4")
            lbl_cnt.pack(side="right", padx=(0, 12))
            for w in (linha, lbl_tag, lbl_cnt):
                w.bind("<Button-1>", lambda e, t=it["tag"]: self._ac_escolher(t))
                w.bind("<Enter>", lambda e, ln=linha: ln.configure(fg_color=("gray82", "#3a3a46")))
                w.bind("<Leave>", lambda e, ln=linha: ln.configure(fg_color="transparent"))
        self._ac_card = card
        card.update_idletasks()
        bx = self.campo_personagem.winfo_rootx() - topo.winfo_rootx()
        by = self.campo_personagem.winfo_rooty() - topo.winfo_rooty()
        # largura mínima = a do campo (o cartão cresce se a tag for mais longa)
        card.configure(width=self.campo_personagem.winfo_width())
        card.place(x=bx, y=by + self.campo_personagem.winfo_height() + 2)
        card.lift()
        self._ac_bind = topo.bind("<Button-1>", self._ac_clique_fora, add="+")

    def _ac_escolher(self, tag):
        self.campo_personagem.delete(0, "end")
        self.campo_personagem.insert(0, tag)
        self._ac_fechar()

    def _ac_clique_fora(self, evento):
        card = self._ac_card
        if card is None:
            return
        w = evento.widget
        while w is not None:
            if w is card or w is self.campo_personagem:
                return
            w = getattr(w, "master", None)
        self._ac_fechar()

    def _ac_fechar(self):
        if self._ac_card is None:
            return
        topo = self.winfo_toplevel()
        if self._ac_bind:
            topo.unbind("<Button-1>", self._ac_bind)
            self._ac_bind = None
        self._ac_card.destroy()
        self._ac_card = None

    # ---- Prompt a partir de uma imagem (visão → tags → moldes) ----
    def _colar_ref(self, _evento):
        """Ctrl+V no campo de prompt: se o clipboard tem IMAGEM, vira referência
        (e cancela a colagem de texto); senão, deixa colar texto normalmente."""
        dado = ImageGrab.grabclipboard()
        if isinstance(dado, Image.Image):
            self._set_ref_imagem(dado)
            return "break"
        if isinstance(dado, list):
            for caminho in dado:
                if str(caminho).lower().endswith((".png", ".jpg", ".jpeg", ".bmp", ".webp")):
                    try:
                        self._set_ref_imagem(Image.open(caminho))
                        return "break"
                    except OSError:
                        logging.exception("Não consegui abrir a imagem colada (ref)")
        return None

    def _anexar_ref_imagem(self):
        """Botão 📎 da aba Imagem: escolher um arquivo de imagem de referência."""
        caminho = filedialog.askopenfilename(
            title="Escolher imagem de referência",
            filetypes=[("Imagens", "*.png *.jpg *.jpeg *.bmp *.webp")])
        if caminho:
            try:
                self._set_ref_imagem(Image.open(caminho))
            except OSError:
                logging.exception("Não consegui abrir a imagem escolhida (ref)")

    def _set_ref_imagem(self, img):
        """Guarda a imagem de referência (encolhida + base64), mostra uma
        MINIATURA dela (feedback: você vê o que carregou e quando troca) e
        atualiza o rótulo."""
        img = img.convert("RGB")
        img.thumbnail((1344, 1344))
        buffer = io.BytesIO()
        img.save(buffer, format="PNG")
        self.imagem_ref_b64 = base64.b64encode(buffer.getvalue()).decode("ascii")
        # miniatura 40x40 ao lado do botão (CTkImage = nítida em HighDPI)
        mini = img.copy()
        mini.thumbnail((160, 160))
        self._thumb_ref_img = ctk.CTkImage(light_image=mini, dark_image=mini, size=(40, 40))
        self.thumb_ref.configure(image=self._thumb_ref_img, text="")
        self.thumb_ref.pack(side="right", padx=(0, 8), pady=4)   # idempotente
        self.rotulo_ref_img.configure(text="imagem pronta ✓ (Ctrl+V troca)",
                                      text_color="#7fd4c1")

    def _prompt_de_imagem_click(self):
        """Cola/anexa uma imagem → o Yato olha e sugere 2-3 moldes de prompt. O
        trabalho (visão + cérebro, ~30s) roda numa thread; um poller na thread
        principal mostra as opções quando ficam prontas (jeito seguro no Tkinter)."""
        if not self.imagem_ref_b64:
            self.status_imagem.configure(text="Cole (Ctrl+V) ou anexe 📎 uma imagem primeiro 🖼️")
            return
        # Já pula pra aba Sugestões mostrando "analisando…" — você acompanha o
        # trabalho ali em vez de ficar na aba Imagem esperando 30s.
        self._sugestoes_carregando()
        self.abas_dir.set("🔍 Sugestões")
        self._trocar_aba_dir("🔍 Sugestões")
        self.status_imagem.configure(text="🔍 olhando a imagem e montando prompts… (~30s)")
        self._moldes_resultado = None
        threading.Thread(target=self._buscar_moldes_imagem, daemon=True).start()
        self.after(200, self._checar_moldes_imagem)

    def _buscar_moldes_imagem(self):
        """(thread) Só roda o pipeline e guarda o resultado — não toca na UI."""
        try:
            self._moldes_resultado = ("ok", imagem.prompt_de_imagem(self.imagem_ref_b64, n=3))
        except imagem.ImagemError as erro:
            self._moldes_resultado = ("erro", str(erro))

    def _checar_moldes_imagem(self):
        """(thread principal) Espera o resultado e mostra as opções (ou o erro)."""
        res = self._moldes_resultado
        if res is None:
            self.after(200, self._checar_moldes_imagem)
            return
        estado, dado = res
        if estado == "erro":
            self._aviso_sugestoes(dado)          # mostra o erro na própria aba
            self.status_imagem.configure(text=dado)
            return
        self._popular_sugestoes(dado)
        self.status_imagem.configure(text="Sugestões prontas 👇 (clique em 'Usar este')")

    def _aviso_sugestoes(self, texto):
        """Mensagem centralizada na aba Sugestões (placeholder / carregando / erro)."""
        for filho in self.lista_sugestoes.winfo_children():
            filho.destroy()
        ctk.CTkLabel(self.lista_sugestoes, text=texto, font=ctk.CTkFont(size=12),
                     text_color="#8a8aa0", justify="center").pack(expand=True, padx=8, pady=40)

    def _placeholder_sugestoes(self):
        """Texto inicial da aba Sugestões (antes de rodar o 🔍 Prompt da imagem)."""
        self._aviso_sugestoes("cole/anexe uma imagem e clique em\n🔍 Prompt da imagem")

    def _sugestoes_carregando(self):
        """Estado de 'analisando' na aba Sugestões, enquanto o pipeline roda."""
        self._aviso_sugestoes("🔍 analisando a imagem…\nmontando 3 sugestões de prompt (~30s)")

    def _popular_sugestoes(self, sugestoes):
        """Preenche a aba 🔍 Sugestões com as 2-3 variações. Cada card mostra o
        resumo em PORTUGUÊS (o que vai sair), o prompt em inglês e um 'Usar este'.
        Os cards FICAM — usar um não apaga os outros (você compara à vontade)."""
        for filho in self.lista_sugestoes.winfo_children():
            filho.destroy()
        for i, (molde, resumo) in enumerate(sugestoes, 1):
            card = ctk.CTkFrame(self.lista_sugestoes, fg_color="#1f1f2a", corner_radius=8)
            card.pack(fill="x", padx=8, pady=(8, 0) if i == 1 else 6)
            topo = ctk.CTkFrame(card, fg_color="transparent")
            topo.pack(fill="x", padx=10, pady=(8, 0))
            ctk.CTkLabel(topo, text=f"Opção {i}", font=ctk.CTkFont(size=11, weight="bold"),
                         text_color="#c9b8ff").pack(side="left")
            ctk.CTkButton(topo, text="Usar este", width=84, height=24,
                          font=ctk.CTkFont(size=11),
                          command=lambda m=molde: self._usar_molde_sugerido(m)).pack(side="right")
            if resumo:
                ctk.CTkLabel(card, text=resumo, font=ctk.CTkFont(size=12),
                             text_color="#e0e0ea", wraplength=440, justify="left",
                             anchor="w").pack(fill="x", padx=10, pady=(4, 0))
            ctk.CTkLabel(card, text=molde, font=ctk.CTkFont(size=10),
                         text_color="#8a8aa0", wraplength=440, justify="left",
                         anchor="w").pack(fill="x", padx=10, pady=(2, 8))

    def _usar_molde_sugerido(self, molde):
        self.campo_prompt.delete("1.0", "end")
        self.campo_prompt.insert("1.0", molde)
        self.status_imagem.configure(
            text="Prompt aplicado ✓ — preencha o Personagem e gere (as sugestões seguem na aba).")

    def _gerar_imagem_click(self):
        """Gera a imagem: pega o prompt do campo (de um favorito ou digitado),
        injeta o personagem no slot se você preencheu o campo, e desenha. Roda
        numa thread (o Forge demora)."""
        base = self.campo_prompt.get("1.0", "end").strip()
        if not base:
            self.status_imagem.configure(text="Sem prompt — escolha um favorito ou descreva algo.")
            return
        pedido = self.campo_personagem.get().strip()
        larg, alt = TAMANHOS_IMAGEM[self.seletor_tamanho.get()]
        hires = bool(self.switch_hires.get())   # lê o switch AQUI (thread da UI)
        aviso_desenho = ("🎨 desenhando em alta resolução… (mais lento, ~1min)"
                         if hires else "🎨 desenhando… (pode levar uns 20-30s)")
        self.status_imagem.configure(text=aviso_desenho)

        def trabalhar():
            # 1) Traduz o personagem (se houver) e encaixa no slot {personagem}.
            #    Isso roda ANTES de liberar a VRAM: o Ollama ainda está de pé pra
            #    traduzir; o gerar() logo em seguida é que o descarrega pro Forge.
            try:
                tag = imagem.personagem_para_tags(pedido) if pedido else ""
            except imagem.ImagemError as erro:
                self.after(0, lambda: self.status_imagem.configure(text=str(erro)))
                return
            prompt = presets.injetar(base, tag)

            # 2) Se o Forge estiver fechado, o Yato ABRE ele sozinho e espera o
            #    boot antes de desenhar. Se não der, _garantir_forge já avisou.
            if not self._garantir_forge():
                return
            # 2.5) Aplica o modelo que você escolheu (se escolheu com o Forge
            #      fechado, é AGORA que ele carrega — antes de desenhar).
            self._aplicar_modelo_desejado()
            # Reafirma o status de "desenhando" (o _garantir_forge pode ter
            # deixado o aviso de "abrindo o Forge" na tela).
            self.after(0, lambda: self.status_imagem.configure(text=aviso_desenho))
            # 3) Desenha (no tamanho/proporção escolhido, com hires se ligado).
            try:
                caminho = imagem.gerar(prompt, largura=larg, altura=alt, hires=hires)
                self.after(0, lambda: self._imagem_pronta(caminho, prompt))
            except imagem.ImagemError as erro:
                self.after(0, lambda: self.status_imagem.configure(text=str(erro)))

        threading.Thread(target=trabalhar, daemon=True).start()

    def _garantir_forge(self):
        """Garante que o Forge esteja no ar. Se estiver fechado, ABRE ele
        sozinho (webui-user.bat, numa console própria) e espera o boot. Roda
        DENTRO da thread de trabalho — os avisos vão pra UI via self.after.
        Retorna True quando o Forge está pronto pra usar."""
        if imagem.disponivel():
            return True
        if not imagem.forge_instalado():
            self.after(0, lambda: self.status_imagem.configure(
                text="Não achei o Forge pra abrir — confira o caminho (variável YATO_FORGE)."))
            return False
        self.after(0, lambda: self.status_imagem.configure(
            text="🚀 abrindo o Forge sozinho… (o boot leva ~40s, só na 1ª vez)"))
        imagem.abrir_forge()
        if imagem.esperar_disponivel():
            # O Forge acabou de subir: o seletor ainda mostra "(Forge fechado)".
            # Como já estamos numa thread, buscamos os modelos aqui e atualizamos
            # o dropdown SILENCIOSAMENTE (sem mexer no status — que vira "desenhando").
            modelos = imagem.listar_modelos()
            atual = imagem.modelo_atual()
            self.after(0, lambda: self._preencher_seletor_modelos(modelos, atual))
            return True
        self.after(0, lambda: self.status_imagem.configure(
            text="O Forge demorou demais pra abrir 😕 tenta gerar de novo em instantes."))
        return False

    def _exibir_imagem_grande(self, caminho):
        """Marca qual imagem deve aparecer no painel direito e a encaixa. O
        encaixe de fato mora no _reencaixar_imagem — que roda AQUI e também
        sozinho a cada resize do painel (é o que corrige o 'não aparece no
        lugar': antes eu media o painel uma vez só, muitas vezes cedo demais)."""
        self._img_grande_path = caminho
        self._ultimo_encaixe = None   # força recalcular
        self._reencaixar_imagem()

    def _agendar_reencaixe(self, _evento=None):
        """Debounce do <Configure>: cancela o agendamento anterior e marca um
        novo pra daqui 100ms — só o ÚLTIMO evento da rajada encaixa de fato."""
        if getattr(self, "_reencaixe_agendado", None):
            self.after_cancel(self._reencaixe_agendado)
        self._reencaixe_agendado = self.after(100, self._reencaixar_imagem)

    def _limpar_imagem_grande(self):
        """Volta o painel direito pro placeholder de texto. O detalhe IMPORTANTE:
        configure(image=None) do CustomTkinter NÃO limpa a imagem no tk por
        baixo — quando o Python coleta a CTkImage antiga, o rótulo fica com uma
        referência morta e QUALQUER configure depois estoura ('pyimage não
        existe'). Por isso limpamos direto no rótulo tk interno também."""
        self._img_grande_path = None
        self._ultimo_encaixe = None
        self._imagem_gerada_ctk = None
        self.rotulo_imagem_gerada._label.configure(image="")   # limpa no tk de verdade
        self.rotulo_imagem_gerada.configure(
            image=None, text="🖼️ a imagem gerada / referência aparece aqui")

    def _reencaixar_imagem(self, _tentativa=0):
        """Redimensiona a imagem ATUAL pra caber no painel, medindo o tamanho
        REAL dele agora, sem distorcer. Chamado ao exibir e a cada <Configure>.
        Se o painel ainda não foi medido (layout não assentou), TENTA DE NOVO
        umas vezes e, no pior caso, usa um tamanho padrão — assim a imagem
        SEMPRE aparece (era o bug: antes ele desistia e a imagem não vinha)."""
        caminho = getattr(self, "_img_grande_path", None)
        if not caminho:
            return
        cx = self.rotulo_imagem_gerada.winfo_width()
        cy = self.rotulo_imagem_gerada.winfo_height()
        if cx <= 20 or cy <= 20:
            if _tentativa < 8 and self.painel_imagem.winfo_ismapped():
                self.after(40, lambda: self._reencaixar_imagem(_tentativa + 1))
                return
            cx, cy = 480, 560   # rede de segurança: mostra mesmo sem medir direito
        # Evita retrabalho/loop: mesmo painel + mesma imagem = não redesenha.
        assinatura = (cx, cy, str(caminho))
        if assinatura == getattr(self, "_ultimo_encaixe", None):
            return
        self._ultimo_encaixe = assinatura
        try:
            img = Image.open(caminho)
        except (OSError, ValueError):
            return
        razao = min((cx - 12) / img.width, (cy - 12) / img.height)
        tamanho = (max(1, int(img.width * razao)), max(1, int(img.height * razao)))
        self._imagem_gerada_ctk = ctk.CTkImage(
            light_image=img, dark_image=img, size=tamanho)
        self.rotulo_imagem_gerada.configure(text="", image=self._imagem_gerada_ctk)

    def _imagem_pronta(self, caminho, prompt=""):
        """Mostra a imagem GERADA no painel grande (pulando pra aba Imagem, caso
        você estivesse nos Favoritos) e guarda caminho + prompt (pro ⭐ Favoritar)."""
        self._ir_para_aba_imagem()
        self._exibir_imagem_grande(caminho)
        self.status_imagem.configure(text=f"pronto — salvo em {caminho.name}")
        self._ultima_imagem = caminho
        self._ultimo_prompt = prompt

    def _nome_amigavel_modelo(self, titulo):
        """'novaAnimeXL_ilV190.safetensors [fa486caafc]' -> 'novaAnimeXL ilV190'
        (tira a extensão e o hash técnico, só pra ficar legível no seletor)."""
        sem_hash = titulo.split(" [")[0]
        return sem_hash.replace(".safetensors", "").replace("_", " ")

    def _atualizar_lista_modelos(self):
        """Busca os checkpoints do Forge (numa thread) e repopula o seletor."""
        self.status_imagem.configure(text="🔄 buscando modelos no Forge…")

        def trabalhar():
            modelos = imagem.listar_modelos()
            atual = imagem.modelo_atual()
            self.after(0, lambda: self._lista_modelos_pronta(modelos, atual))

        threading.Thread(target=trabalhar, daemon=True).start()

    def _lista_modelos_pronta(self, modelos, atual):
        if not modelos:
            # Forge fechado: lê os checkpoints DO DISCO pra você já poder escolher
            # (o modelo escolhido carrega sozinho na hora de gerar).
            disco = imagem.listar_modelos_disco()
            if disco:
                self._preencher_seletor_modelos(disco, None)
                self.status_imagem.configure(
                    text="Forge fechado — escolha o modelo; ele carrega ao gerar.")
            else:
                self.seletor_modelo_imagem.configure(values=["(Forge fechado)"])
                self.seletor_modelo_imagem.set("(Forge fechado)")
                self.status_imagem.configure(
                    text="Forge fechado — o Yato abre sozinho quando você gerar.")
            return
        self._preencher_seletor_modelos(modelos, atual)
        self.status_imagem.configure(
            text=f"{len(self._modelos_disponiveis)} modelo(s) disponível(is).")

    def _preencher_seletor_modelos(self, modelos, atual):
        """Popula o dropdown de checkpoints SEM tocar no status. Assim serve
        tanto pro refresh explícito (que mostra a mensagem) quanto pro refresh
        SILENCIOSO depois do auto-open do Forge — que não pode atropelar o
        status de '🎨 desenhando…' que já vai aparecer."""
        if not modelos:
            return
        self._modelos_disponiveis = {self._nome_amigavel_modelo(t): t for t in modelos}
        nomes = list(self._modelos_disponiveis.keys())
        self.seletor_modelo_imagem.configure(values=nomes)
        # Qual marcar: a sua escolha pendente > o que está carregado no Forge >
        # o primeiro. (Assim, escolher com o Forge fechado não é atropelado quando
        # a lista é repopulada depois do boot.)
        if self._modelo_desejado in self._modelos_disponiveis:
            alvo = self._modelo_desejado
        else:
            alvo = next((n for n, t in self._modelos_disponiveis.items()
                         if atual and t.startswith(atual)), nomes[0])
        self.seletor_modelo_imagem.set(alvo)

    def _trocar_modelo_click(self, nome_amigavel):
        """Chamado pelo seletor. Se o Forge está aberto, troca o checkpoint na
        hora (demora — numa thread). Se está FECHADO, só GUARDA a escolha — ela é
        aplicada sozinha quando você gerar (aí o Forge já vai estar de pé)."""
        if nome_amigavel.startswith("("):     # placeholders "(carregando…)" etc.
            return
        self._modelo_desejado = nome_amigavel
        if not imagem.disponivel():
            self.status_imagem.configure(
                text=f"🎯 {nome_amigavel} escolhido — carrega quando você gerar.")
            return
        titulo = self._modelos_disponiveis.get(nome_amigavel)
        if not titulo:
            return
        self.status_imagem.configure(text=f"🔄 carregando {nome_amigavel}… (pode levar uns 30s)")

        def trabalhar():
            try:
                imagem.trocar_modelo(titulo)
                self.after(0, lambda: self.status_imagem.configure(
                    text=f"✅ {nome_amigavel} carregado — pode gerar."))
            except imagem.ImagemError as erro:
                self.after(0, lambda: self.status_imagem.configure(text=str(erro)))

        threading.Thread(target=trabalhar, daemon=True).start()

    def _aplicar_modelo_desejado(self):
        """(dentro da thread de gerar, Forge já no ar) Se você escolheu um modelo
        diferente do carregado, troca ANTES de desenhar. Resolve o nome amigável
        pro título real (só disponível com o Forge aberto)."""
        if not self._modelo_desejado:
            return
        atual = imagem.modelo_atual()
        if atual and self._nome_amigavel_modelo(atual) == self._modelo_desejado:
            return                              # já é o carregado
        alvo = next((t for t in imagem.listar_modelos()
                     if self._nome_amigavel_modelo(t) == self._modelo_desejado), None)
        if not alvo:
            return
        self.after(0, lambda: self.status_imagem.configure(
            text=f"🔄 carregando {self._modelo_desejado}… (~30s)"))
        try:
            imagem.trocar_modelo(alvo)
        except imagem.ImagemError as erro:
            self.after(0, lambda e=erro: self.status_imagem.configure(text=str(e)))

    def _redesenhar_conversa(self):
        """Limpa a área e redesenha as bolhas a partir de self.mensagens.
        Usado ao abrir o app E ao carregar uma conversa do histórico."""
        for filho in self.area.winfo_children():
            filho.destroy()
        falas = [m for m in self.mensagens if m["role"] != "system"]
        for m in falas:
            if m["role"] == "user":
                self._bolha(m["content"], autor="user")
            else:
                self._bolha(limpar_markdown(m["content"]), autor="yato")
        if falas:
            self._bolha("— conversa restaurada · 🧹 pra começar do zero —", autor="dica")
        else:
            self._bolha('Manda um "oi" pro Yato…', autor="dica")

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

        # Botão direito copia o texto do balão (CTkLabel não deixa selecionar
        # com o mouse — este é o atalho de usabilidade). Lê o texto NA HORA
        # do clique, então funciona até em balão que ainda está "pingando".
        rotulo.bind("<Button-3>", lambda e: self._copiar(rotulo.cget("text")))

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

    def _copiar(self, texto):
        """Copia o texto pro clipboard e dá um aviso rápido no status."""
        self.clipboard_clear()
        self.clipboard_append(texto)
        texto_antes = self.status.cget("text")
        cor_antes = self.status.cget("text_color")
        self.status.configure(text="📋 copiado!", text_color="#2ecc71")
        self.after(1500, lambda: self.status.configure(
            text=texto_antes, text_color=cor_antes))

    def _rolar_pro_fim(self):
        """Rola a área de mensagens até o fim (pra ver a mensagem mais nova)."""
        try:
            self.update_idletasks()
            self.area._parent_canvas.yview_moveto(1.0)
        except Exception:
            pass  # se a API interna mudar, melhor não derrubar o app por isso

    # --------------------------------------------------------------- ações
    def _modo_mudou(self, modo):
        """Chamado pelo seletor: atualiza a dica do modo escolhido."""
        self.rotulo_dica.configure(text=DICAS_MODO.get(modo, ""))

    def _acordar_cerebro(self):
        """Roda numa thread de fundo ao abrir: garante o Ollama de pé, carrega
        o modelo e mostra o status."""
        garantir_ollama()    # liga o Ollama se ele estiver fechado (dispensa o .bat)
        pronto = acordar()   # demora ~20s se o modelo estiver "frio"
        texto = "● pronto" if pronto else "● Ollama fechado"
        cor = "#2ecc71" if pronto else "#e74c3c"
        # after(0, ...) = "tela, atualiza isso quando puder" (thread-safe)
        self.after(0, lambda: self.status.configure(text=texto, text_color=cor))

    # ------------------------------------------------------------ imagem
    def _colar(self, evento):
        """Ctrl+V: se o clipboard tem IMAGEM, anexa; senão, deixa colar texto.

        Devolver "break" cancela o comportamento padrão do Tkinter (colar
        como texto); devolver None deixa ele acontecer. É assim que o mesmo
        atalho serve pros dois casos.
        """
        dado = ImageGrab.grabclipboard()
        if isinstance(dado, Image.Image):          # print da tela (Win+Shift+S)
            self._anexar_imagem(dado)
            return "break"
        if isinstance(dado, list):                 # arquivo copiado no Explorer
            for caminho in dado:
                if str(caminho).lower().endswith((".png", ".jpg", ".jpeg",
                                                  ".bmp", ".webp")):
                    try:
                        self._anexar_imagem(Image.open(caminho))
                        return "break"
                    except OSError:
                        logging.exception("Não consegui abrir a imagem colada")
        return None                                # texto normal: cola como sempre

    def _escolher_imagem(self):
        """Botão 📎: escolher um arquivo de imagem do disco."""
        caminho = filedialog.askopenfilename(
            title="Escolher imagem",
            filetypes=[("Imagens", "*.png *.jpg *.jpeg *.bmp *.webp")],
        )
        if caminho:
            try:
                self._anexar_imagem(Image.open(caminho))
            except OSError:
                logging.exception("Não consegui abrir a imagem escolhida")

    def _anexar_imagem(self, img):
        """Prepara a imagem pro Ollama: encolhe, vira PNG, codifica em base64.

        O encolhimento (teto ~1344px) importa: o modelo de visão trabalha
        em resolução limitada de qualquer jeito, e imagem menor = pedido
        mais leve e olhada mais rápida.
        """
        img = img.convert("RGB")
        img.thumbnail((1344, 1344))                # reduz mantendo proporção
        buffer = io.BytesIO()
        img.save(buffer, format="PNG")
        self.imagem_anexada = base64.b64encode(buffer.getvalue()).decode("ascii")
        # mostra o chip logo acima da linha de digitação
        self.linha_anexo.pack(fill="x", padx=16, pady=(0, 2))
        logging.info("Imagem anexada (%d KB em base64)", len(self.imagem_anexada) // 1024)

    def _remover_imagem(self):
        self.imagem_anexada = ""
        self.linha_anexo.pack_forget()

    def mostrar_memoria(self):
        """Bolha com os fatos REAIS do fatos.json — o gabarito da memória."""
        fatos = carregar_fatos()
        if fatos:
            texto = "📌 Anotado na memória (fatos.json):\n" + \
                    "\n".join(f"• {f}" for f in fatos) + \
                    '\n(pra apagar: peça "esqueça que...")'
        else:
            texto = "📌 Memória vazia — nenhum fato anotado ainda."
        self._bolha(texto, autor="dica")

    def _salvar(self):
        """Salva a conversa atual no disco. O arquivo nasce na 1ª mensagem."""
        if self.arquivo_conversa is None:
            self.arquivo_conversa = novo_arquivo_conversa()
        salvar_conversa_em(self.arquivo_conversa, self.mensagens)

    def nova_conversa(self):
        """Começa uma conversa NOVA — sem apagar as antigas (ficam no 📜).

        A conversa atual já está salva no disco (salvamos a cada troca), então
        aqui só trocamos de trilho: arquivo_conversa=None faz a próxima
        mensagem nascer num arquivo novo.
        """
        if self.bolha_pensando is not None:
            return  # esperando resposta — não puxar o tapete da thread

        self.mensagens = [{"role": "system", "content": PERSONALIDADE}]
        self.fonte_atual = ""
        self.arquivo_conversa = None   # a próxima fala cria um arquivo novo
        for filho in self.area.winfo_children():
            filho.destroy()   # limpa todas as bolhas da tela
        self._bolha('Conversa nova. Manda um "oi"…', autor="dica")
        self._atualizar_lista_conversas()   # tira o "● atual" da lista
        logging.info("Nova conversa iniciada")

    def toggle_painel(self):
        """Abre/recolhe o painel lateral de conversas (embutido na janela)."""
        if self.painel_visivel:
            self.painel.pack_forget()
            self.painel_visivel = False
        else:
            self.painel.pack(side="left", fill="y", padx=(8, 0), pady=(0, 12),
                             before=self.principal)
            self.painel_visivel = True
            self._atualizar_lista_conversas()

    def _atualizar_lista_conversas(self):
        """Recria a lista no painel — chamada sempre que as conversas mudam.
        (Como o painel é embutido, isso resolve o antigo bug do histórico
        que não atualizava sozinho.)"""
        if not self.painel_visivel:
            return
        for w in self.lista_conversas.winfo_children():
            w.destroy()
        conversas = listar_conversas()
        if not conversas:
            ctk.CTkLabel(self.lista_conversas, text="(nenhuma ainda)",
                         text_color="#8a8aa0").pack(pady=12)
            return
        for arquivo, titulo in conversas:
            atual = arquivo == self.arquivo_conversa
            item = ctk.CTkFrame(self.lista_conversas,
                                fg_color="#3a3a4a" if atual else "#242430")
            item.pack(fill="x", pady=2)
            ctk.CTkButton(
                item, text=("● " if atual else "") + titulo, anchor="w",
                fg_color="transparent", hover_color="#4a4a5a", height=30,
                command=lambda a=arquivo: self._abrir_conversa(a),
            ).pack(side="left", fill="x", expand=True)
            ctk.CTkButton(
                item, text="✏️", width=26, fg_color="transparent",
                hover_color="#4a4a5a",
                command=lambda a=arquivo: self._renomear_conversa(a),
            ).pack(side="left")
            ctk.CTkButton(
                item, text="🗑️", width=26, fg_color="transparent",
                hover_color="#7a2a2a",
                command=lambda a=arquivo: self._excluir_conversa(a),
            ).pack(side="left")

    def _abrir_conversa(self, arquivo):
        """Carrega uma conversa do painel pra continuar de onde parou."""
        if self.bolha_pensando is not None:
            return  # esperando resposta — não troca no meio
        self.arquivo_conversa = arquivo
        self.mensagens = ([{"role": "system", "content": PERSONALIDADE}]
                          + carregar_falas_de(arquivo))
        self.fonte_atual = ""
        self._redesenhar_conversa()
        self._atualizar_lista_conversas()   # atualiza o marcador "● atual"
        logging.info("Conversa aberta do painel: %s", arquivo.name)

    def _renomear_conversa(self, arquivo):
        """Pergunta um nome novo (input pequeno) e renomeia a conversa."""
        dialog = ctk.CTkInputDialog(text="Novo nome da conversa:", title="Renomear")
        novo = dialog.get_input()   # None se cancelar
        if novo:
            renomear_conversa(arquivo, novo)
            self._atualizar_lista_conversas()

    def _excluir_conversa(self, arquivo):
        """Apaga uma conversa do histórico. Se for a atual, começa uma nova."""
        excluir_conversa(arquivo)
        if arquivo == self.arquivo_conversa:
            self.arquivo_conversa = None
            self.mensagens = [{"role": "system", "content": PERSONALIDADE}]
            self.fonte_atual = ""
            self._redesenhar_conversa()
        self._atualizar_lista_conversas()
        logging.info("Conversa excluída: %s", arquivo.name)

    def enviar(self):
        texto = self._texto_entrada().strip()
        if self.bolha_pensando is not None:
            return  # já estamos esperando uma resposta
        if not texto and not self.imagem_anexada:
            return  # nada pra enviar
        if not texto:
            # só imagem, sem pergunta? Usa a pergunta padrão.
            texto = "O que você vê nesta imagem?"

        if self.voz_ligada:
            voz.parar()   # nova pergunta = corta a fala anterior
            if avatar2d.esta_aberto():
                avatar2d.lip_sync(0.0)   # fecha a boca do avatar na hora

        # A imagem desta mensagem (se houver) — capturada AGORA e removida
        # do campo: cada anexo vale pra UMA mensagem.
        imagem = self.imagem_anexada
        self._remover_imagem()

        # 1) mostra sua fala e guarda no histórico (com marcador de imagem)
        self._bolha(("🖼️ " if imagem else "") + texto, autor="user")
        self.mensagens.append({"role": "user", "content": texto})
        self._limpar_entrada()

        # 2) trava o botão e cria o balão onde a resposta vai PINGAR ao vivo.
        self.botao.configure(state="disabled", text="...")
        self.texto_parcial = ""
        self.bolha_pensando = self._bolha("digitando…", autor="yato")
        # O rótulo (o texto) é o primeiro filho do balão — guardamos a
        # referência pra ir trocando o texto dele a cada pedaço que chegar.
        self.rotulo_pensando = self.bolha_pensando.winfo_children()[0]

        # 3) chama a IA numa THREAD de fundo, pra a janela não congelar.
        #    O modo é lido AGORA e traduzido pra temperatura — cada
        #    mensagem pode ir com um modo diferente.
        temperatura = MODOS[self.seletor_modo.get()]
        self._expressao("pensando")   # o avatar reage (se estiver no modo avatar)
        threading.Thread(
            target=self._buscar_resposta, args=(temperatura, imagem), daemon=True
        ).start()

    def _buscar_resposta(self, temperatura, imagem=""):
        """Roda NA THREAD DE FUNDO. Daqui NÃO se mexe na tela direto."""

        def pinga_na_tela(pedaco):
            # O cérebro chama isto a CADA pedacinho gerado (nesta thread!).
            # after(0, ...) despacha pra thread principal — só ela toca a tela.
            self.after(0, self._pedaco_chegou, pedaco)

        def avisa_busca(termo):
            # O modelo DECIDIU buscar na web: mostra a decisão dele ao vivo.
            self.after(0, self._mostrar_busca, termo)

        detalhe = None
        try:
            r = pensar(self.mensagens, temperatura=temperatura,
                       ao_receber=pinga_na_tela, ao_buscar=avisa_busca,
                       # a fonte do turno passado volta pra mesa — é ela
                       # que torna o "continua" honesto em vez de inventado
                       fonte_anterior=self.fonte_atual or None,
                       imagem=imagem or None)
            texto = r.texto
            if r.fonte:
                self.fonte_atual = r.fonte   # pesquisa nova substitui a antiga
            # A etiqueta de laboratório desta resposta:
            detalhe = (
                f"{r.tokens} tokens · {r.segundos:.1f}s · "
                f"{r.velocidade:.0f} tok/s · 🌡️ {temperatura:.1f}"
            )
            if r.buscas:
                # conta buscas E leituras de página — toda ida à web
                detalhe += f" · 🔍 {r.buscas}× web"
            if r.olhadas:
                detalhe += f" · 👁️ {r.olhadas} olhada(s)"
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

    def _mostrar_busca(self, descricao):
        """Roda na thread principal: o balão mostra a ação da ferramenta.

        A descrição já vem pronta do cérebro ("buscando na web: ..." ou
        "lendo a página: ..."). Também ZERA o texto parcial: o que o modelo
        tenha falado antes de decidir agir era "pensamento em voz alta" —
        a resposta de verdade recomeça depois que a ferramenta voltar.
        """
        if self.rotulo_pensando is None:
            return
        self.texto_parcial = ""
        self.rotulo_pensando.configure(text=f"{descricao}…")  # já vem com emoji
        self._rolar_pro_fim()

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
        self._salvar()   # cada troca completa vai pro disco (na conversa atual)
        self._atualizar_lista_conversas()   # a conversa nova/atualizada aparece no painel
        # Com a voz LIGADA, o Yato lê a resposta e a expressão fica 'falando'
        # até o áudio acabar. Sem voz, o avatar só "abre a boca" por 2,5s.
        if self.voz_ligada and texto:
            self._falar(texto)
        else:
            self._expressao("falando")
            self.after(2500, lambda: self._expressao("ociosa"))
        self.botao.configure(state="normal", text="Enviar")
        self._rolar_pro_fim()
        self.entrada.focus()


# Porta local usada como "plaquinha de ocupado" — só pra marcar que há um
# Yato aberto. Número alto e incomum pra não colidir com outros programas.
PORTA_INSTANCIA = 49517


def travar_instancia_unica():
    """Impede uma SEGUNDA janela do Yato.

    Como: tenta "pendurar uma plaquinha" numa porta local. Se conseguir, é
    a única instância — devolve o socket (mantê-lo vivo = a trava dura toda
    a vida do app). Se a porta já está ocupada, já existe um Yato aberto —
    devolve None.

    Por que porta e não arquivo de trava: quando o processo morre (fecha OU
    trava/crasha), o Windows LIBERA a porta sozinho. Nunca sobra uma
    "trava-fantasma" travando a próxima abertura — o pesadelo dos lock files.
    """
    trava = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        trava.bind(("127.0.0.1", PORTA_INSTANCIA))
        trava.listen(1)
        return trava
    except OSError:
        return None


def avisar_ja_aberto():
    """Janelinha de aviso que some sozinha — a 2ª instância mostra e sai.

    Por que NÃO messagebox: messagebox + CustomTkinter trava invisível (o
    processo fica pendurado sem mostrar nada — flagrado nos testes). Uma
    janela CTk normal é confiável, e o auto-fechar evita processo preso.
    """
    aviso = ctk.CTk()
    aviso.title("Yato")
    aviso.geometry("320x120")
    aviso.attributes("-topmost", True)   # aparece na frente de tudo
    ctk.CTkLabel(
        aviso, text="🐾 O Yato já está aberto!",
        font=ctk.CTkFont(size=15, weight="bold"),
    ).pack(expand=True, padx=20, pady=20)
    aviso.after(2500, aviso.destroy)     # some sozinha após 2,5s
    aviso.mainloop()


if __name__ == "__main__":
    _trava = travar_instancia_unica()
    if _trava is None:
        # Já tem um Yato aberto: avisa e sai, sem abrir segunda janela.
        avisar_ja_aberto()
        sys.exit(0)

    logging.info("Yato abriu (modelo: %s)", MODELO)
    App().mainloop()
    avatar2d.esconder()   # se o avatar estava aberto, fecha junto com o Yato
    logging.info("Yato fechou")
