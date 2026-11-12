# Maestro para Claude Code

Um jeito de trabalhar com o Claude Code em que **você fala com um agente só, o Maestro**, e ele organiza
o resto: entende o pedido, divide em etapas, escolhe o modelo certo para cada etapa (o mais forte só onde
precisa, o mais barato onde dá), abre as sessões de trabalho, acompanha cada uma até o fim e devolve a
você só o que é decisão sua.

Junto vem o **vigia**: um script sem IA (custo zero) que roda a cada 10 minutos e retoma sozinho qualquer
sessão que caiu no meio (internet, falta de memória, computador reiniciado, erro da API), do ponto onde
parou.

## O que tem aqui

| Peça | Para que serve |
|---|---|
| `CLAUDE.md` | A constituição: regras que o Claude segue em toda sessão aberta nesta pasta |
| `MAESTRO/maestro.md` | O papel do Maestro: como enquadra, divide, escolhe modelo, abre e fecha sessões |
| `MAESTRO/como-penso.md` | As regras universais de como o dono pensa (cresce com as suas regras) |
| `MAESTRO/como-falar-comigo.md` | Como o Maestro fala com você |
| `MAESTRO/regua-de-qualidade.md` | O que reprova uma entrega |
| `MAESTRO/formato-das-entregas.md` | Como cada tipo de entrega chega a você |
| `MAESTRO/sobre-o-dono.md` | Quem você é e o seu negócio: o Maestro preenche na primeira sessão, com uma pergunta só |
| `MAESTRO/projetos.md` | Seus projetos, onde mora o código e os comandos de teste e build: o Maestro preenche sozinho |
| `DIARIO.md` | Estado atual e diário de decisões |
| `ferramentas/vigia.mjs` | O vigia (retoma sessões, fecha as abas do que terminou) |
| `ferramentas/trava.sh` | Um trabalho pesado por vez na máquina (testes, build, publicação) |
| `ferramentas/abridor.mjs` | O único arquivo que depende do Orca |
| `ferramentas/publicar.mjs`, `ferramentas/varredura.mjs` | Publicar no GitHub sem vazar dado privado (varredura sem IA + gancho de push) |
| `ferramentas/filas/`, `ferramentas/prompts/` | Filas de trabalho e prompts (com exemplos) |
| `ferramentas/instalar/` | Instaladores do vigia: Windows (Agendador de Tarefas) e Mac (launchd) |

## Requisitos

- **Claude Code** instalado e logado (`claude` funcionando no terminal): https://docs.claude.com/claude-code
- **Node.js 20 ou mais novo**: https://nodejs.org
- **Git**. No Windows, instale o **Git for Windows** (traz o Git Bash, que a trava usa): https://git-scm.com
- **Orca** (recomendado, para o Maestro abrir e fechar abas sozinho). Sem Orca funciona no VS Code, com
  menos automação (tabela mais abaixo).
- **Windows 10/11 ou macOS.**

## Instalação, passo a passo

1. **Aceite o convite** do repositório que chegou no seu e-mail do GitHub (botão "View invitation" e
   depois "Accept invitation").
2. **Escolha a pasta-mãe** onde vão morar os seus projetos (exemplo: `Documentos/Maestro`). O Maestro vale
   para toda sessão aberta nela e nas subpastas.
3. **Clone o repositório nessa pasta.** Abra o terminal (no Windows, o Git Bash; no Mac, o Terminal) e rode:

   ```
   git clone https://github.com/<dono-do-repositorio>/maestro-generico.git Maestro
   cd Maestro
   ```

4. **Instale o vigia.**
   - Windows (PowerShell, dentro da pasta do Maestro):
     ```
     powershell -NoProfile -ExecutionPolicy Bypass -File ferramentas\instalar\windows.ps1
     ```
   - Mac (Terminal, dentro da pasta do Maestro):
     ```
     bash ferramentas/instalar/mac.sh
     ```
   O instalador cria o `maestro.config.json` a partir do exemplo, se ainda não existir.
5. **Confira:**
   ```
   npm test
   node ferramentas/vigia.mjs --check
   ```
   O primeiro tem que terminar com `fail 0`. O segundo mostra o que o vigia faria agora, sem fazer nada.
6. **Abra uma sessão do Claude Code na pasta do Maestro** (no Orca ou no VS Code) e peça qualquer coisa.
   Ela já nasce como Maestro. Na primeira vez ele faz **uma pergunta só**, para saber quem você é e o que
   você faz: se o Claude já trabalhou com você nesta máquina, ele mostra um resumo do que já sabe e você só
   confirma; se não, você escreve em poucas linhas ou manda um site, um perfil ou um currículo. O resto ele
   preenche sozinho: seu sistema, suas ferramentas, seus projetos (com os comandos de teste e build) e o
   `maestro.config.json`. Como ele fala com você, dá prazo e cota, decide e entrega já vem configurado.
   O ideal é cada projeto ser uma subpasta da pasta-mãe (exemplo: `Maestro/meu-saas`), cada um com o
   próprio git.

> **Para valer em qualquer pasta** (projetos fora da pasta-mãe), acrescente esta linha ao seu
> `~/.claude/CLAUDE.md`, trocando pelo caminho real: `@<caminho da pasta do Maestro>/CLAUDE.md`

## O que funciona no Orca e no VS Code

| | Orca | VS Code (sem Orca) |
|---|---|---|
| O Maestro enquadra, divide em etapas, escolhe o modelo, dá previsão | Sim | Sim |
| Abre sessões de execução sozinho, uma aba por etapa | Sim | Não: executa na própria sessão e usa subagentes para leitura em volume |
| Troca de modelo no meio do trabalho | Abre a etapa nova no modelo certo | Recomenda `/model` na hora |
| Vigia retoma sessão que caiu | Sim, numa aba nova do Orca | Sim, numa janela de terminal solta |
| Vigia cutuca sessão viva que parou sem motivo | Sim, digitando na aba | Não: registra em `estado/ultima-rodada.json` e o Maestro avisa você |
| Aceita a tela "confia nesta pasta?" sozinho | Sim | Não: abra cada pasta de projeto uma vez com `claude` e aceite |
| Fecha a aba quando a etapa termina | Sim | Não se aplica |
| Trava de trabalho pesado | Sim | Sim |

Tudo que depende do Orca mora em `ferramentas/abridor.mjs`. Para usar outra ferramenta de abas no lugar
dele, é esse o único arquivo a mudar.

## Como o Maestro trabalha com você

- Você pede; na primeira resposta ele dá um nome à demanda, a **previsão de entrega** (dia e hora) e o
  **consumo estimado da cota semanal** da sua assinatura, em %. Se um dos dois for estourar, ele avisa antes.
- Toda resposta final vem em linguagem simples, na ordem situação atual, contexto e próximos passos, e
  termina repetindo tudo que está pendente com você: você nunca precisa procurar nada mais para cima no chat.
- O que cabe em poucas respostas ele resolve ali. O que é maior vira uma **fila** em
  `ferramentas/filas/<demanda>.json`, com uma etapa por entrega, e o vigia abre e acompanha cada uma.
- Ele só te pergunta **decisão** (dinheiro, escopo, prioridade, texto que vai para cliente), sempre com o
  trecho exato e uma recomendação. Acesso, permissão e pasta ele resolve.
- Quando você diz "sempre" ou "nunca", ele grava a regra em `MAESTRO/como-penso.md` na hora.

## Filas, estado e vigia (para quem quer entender por dentro)

- **Fila** (`ferramentas/filas/*.json`): etapas em ordem. Etapa com `"paralela": true` roda junto com a
  anterior. Exemplo comentado em `ferramentas/filas/exemplo.json` (o vigia ignora arquivos com
  `"exemplo": true`).
- **Estado** (`estado/<fila>/<etapa>.json`): a sessão grava `fechada` (com a prova) ou `esperando-dono`
  (com a pergunta); o vigia grava `em-andamento` e nunca escreve por cima do que a sessão decidiu.
- **Vigia** (`ferramentas/vigia.mjs`): as regras completas estão no cabeçalho do arquivo. Log em
  `estado/vigia.log`; a situação de cada etapa em `estado/ultima-rodada.json`.
- **Trava** (`ferramentas/trava.sh`): `bash ferramentas/trava.sh pesada npm test` roda o comando quando
  for a vez dele; se outra sessão estiver usando, espera até 8 minutos.

## Ligar, desligar e remover o vigia

| | Windows | Mac |
|---|---|---|
| Desligar | `schtasks /Change /TN "Vigia do Maestro" /DISABLE` | `launchctl bootout gui/$(id -u)/com.maestro.vigia` |
| Religar | `schtasks /Change /TN "Vigia do Maestro" /ENABLE` | `bash ferramentas/instalar/mac.sh` |
| Remover | `powershell -NoProfile -ExecutionPolicy Bypass -File ferramentas\instalar\windows.ps1 -Remover` | `bash ferramentas/instalar/mac.sh --remover` |

## Segurança

- **Modo de permissão.** O padrão é `"modoPermissao": "acceptEdits"`: as sessões abertas pelo vigia
  editam arquivos sem perguntar, mas **pedem licença para rodar comando**. É o modo seguro para começar,
  com um custo: a sessão para esperando você quando precisa rodar um teste ou um build.
- **Autonomia total (`"bypassPermissions"`) é escolha sua, consciente.** Nesse modo a sessão não pede
  licença para nada e segue de madrugada sem você. Só ligue se as três coisas forem verdade:
  1. nenhuma credencial com poder de apagar ou cobrar (banco de produção, painel de pagamento, conta de
     anúncio) está ao alcance da sessão sem uma trava no próprio sistema;
  2. tudo que importa está no git e com cópia fora da máquina;
  3. de preferência, as sessões rodam num ambiente isolado (máquina virtual, contêiner ou usuário separado
     do sistema operacional).
  Para ligar: troque o valor no `maestro.config.json`. Para voltar: troque de novo.
- **Tela "confia nesta pasta?".** Com Orca, o vigia aceita essa tela sozinho, mas só nas pastas que você
  mesmo colocou nas filas. Nunca coloque numa fila uma pasta de origem desconhecida (código baixado da
  internet, por exemplo).
- **Segredos** moram num `.env` fora do git e nunca vão para o chat. O `.gitignore` já recusa `.env`,
  `maestro.config.json` e a pasta `estado/`.
- O vigia só abre as pastas listadas nas suas filas e recusa caminho, nome ou valor fora do formato antes
  de montar qualquer comando.
- **Compartilhar sem vazar.** Se você publica o seu Maestro num repositório (para a equipe, por exemplo),
  publique sempre por `node ferramentas/publicar.mjs "mensagem"`. Ele roda a varredura de privacidade
  (e-mail, telefone, caminho da sua pasta pessoal, IP, chave e token, mais os termos que você listar), os
  testes, o commit e o push, e liga o gancho `.githooks/pre-push`, que varre de novo cada commit antes de
  subir. Os seus termos privados (nomes de clientes, empresas, pessoas) e os arquivos de onde eles são
  lidos ficam no `publicar.local.json`, que nunca vai para o git: o formato está no cabeçalho de
  `ferramentas/varredura.mjs`.

## Problemas comuns

| Sintoma | O que fazer |
|---|---|
| `vigia: falta maestro.config.json` | Rode o instalador do passo 6 ou copie `maestro.config.exemplo.json` para `maestro.config.json` |
| `abridor-fora` no `estado/vigia.log` | O Orca está fechado ou o caminho dele mudou: abra o Orca, ou preencha `orca.executavel` com o caminho de `which orca` (Mac) / `where orca` (Windows) |
| `fila-com-erro ... não está em maestro.config.json` | O `projeto` da etapa não bate com nenhum `nome` em `projetos` |
| No Mac, o vigia não acha o `claude` | Rode o instalador de novo depois de instalar o Claude Code (ele grava o PATH no LaunchAgent) |
| No Windows, a trava não roda | Instale o Git for Windows e rode a trava pelo Git Bash |
