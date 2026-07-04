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
import re
import socket
import sys
import threading
from logging.handlers import RotatingFileHandler
from pathlib import Path
from tkinter import filedialog

import customtkinter as ctk
from PIL import Image, ImageGrab

from personalidade import PERSONALIDADE
from cerebro import pensar, acordar, CerebroError, MODELO
from memoria import (carregar_fatos, listar_conversas, novo_arquivo_conversa,
                     salvar_conversa_em, carregar_falas_de, MAX_CONVERSAS)

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


class App(ctk.CTk):
    def __init__(self):
        super().__init__()
        self.title("Yato — IA local")
        self.geometry("520x660")
        self.minsize(420, 480)

        # ---- ESTADO: o histórico da conversa mora aqui ----
        # Personalidade sempre FRESCA (vem do código, nunca do disco) +
        # as falas da conversa MAIS RECENTE do histórico (se houver).
        # self.arquivo_conversa = onde a conversa atual é salva (None = nova,
        # o arquivo nasce na primeira mensagem).
        self.mensagens = [{"role": "system", "content": PERSONALIDADE}]
        historico = listar_conversas()
        if historico:
            self.arquivo_conversa = historico[0][0]
            self.mensagens += carregar_falas_de(self.arquivo_conversa)
        else:
            self.arquivo_conversa = None

        self.bolha_pensando = None   # o balão da resposta em andamento
        self.rotulo_pensando = None  # o TEXTO dentro dele (atualiza no streaming)
        self.texto_parcial = ""      # o que já chegou da resposta atual
        self.fonte_atual = ""        # o que a última pesquisa trouxe (pro "continua")
        self.imagem_anexada = ""     # a imagem colada/anexada (base64), 1 por mensagem

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
            topo, text="🧹 Nova", width=64,
            fg_color="transparent", border_width=1,
            command=self.nova_conversa,
        ).pack(side="right")

        ctk.CTkButton(
            topo, text="📜 Histórico", width=100,
            fg_color="transparent", border_width=1,
            command=self.mostrar_historico,
        ).pack(side="right", padx=(0, 8))

        # Mostra a memória DIRETO do arquivo, sem passar pelo modelo:
        # perguntar "o que você sabe?" pro modelo rende enfeite (testado!);
        # este botão é o gabarito — determinístico, sempre a verdade.
        ctk.CTkButton(
            topo, text="📌 Memória", width=100,
            fg_color="transparent", border_width=1,
            command=self.mostrar_memoria,
        ).pack(side="right", padx=(0, 8))

        # Status do cérebro. Repare: cor E texto mudam juntos — nunca dependa
        # só da cor (acessibilidade: daltônico também precisa entender).
        self.status = ctk.CTkLabel(topo, text="● acordando…", text_color="#f1c40f")
        self.status.pack(side="right", padx=(0, 10))

        # Área das mensagens: um quadro que ROLA sozinho quando enche.
        self.area = ctk.CTkScrollableFrame(self)
        self.area.pack(fill="both", expand=True, padx=12, pady=(0, 12))

        # ---- O seletor de MODO (a temperatura com nome de gente) ----
        linha_modo = ctk.CTkFrame(self, fg_color="transparent")
        linha_modo.pack(fill="x", padx=14, pady=(0, 4))

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
        self.linha_anexo = ctk.CTkFrame(self, fg_color="transparent")
        self.chip_anexo = ctk.CTkLabel(
            self.linha_anexo, text="🖼️ imagem anexada — clique pra remover",
            text_color="#8ab4f8", cursor="hand2", font=ctk.CTkFont(size=11),
        )
        self.chip_anexo.bind("<Button-1>", lambda e: self._remover_imagem())
        self.chip_anexo.pack(side="left")

        # Linha de baixo: anexar + campo de digitar + botão enviar.
        baixo = ctk.CTkFrame(self, fg_color="transparent")
        baixo.pack(fill="x", padx=12, pady=(0, 12))

        ctk.CTkButton(
            baixo, text="📎", width=36,
            fg_color="transparent", border_width=1,
            command=self._escolher_imagem,
        ).pack(side="left", padx=(0, 6))

        self.entrada = ctk.CTkEntry(baixo, placeholder_text="Fala com o Yato...")
        self.entrada.pack(side="left", fill="x", expand=True)
        self.entrada.bind("<Return>", lambda evento: self.enviar())  # Enter envia
        # Ctrl+V com IMAGEM no clipboard anexa; com texto, cola normal.
        self.entrada.bind("<Control-v>", self._colar)
        self.entrada.bind("<Control-V>", self._colar)

        self.botao = ctk.CTkButton(baixo, text="Enviar", width=90, command=self.enviar)
        self.botao.pack(side="left", padx=(8, 0))

        self._redesenhar_conversa()
        self.entrada.focus()

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
        """Roda numa thread de fundo ao abrir: carrega o modelo e mostra o status."""
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
        logging.info("Nova conversa iniciada")

    def mostrar_historico(self):
        """Janela com a lista das conversas salvas — clicar reabre a conversa."""
        conversas = listar_conversas()
        janela = ctk.CTkToplevel(self)
        janela.title("Histórico de conversas")
        janela.geometry("440x500")
        janela.attributes("-topmost", True)

        ctk.CTkLabel(
            janela, text=f"📜 Últimas conversas (até {MAX_CONVERSAS})",
            font=ctk.CTkFont(size=15, weight="bold"),
        ).pack(pady=12)

        lista = ctk.CTkScrollableFrame(janela)
        lista.pack(fill="both", expand=True, padx=12, pady=(0, 12))

        if not conversas:
            ctk.CTkLabel(lista, text="(nenhuma conversa salva ainda)",
                         text_color="#8a8aa0").pack(pady=20)
            return
        for arquivo, titulo in conversas:
            marca = "  ● atual" if arquivo == self.arquivo_conversa else ""
            ctk.CTkButton(
                lista, text=titulo + marca, anchor="w", height=36,
                fg_color="#2a2a3a", hover_color="#3a3a4a",
                command=lambda a=arquivo, j=janela: self._abrir_do_historico(a, j),
            ).pack(fill="x", pady=3)

    def _abrir_do_historico(self, arquivo, janela):
        """Carrega uma conversa do histórico pra continuar de onde parou."""
        if self.bolha_pensando is not None:
            return  # esperando resposta — não troca de conversa no meio
        janela.destroy()
        self.arquivo_conversa = arquivo
        self.mensagens = ([{"role": "system", "content": PERSONALIDADE}]
                          + carregar_falas_de(arquivo))
        self.fonte_atual = ""
        self._redesenhar_conversa()
        logging.info("Conversa carregada do histórico: %s", arquivo.name)

    def enviar(self):
        texto = self.entrada.get().strip()
        if self.bolha_pensando is not None:
            return  # já estamos esperando uma resposta
        if not texto and not self.imagem_anexada:
            return  # nada pra enviar
        if not texto:
            # só imagem, sem pergunta? Usa a pergunta padrão.
            texto = "O que você vê nesta imagem?"

        # A imagem desta mensagem (se houver) — capturada AGORA e removida
        # do campo: cada anexo vale pra UMA mensagem.
        imagem = self.imagem_anexada
        self._remover_imagem()

        # 1) mostra sua fala e guarda no histórico (com marcador de imagem)
        self._bolha(("🖼️ " if imagem else "") + texto, autor="user")
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
        #    O modo é lido AGORA e traduzido pra temperatura — cada
        #    mensagem pode ir com um modo diferente.
        temperatura = MODOS[self.seletor_modo.get()]
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
    logging.info("Yato fechou")
