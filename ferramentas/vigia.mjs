#!/usr/bin/env node
// VIGIA DO MAESTRO: garante que toda sessão aberta pelo Maestro siga até o fim, mesmo com o dono fora e
// com qualquer interrupção (queda de internet, falta de memória, máquina reiniciada, erro da API, sessão
// que parou para perguntar o que não é decisão). Script sem IA: cada rodada custa zero token.
// Roda a cada 10 minutos e no logon, oculto: Agendador de Tarefas no Windows (instalar/windows.ps1),
// launchd no Mac (instalar/mac.sh). Caminhos e projetos saem de maestro.config.json, nunca do código.
//
// REGRAS
// 1. Fila: <pastaFilas>/<fila>.json. Itens da fila: fila (nome), titulo, etapas (em ordem), e opcionais
//    prioridade (true passa na frente), orcaProjeto, acompanhamento (true = só agrupa sessões, o vigia
//    ignora) e exemplo (true = arquivo de exemplo, o vigia ignora). Itens da etapa: etapa (nome), projeto
//    (nome em maestro.config.json) ou pasta, nome (o --name da sessão; padrão <fila>-<etapa>), titulo (da
//    aba), modelo, esforco, prompt (arquivo em <pastaPrompts>; sem ele a etapa só é retomada), env,
//    mcpConfig, paralela (true = não espera a anterior), dependeDe ([{fila, etapa}] de outra fila) e
//    arquivoEstado (relativo a <pastaEstado>).
// 2. Estado: <pastaEstado>/<fila>/<etapa>.json. estado = fechada (com prova), esperando-dono (com
//    pergunta), esperando-cliente, pausada-pelo-dono ou em-andamento. A sessão grava fechada e
//    esperando-dono; o vigia grava em-andamento e nunca escreve por cima dos outros. aguardandoAte (ISO)
//    gravado pela sessão é espera de propósito. Estado que existe e não se lê vira "ilegivel": o vigia não
//    mexe na etapa e ela aparece assim na ultima-rodada.json.
// 3. A cada rodada, para as etapas ativas de cada fila (a primeira não fechada e as paralelas seguintes):
//    a. esperando-dono, esperando-cliente, pausada-pelo-dono: não faz nada.
//    b. sem sessão viva (~/.claude/sessions/<pid>.json com o pid vivo; pelo --name e, sem ele, por
//       qualquer Claude vivo na pasta da etapa: uma pasta, uma sessão): com transcrição, retoma com
//       claude --resume; sem, abre do zero com o prompt da etapa. Depois espera esperaAberturaMin.
//    c. sessão viva, sem falar há paradaMin e sem tarefa rodando (shell pendurado no claude): manda o
//       cutucão pela aba (só com Orca). A caixa de texto pode ter rascunho do dono: o vigia digita,
//       confere e, se a caixa não ficou só com o texto dele, apaga o que digitou e só registra.
//    d. no máximo maxCutucoes retomadas sem progresso (progressoRespostas respostas desde a última);
//       passou disso: esperando-dono com o motivo.
//    e. sem internet ou com o Orca fora do ar: só registra e tenta na próxima rodada.
//    f. freio: com menos de memoriaMinimaGB livres não abre nem retoma.
//    g. aba fechada pelo dono (sumiu, sem a máquina nem o Orca terem reiniciado): etapa fechada, nunca
//       reaberta. Etapa fechada com a sessão quieta há quietoParaFecharMin: a aba sai do Orca.
// 4. Prompt de retomada: <pastaPrompts>/retomada.txt ({ESTADO} vira o arquivo de estado da etapa).
//    Prompt de abertura e de retomada: uma linha, sem aspas.
// 5. Log: <pastaEstado>/vigia.log (uma linha JSON por ação) e <pastaEstado>/ultima-rodada.json (a
//    situação de cada etapa, que o Maestro lê ao abrir a sessão). Duas rodadas nunca correm juntas.
//
// USO
//   node ferramentas/vigia.mjs              uma rodada
//   node ferramentas/vigia.mjs --check      o que faria, sem fazer nada
//   node ferramentas/vigia.mjs --config <arquivo>
import fs from 'node:fs';
import path from 'node:path';
import { criarAbridor } from './abridor.mjs';
import { comandoClaude, lerPrompt } from './comando.mjs';
import { RAIZ, carregarConfig, lerJson } from './config.mjs';
import {
  bootMs, contarRespostas, listarProcessos, memoriaLivreGB, online, sessaoDaEtapa, sessoesVivas,
  tarefasRodando, transcricao, ultimaAtividade,
} from './sistema.mjs';
import {
  abaFechadaPeloDono, caixaDeTexto, cutucoesEfetivas, decidir, etapasAtivas, filasDoVigia, ordenarFilas,
  resolverEtapa, vigiaPodeGravar,
} from './vigia-regras.mjs';

const args = process.argv.slice(2);
const CHECK = args.includes('--check');
const iCfg = args.indexOf('--config');
const cfg = carregarConfig(iCfg >= 0 ? path.resolve(args[iCfg + 1]) : undefined);
if (!cfg) {
  console.error('vigia: falta maestro.config.json na raiz do repositório (copie de maestro.config.exemplo.json).');
  process.exit(0);
}
const MIN = 60_000;
fs.mkdirSync(cfg.pastaEstado, { recursive: true });
const LOG = path.join(cfg.pastaEstado, 'vigia.log');
const RODADA = path.join(cfg.pastaEstado, 'ultima-rodada.json');
const ARRUMADAS = path.join(cfg.pastaEstado, 'arrumadas.json');
// Registro do próprio vigia (aba, sessão, quando a aba foi vista): a sessão reescreve o arquivo de estado
// inteiro ao fechar, então o que o vigia precisa lembrar mora aqui, fora do alcance dela.
const REGISTRO = path.join(cfg.pastaEstado, 'sessoes.json');
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

let REG = {}; // fila/etapa -> { aba, sessionId, abaVistaEm }
const RESUMO = [];
function log(acao, dados = {}) {
  const linha = { em: new Date().toISOString(), acao, ...dados };
  RESUMO.push({ acao, ...dados });
  if (CHECK) { console.log(JSON.stringify(linha)); return; }
  fs.appendFileSync(LOG, JSON.stringify(linha) + '\n');
}
const nota = (acao, dados = {}) => { RESUMO.push({ acao, ...dados }); if (CHECK) console.log(JSON.stringify({ acao, ...dados })); };
const lerOu = (arquivo, padrao) => { try { return lerJson(arquivo); } catch { return padrao; } };

// ---------- trava de rodada única ----------
const TRAVA = path.join(cfg.pastaEstado, 'vigia.lock');
function pegarTrava() {
  const t = lerOu(TRAVA, null);
  if (t) {
    const viva = (() => { try { process.kill(t.pid, 0); return true; } catch { return false; } })();
    if (viva && Date.now() - t.desde < 25 * MIN) return false;
  }
  fs.writeFileSync(TRAVA, JSON.stringify({ pid: process.pid, desde: Date.now() }));
  return true;
}
const soltarTrava = () => { try { if (lerOu(TRAVA, {}).pid === process.pid) fs.unlinkSync(TRAVA); } catch {} };

// ---------- estado ----------
function lerEstado(arquivo) {
  if (!fs.existsSync(arquivo)) return null;
  try { return lerJson(arquivo); } catch { return { estado: 'ilegivel', arquivo }; }
}
function gravarEstado(etapa, novo, { forcar = false } = {}) {
  const atual = lerEstado(etapa.arquivoEstado);
  if (!vigiaPodeGravar(atual, { forcar })) return atual;
  const final = { ...(atual ?? {}), ...novo, atualizadoEm: new Date().toISOString() };
  if (CHECK) return final;
  fs.mkdirSync(path.dirname(etapa.arquivoEstado), { recursive: true });
  fs.writeFileSync(etapa.arquivoEstado, JSON.stringify(final, null, 2));
  return final;
}
function promptRetomada(fila, etapa) {
  const modelo = lerPrompt(path.join(cfg.pastaPrompts, 'retomada.txt'));
  const texto = modelo
    .replaceAll('{ESTADO}', etapa.arquivoEstado.replaceAll('\\', '/'))
    .replaceAll('{TRAVA}', path.join(RAIZ, 'ferramentas', 'trava.sh').replaceAll('\\', '/'));
  const destino = path.join(cfg.pastaEstado, 'prompts', `retomada-${fila.fila}-${etapa.etapa}.txt`);
  if (!CHECK) { fs.mkdirSync(path.dirname(destino), { recursive: true }); fs.writeFileSync(destino, texto); }
  return destino;
}

// ---------- ações ----------
async function abrirOuRetomar(ab, fila, etapa, st, t, respostas, acao) {
  const resume = acao === 'retomar' ? t.sessionId : null;
  const arquivoPrompt = resume ? promptRetomada(fila, etapa) : etapa.prompt;
  if (!CHECK || !resume) lerPrompt(arquivoPrompt); // valida antes de abrir
  const comando = comandoClaude(etapa, { resume, arquivoPrompt, modoPermissao: cfg.modoPermissao, mcpEstrito: cfg.mcpEstrito });
  const base = { fila: fila.fila, etapa: etapa.etapa, nome: etapa.nome };
  if (CHECK) return log(`faria:${acao}`, { ...base, resume, abridor: ab.tipo });
  const handle = ab.abrir({ projetoOrca: etapa.projetoOrca, tituloAba: etapa.titulo, comando, pasta: etapa.pasta });
  const chave = `${fila.fila}/${etapa.etapa}`;
  REG[chave] = { ...(REG[chave] ?? {}), aba: handle ?? REG[chave]?.aba ?? null, abaVistaEm: handle ? Date.now() : REG[chave]?.abaVistaEm ?? null };
  const cutucoes = st ? (st.cutucoes ?? 0) + 1 : 0; // a primeira abertura não é cutucão
  gravarEstado(etapa, {
    estado: 'em-andamento', sessionId: resume ?? st?.sessionId ?? null, abertoEm: Date.now(), cutucoes,
    aba: handle ?? null, respostasNaCutucada: respostas,
  });
  // Começou = sessão viva com o nome da etapa (passou da tela de confiança da pasta).
  let comecou = null;
  for (let s = 0; s < 90 && !comecou; s += 5) {
    await dormir(5000);
    try { ab.aceitarConfianca(handle); } catch {}
    const viva = sessoesVivas(listarProcessos(cfg.pastaEstado)).find((v) => v.sessao?.name === etapa.nome);
    if (viva?.sessao?.sessionId) comecou = viva.sessao.sessionId;
  }
  if (comecou) { gravarEstado(etapa, { sessionId: comecou }); REG[chave].sessionId = comecou; }
  log(acao, { ...base, resume, cutucoes, aba: handle, comecou: Boolean(comecou) });
}

async function cutucar(ab, fila, etapa, st, aba, viva, respostas) {
  const base = { fila: fila.fila, etapa: etapa.etapa, nome: etapa.nome, aba: aba.handle };
  const linhas = ab.tela(aba.handle);
  const antes = caixaDeTexto(linhas);
  if (antes === null) return log('caixa-nao-encontrada', base);
  const arquivo = promptRetomada(fila, etapa).replaceAll('\\', '/');
  const texto = `Maestro (vigia), em nome do dono: a sessao foi interrompida por motivo externo. Leia e siga agora o arquivo ${arquivo}`;
  const ocupada = viva.sessao?.status === 'busy' || linhas.some((l) => /esc to interrupt/i.test(l));
  if (CHECK) return log('faria:cutucar', { ...base, esc: ocupada, caixa: antes ? 'com-texto' : 'vazia' });
  if (ocupada) { ab.esc(aba.handle); await dormir(4000); }
  ab.enviar(aba.handle, texto);
  await dormir(2500);
  const depois = caixaDeTexto(ab.tela(aba.handle));
  const sem = (s) => (s ?? '').replace(/\s+/g, '');
  if (sem(depois) !== sem(texto)) { // havia rascunho do dono: apaga só o que o vigia digitou
    ab.enviar(aba.handle, '\u007f'.repeat(texto.length));
    return log('rascunho-do-dono', base);
  }
  ab.enviar(aba.handle, '\r');
  const cutucoes = (st?.cutucoes ?? 0) + 1;
  gravarEstado(etapa, { estado: 'em-andamento', ultimaCutucada: Date.now(), cutucoes, respostasNaCutucada: respostas });
  log('cutucar', { ...base, esc: ocupada, cutucoes });
}

// ---------- rodada ----------
async function cuidar(ctx, fila, etapa) {
  const { ab, vivas, procs, abasAgora, abasAntes, arrumadas } = ctx;
  const agora = Date.now();
  const st = lerEstado(etapa.arquivoEstado);
  const viva = sessaoDaEtapa(etapa, vivas);
  const chave = `${fila.fila}/${etapa.etapa}`;
  const reg = (REG[chave] ??= {});
  const sid = viva?.sessao?.sessionId ?? st?.sessionId ?? reg.sessionId ?? null;
  const t = transcricao(etapa, sid);
  const respostas = t ? contarRespostas(t.arquivo) : 0;
  const aba = ab.acharAba(etapa.nome, abasAgora, reg.aba ?? st?.aba, etapa.titulo);
  const abaVistaAntes = reg.abaVistaEm ?? null;
  if (viva) {
    if (viva.sessao?.sessionId) reg.sessionId = viva.sessao.sessionId;
    if (aba) { reg.aba = aba.handle; reg.abaVistaEm = agora; }
  }
  const base = { fila: fila.fila, etapa: etapa.etapa, nome: etapa.nome };

  // Adota a sessão viva da pasta (aberta por fora ou com outro nome) e registra a aba em que ela foi vista.
  if (viva && (!st || st.estado === 'em-andamento')) {
    gravarEstado(etapa, {
      estado: 'em-andamento', sessionId: viva.sessao.sessionId ?? st?.sessionId ?? null,
      ...(aba ? { aba: aba.handle, abaVistaEm: agora } : {}),
    });
  }
  let cutucoes = cutucoesEfetivas(st, respostas, cfg.progressoRespostas);
  if (cutucoes === 0 && (st?.cutucoes ?? 0) > 0) gravarEstado(etapa, { cutucoes: 0 });

  const dependenciaPendente = (etapa.dependeDe ?? []).map((d) => {
    const outro = lerEstado(path.join(cfg.pastaEstado, String(d.fila).replace(/[^A-Za-z0-9._-]/g, ''), `${String(d.etapa).replace(/[^A-Za-z0-9._-]/g, '')}.json`));
    return outro?.estado === 'fechada' ? null : `${d.fila}/${d.etapa}`;
  }).find(Boolean) ?? null;

  const d = decidir({
    st, agora, sessaoViva: Boolean(viva), tarefasRodando: viva ? tarefasRodando(viva.pid, procs).length : 0,
    temTranscricao: Boolean(t), temPrompt: Boolean(etapa.prompt && fs.existsSync(etapa.prompt)),
    ultimaAtividade: t ? ultimaAtividade(t) : null, cutucoes, dependenciaPendente,
    abaFechadaPeloDono: ab.tipo === 'orca' && abaFechadaPeloDono({
      aba: reg.aba ?? null, abaVistaEm: viva ? null : abaVistaAntes, abasAgora: abasAgora.map((a) => a.handle), abasAntes, bootEm: bootMs(),
    }),
    temAba: Boolean(aba), abaJaFechada: arrumadas.has(`${fila.fila}/${etapa.etapa}`),
    podeCutucar: ab.podeCutucar, podeFechar: ab.podeFechar, memoriaLivreGB: memoriaLivreGB(),
    paradaMs: cfg.paradaMin * MIN, esperaAberturaMs: cfg.esperaAberturaMin * MIN, quietoMs: cfg.quietoParaFecharMin * MIN,
    maxCutucoes: cfg.maxCutucoes, memoriaMinimaGB: cfg.memoriaMinimaGB,
  });

  switch (d.acao) {
    case 'abrir':
    case 'retomar':
      return abrirOuRetomar(ab, fila, etapa, st, t, respostas, d.acao);
    case 'cutucar':
      return cutucar(ab, fila, etapa, st, aba, viva, respostas);
    case 'esperando-dono': {
      const pergunta = d.motivo === 'sem-prompt-de-abertura'
        ? `A etapa ${etapa.etapa} da fila ${fila.fila} não tem sessão nem prompt de abertura (${etapa.prompt ?? 'sem prompt'}). O Maestro precisa escrever o prompt da etapa.`
        : `A etapa ${etapa.etapa} da fila ${fila.fila} (sessão ${etapa.nome}, pasta ${etapa.pasta}) foi retomada ${cutucoes} vezes sem avançar (${d.motivo}). O Maestro precisa olhar onde ela parou e decidir como seguir.`;
      gravarEstado(etapa, { estado: 'esperando-dono', pergunta, por: 'vigia' });
      return log('esperando-dono', { ...base, motivo: d.motivo });
    }
    case 'fechada-pelo-dono':
      gravarEstado(etapa, { estado: 'fechada', fechadaPor: 'dono', prova: 'aba fechada pelo dono no Orca', em: new Date().toISOString() });
      return log('fechada-pelo-dono', base);
    case 'fechar-aba':
      if (CHECK) return log('faria:fechar-aba', { ...base, aba: aba.handle });
      ab.fechar(aba.handle);
      arrumadas.add(`${fila.fila}/${etapa.etapa}`);
      return log('fechou-aba', { ...base, aba: aba.handle });
    case 'concluida':
      if (!aba) arrumadas.add(`${fila.fila}/${etapa.etapa}`); // nada a fechar: não volta a olhar
      return nota('concluida', base);
    case 'parada-sem-aba':
      return log('parada-sem-aba', { ...base, pid: viva?.pid, dica: 'sessao viva e parada; sem Orca o vigia nao digita nela' });
    default:
      return nota(d.acao, { ...base, ...(d.motivo ? { motivo: d.motivo } : {}) });
  }
}

function lerFilas() {
  let arquivos = [];
  try { arquivos = fs.readdirSync(cfg.pastaFilas).filter((f) => f.endsWith('.json')); } catch {}
  const filas = [];
  for (const f of arquivos.sort()) {
    try { filas.push(lerJson(path.join(cfg.pastaFilas, f))); } catch (e) { log('fila-ilegivel', { arquivo: f, erro: String(e.message).slice(0, 200) }); }
  }
  return filas;
}

async function rodada() {
  const ab = criarAbridor(cfg);
  if (!(await online())) return log('sem-internet');
  const pronto = ab.pronto();
  if (pronto !== true) return log('abridor-fora', { abridor: ab.tipo, erro: pronto?.erro });
  const procs = listarProcessos(cfg.pastaEstado);
  const vivas = sessoesVivas(procs);
  let abasAgora = [];
  try { abasAgora = ab.abas(); } catch (e) { log('abas-ilegiveis', { erro: String(e.message).slice(0, 200) }); }
  const abasAntes = lerOu(RODADA, {}).abas ?? [];
  const arrumadas = new Set(lerOu(ARRUMADAS, []));
  REG = lerOu(REGISTRO, {});
  const ctx = { ab, vivas, procs, abasAgora, abasAntes, arrumadas };

  for (const fila of ordenarFilas(filasDoVigia(lerFilas()))) {
    let etapas;
    try { etapas = fila.etapas.map((e) => resolverEtapa(fila, e, cfg)); } catch (e) { log('fila-com-erro', { fila: fila.fila, erro: e.message }); continue; }
    const estadoDe = (e) => lerEstado(e.arquivoEstado);
    for (const e of etapas) { // etapa fechada que ainda tem aba: o Maestro fecha o que abre
      if (ab.podeFechar && estadoDe(e)?.estado === 'fechada' && !arrumadas.has(`${fila.fila}/${e.etapa}`)) {
        try { await cuidar(ctx, fila, e); } catch (err) { log('erro', { fila: fila.fila, etapa: e.etapa, erro: String(err.message).slice(0, 300) }); }
      }
    }
    const ativas = etapasAtivas(etapas, estadoDe);
    if (!ativas.length) { nota('fila-concluida', { fila: fila.fila }); continue; }
    for (const e of ativas) {
      try { await cuidar(ctx, fila, e); } catch (err) { log('erro', { fila: fila.fila, etapa: e.etapa, erro: String(err.message).slice(0, 300) }); }
    }
  }
  if (!CHECK) {
    fs.writeFileSync(ARRUMADAS, JSON.stringify([...arrumadas], null, 2));
    fs.writeFileSync(REGISTRO, JSON.stringify(REG, null, 2));
    return abasAgora.map((a) => a.handle);
  }
  return null;
}

if (!CHECK && !pegarTrava()) process.exit(0);
let abas = null;
try {
  abas = await rodada();
} catch (e) {
  log('erro-da-rodada', { erro: String(e?.stack || e).slice(0, 500) });
} finally {
  if (!CHECK) {
    const anterior = lerOu(RODADA, {});
    fs.writeFileSync(RODADA, JSON.stringify({ em: new Date().toISOString(), abridor: cfg.abridor, abas: abas ?? anterior.abas ?? [], etapas: RESUMO }, null, 2));
    soltarTrava();
  }
}
