<h1 align="center">Yato — assistente de IA 100% local</h1>

<p align="center">
  <em>Chat com personalidade, memória individual, avatar chibi próprio e estúdio de imagem —<br>
  com inferência de IA <strong>na sua máquina</strong> e modo mini com IA sob demanda.</em>
</p>

<p align="center">
  <img alt="Python" src="https://img.shields.io/badge/Python-3.12+-3776AB?logo=python&logoColor=white">
  <img alt="100% local" src="https://img.shields.io/badge/IA-100%25%20local-6c5ce7">
  <img alt="Ollama" src="https://img.shields.io/badge/Ollama-qwen2.5%3A7b-222222">
  <img alt="Stable Diffusion" src="https://img.shields.io/badge/Stable%20Diffusion-Forge%20%2B%20SDXL-ff6f61">
  <img alt="Licença MIT" src="https://img.shields.io/badge/licen%C3%A7a-MIT-green">
</p>

<p align="center">
  <img src="yato-py/assets/vitrine/yato-chibi.png" width="280" alt="Avatar chibi próprio do Yato, de corpo inteiro, com roupa preta e detalhes violetas">
</p>

---

## O que é

O **Yato** é um assistente de desktop (Windows) com personalidade própria, construído
do zero em Python. A regra do projeto é uma só: **tudo roda localmente** — o cérebro é
um modelo aberto na GPU via [Ollama](https://ollama.com), a voz é sintetizada na CPU,
o ouvido transcreve offline e as imagens são geradas pelo Stable Diffusion na sua placa.
A inferência local não exige chave de API nem mensalidade. Pesquisa web e notícias
acessam serviços externos; conversas e memórias são guardadas localmente e não entram no GitHub.

Nasceu como projeto de estudo — **abrir a caixa-preta da IA** e entender tokens,
contexto, temperatura e streaming na prática — e cresceu, rodada a rodada, até virar
um assistente completo.

## 🐾 Avatar próprio e modo Só mini Yato

O Yato ganhou uma identidade visual própria: **chibi de corpo inteiro**, com cabelo
escuro, olhos violetas e roupa preta com detalhes roxos. A versão beta-1 foi
preservada como referência; a evolução do mini acontece separadamente.

O **[Só mini Yato](https://github.com/RodrigoRuan2/yato-assistente-ia-local/tree/experiment/mini-yato-solo/yato-py/mini-yato)** é a versão experimental atual do companheiro de desktop:

- Avatar transparente com respiração, piscadas, caminhada e pausas;
- Balão de conversa simples e balão pequeno acima da cabeça para informações rápidas;
- Comentários curtos de horário, com intervalos longos; notícias apenas sob pedido;
- Conversa com o modelo local, contexto, memória de preferências e ferramentas de cálculo e ações;
- IA iniciada apenas quando você envia uma mensagem, com liberação do modelo após 30 segundos sem uso;
- Opção **Abrir Yato Chat** no menu do mini, sem manter a janela principal aberta;
- Dados individuais guardados localmente: cada instalação começa com a própria memória.

**Disponibilidade:** o modo mini está na branch `experiment/mini-yato-solo`, em
`yato-py/mini-yato/`. Ele não é a antiga pasta `yato-mini/` de React. Voz e microfone
continuam no chat principal; o novo mini é focado em texto e menor consumo em repouso.

**[Instruções](https://github.com/RodrigoRuan2/yato-assistente-ia-local/tree/experiment/mini-yato-solo/yato-py/mini-yato)** · **[Relatório de consumo e condições dos testes](https://github.com/RodrigoRuan2/yato-assistente-ia-local/blob/experiment/mini-yato-solo/yato-py/mini-yato/MEDICOES.md)**

## 🧪 Protótipos separados

O **[catálogo dos protótipos](https://github.com/RodrigoRuan2/yato-assistente-ia-local/tree/experiment/prototipos/yato-py/prototipos)** reúne o beta-1 preservado, a prévia original, o laboratório do avatar, o rig 2D, os estudos de caminhada/repouso e os modelos de balão. Cada experimento fica em sua própria pasta, com instruções de execução. O mini atual continua na branch `experiment/mini-yato-solo`.

Código e artes são publicados sem conversas, memórias ou configurações pessoais. O catálogo inclui um manifesto SHA-256 para conferir os arquivos públicos do beta-1.

## ✨ Recursos do chat principal

### 💬 Conversa (e age)

<p align="center">
  <img src="yato-py/assets/vitrine/chat.png" width="720" alt="Tela de chat do Yato">
</p>

Não é só um chat: o Yato é um **agente**. Ele decide sozinho quando precisa de suas
"mãos" — **busca na web** (DuckDuckGo, sem chave), **lê páginas**, **anota fatos sobre
você** (memória permanente entre sessões) e **enxerga imagens** que você cola no chat
(um segundo modelo, `qwen2.5vl`, funciona como "olho emprestado" do cérebro cego).

- Respostas em **streaming** (a geração token a token, visível);
- **Modos de conversa** que ensinam ML na prática: 🎯 Preciso / 💬 Natural / 🎭 Lúdico
  são temperaturas (0.2 / 0.7 / 1.2) com nome de gente;
- **Métricas em cada resposta**: tokens, tempo, velocidade da GPU e temperatura usada;
- **Histórico de conversas** com rotação + memória de fatos em JSON legível;
- Defesa contra **prompt injection**: texto de página é informação, nunca ordem.

### 🔊 Fala e ouve 🎤

O Yato **lê as respostas em voz alta** com o [Piper](https://github.com/rhasspy/piper)
(TTS offline, na CPU, voz pt-BR) e **ouve o microfone** com o
[faster-whisper](https://github.com/SYSTRAN/faster-whisper) — aperte 🎤, fale, e a
transcrição vira mensagem. Nenhum áudio sai da sua máquina.

### 🎭 Avatar do Yato

A apresentação atual usa o **chibi próprio do Yato**, animado em uma janela
Electron transparente. O mini tem balões de conversa e informações rápidas,
respiração, piscadas, caminhada com pausas e efeitos visuais.

O avatar Live2D de demonstração foi usado nas primeiras versões e permanece como
parte do histórico técnico. O chat principal já possui integração de boca com a
voz; o modo mini experimental funciona por texto, sem carregar voz e microfone.

Veja a **[versão com o avatar próprio](https://github.com/RodrigoRuan2/yato-assistente-ia-local/tree/experiment/mini-yato-solo/yato-py/mini-yato)**.

### 🎨 Estúdio de imagem

<p align="center">
  <img src="yato-py/assets/vitrine/estudio-imagem-gerada.png" width="720" alt="Estúdio de imagem do Yato com uma imagem gerada">
</p>

Geração de imagem local com o [Forge](https://github.com/lllyasviel/stable-diffusion-webui-forge)
(Stable Diffusion / SDXL) — e um fluxo de trabalho pensado pra quem itera de verdade:

- **Biblioteca de moldes (favoritos)**: salve um prompt bom junto da imagem de
  referência. O molde tem um slot `{personagem}` — você digita só o personagem
  em português, o cérebro traduz pra tag e **injeta no lugar certo**, mantendo
  cena, estilo e qualidade do molde;
- **🎭 Virar molde**: transforma qualquer prompt num molde reutilizável em duas
  camadas — o LLM tira o nome do personagem e um **filtro determinístico** remove
  aparência e temas de cor (porque modelo 7B é ruim em *apagar* tags — quando uma
  etapa não é confiável no modelo, ela vira código);
- **Seletor de LoRA** com peso ajustável — troque o estilo da arte por geração;
- **Revezamento de VRAM**: Ollama (~5 GB) e SDXL (~6–7 GB) não cabem juntos em
  8 GB — antes de gerar, o Yato manda o cérebro soltar a GPU e o recupera depois;
- O Yato **abre o Forge sozinho** se estiver fechado (e espera o boot).

<p align="center">
  <img src="yato-py/assets/vitrine/favoritos.png" width="720" alt="Biblioteca de moldes favoritos, com checkpoint e LoRA de cada um">
</p>

## 🧠 Arquitetura do chat principal (versão base)

Cada módulo tem uma responsabilidade só — dá pra testar o cérebro sem abrir a janela:

```
app.py (a janela — CustomTkinter)
   │
   ├─► cerebro.py ──HTTP──► Ollama :11434 ──► qwen2.5:7b na GPU
   │       └─► ferramentas.py  (busca web · ler página · ver imagem · anotar fatos)
   │
   ├─► personalidade.py  (quem o Yato é — o system prompt)
   ├─► memoria.py        (conversas + fatos, JSON com leitura segura)
   ├─► voz.py            (Piper TTS, offline)  ──► lip-sync ──┐
   ├─► ouvido.py         (faster-whisper, offline)            │
   ├─► avatar2d.py ──HTTP──► avatar-electron/ :8137  (Live2D transparente)
   ├─► imagem.py  ──HTTP──► Forge :7860  (Stable Diffusion / SDXL + LoRA)
   └─► presets.py        (a biblioteca de moldes com slot {personagem})
```

## 🔩 Stack (e o porquê de cada peça)

| Peça | Tecnologia | Por quê |
| ---- | ---------- | ------- |
| Cérebro | Ollama + `qwen2.5:7b` | Modelo aberto que cabe em 8 GB de VRAM e suporta ferramentas (agente) |
| Olho | `qwen2.5vl:7b` | Venceu o teste cego de leitura de tela (12/12 itens vs 11/12 do gemma3) |
| Interface | CustomTkinter | Janela nativa leve, sem navegador embutido |
| Voz | Piper (`faber-medium` pt-BR) | TTS offline na CPU — não disputa a GPU com o cérebro |
| Ouvido | faster-whisper (small) | Transcrição offline na CPU, mesma lógica |
| Avatar | Electron + animação 2D própria no mini; Live2D na versão base | Personagem em janela transparente no desktop |
| Imagem | Forge (SDXL / Illustrious) | API local `--api`, mesmo espírito do Ollama: HTTP sem chave |

**Hardware de referência:** RTX 4060 Ti (8 GB VRAM) + 16 GB RAM. Os 8 GB são o teto
que moldou o projeto inteiro — modelos 7B, visão e imagem se **revezando** na GPU em
vez de coexistir.

## 🚀 Instalação

```powershell
# pré-requisitos: Python 3.12+ e Ollama instalados
cd yato-py
python preparar.py   # cria o .venv, instala tudo, baixa voz e modelo
```

Depois é duplo-clique no **`Iniciar Yato.bat`**. O guia completo (instalação manual,
troca de modelo, ajustes finos e o roadmap detalhado de todas as rodadas) está no
**[README do yato-py](yato-py/README.md)**.

> A geração de imagem pede o [Forge](https://github.com/lllyasviel/stable-diffusion-webui-forge)
> instalado à parte (com a flag `--api`) — o Yato o abre sozinho quando você manda desenhar.

## 📂 Os dois projetos deste repositório

| Pasta | O que é |
| ----- | ------- |
| [`yato-py/`](yato-py/) | **A versão atual** — o assistente completo descrito acima |
| [`yato-mini/`](yato-mini/) | A primeira versão: chat web em React + Vite (o começo da jornada) |

## 🗺️ Roadmap

O projeto evolui em **rodadas** — cada uma vira um commit com nome claro. Já foram 12
(robustez → laboratório de ML → streaming → agente com busca → memória → visão →
histórico → voz → avatar Live2D → ouvido → geração de imagem → biblioteca de moldes).
Próximas ideias: importar prompts do Civitai via API, triggers automáticos de LoRA e,
o chefão final, **trocar o Ollama por código que roda o modelo direto**.

## 📜 Licença

[MIT](LICENSE) — use, estude e adapte à vontade.

---

<p align="center">
  Feito por <a href="https://github.com/RodrigoRuan2">Rodrigo Ruan</a> — aprendendo IA na prática, uma rodada de cada vez. 💜
</p>
