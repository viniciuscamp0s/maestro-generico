---
name: route
version: 1.0.0
description: |
  Loop de dois modelos para tarefas de implementação: Claude planeja e revisa,
  o Codex CLI (GPT, na assinatura do ChatGPT do usuário) escreve o código.
  Só ativa com o comando explícito /route "<tarefa>", nunca em conversa normal.
  Ideal para trabalho de implementação delimitado (ex.: "adiciona validação X",
  "cria endpoint Y", "escreve testes para Z"). Não é para discussão de arquitetura
  nem para tarefa vaga sem escopo claro.
license: MIT
compatibility: claude-code
allowed-tools:
  - Bash
  - Read
  - Write
  - Grep
  - Glob
  - AskUserQuestion
---

# /route: Claude planeja e revisa, o Codex executa

Você é o diretor técnico. O Codex (GPT, via Codex CLI) é o executor. A regra de
ouro: **você nunca escreve o código de produção diretamente**. Você escreve o
plano, delega a implementação ao Codex e revisa o resultado como adversário até
aprovar.

Por que vale a pena: o código, que é a parte mais longa, sai na assinatura do
ChatGPT, e a do Claude fica com o plano curto e a revisão.

## 0. Pré-requisitos (checar os dois antes de qualquer coisa)

### 0.1 Localizar o Codex

Resolva o executável antes de cada execução (vale para Mac, Linux e Windows):

```bash
CODEX="$(command -v codex 2>/dev/null)"
# Windows com o app desktop da OpenAI: o binário mora numa pasta com hash que muda a cada atualização
if [ -z "$CODEX" ] && [ -n "$LOCALAPPDATA" ]; then
  BASE="$(cygpath -u "$LOCALAPPDATA" 2>/dev/null || echo "$LOCALAPPDATA")/OpenAI/Codex/bin"
  for d in $(ls -t -d "$BASE"/*/ 2>/dev/null); do
    if [ -f "$d/codex.exe" ] && [ -f "$d/codex-code-mode-host.exe" ]; then CODEX="$d/codex.exe"; break; fi
  done
fi
echo "${CODEX:-CODEX NAO ENCONTRADO}"
```

No Windows com o app desktop, escolha sempre a pasta mais recente que tem **os
dois** executáveis: durante uma atualização o app deixa pastas incompletas (só
`codex.exe`) e o `exec` nelas falha sem escrever nada.

Se `$CODEX` vier vazio, pare e passe ao usuário a instalação (README, seção
"Skill /route"): no Mac ou Linux, `curl -fsSL https://chatgpt.com/codex/install.sh | sh`
e depois `codex login` com a conta do ChatGPT.

O modelo é o padrão configurado em `~/.codex/config.toml`. Não passe `-m`, a
menos que o usuário peça outro modelo (ou na situação do passo 2.2).

Caminho da pasta para o `-C`: no Git Bash do Windows o `.exe` entende só o
formato Windows; no Mac e no Linux, o caminho normal.

```bash
PASTA="$(pwd -W 2>/dev/null || pwd)"
```

### 0.2 Verificar se a pasta atual é um repositório git

O passo 3 revisa por `git diff`, e o git é a **única rede de segurança** contra o
Codex estragar código existente:

```bash
git rev-parse --is-inside-work-tree 2>/dev/null
```

- **É repo, árvore limpa** → segue normal.
- **É repo, com alterações não commitadas** → avise o usuário que o diff do Codex
  vai se misturar ao trabalho dele e pergunte se quer commitar ou guardar antes.
  Nunca commitar nem guardar por conta própria.
- **Não é repo** → pare e pergunte (AskUserQuestion) antes de rodar o Codex:
  `git init` na pasta (recomendado: dá diff e volta atrás), seguir sem rede de
  segurança (a revisão do passo 3 vira leitura dos arquivos) ou abortar. Pasta só
  com arquivos novos criados do zero pode seguir sem git; se já existe código do
  usuário lá, insista no `git init`.

## 1. Reformular a tarefa em PLAN.md

Leia o pedido (`/route "<tarefa>"`). Explore o código relevante (Read, Grep,
Glob) o suficiente para escrever um plano concreto e escopado, não genérico.
Escreva em `PLAN.md`, na raiz da pasta de trabalho:

- Objetivo em 1 ou 2 frases
- Arquivos que devem ser tocados (caminhos exatos, já verificados)
- O que implementar, passo a passo, sem ambiguidade
- Critério de pronto (o que precisa ser verdade para o plano estar completo)
- Fora de escopo (o que o Codex NÃO deve tocar)

Plano curto: decisões, arquivos e testes. Nunca o código pronto dentro do plano
(o Codex escreveria tudo de novo e a economia some).

Se a tarefa for vaga demais para escopar sem chutar, pare e pergunte antes de
escrever o plano (AskUserQuestion).

Se já existir um `PLAN.md` na pasta que não é seu (outra sessão trabalhando na
mesma pasta), **não sobrescreva**: use `PLAN-<frente>.md` e guarde o nome:

```bash
PLAN_FILE="PLAN.md"   # ou PLAN-<frente>.md, se PLAN.md for de outra sessão
```

## 2. Delegar ao Codex

Modo não interativo, escrita liberada só na pasta de trabalho, sem esperar
aprovação (não há terminal interativo nesta chamada):

```bash
cd "<raiz do repo>" && PASTA="$(pwd -W 2>/dev/null || pwd)" && "$CODEX" exec -C "$PASTA" -s workspace-write -c model_reasoning_effort=high \
  "Implemente o $PLAN_FILE exatamente como está escrito. Não toque em nada fora do escopo descrito nele. Escreva o código." \
  < /dev/null
```

Por que cada pedaço:
- **Sem `-a never`.** A flag não existe mais no `exec`; ele já roda sem aprovação
  (a saída mostra `approval: never`).
- **`-C` é obrigatório.** Sem ele o Codex recusa com `Not inside a trusted directory`.
- **`cd` no mesmo comando.** A pasta da ferramenta Bash volta ao início entre
  chamadas; não confie que "já está na pasta".
- **`< /dev/null`.** Fecha a entrada, para o Codex não ficar esperando texto.

Deixe rodar até terminar. Guarde a saída: ela traz o `session id`, útil para
retomar no passo 4.

### 2.1 Se o Codex bater no limite de uso da conta

A saída mostra, textualmente, `You've hit your usage limit` com o horário em que
volta. **Só essa mensagem** conta como limite de uso; qualquer outro erro
(binário não encontrado, sandbox, rede, pasta não confiável) é problema de
ambiente e se investiga normalmente (volte ao passo 0.1).

Confirmado o limite, pergunte ao usuário se prefere esperar o horário de volta
ou que você escreva o código nesta rodada. Se ele escolher você:

- Siga o `$PLAN_FILE` com o mesmo rigor que cobraria do Codex: passo a passo, sem
  inventar, sem expandir escopo.
- Faça o passo 3 sobre o próprio diff, como se fosse de outra pessoa.
- Registre no relatório e no commit que esta rodada foi escrita pelo Claude por
  causa do limite do Codex.
- É exceção desta rodada: na próxima tarefa, volta a ser o Codex quem escreve.

### 2.2 Se o modelo estiver lotado

`Selected model is at capacity` **não é limite de uso**: a conta tem cota, o
servidor daquele modelo é que está cheio. Tente de novo uma vez; se repetir, rode
a mesma chamada com `-m <outro modelo da OpenAI disponível na conta>` (flag do
`exec`, antes de `resume` quando for retomada). O Codex continua escrevendo e você
continua revisando. Registre no relatório qual modelo saiu a rodada. Confira
sempre a mensagem de erro de agora, nunca a de uma rodada anterior.

## 3. Revisar como adversário

Leia o que o Codex mudou com ceticismo:

- **Em repo git**: `git status` + `git diff` (e `git diff --stat` se for grande).
- **Fora de repo**: liste os arquivos criados ou alterados e leia cada um por
  inteiro. Sem diff, a leitura precisa ser mais cuidadosa, não menos.

Procurando:

- O plano foi seguido à risca, ou o Codex inventou ou expandiu escopo?
- Bugs e casos de borda não tratados
- Segurança: segredo escrito no código, entrada sem validação, rota ou ação sem
  checagem de quem pode usar, consulta montada com texto do usuário. Problema de
  segurança reprova a rodada
- Complexidade desnecessária, código morto, abstração prematura
- Falta de teste onde o plano pedia teste

Não corrija você mesmo. Seu papel aqui é só encontrar o problema.

## 4. Iterar ou aprovar

- **Achou problema real**: escreva a correção específica (o que está errado e o
  que deve virar) e rode de novo, retomando a sessão anterior para manter o
  contexto:
  ```bash
  cd "<raiz do repo>" && PASTA="$(pwd -W 2>/dev/null || pwd)" && "$CODEX" exec -C "$PASTA" -s workspace-write resume --last \
    -c model_reasoning_effort=high "<correção específica aqui>" < /dev/null
  ```
  Atenção à ordem: `-C` e `-s` são do `exec` e vêm **antes** de `resume`;
  `--last` e `-c` são do `resume` e vêm depois. Trocar a ordem dá
  `unexpected argument '-s'`. Volte ao passo 3.
- **Aprovou**: siga para o passo 5.
- **Trava**: depois de 3 rodadas sem aprovação, pare e pergunte ao usuário se quer
  continuar, assumir manualmente ou abortar. Nunca gire o loop sozinho gastando
  cota indefinidamente.

## 5. Fechar

Apague o `$PLAN_FILE` (era só material de trabalho), a menos que o usuário peça
para manter, e confira com `git ls-files` que ele não entrou num commit. Resuma ao
usuário: o que foi pedido, quantas rodadas levou, o que mudou (arquivos) e o diff
final. **Não faça commit nem push**: isso é decisão do usuário, mesmo com o
resultado aprovado.
