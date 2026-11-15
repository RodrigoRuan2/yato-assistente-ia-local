# Yato chibi — prévia v1 / beta-1

Conceito independente, com proporção alongada de aproximadamente 3,5 cabeças,
conforme preferência do usuário. A arte é uma proposta visual, sujeita a refinamento.

## Abrir

- `Abrir demonstracao.bat`: estúdio com controles de respiração, piscadas, caminhada,
  passeio, fala e fundo claro/escuro/quadriculado.
- `Abrir no desktop.bat`: personagem numa janela Electron transparente. Arraste pelo
  tronco. Botão direito sobre o corpo abre o menu; Esc com foco na janela fecha.
  O passeio é opcional e começa desligado. Pausa quando o cursor está sobre o tronco.

Ambos usam o Electron já instalado em `../avatar-electron/node_modules`. Não há
instalação de dependências. A porta desta prévia é **8138**, separada da porta do
avatar atual (8137 por padrão). Defina `YATO_CHIBI_PORTA` para usar outra porta.
Feche uma prévia antes de abrir a outra na mesma porta.

## Avaliação das referências

- `dataset_yato/Yato v1.png`: referência principal de rosto, cabelo preto em camadas,
  olhos violetas, brinco, sorriso discreto, capuz roxo, alça com fivela, nome e emblema.
- `ChatGPT Image 7 de jul. de 2026, 20_13_32.png`: completa o traje com calça cargo,
  corrente, tiras violetas e tênis de cano alto. Base para o corpo inteiro.
- Pranchas `20_13_05` e `20_13_26`: boas referências de componentes e expressões,
  mas são imagens raster achatadas. Os desenhos de peças não constituem um rig,
  nem garantem encaixes, áreas ocultas ou camadas editáveis para Live2D.
- Recortes de cabeça e expressões: úteis para sorriso, surpresa, olhos fechados e
  irritação; resolução pequena para servirem como arte final.
- `assets/Yato v1.png` e `assets/yato_ociosa.png`: hashes idênticos ao original;
  não são duas expressões diferentes. `icone.png` define o emblema violeta.

Direção: manter o ar confiante e carismático, sem infantilizar. Simplificar correntes,
costuras e cabelo para leitura pequena. Roxo no capuz/olhos/acabamentos, preto carvão
no traje, pequenos detalhes prateados. A cabeça maior e as pernas curtas distinguem
o chibi do modelo anime adulto. A proporção da geração é aproximada, não uma medida
de modelagem rígida; a folha de sprites apresenta pequenas variações.

## O que esta demonstração faz

- Respiração por deformação vertical sutil, ancorada nos pés.
- Piscadas com pose própria e intervalos variáveis.
- Boca em três estados, acompanhando o volume real de uma amostra de voz.
- Ciclo inicial de caminhada frontal com quatro poses e deslocamento opcional.
- Janela transparente separada, arraste pelo tronco e passagem de cliques fora dele.
- Mesmo contrato `window.setBoca(0..1)` e `window.setExpressao(nome)` do avatar antigo.
- Ponte HTTP local: `/controle?acao=boca&valor=0.7` e
  `/controle?acao=expressao&nome=pensando`.

As expressões alteram o estado/legenda. Ainda não há desenhos específicos de
pensando/feliz. As piscadas têm prioridade visual sobre a boca durante seus 145 ms.
O ciclo frontal serve para avaliar passos; deslocamento lateral definitivo precisa
de poses de perfil/3/4. A animação por sprites tem pequenas diferenças entre quadros;
não equivale a um rig articulado de produção.

A amostra usa **Microsoft Daniel / pt-BR**, sintetizada localmente no Windows.
A pasta de modelos Piper estava vazia na inspeção. O envelope foi calculado pela
função `_envelope` do `voz.py` atual. Não foi alterada a voz configurada do Yato.
O controle de boca por HTTP foi testado; o chat principal ainda abre o Natori.

## Preservação e próximos passos

Tudo desta entrega está dentro desta pasta. Nenhum arquivo existente de `avatar/`,
`avatar-electron/`, `assets/`, `app.py`, `avatar2d.py`, `voz.py`, `personalidade.py` ou
`memoria.py` foi alterado. `preservacao.json` registra os hashes dos arquivos
principais antes do trabalho. As alterações que já existiam no Git foram mantidas.

Personalidade e memória já possuem módulos no Python. Esta prévia não chama o
cérebro, não lê conversas/fatos pessoais e não cria uma memória paralela. Integração
futura: o cérebro emite estados semânticos; um controlador decide repouso, olhar e
locomoção; o renderizador só apresenta o estado. Memória continua no núcleo existente.

Depois de validar o visual: estabilizar a folha de modelo frontal/perfil/costas,
produzir peças com sobreposição para rigging ou sprites consistentes de caminhada,
ligar um seletor optativo de avatar ao `avatar2d.py` e só então evoluir o comportamento
autônomo (pausas, áreas livres, monitores, preferência do usuário e persistência).

## Verificação

`electron.exe . --selftest` executa verificações no Electron real, salva capturas e
um resultado em `qa/`, e fecha. Acrescente `--desktop` para testar o modo transparente.
O teste usa a porta 18138 e toca um trecho curto de áudio. Veja os resultados JSON
para as verificações efetivamente concluídas nesta máquina.

`gerar_envelope.py` recria o envelope se a amostra WAV for substituída.
As artes foram criadas pela ferramenta integrada `image_gen`, a partir das
referências locais, com fundo transparente. Prompts exatos em `prompts.txt`.
