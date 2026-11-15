# Yato — protótipo de rig 2D

Cópia independente do laboratório, criada para experimentar uma caminhada por
partes articuladas e uma parada que conclui a passada. O beta-1 aprovado,
a prévia original, o laboratório anterior e a integração do chat são preservados.

## Abrir

- `Abrir demonstracao.bat`: abre o estúdio com palco e controles.
- `Abrir no desktop.bat`: abre somente o personagem, em janela transparente.
- `../Yato rig 2D prototipo.bat`: atalho para este estúdio.

O protótipo usa o Electron já instalado em `../avatar-electron/node_modules/`.
A porta é **8140**, ajustável por `YATO_CHIBI_RIG_PORTA`. Estúdio e desktop deste
protótipo compartilham essa porta: abra um de cada vez. Eles podem coexistir
com o laboratório de sprites e com o beta-1, que usam outras portas.

As preferências de tamanho e rotina ficam em
`%APPDATA%/yato-chibi-rig-lab/desktop-settings.json`. O protótipo não usa o perfil
do chat nem altera seu seletor de avatar.

## Experimentar

Use **Reproduzir caminhada** para observar o ciclo de andar e descansar.
**Parar com suavidade** pede a parada; o personagem conclui a passada antes
de assentar os pés. **Caminhar** mantém o ciclo ligado, e **Passear no palco**
adiciona deslocamento. As setas escolhem a direção e o controle de ritmo altera
a velocidade.

Abra **Ver articulações e apoios** para visualizar as articulações ou os apoios
dos pés. Os controles de presença, expressões e voz da cópia anterior continuam
agrupados abaixo. As reações e a fala preservam a arte frontal do laboratório;
o foco deste protótipo é a caminhada articulada.

A demonstração alterna 3,4 segundos de caminhada, conclusão da passada e
2,4 segundos de repouso. Um comando manual de caminhar, passear ou direção
encerra esse ciclo automático para respeitar a sua escolha.

O corpo tem oito peças independentes desenhadas para o protótipo. As pernas
usam duas articulações por membro, com os pés fixos no mundo durante o apoio.
A antecipação dura 160 ms; ao parar, o Yato termina o passo em curso, aproxima
o pé restante e acomoda o corpo. A parada pode levar cerca de 0,8 segundo.
Cabeça e pés não recebem o estiramento usado pela antiga respiração global.

Limites desta primeira versão: o rig fica de perfil; a virada troca o lado
depois do apoio duplo. Piscadas, boca e gestos continuam nas poses frontais
herdadas, ainda sem articulação facial, cabelo ou roupa independentes.

No desktop, arraste pelo tronco e use o botão direito para abrir o menu. O menu
mantém tamanho 50/75/100/125%, passeio automático com pausas, direção e fechamento,
e acrescenta visualização de articulações e apoios. A pausa ao passar o mouse,
a janela sem foco e a sobreposição sobre outros aplicativos foram mantidas.

## Estrutura

- `motion.js`: passada, apoio dos pés, deslocamento, parada e virada.
- `rig.js`: articulações e montagem das partes do personagem.
- `avatar.js`: renderização, controles, transições e expressões.
- `main.js`: janela Electron, tamanho, rotina e ponte HTTP local.
- `assets/`: cópias das artes anteriores e peças próprias deste protótipo.

Atlas novo: `assets/yato-rig-parts-v1.png`, gerado com a ferramenta integrada
`image_gen`, com transparência real e referências das artes aprovadas.
Prompt completo: `prompt-rig-parts.txt`. A cabeça é aproveitada da arte lateral
anterior; os PNGs de referência não foram alterados. As peças são recortadas
em memória no renderer, sem editar a folha de origem.

A escala enviada pelo host ao controlador é `alturaDaJanela × 0,88 / 512`.
Assim, os apoios podem ser calculados em coordenadas de tela mesmo quando o
usuário muda o tamanho do personagem. O estúdio deve enviar sua própria escala
visual ao mesmo controlador.

A ponte local mantém `/controle` e `/saude`; a saúde identifica o avatar como
`rig-lab`. Nenhum endpoint lê conversas, personalidade ou memória. O projeto
permanece um estudo de animação, sem novo comportamento de IA autônoma.

## Verificar

- `node qa/test-rig-motion.cjs`: testes determinísticos da passada.
- `electron.exe . --rig-selftest`: verificação do host e renderer em modo estúdio.
- `electron.exe . --desktop --rig-selftest`: verificação do host desktop.
- `electron.exe qa/render-rig.cjs`: verifica montagem, controles, parada,
  substituição manual da demonstração e retorno da fala ao rig; produz as
  imagens `qa/rig-studio.png`, `qa/rig-walking.png`, `qa/rig-walk-stop.png`
  e `qa/rig-skeleton.png`.

Os testes do host usam a porta **18141** e o perfil `yato-chibi-rig-selftest`,
separados das preferências normais. As imagens de QA são renderizações internas
do personagem; não são gravações da área de trabalho.

O manifesto `qa/preserved-before.json` registra os hashes do beta-1, da prévia e
do laboratório anterior no início desta cópia. Não desenvolver nessas pastas.
