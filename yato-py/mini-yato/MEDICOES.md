# Medição local — 14/11/2026

Execução no Windows, projeto em HD SATA e testes no monitor principal (monitor 1).
Valores agregados, sem transcrições, perfis pessoais ou caminhos da máquina.

| Condição | RAM do Yato | RAM Yato + Ollama | CPU total aproximada | VRAM do modelo |
|---|---:|---:|---:|---:|
| Aplicativo completo + avatar + qwen3:8b carregado | 1.932 MiB | 2.093 MiB | 14,9% | 5,20 GiB |
| Mini inicial, sem carregar IA | 669 MiB | 833 MiB | 2,1% | 0 |
| Mini final aberto, modelo descarregado | 679 MiB | 824 MiB | 4,7% | 0 |

Nesse recorte, o total de RAM residente caiu aproximadamente 61%. Ainda há custo
relevante do Electron e dos sprites; “leve” não significa consumo mínimo.

## Método e limites

- RAM: soma do working set da árvore de processos do Yato, mais os processos
  Ollama. O serviço do Ollama foi incluído em todos os cenários, independente
  de qual aplicativo o iniciou. Páginas compartilhadas podem ser somadas mais
  de uma vez; esses números não equivalem à memória física exclusiva.
- CPU: variação do tempo de CPU dos processos durante a amostragem, dividida
  pelo tempo de parede e pelo número de processadores lógicos. As amostras
  iniciais tinham arredondamento por ponto percentual; a coleta final preserva
  casas decimais. São valores indicativos, não um benchmark de CPU de precisão.
- 13 amostras válidas no aplicativo completo; 15 no mini inicial e 15 no mini
  final. As duas amostras do aplicativo completo após seu encerramento foram
  descartadas. Uma coleta intermediária teve encerramento de janelas e não
  fundamenta a comparação final. O mini final teve prontidão, visibilidade e
  permanência no monitor 1 confirmadas depois da coleta.
- Não foram fixados clocks, carga do restante do PC, fase da animação ou caches.
  Testes sequenciais curtos, sem repetições estatísticas. Não interpretar a
  diferença de CPU como promessa de economia constante.
- VRAM do modelo vem de `/api/ps` do Ollama. A leitura global do driver também
  foi coletada, mas não é atribuída exclusivamente ao Yato e não está na tabela.
- O modelo do mini carregou apenas ao receber mensagem, respondeu, realizou
  cálculo por ferramenta e persistiu um fato fictício no perfil de QA. O
  processo Python de inferência encerrou após a resposta e `/api/ps` confirmou
  o descarregamento automático do modelo depois de 30 segundos sem uso.
- Durante uma resposta, o mini continua precisando da memória do modelo. A
  redução principal acontece entre conversas, com custo de nova carga na próxima.

## Verificações

- Conversa real com qwen3:8b, continuidade de contexto e cálculo correto.
- Memória de preferência fictícia salva em perfil de QA separado.
- IPC, ponte autenticada, espera durante resposta, ferramentas de cálculo e
  abertura de Google simulada, rejeição de ação desconhecida.
- Comentários de 11h e 23h, intervalo padrão de 30–60 minutos.
- Beta-1: 29 arquivos verificados por hash, nenhuma alteração.
- Nenhuma conversa, memória pessoal, perfil ou captura de desktop nesta publicação.
