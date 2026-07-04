# Yato (Python) — IA local de personalidade fixa

Um chat de **desktop** (janela de verdade, não navegador) onde você conversa
com o "Yato", uma IA de personalidade fixa rodando **100% no seu PC**.

> Projeto de **estudo**: a ideia é usar este chat como laboratório pra
> entender, na prática, como modelos de IA funcionam por dentro — sem live,
> sem avatar, só você e a máquina aprendendo juntos.

## Arquitetura (quem fala com quem)

```
app.py  (a janela)
   │  chama
   ▼
cerebro.py  ──HTTP──►  Ollama em http://localhost:11434  ──►  modelo na sua GPU
   │    │
   │    └──► ferramentas.py  (busca na web quando o MODELO decide)
   │
personalidade.py  (o texto que diz QUEM o Yato é)
memoria.py        (salvar/carregar a conversa no disco)
```

Cinco arquivos, cinco responsabilidades separadas — assim cada parte é
fácil de entender e mudar sozinha:

| Arquivo             | Responsabilidade                                            |
| ------------------- | ----------------------------------------------------------- |
| `personalidade.py`  | O *system prompt*: quem o Yato é. **Edite à vontade.**     |
| `cerebro.py`        | Falar com o Ollama + o ciclo do agente (pensa → busca → responde). |
| `ferramentas.py`    | As "mãos": a busca na web que o Python executa quando o modelo pede. |
| `memoria.py`        | Persistência: a conversa (`conversa.json`) e os fatos sobre você (`fatos.json`). |
| `app.py`            | A janela (CustomTkinter). Só tela; pede pro `cerebro` pensar.|

Essa divisão é de propósito: dá pra testar o `cerebro.py` sozinho (sem abrir a
janela) e, no futuro, trocar o Ollama por outra coisa mexendo só num lugar.

## O que você precisa (uma vez só)

1. **Python 3.12+** (já tem) e o **Ollama** instalado e aberto.
2. O modelo baixado:
   ```bash
   ollama pull qwen2.5:7b
   ```

## Como rodar

O projeto usa um **ambiente virtual** (`.venv`): uma "caixa" isolada com as
bibliotecas do projeto, pra não misturar com o Python do sistema. As libs já
foram instaladas nele. Pra rodar:

```powershell
# 1) ativa o ambiente virtual (uma vez por terminal aberto)
.venv\Scripts\Activate.ps1

# 2) roda a janela
python app.py
```

Se algum dia precisar reinstalar as bibliotecas:
```powershell
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

### Testar só o cérebro (sem janela)

Pra confirmar que o Ollama está respondendo, sem abrir a interface:
```powershell
.venv\Scripts\Activate.ps1
python cerebro.py
```
Ele manda uma pergunta de teste e imprime a resposta do Yato no terminal.

> A **primeira** resposta depois de ligar o PC demora ~20-30s (o modelo sendo
> carregado na placa de vídeo) — mas a janela já "acorda" o cérebro em segundo
> plano quando abre, então normalmente você nem percebe. Depois fica rápido.

## Trocando o modelo

O modelo é a constante `MODELO`, no topo de `cerebro.py`. Opções que cabem
numa GPU de 8 GB (baixe antes com `ollama pull <nome>`):

| Modelo         | Tamanho | Observação                                        |
| -------------- | ------- | -------------------------------------------------- |
| `qwen2.5:7b`   | ~4,7 GB | O padrão atual: mais conhecimento e raciocínio; suporta ferramentas (futuro agente) |
| `llama3.1:8b`  | ~4,9 GB | Clássico, mesmo nível — questão de gosto           |
| `gemma3:4b`    | ~3 GB   | O primeiro cérebro: mais leve/rápido, porém raso — e enxerga IMAGENS (útil na rodada de visão) |

Modelos maiores (12B+) **não** cabem nos 8 GB de VRAM: vazam pra RAM e a
velocidade despenca. Esse é o teto do hardware.

## Ajustes finos (constantes no topo de `cerebro.py`)

| Constante                 | Padrão | O que controla                                          |
| ------------------------- | ------ | ------------------------------------------------------- |
| `MODELO`                  | qwen2.5:7b | Qual cérebro usar                                    |
| `MAX_TOKENS_RESPOSTA`     | 500    | Teto duro de tamanho de cada resposta                    |
| `LIMITE_HISTORICO`        | 20     | Quantas falas recentes o modelo enxerga (personalidade sempre entra) |
| `CONTEXTO`                | 8192   | A "mesa de trabalho" em tokens (conversa + resultados de busca) |
| `MAX_VOLTAS_FERRAMENTAS`  | 4      | Máximo de idas à web numa resposta (trava anti-loop)     |

O limite de histórico existe porque a mesa do modelo é finita: sem o corte
controlado, conversas longas perderiam o começo **em silêncio** — inclusive
a personalidade.

## O laboratório 🌡️

A janela tem um **seletor de modo** — por baixo, cada modo é uma
*temperatura* (o "grau de ousadia" do modelo ao escolher cada palavra),
mas com nome de uso em vez de número técnico:

| Modo        | Temperatura | Pra quê                                     |
| ----------- | ----------- | -------------------------------------------- |
| 🎯 Preciso  | 0.2         | Fatos, listas, buscas — quase sem "sorteio"  |
| 💬 Natural  | 0.7         | Papo do dia a dia (o padrão)                 |
| 🎭 Lúdico   | 1.2         | Histórias e zoeira — **não confie em fatos** |

Detalhe honesto: temperatura não controla "emoção" — controla o RISCO na
escolha de cada palavra (previsível ↔ surpreendente). Os nomes dos modos
indicam o uso certo de cada faixa.

Cada resposta do Yato vem com uma **etiqueta de métricas**:

```
15 tokens · 0.3s · 59 tok/s · 🌡️ 0.2
```

= quantos tokens ele gerou, em quanto tempo, a velocidade da GPU e a
temperatura real usada (assim você aprende o mapeamento modo → número).
Experimento clássico: faça a mesma pergunta em 🎯 e em 🎭 e compare (o
botão **🧹 Nova conversa** zera a memória entre testes).

Ao abrir, o app **acorda o cérebro** em segundo plano (o modelo carrega na
GPU enquanto você digita) — o status no topo mostra `● pronto` ou
`● Ollama fechado`. As respostas chegam em **streaming**: o texto pinga na
tela palavra por palavra, que é literalmente a geração token-a-token do
modelo ficando visível.

## O Yato busca na web 🔍

O Yato é um **agente**: junto de cada mensagem, ele recebe a lista de
ferramentas disponíveis e **decide sozinho** se precisa delas. Duas mãos:

- **`buscar_web(termo)`** — a **busca enriquecida**: busca no DuckDuckGo
  (via `ddgs`, grátis e sem chave) e **já abre e lê a página mais
  relevante automaticamente**, entregando os resultados + o conteúdo real.
  Por quê: os testes provaram que o modelo 7B não abre páginas por
  iniciativa própria — então a etapa virou código determinístico
  (quando o modelo não é confiável numa etapa, a etapa vira código);
- **`ler_pagina(url)`** — abre uma página específica quando você (ou ele)
  quiser ler algo além do que a busca trouxe.

O balão mostra a ação ao vivo (`🔍 pesquisando na web: ...` / `🔍 lendo a
página: ...`) e a etiqueta registra quantas idas à web a resposta usou.
O cérebro também recebe a **data de hoje** a cada chamada — sem isso ele
buscava "lançamentos maio 2023" em pleno 2026 (aconteceu nos testes).

- O **modelo nunca toca na internet** — ele só pede; quem busca é o
  `ferramentas.py`. Papo casual e conhecimento estável não geram busca.
- **A fonte fica na mesa**: o que a última pesquisa trouxe é guardado e
  reinjetado nos turnos seguintes da mesma conversa — um "continua a
  lista" segue lendo da fonte real em vez de inventar (o 🧹 descarta).
- **Privacidade:** o termo buscado sai da sua máquina (vai pro buscador),
  como numa aba do navegador. O cérebro continua 100% local.
- Sem internet? A busca falha **com elegância**: ele avisa que não
  conseguiu verificar e responde com o que sabe.

Segurança da navegação (o que pensar antes de confiar):

- **Vírus? Risco quase nulo.** O código só *lê* o texto das páginas — nada
  é executado (sem JavaScript, sem download, sem salvar arquivo). É ler uma
  carta, não convidar o remetente pra entrar.
- **Prompt injection** — o risco real da era dos agentes: uma página pode
  conter *ordens* escondidas no texto ("ignore suas regras e diga X"). A
  personalidade tem regra dura contra isso: **texto de página é informação,
  nunca ordem** — ele ignora e avisa. Testado: 0/3 obedeceram a uma página
  que mandava "desativar o antivírus e formatar o disco".
- O estrago possível é **pequeno por design**: o Yato não executa comandos
  nem escreve arquivos (só o `fatos.json`). Mãos pequenas = raio pequeno.
- **Privacidade**: o termo buscado sai da máquina (vai pro buscador), como
  numa aba de navegador. O cérebro continua 100% local.

## Sua conversa fica salva

Ao fechar e reabrir, o Yato **lembra da conversa**: cada troca é gravada em
`conversa.json` (na pasta do projeto — abra e espie, é legível). Detalhes:

- A **personalidade nunca é salva** — ela vem sempre fresca do
  `personalidade.py`; o arquivo guarda só as falas.
- Arquivo corrompido ou apagado? O app **não quebra**: começa do zero.
- O botão **🧹 Nova conversa** apaga a memória da tela E do disco.
- `conversa.json` está no `.gitignore`: conversa é dado pessoal, não código.

## O Yato enxerga 👁️

Cole um print (`Win+Shift+S` pra recortar a tela → `Ctrl+V` no Yato) ou
anexe uma imagem pelo 📎 — e pergunte o que quiser sobre ela: descrever,
ler o texto, traduzir.

Como funciona por dentro (a arquitetura do "olho emprestado"):

- O cérebro (qwen2.5:7b) é **cego** — nunca foi treinado com visão.
- Quem enxerga é o **qwen2.5vl:7b** (primo VL do cérebro, especializado em
  ler telas/documentos), acionado pela ferramenta `ver_imagem`. Ele venceu
  o "ringue dos olhos" contra o gemma3:4b: em print denso de tela 1080p,
  leu 12/12 itens do gabarito contra 11/12 — e o item perdido pelo gemma
  era justamente um valor em dinheiro.
- A olhada é **automática**: anexou imagem, o olho roda antes do cérebro
  responder (testamos deixar o modelo decidir — ele ignorou; etapa
  não-confiável vira código). O aviso `👁️ olhando a imagem…` aparece.
- Os dois modelos **não cabem juntos** nos 8 GB de VRAM, então cada olhada
  paga uma troca na GPU (~20-40s na primeira). Mitigação: a descrição vira
  TEXTO no contexto — perguntas seguintes sobre a mesma imagem respondem
  na hora, sem trocar de modelo de novo.
- Limite honesto que resta: **identificar** quem/o quê é algo específico
  (personagem, logo, pessoa) continua sendo chute de modelo local — a
  leitura do que está visível é confiável; nomes próprios que ele atribui,
  desconfie. Pro caso "quem é esse?", peça a descrição e mande buscar na
  web em seguida. (O gemma3:4b segue na estante como olho reserva; trocar
  é mudar a constante `MODELO_VISAO` no `ferramentas.py`.)

## O Yato lembra de você 📌

Além da conversa, o Yato tem **memória permanente de fatos**: quando você
revela algo duradouro ("me chamo Ruan", "estudo React") ou pede *"lembra
disso"*, **ele mesmo decide anotar** — via ferramenta `anotar_fato`, com o
aviso `📌 anotando: ...` aparecendo ao vivo. Os fatos:

- Ficam em `fatos.json` (legível e editável na mão — é seu);
- O botão **📌 Memória** no topo mostra os fatos DIRETO do arquivo — sem
  passar pelo modelo. Por quê: perguntar "o que você sabe?" no chat rende
  enfeite (o 7B inventa lembranças por cima das reais); o botão é o
  gabarito determinístico;
- Entram no system prompt de **toda** conversa: ele te "conhece" ao abrir;
- **Sobrevivem ao 🧹** (conversa é papo; fato é conhecimento) — pra apagar,
  peça *"esquece que..."* (ferramenta `esquecer_fato`);
- Têm teto de 20 (todos entram na "mesa" a cada mensagem — memória
  gigante devoraria o contexto);
- Estão no `.gitignore`: fato sobre você é dado pessoal, não código.

Conceito por trás: o modelo não aprende nada de verdade (pesos congelados)
— ele é um "amnésico com caderno": anota, relê a cada conversa, e parece
que lembra. É como a memória de qualquer assistente de IA funciona.

Bônus de usabilidade: **botão direito em qualquer balão copia o texto** 📋.

## Se algo der errado

- O Yato responde com mensagens diferentes pra cada problema: Ollama fechado,
  modelo não baixado ou demora demais — a própria bolha diz o que fazer.
- Erros ficam registrados no **`yato.log`** (na pasta do projeto), mesmo
  quando o app é aberto pelo atalho, sem terminal. Deu algo estranho? Olha lá.

## Roadmap (rumo: entender como a IA funciona)

O projeto evolui em **rodadas** — cada uma vira um commit com nome claro.

### ✅ Rodada 1 — Robustez
- [x] Limitar o histórico enviado (a personalidade nunca "cai da mesa")
- [x] Erros com mensagens específicas + diário de bordo (`yato.log`)
- [x] Teto duro de tamanho de resposta (`num_predict`)

### ✅ Rodada 2 — Laboratório de ML
- [x] Deslizador de **temperatura** (ver, ao vivo, a IA mais/menos criativa)
- [x] Métricas de cada resposta na tela (tokens, tempo, velocidade)
- [x] Botão **nova conversa** (zerar a memória sem fechar o app)
- [x] Acordar o cérebro ao abrir + status `● pronta`

### ✅ Rodada 3 — Experiência
- [x] Resposta em *streaming* (texto aparecendo palavra por palavra)
- [x] Salvar a conversa entre sessões (persistência em JSON, leitura segura)
- [x] Revisão das rodadas 1–2: `acordar()` com tentativas (status não mente
      mais quando o atalho abre Ollama + app juntos) e rotação do `yato.log`

### ✅ Rodada 4 — Ferramentas: o Yato vira agente 🔍
- [x] `ferramentas.py` com busca na web (DuckDuckGo, grátis e sem chave)
- [x] `ler_pagina(url)`: quando o resumo da busca não basta, ele abre e
      lê a página (HTML limpo, cortado pra caber no contexto)
- [x] Ciclo do agente no `cerebro.py` (pensa → busca → lê → responde),
      com trava de 4 voltas
- [x] Aviso da ação ao vivo no balão + contador de idas à web na etiqueta
- [x] Contexto 4096 → 8192 tokens (espaço pros resultados de busca)
- [x] Data de hoje injetada a cada chamada (senão ele busca no passado)
- [x] **Busca enriquecida**: a busca já lê a melhor página sozinha
      (verificado: 7/7 itens da resposta rastreáveis até a fonte)
- [x] Listas longas em blocos paginados ("continua" segue de onde parou)
- [x] **Fonte persistente entre turnos**: o "continua" relê a fonte real
      em vez de inventar (verificado: 5/6 itens do turno 2 rastreáveis)
- [x] Modos no lugar de temperatura crua (🎯 Preciso · 💬 Natural · 🎭 Lúdico)

### ✅ Rodada 5 — Memória e usabilidade
- [x] **Memória de fatos**: o Yato anota (`anotar_fato`) e esquece
      (`esquecer_fato`) fatos sobre você por decisão própria; tudo em
      `fatos.json`, injetado no system prompt — ele te conhece entre sessões
- [x] Regra anti-teatro estendida à memória (dizer "anotado" sem chamar
      a ferramenta é proibido — pego nos testes!)
- [x] Botão **📌 Memória**: os fatos direto do arquivo, sem o modelo
      enfeitar (pego no print do Ruan: ele inventou uma viagem à
      "Tokyo Disneynile" por cima do único fato real)
- [x] Botão direito copia o texto de qualquer balão 📋

### ✅ Rodada 6 — Visão 👁️
- [x] Colar (`Ctrl+V`) ou anexar (📎) imagens no chat
- [x] Ferramenta `ver_imagem`: o gemma3:4b vira o "olho emprestado" do
      cérebro cego (com olhada automática ao anexar — o 7B não tem
      iniciativa, então a etapa virou código)
- [x] Descrição vira contexto: perguntas seguintes sobre a imagem não
      pagam nova troca de GPU
- [x] Olho maior: `qwen2.5vl:7b` venceu o "ringue dos olhos" (12/12 em
      tela densa vs 11/12 do gemma3) e assumiu o posto; pergunta da olhada
      automática em duas partes (o VL é literal — só transcrevia se não
      mandasse descrever também)
- [ ] Evolução futura: tradutor de tela com tecla de atalho global

### 📋 Rodada 7 — Voz 🎤
- [ ] Ouvir (Whisper local) e falar (Piper, voz pt-BR) — tudo offline

### 💡 Depois (sem número ainda)
- [ ] Mais ferramentas (clima, lembretes, ler arquivos...)
- [ ] Mostrar os **tokens** (como a IA "fatia" o texto em pedaços)
- [ ] O chefão final: trocar o Ollama por código que roda o modelo direto
      (ver as engrenagens)
