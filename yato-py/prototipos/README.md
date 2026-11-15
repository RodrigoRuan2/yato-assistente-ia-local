# Protótipos do Yato

Código e artes dos experimentos, organizados na branch `experiment/prototipos`.
Cada pasta mantém seu próprio ponto de entrada. Esta publicação não substitui
o aplicativo principal nem altera a instalação local.

| Versão | Pasta | Uso |
| --- | --- | --- |
| **Beta-1 preservado** | [avatar-chibi-beta-1](../avatar-chibi-beta-1/) | Referência aprovada: arte e animação originais, sem incorporar experimentos posteriores. |
| Prévia original | [avatar-chibi-preview](../avatar-chibi-preview/) | Primeiro estúdio de avaliação do chibi. Compartilha a porta do beta-1; abra um por vez. |
| Laboratório do avatar | [avatar-chibi-lab](../avatar-chibi-lab/) | Caminhada, pausas, efeitos, tamanho, quadros preparados e balão com comandos. |
| Rig 2D | [avatar-chibi-rig-lab](../avatar-chibi-rig-lab/) | Experimento de articulação separado, mantido para comparação. |
| Caminhada e repouso | [avatar-chibi-walk-lab](../avatar-chibi-walk-lab/) | Estudos de ciclo, braços, paradas, movimentos de repouso e efeitos. |
| Modelos de balão | [design/baloes-20261114](../design/baloes-20261114/) | Comparação visual: discreto, cartão de leitura e miniconversa. Abra `preview.html` no navegador. |
| **Só mini Yato atual** | [Branch própria](https://github.com/RodrigoRuan2/yato-assistente-ia-local/tree/experiment/mini-yato-solo/yato-py/mini-yato) | Avatar com IA sob demanda, memória individual, dois balões e opção de abrir o chat principal. |

## Executar os estudos visuais

No Windows, instale Node.js/npm e, a partir da raiz deste checkout:

```powershell
cd yato-py/avatar-electron
npm ci
cd ..
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
& .\avatar-electron\node_modules\electron\dist\electron.exe .\avatar-chibi-lab --monitor=1
```

Troque a última pasta por `avatar-chibi-rig-lab`, `avatar-chibi-walk-lab`,
`avatar-chibi-beta-1` ou `avatar-chibi-preview`. Acrescente `--desktop` para
o personagem transparente. Os estudos recentes aceitam `--monitor=1`; o beta-1
mantém o comportamento original de posicionamento. Os atalhos `.bat` antigos
também estão preservados; alguns abrem a segunda tela por padrão.

Portas locais: prévia/beta-1 **8138**, laboratório **8139**, rig **8140**,
caminhada **8141**. Feche instâncias que usem a mesma porta antes de abrir outra.

Os estudos visuais rodam sem carregar o modelo de IA. A conversa do laboratório
depende de um host compatível; esta branch não incorpora todas as alterações
recentes do chat Python. Para experimentar conversa e memória independentes,
use a branch **Só mini Yato** indicada na tabela.

## Preservação e privacidade

Os **29 arquivos do beta-1 local** foram conferidos contra o manifesto original
antes desta publicação. Código, artes e metadados públicos do beta-1 permanecem
com os bytes originais, verificáveis por SHA-256:

```powershell
python yato-py/prototipos/verificar_beta1.py
```

O [manifesto público](beta-1-publicado.sha256.json) cobre somente os arquivos
publicados. Áudio de demonstração, logs, capturas de testes, resultados gerados
e metadados locais de preservação foram omitidos. Assim, a amostra de voz do
estúdio antigo precisa ser fornecida localmente para reproduzir áudio; as artes
e animações continuam disponíveis. O backup completo do beta-1 fica local.

Conversas, memórias, configurações, localização, associações de pastas,
credenciais, perfis de uso e capturas da área de trabalho não fazem parte desta
publicação. Exemplos de cidade e caminhos em testes/documentação foram
generalizados na cópia pública. Cada instalação guarda seus dados localmente.

Os READMEs de cada estudo registram sua evolução histórica. Referências a
`avatar-releases/`, medições e imagens de QA apontam para materiais locais
omitidos; não são downloads incluídos neste catálogo. A publicação não muda
automaticamente os experimentos para o comportamento do mini atual.

## Testes sem abrir janelas

Exemplos, a partir da raiz:

```powershell
node yato-py/avatar-chibi-lab/qa/test-motion.cjs
node yato-py/avatar-chibi-lab/qa/test-natural.cjs
node yato-py/avatar-chibi-walk-lab/qa/test-idle.cjs
node yato-py/avatar-chibi-rig-lab/qa/test-rig-motion.cjs
```

Os demais `qa/test-*.cjs` são verificações de lógica. Scripts de integração e
renderização precisam de Electron e podem gerar arquivos locais ignorados pelo
Git; confira seus parâmetros de monitor antes de executá-los.
