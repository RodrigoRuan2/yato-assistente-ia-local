# Yato (Python) — IA local de personalidade fixa

Um chat de **desktop** (janela de verdade, não navegador) onde você conversa
com a "Yato", uma IA de personalidade fixa rodando **100% no seu PC**.

> Projeto de **estudo**: a ideia é usar este chat como laboratório pra
> entender, na prática, como modelos de IA funcionam por dentro — sem stream,
> sem avatar, só você e a máquina aprendendo juntos.

## Arquitetura (quem fala com quem)

```
app.py  (a janela)
   │  chama
   ▼
cerebro.py  ──HTTP──►  Ollama em http://localhost:11434  ──►  modelo na sua GPU
   │
personalidade.py  (o texto que diz QUEM a Yato é)
```

Três arquivos, três responsabilidades separadas — assim cada parte é fácil de
entender e mudar sozinha:

| Arquivo             | Responsabilidade                                            |
| ------------------- | ----------------------------------------------------------- |
| `personalidade.py`  | O *system prompt*: quem a Yato é. **Edite à vontade.**     |
| `cerebro.py`        | Falar com o Ollama. Nenhuma tela aqui — só a lógica da IA.   |
| `app.py`            | A janela (CustomTkinter). Só tela; pede pro `cerebro` pensar.|

Essa divisão é de propósito: dá pra testar o `cerebro.py` sozinho (sem abrir a
janela) e, no futuro, trocar o Ollama por outra coisa mexendo só num lugar.

## O que você precisa (uma vez só)

1. **Python 3.12+** (já tem) e o **Ollama** instalado e aberto.
2. O modelo baixado:
   ```bash
   ollama pull gemma3:4b
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
Ele manda uma pergunta de teste e imprime a resposta da Yato no terminal.

> A **primeira** resposta depois de ligar o PC demora 1-3 min (o modelo está
> sendo carregado na placa de vídeo). Depois disso fica rápido, porque ele
> permanece na memória.

## Trocando o modelo

O modelo é a constante `MODELO`, no topo de `cerebro.py`. Opções que cabem
numa GPU de 8 GB (baixe antes com `ollama pull <nome>`):

| Modelo         | Tamanho | Observação                              |
| -------------- | ------- | --------------------------------------- |
| `gemma3:4b`    | ~3 GB   | Ótimo português e rápido — o padrão     |
| `qwen2.5:7b`   | ~4,7 GB | Mais "esperto", um pouco mais lento     |
| `llama3.1:8b`  | ~4,9 GB | Clássico, bom equilíbrio                 |

## Ajustes finos (constantes no topo de `cerebro.py`)

| Constante             | Padrão | O que controla                                          |
| --------------------- | ------ | ------------------------------------------------------- |
| `MODELO`              | gemma3:4b | Qual cérebro usar                                     |
| `MAX_TOKENS_RESPOSTA` | 300    | Teto duro de tamanho de cada resposta                    |
| `LIMITE_HISTORICO`    | 20     | Quantas falas recentes o modelo enxerga (personalidade sempre entra) |

O limite de histórico existe porque o modelo só "vê" 4096 tokens por vez:
sem o corte controlado, conversas longas perderiam o começo **em silêncio** —
inclusive a personalidade.

## O laboratório 🌡️

A janela tem um **deslizador de temperatura** (0.0 a 1.5) — o "grau de
ousadia" do modelo ao escolher cada palavra:

- **0.0** → sempre a palavra mais provável: respostas previsíveis e
  repetíveis (a mesma pergunta dá a MESMA resposta).
- **1.5** → aceita palavras improváveis: criativa, variada, às vezes doida.

Cada resposta da Yato vem com uma **etiqueta de métricas**:

```
15 tokens · 0.3s · 59 tok/s · 🌡️ 0.3
```

= quantos tokens ela gerou, em quanto tempo, a velocidade da GPU e a
temperatura usada. Experimento clássico: faça a mesma pergunta em 0.0 e em
1.5 e compare (o botão **🧹 Nova conversa** zera a memória entre testes).

Ao abrir, o app **acorda o cérebro** em segundo plano (o modelo carrega na
GPU enquanto você digita) — o status no topo mostra `● pronta` ou
`● Ollama fechado`.

## Se algo der errado

- A Yato responde com mensagens diferentes pra cada problema: Ollama fechado,
  modelo não baixado ou demora demais — a própria bolha diz o que fazer.
- Erros ficam registrados no **`yato.log`** (na pasta do projeto), mesmo
  quando o app é aberto pelo atalho, sem terminal. Deu algo estranho? Olha lá.

## Próximas ideias (rumo: entender como a IA funciona)

- [x] Limitar o histórico enviado (a personalidade nunca "cai da mesa")
- [x] Erros com mensagens específicas + diário de bordo (`yato.log`)
- [x] Teto duro de tamanho de resposta (`num_predict`)
- [x] Deslizador de **temperatura** pra ver, ao vivo, a IA ficar mais/menos criativa
- [x] Métricas de cada resposta na tela (tokens, tempo, velocidade)
- [x] Botão **nova conversa** (zerar a memória sem fechar o app)
- [x] Acordar o cérebro ao abrir + status `● pronta`
- [ ] Resposta em *streaming* (texto aparecendo aos poucos, palavra por palavra)
- [ ] Mostrar os **tokens** (como a IA "fatia" o texto em pedaços)
- [ ] Salvar a conversa entre sessões
- [ ] Trocar o Ollama por código que roda o modelo direto (ver as engrenagens)
