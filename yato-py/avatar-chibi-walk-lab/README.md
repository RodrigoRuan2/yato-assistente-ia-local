# Yato — Repouso LAB

## Repouso 01 — somente experimental

Novos movimentos de repouso: mudar o apoio do corpo, ajeitar a manga, colocar a
mão no bolso e observar os lados. O controlador `idle.js` escolhe gestos sem
repetição consecutiva, intercala pausas de 10–22 s e alterna os lados do apoio
e do olhar. Um gesto termina em repouso antes de começar outro.

**Demonstrar movimentos de repouso** apresenta os quatro gestos com pausas de
2–3 s. Os quatro botões também permitem experimentar cada ação. Ao selecionar
um gesto durante a caminhada, o Yato conclui a parada antes de começar. Fala,
conversa, reações, sono ou nova caminhada interrompem o gesto; ele não fica
guardado para aparecer depois. Movimento reduzido desativa esses gestos.

As poses estão em `assets/yato-repouso-v1.png`, geradas pela ferramenta integrada
de imagens a partir da arte frontal existente. Prompt completo em
`prompt-repouso-v1.txt`. O renderer mistura as poses com opacidade ponderada.
Repouso e fala compartilham a pose neutra desse atlas enquanto o experimento
está ligado, para não trocar a cor da roupa ao falar. A variante de cor
`yato-repouso-v2.png` foi avaliada e não está carregada: ela aumentava a cabeça
em relação ao frontal aprovado. O atlas v1 mantém a cabeça dentro de 3 px do
original; o teste também limita a variação entre poses a 4 px.

O principal e o beta-1 continuam separados, sem receber este experimento.
Backup anterior: `../avatar-releases/walk-lab-antes-repouso-20261114-003948/`;
`protected.json` registra os hashes do principal e do beta-1.

Teste do controlador: `node qa/test-idle.cjs`. QA visual e integração:
`electron.exe qa/render-idle.cjs --monitor=2`, em janela oculta na segunda tela.

Cópia independente usada para revisar cores e passos. O ciclo 02 foi aprovado e integrado ao Yato principal em 14/11/2026; esta pasta continua separada para comparação e futuros experimentos. O beta-1 e o protótipo de rig permanecem preservados. O ciclo 02 usa uma única paleta para oito fases da passada e uma pose de repouso lateral.

Experimento de 14/11/2026: **braços 03** completa o balanço para trás que faltava no ciclo 02. Mantém animação por sprites, sem voltar ao rig. Inclui halo violeta/ciano, poucas partículas e um pulso digital opcional de 1,35 s, com aro nos pés e partículas maiores para ficar visível no avatar pequeno; os efeitos iniciam desligados neste estúdio e não disparam a cada passo. Depois de testar esta cópia, o usuário aprovou a integração dos braços e efeitos ao principal. Esta pasta permanece independente para comparação; o principal oferece os efeitos no botão direito e salva a preferência.

Backup anterior a este experimento: `../avatar-releases/walk-lab-antes-bracos-20261114-000922/`. O arquivo `protected-main-beta1.json` nesse backup registra o principal e o beta-1 antes da criação do experimento. Após a aprovação, o principal foi atualizado; o beta-1 continua igual. Backup do principal antes da integração: `../avatar-releases/antes-integracao-bracos-03-20261114-002321/`.

## Abrir

- `../Yato repouso experimental.bat`: inicia a demonstração dos quatro gestos no monitor 2.
- `Abrir demonstracao.bat`: estúdio com os controles de comparação.
- `Abrir no desktop.bat`: personagem em janela transparente.
- `../Yato caminhada refinada.bat`: atalho para este estúdio.
- `../Yato bracos e efeitos.bat`: abre no monitor 2 com a caminhada de demonstração e o brilho ligados. Permite desligar cada novidade separadamente. Feche uma prévia anterior desta mesma pasta antes de abrir outra.

Usa o Electron instalado em `../avatar-electron/node_modules/`. A porta desta cópia é **8141**, ajustável por `YATO_CHIBI_WALK_PORTA`, e o perfil é `%APPDATA%/yato-chibi-walk-lab/`. Estúdio e desktop usam a mesma porta; feche um antes de abrir o outro. No chat, **Yato laboratório** agora usa o mesmo ciclo aprovado; o beta-1 segue separado.

Os atalhos e testes usam **monitor 2**, identificado como o único secundário quando há duas telas. Nesta máquina é o Odyssey G30B, à direita, ID 2723638656. A janela nasce dentro dessa tela e fica limitada a ela. Se o monitor não puder ser identificado, nenhuma janela é aberta. `display-target.cjs` faz a seleção antes de criar inclusive janelas ocultas de teste.

## Comparar os movimentos

**Reproduzir caminhada** alterna automaticamente entre andar e descansar. **Parar com suavidade** encerra o movimento respeitando a transição de parada.

**Balanço completo dos braços** alterna entre o novo ciclo 03 e o ciclo 02 aprovado que está no principal. Ambos têm oito poses e usam o mesmo controlador de entrada e parada. A sequência nova é frente → vertical → trás → vertical → frente; a anterior não tinha o recuo do braço próximo.

**Presença digital** permite ligar brilho/partículas e testar um pulso. A camada desenha atrás do personagem e mantém suas cores opacas. Desligada, não altera pixels nem aloca os buffers dos efeitos; a preferência de movimento reduzido do sistema mantém apenas o halo estático.

Os quadros antigos e novos não se alternam dentro da mesma passada. Preparação e repouso usam a mesma arte do ciclo novo. A direção esquerda espelha o ciclo direito em tempo de execução, mantendo as mesmas cores e a mesma sequência. A janela do desktop atualiza a cada 16 ms. A parada mantém a velocidade da fase e depois desacelera, sem acelerar os pés para forçar o apoio; interromper durante a aceleração inicial pode exigir mais tempo até o próximo apoio.

Também continuam disponíveis direção, velocidade, caminhada, passeio, respiração, piscadas, pequenos movimentos, olhar para o mouse, gestos e demonstração da fala. No desktop, o menu do botão direito mantém tamanho e passeio automático com pausas. A janela continua sem receber foco e com prioridade de sobreposição.

## Arquivos

- `assets/yato-caminhada-lateral-v1.png`: poses anteriores preservadas.
- `assets/yato-caminhada-ciclo-v2.png`: atlas 3 × 3; oito fases de caminhada e um repouso lateral. Criado com a ferramenta integrada de imagens; os prompts estão em `prompt-ciclo-v2.txt` e `prompt-ciclo-v2-layout.txt`.
- `assets/yato-caminhada-bracos-v3.png`: edição do ciclo 02 com recuo dos braços, criada com a ferramenta integrada de imagens, modo de edição. Prompt exato em `prompt-bracos-v3.txt`.
- `effects.js`: efeitos originais em Canvas, sem imagens de Capri nem captura de tela.
- `assets/yato-caminhada-complementos-v1.png`: experimento anterior arquivado, não carregado pelo renderer.
- `avatar.js`: composição e reprodução das poses, fala, gestos e controles.
- `motion.js`: fases de entrada, caminhada e parada, sincronizadas com o deslocamento.
- `main.js`: janela Electron, menu do desktop e servidor local isolado.

Este laboratório usa sprites. O protótipo de rig permanece em sua própria pasta.

## Verificação

`node qa/test-motion.cjs` verifica o controlador sem abrir janelas; `node qa/test-effects.cjs` verifica que os efeitos desligados não interferem, que o pulso termina e que os buffers são limitados. O renderer atual usa `electron.exe qa/render-arms.cjs --monitor=2`; confere cores da roupa, proporções, sequência apoio/passagem, comparação e parada. Gera apenas imagens do próprio avatar, sem vídeo ou captura da área de trabalho. O script `render-walk.cjs` é o registro da QA histórica do ciclo 02.

O teste de integração do host usa `electron.exe . --monitor=2 --walk-selftest` ou `electron.exe . --monitor=2 --desktop --walk-selftest`. Usa a porta **18142**, o perfil `yato-chibi-walk-selftest` e uma janela oculta posicionada no monitor 2. O resultado fica em `qa/walk-host-studio.json` ou `qa/walk-host-desktop.json`.

O endpoint `/saude` identifica esta cópia como `walk-lab`. O host verifica carregamento do renderer, acesso ao atlas adicional, bloqueio de arquivos privados e integração de boca; no desktop, também confere foco, sobreposição e tamanho.

`qa/protected-before-color-fix.json` registra os hashes do principal, beta-1 e rig antes desta correção. O experimento anterior está em `../avatar-releases/walk-lab-antes-correcao-20261113-233900/`.

## Referências estudadas

- [Animation Mentor — Animating a Basic Human Walk Cycle](https://www.animationmentor.com/blog/tutorial-animating-human-walk-cycle/): sequência de apoio, passagem e elevação, continuidade do loop, balanço dos braços e atraso entre braço/antebraço/mão.
- [Animation Mentor — How Size Changes the Way a Character Moves](https://www.animationmentor.com/blog/tutorial-animating-big-and-small-characters/): evitar duplicar o primeiro quadro no final e escalonar movimentos secundários.
- [Toon Boom — Walk Analysis](https://learn.toonboom.com/modules/walk-cycle-animation/topic/walk-analysis1): analisar mãos, braços, cabeça e atitude junto das pernas.
- [Capri Companion](https://github.com/TheAgencyMGE/capri-companion): referência de presença digital e glitch/teleporte. O teste do Yato usa apenas a direção visual geral, com efeitos próprios e discretos.
