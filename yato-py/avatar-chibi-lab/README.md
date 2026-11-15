# Yato chibi — beta-2 LAB

Laboratório independente derivado do **beta-1 aprovado** em 13/11/2026.
O beta-1 está congelado em `../avatar-chibi-beta-1/`, com ZIP e manifesto de hashes
em `../avatar-releases/`. O conceito e os sprites originais não foram redesenhados.

## Abertura com quadros preparados

As imagens em `assets/prepared/` contêm os mesmos quadros normalizados, gerados
pelo próprio renderer. A abertura carrega uma pose parada primeiro e depois
publica todos os quadros de animação juntos, evitando repetir a análise de pixels
e as correções de proporção em cada inicialização. Os PNGs originais permanecem
intactos. Se um arquivo preparado faltar ou falhar ao decodificar, o avatar usa
o processamento original automaticamente.

Ao trocar a arte ou alterar `prepareFrames`, regenere esses arquivos com Electron:
`electron qa/startup.cjs --build --monitor=1`. O manifesto registra os hashes das
fontes e dos resultados. `electron qa/startup.cjs --monitor=1` compara o caminho
original com o otimizado, verifica pixels e simula falha do cache. São janelas
ocultas no monitor 1. `--monitor=2` continua disponível quando solicitado.

Os tempos em `qa/startup-after.json` medem o carregamento do renderer após criar
a janela, não o tempo total de lançamento do processo Electron. Nesta máquina,
as amostras passaram de 895–1414 ms para 308–402 ms; a primeira pose apareceu
em 129–216 ms. Os testes são sequenciais, com cache do sistema aquecido.

Backup anterior à otimização: `../avatar-releases/antes-startup-20261114-094140/`.
O beta-1 separado não foi alterado. Para usar a atualização no chat já aberto,
desligue e ligue o botão **Avatar**.

## Balão do mini Yato

### Comandos e informações ocasionais

#### Clima e notícias online

Com **Clima e notícias da internet** ligado, as dicas locais são substituídas por
consultas online. Notícias de jogos, IA e tecnologia vêm dos RSS do Canaltech e
Xbox Wire, com filtro de temas, descarte de promoções e de itens com mais de
72 horas, e alternância entre os temas disponíveis. Manchetes já exibidas são
lembradas no perfil para evitar repetição.

O limite automático é **duas notícias por dia**, com pelo menos seis horas entre
elas. O clima é consultado para a região configurada a cada **90 minutos**;
há também pelo menos 20 minutos entre cartões automáticos. Limites e histórico
persistem entre reinícios. As consultas começam após a abertura, sem bloquear
o carregamento do avatar. Conversar, digitar, caminhar ou dormir suspende a exibição.

Use **Ver clima agora**, **Ver notícia agora**, ou digite `clima` / `notícias` no
campo de comandos para consultar manualmente. Os cartões mostram fonte e horário
dos dados/publicação, com **Ver fonte**. As notícias são manchetes diretas, sem
resumos inventados. Clima: estimativa regional Open-Meteo; a chance de chuva é
a máxima prevista para o dia. Falhas de rede ficam silenciosas no modo automático
e são informadas nas consultas manuais; uma falha adia a tentativa em 15 minutos.

Configuração pessoal no perfil do avatar: `onlineInfo`, `weatherLocation`
(label, latitude, longitude) e `onlineHistory`. Cada pessoa configura sua cidade
localmente; nenhuma localização pessoal é distribuída e não há coleta de GPS.
Fontes: https://open-meteo.com/en/docs, https://canaltech.com.br/rss/ e
https://news.xbox.com/pt-br/feed/ . Testes de lógica e interface:
`qa/test-online.cjs` e `qa/online-integration.cjs --monitor=1`.
Backup anterior: `../avatar-releases/antes-clima-noticias-20261114-095709/`.

Clique em **Dar comando…** no balão ou no menu do personagem. Digite e pressione
Enter. Comandos disponíveis: `abre o Google`, `abre o explorador de arquivos`,
`abre o explorador de arquivos na pasta jogos`, `abre a pasta Downloads`,
`que horas são?` e `que dia é hoje?`. Os demais mostram exemplos disponíveis.

Pastas são procuradas pelo nome nas raízes dos discos e nas pastas pessoais.
Se houver ambiguidade ou o nome não for encontrado, um seletor permite escolher a pasta e salva a associação
no perfil do avatar. Só diretórios são abertos; o texto não é executado como código
ou comando de terminal. O Google usa uma URL fixa no navegador padrão.

O foco de teclado só é ativado ao abrir o campo. Enquanto você digita, o passeio
e a expiração do balão pausam. Fechar o balão retorna à janela passiva habitual.

As **Frases ocasionais** incluem hora, data e dicas rápidas locais. O menu
**Intervalo das informações** oferece 2–4, 5–10 e 10–20 minutos; **Mostrar informação
agora** permite experimentar sem esperar. Hora e data são calculadas ao exibir.
Essas informações não consultam a internet nem acionam a voz.

Testes: `qa/test-commands.cjs` e `qa/commands-integration.cjs --monitor=1`.
As aberturas externas são simuladas no teste de interface; formulário, IPC,
resolução da pasta, foco e persistência são exercitados. Backup anterior:
`../avatar-releases/antes-comandos-balao-20261114-095248/`.

O avatar do chat mostra as respostas concluídas em um balão, inclusive com a voz
desligada. Respostas compridas têm páginas; as setas permitem lê-las no próprio
balão. Passar o mouse mantém o texto disponível e pausa o deslocamento. O botão
direito no personagem oferece os controles do balão e permite rever a última
resposta. Enviar outra mensagem ou trocar de conversa limpa o conteúdo anterior.

**Frases ocasionais** acrescenta comentários curtos locais durante o repouso,
com intervalos de 2–4 minutos. Elas cedem lugar às respostas e ficam suspensas
enquanto ele conversa, caminha, cochila ou faz um gesto. É possível desativá-las
independentemente dos balões de resposta. Elas não chamam o modelo nem a voz.

O balão usa sua própria janela transparente, sem alterar a escala do personagem.
Ele acompanha a posição do Yato e cabe na área útil do mesmo monitor. Preferências
ficam no perfil do avatar; o texto não é salvo nesse perfil.

Abra `../Yato mini com balao.bat` para testar uma prévia no **monitor 2**, com
preferências separadas do chat. O botão direito permite testar o balão novamente.
Para receber mensagens reais após instalar esta mudança, feche e reabra o **Yato
completo**, pois os novos envios também passam por `app.py` e `avatar2d.py`.

A ponte usa `POST /balao`, JSON `{ "texto": "...", "revisao": 1 }`.
Texto vazio limpa. Só aceita texto até 32768 unidades UTF-16 e revisão inteira
não negativa; revisões antigas não substituem uma mensagem mais recente.
O envio roda separadamente da boca, descarta mensagens substituídas e não
reenvia respostas de uma sessão anterior do avatar. Beta-1 e Natori mantêm
seus protocolos anteriores. Backup anterior: `../avatar-releases/antes-balao-20261114-005754/`.

## Braços 03 e efeitos aprovados e integrados

O avatar principal do chat usa o ciclo 03 aprovado em `../avatar-chibi-walk-lab/`
em 14/11/2026: oito fases por direção, agora com o recuo do braço que faltava,
e repouso lateral com a mesma paleta, sem alternar os quadros de duas artes.
A direção esquerda espelha o mesmo ciclo. A janela atualiza a cada 16 ms e
a parada mantém a continuidade entre os pés e o corpo.

**Brilho e partículas** liga ou desliga a camada violeta/ciano pelo botão direito.
**Pulso digital** dispara um aro violeta nos pés e partículas maiores por cerca
de 1,35 s, sem vinculá-lo aos passos. É uma ação pontual; **Brilho e partículas**
controla a camada contínua. Acionar o pulso não reinicia as partículas ambientes. Os efeitos
iniciam ligados quando ainda não há preferência salva; a escolha fica no mesmo
perfil do tamanho e passeio. A preferência de movimento reduzido mantém apenas
o halo estático. A boca continua respondendo à voz do chat.

A arte está em `assets/yato-caminhada-bracos-v3.png`, promovida sem mudanças do
experimento. O prompt original permanece em `../avatar-chibi-walk-lab/prompt-bracos-v3.txt`.
`effects.js` mantém os efeitos separados do desenho e do controlador dos passos.

No desktop, os comandos **Caminhar / parar** e **Passeio contínuo / parar**
ativam ou param a passada e o deslocamento juntos. A reprodução no lugar fica
disponível apenas no estúdio de animação. O tamanho e as opções de passeio
continuam no perfil existente do chat; a posição após um arraste é preservada.

Backup anterior: `../avatar-releases/antes-integracao-bracos-03-20261114-002321/`,
com manifesto SHA-256. O beta-1 permanece separado e inalterado.

Testes com janela usam `--monitor=2`, inclusive quando ocultos. O host resolve
o monitor secundário antes de criar a janela e mantém o teste inteiro nessa
tela. A opção de teste falha se não puder identificar o monitor; não recai
silenciosamente no principal.

## Abrir

- `Abrir demonstracao.bat`: estúdio de animação.
- `Abrir no desktop.bat`: janela transparente; arraste pelo tronco, botão direito
  para abrir as ações e **Fechar** para encerrar o personagem.
- `../Yato chibi beta-1.bat`: versão aprovada anterior, sem mudanças.

Usa o Electron já instalado em `../avatar-electron/node_modules/`.
Porta do laboratório: **8139**, ajustável por `YATO_CHIBI_LAB_PORTA`.
Pode rodar ao lado do beta-1 (8138). Estúdio e desktop deste laboratório usam a
mesma porta: feche um antes de abrir o outro. Pelo chat, escolha **Yato laboratório**
no seletor ao lado de **Avatar** e ligue o interruptor. Essa instância usa uma porta
livre e pode conviver com a demonstração. Natori e beta-1 continuam no seletor.

## Tamanho no desktop

Clique com o botão direito no corpo do Yato → **Tamanho** e escolha **50%, 75%,
100% ou 125%**. O padrão novo é 75%, menor que a janela original. A mudança é
imediata, mantém os pés na mesma altura quando há espaço e respeita os limites
do monitor. O passeio e a pausa ao passar o mouse continuam funcionando.

A escolha fica salva em `desktop-settings.json` no perfil do Electron
(`%APPDATA%/yato-chibi-chat/` no chat, `%APPDATA%/yato-chibi-lab/` nos atalhos).
O tamanho do estúdio de animação e o beta-1 aprovado permanecem como estavam.
Para carregar esta atualização em um avatar já aberto, desligue e ligue **Avatar**
uma vez no chat. Depois, qualquer mudança pelo menu dispensa reiniciar.

Validação: `node qa/test-size.cjs` e `electron.exe . --desktop --size-selftest`.
As imagens `qa/size-*.png` são capturas internas do avatar, não da área de trabalho.

## Passeio automático e troca de janelas

No desktop, o **Passeio automático com pausas** começa ligado. O Yato descansa
por 8–16 segundos e caminha por 3–6 segundos, variando o intervalo e a direção.
Ele desacelera ao parar. Passar o mouse, abrir o menu, arrastá-lo, conversar ou
executar um gesto interrompe a rotina; depois ele descansa antes de voltar a andar.

Botão direito → **Passeio automático com pausas** liga/desliga a rotina e salva
a preferência junto ao tamanho. **Passeio contínuo / parar** mantém a opção de
caminhar sem pausas; os comandos manuais de movimento desligam a rotina automática.

A janela desktop não recebe foco nem aparece no Alt+Tab e mantém a prioridade
de sobreposição ao trocar de aplicativo. O fechamento continua pelo menu do
personagem ou pelo interruptor **Avatar** do chat. O estúdio permanece uma janela
normal. Jogos em tela cheia exclusiva podem impedir sobreposições do Windows.

Validação: `node qa/test-autonomy.cjs` e
`electron.exe . --desktop --routine-selftest`. O teste usa intervalos curtos,
verifica pausas/interrupções e abre uma janela temporária para conferir foco e
sobreposição, sem capturar a área de trabalho.

## Novidades desta rodada

- Proporções da caminhada corrigidas no renderer: a cabeça lateral passa de
  171–176 px para 137–141 px, comparável aos 140 px da pose frontal, na escala
  interna. A altura total e o apoio dos pés são mantidos; a correção de largura
  se dissolve pelo capuz para evitar uma emenda no pescoço. PNGs preservados.
- Troca entre frente e perfil em 100 ms, com mistura de transparência ponderada
  para reduzir a dupla silhueta durante a virada.
- Caminhada lateral: seis poses desenhadas para a direita e seis para a esquerda.
- Aceleração e desaceleração ao iniciar/parar, sem saltar de posição.
- Virada com parada e passagem pela pose frontal antes de retomar o outro lado.
- Botões de direção, também disponíveis no menu do desktop.
- Um controlador compartilhado sincroniza passos, velocidade e direção da janela.
- Passar o mouse sobre o corpo no desktop pausa tanto a janela quanto os passos.
- Quatro novas poses de reação: acenar, pensar, comemorar e cochilar.
- Entrada/saída suavizadas; os gestos curtos retornam ao estado anterior.
- Cochilo persistente, respiração mais lenta e botão para despertar.
- Pausa da caminhada durante gestos e cochilo, com retomada automática.
- Balanço de repouso e leve inclinação em direção ao cursor no palco.
- Controle de velocidade do ciclo de passos e dos gestos.
- Boca com suavização temporal e piscadas independentes da fala.
- Sprites alinhados pelo cabelo e pelos pés para reduzir oscilação lateral.
- Ciclo de caminhada reinicia ao ligar; desligar passeio conserva a posição.
- Posição limitada novamente quando o palco é redimensionado.

São **poses raster com movimentos procedurais**, não um rig articulado final. Acenar
combina a pose com balanço; comemorar inclui pequenos saltos, pensar uma inclinação,
cochilar uma oscilação lenta. Não há animação independente de dedos, cabelo ou roupa.
A caminhada usa uma nova folha de perfis em duas direções. A escala de cada ciclo
é mantida constante para reduzir mudanças de tamanho entre os passos. Ainda há
pequenas variações na arte gerada e no apoio dos pés; não é um rig com encaixe físico
dos pés no chão. Não há comportamento de IA autônomo novo.

As reações usam uma folha nova gerada por `image_gen` a partir do conceito aprovado;
ela pode apresentar pequenas diferenças de desenho em relação ao beta-1. A arte-base
foi mantida. As transições de perfil duram 100 ms; as demais duram 200 ms,
com virada parada de 360 ms.
É possível desligar balanço e cursor para
comparar a silhueta em repouso.

## Fala e estados

A voz de demonstração continua sendo Microsoft Daniel / pt-BR, local, já gerada no
beta-1. O envelope de volume continua derivado de `voz.py`. Nenhuma voz configurada
no aplicativo foi substituída.

Quando aberto pelo chat (`--desktop --chat`), a voz vem do **Piper real** do
aplicativo; a amostra de demonstração não aparece no menu. O chat envia estados
persistentes de ouvir, pensar e falar, além da amplitude da boca. Esses estados
pausam o passeio até o fim da interação, inclusive em silêncios entre palavras,
e retomam as preferências anteriores. Uma confirmação a cada segundo mantém o
estado ativo; após 4,5 segundos sem contato, o laboratório volta ao repouso.
Cancelar uma fala também cancela sínteses pendentes e impede que uma resposta
antiga sobrescreva o estado da interação seguinte.

As reações interrompem a amostra de fala para apresentar sua expressão. Iniciar a
fala, ou receber uma abertura de boca pela ponte, cancela a reação e desperta o Yato.
Durante a fala, olhos e boca são compostos separadamente. A reação de pensar/feliz
agora tem efeito visual, além de mudar a legenda. Personalidade e memória continuam
nos módulos existentes, sem leitura ou alteração de dados pessoais por este lab.
Durante a fala ele pausa os passos e volta a olhar para frente. A ponte externa
mantém uma pausa de 350 ms depois do último volume positivo, para não reiniciar
a caminhada nos pequenos silêncios entre sílabas. Depois retoma as opções ligadas.

Contrato preservado: `window.setBoca(0..1)` e `window.setExpressao(nome)`.
Novas funções: `window.reagir('wave'|'think'|'celebrate'|'sleep'|'wake')`,
`window.setVelocidade(0.6..1.5)`, `window.setDirecao(-1|1)` e
`window.setMovimento(nome, boolean)`.
Integração do chat: `window.setEstadoConversa('ociosa'|'ouvindo'|'pensando'|'falando')`,
exposta em `/controle?acao=estado&nome=pensando`. `/saude` informa prontidão e estado
visual para os testes, sem texto das conversas.
Ponte local: `/controle?acao=boca&valor=0.7`,
`/controle?acao=expressao&nome=pensando`, `/controle?acao=reacao&nome=wave`.

## Validação e materiais

`electron.exe qa/check-proportions.cjs` compara as 12 poses laterais à frontal,
verifica tamanho da cabeça, altura e pés, e percorre os ciclos de andar/parar
nas duas direções. As comparações `qa/proportions-before.png` e
`qa/proportions-after.png` são montagens internas do renderer, sem captura
da área de trabalho. Backup: `../avatar-releases/Yato-lab-antes-proporcoes.zip`.

`electron.exe . --selftest` testa o estúdio e `electron.exe . --selftest --desktop`
testa o modo transparente, com a instalação do Electron do projeto. Os testes usam
18139, tocam um pequeno trecho de áudio e salvam resultados/capturas em `qa/`.
`node qa/test-motion.cjs` verifica aceleração, frenagem, mudanças de direção,
voltas repetidas nas bordas, pausa/retomada, redimensionamento e caminhada no lugar.
`../tests/verificar_avatar_real.py` valida Piper, boca no Electron, pausa/retomada
e troca entre os três avatares; registra o resultado em `qa/chat-real-result.json`.
Os testes de microfone usam simulações; esse teste não grava áudio do ambiente.
Capturas antigas herdadas do beta-1 não representam a validação atual; os arquivos
`studio-*` e `desktop-*` produzidos nesta rodada identificam o modo verificado.

Conceito aprovado: `assets/yato-chibi-conceito-v1.png`.
Sprites aprovados: `assets/yato-chibi-sprites-v1.png`.
Nova folha: `assets/yato-chibi-reacoes-v1.png`.
Prompt exato da folha nova: `prompt-reacoes.txt` (ferramenta integrada `image_gen`).
Prompts herdados do beta-1: `prompts.txt`.
Folha lateral: `assets/yato-caminhada-lateral-v1.png`.
Prompt exato: `prompt-caminhada.txt` (ferramenta integrada `image_gen`).
Backup do laboratório anterior a esta rodada: `../avatar-releases/Yato-lab-antes-caminhada-lateral.zip`.

## Conversa inteligente pelo balão (14/11/2026)
O balão gerenciado pelo chat envia as mensagens para a mesma conversa do app.py,
com personalidade, histórico, memória, pesquisa e voz existentes. Não usa o
reconhecedor de frases para decidir a intenção quando está conectado ao chat.
O modelo pode chamar mini_yato para Google, pastas, explorador, cálculo, clima,
notícias, hora e data. Ações locais têm lista explícita; não executam shell.
A ponte HTTP usa loopback, porta dinâmica e token por processo. A fila é drenada
pela thread Tk e rejeita outro pedido durante uma resposta. Rascunhos e anexos
no chat são preservados. A prévia isolada mantém comandos locais e orienta abrir
o app principal para conversa livre.

Após atualizar, reinicie o Yato inteiro; alternar apenas Avatar não recarrega
os módulos Python. O beta-1 não foi alterado.

Validação: tests.test_bubble_bridge, tests.test_avatar_bubble e
 tests.test_avatar_integration (26 testes); qa/assistant-integration.cjs oculto
no monitor 1; tests/check_bubble_model.py (opt-in, modelo real, ações simuladas,
sem gravar memória/histórico). Resultado em qa/assistant-model-result.json.
