# Só mini Yato — experimental

Avatar independente do chat principal, com o visual Discreto e o cérebro local
do Yato. O beta-1 e o aplicativo principal permanecem separados.

## Abrir

Na instalação existente, execute **Abrir Mini Yato.vbs**. O avatar abre no monitor
principal (monitor 1). Clique com o botão direito e escolha **Falar com o Yato**.
Para encerrar o modo, use **Fechar** no menu do avatar.
O mesmo menu oferece **Abrir Yato Chat** para iniciar a interface principal
quando necessário, sem encerrar o mini. A proteção de instância única do chat
continua valendo. O atalho do mini pode ser fixado na barra de tarefas pelo
menu do Windows; atalhos locais não entram no GitHub porque contêm caminhos
específicos de cada instalação.

Em uma instalação nova, prepare o ambiente Python em `../.venv`, instale este
`requirements.txt`, execute `npm install` em `../avatar-electron`, instale o
Ollama e baixe `qwen3:8b`. Reutiliza o Electron do projeto, mas não abre o chat.
As versões Python das dependências estão fixadas neste diretório.

## IA e consumo

- O processo residente usa apenas a biblioteca padrão do Python.
- O modelo não é carregado ao abrir o avatar.
- Uma mensagem inicia um processo temporário com o cérebro, personalidade,
  contexto de conversa, memória e ferramentas de pesquisa do Yato.
- Ao terminar a resposta, o processo temporário encerra. O Ollama recebe
  `keep_alive: 30s` em todas as chamadas ao modelo. Ele pode manter seu pequeno
  serviço aberto, mesmo depois de descarregar o modelo.
- A primeira resposta após descarregar paga o tempo de carregar o modelo.
- Animações em repouso têm atualização reduzida; caminhada usa atualização maior.
- Voz, microfone, interface Tk e ferramentas de imagem não são iniciados.
- Comentários espontâneos são frases curtas de companhia e horário, sem chamar
  a IA nem consultar a internet. Intervalo padrão de 30–60 minutos, somente em
  repouso e sem interromper conversa. Notícias ficam disponíveis sob pedido.
- Não descarrega modelos de outros aplicativos nem interfere no Forge. Se outro
  cliente usar o mesmo modelo no Ollama, pode alterar o tempo de permanência.

## Experiência individual e privacidade

Todos os dados específicos desta versão ficam em `data/`, no mesmo disco do
projeto: conversa, fatos aprendidos e perfil Electron. Essa pasta é ignorada pelo
Git. Não copiar perfis entre usuários nem publicar dados para treinar um modelo.
Cada instalação começa com memória própria vazia. O modo não lê automaticamente
arquivos do PC, tela, teclado, histórico do navegador ou pastas pessoais.

O Yato pode guardar preferências que a pessoa ensine na conversa. É memória
persistente e adaptação por contexto, não retreinamento do modelo ou alteração
autônoma de código. Pergunte “o que você lembra sobre mim?” ou peça “esqueça que
eu gosto de X”. O arquivo `data/fatos.json` também permite revisar essas memórias.
O histórico recente retém até 120 mensagens; até 20 fatos duradouros são guardados.

Pesquisa web e notícias usam a internet quando acionadas. O texto enviado ao
modelo é processado pelo Ollama local. Cidade do clima e preferências não vêm
preenchidas com os dados de quem desenvolveu o projeto. Uma consulta de clima sem
cidade configurada explica essa limitação.

Somente código, assets do personagem, testes sintéticos e medições agregadas
devem ir ao GitHub. Nunca publicar `data/`, configuração local, logs, backups,
capturas da área de trabalho, caminhos pessoais ou transcrições de conversas.

## Desenvolvimento e testes

`runtime/` é uma cópia dos módulos necessários do projeto; `brain.py` mantém o
fluxo do cérebro com retenção curta do modelo. Essa cópia isola a experiência do
aplicativo principal. Atualizações do cérebro devem ser revisadas explicitamente.

`qa/assistant-integration.cjs` testa IPC, conversa, cálculo e ações simuladas em
janelas ocultas no monitor 1. `qa/session.py` testa o modelo real com um perfil
sintético separado em `data/qa`. `qa/measure.ps1` coleta RAM, memória privada,
CPU e estado do Ollama; a GPU reportada pelo driver é de todo o sistema.
