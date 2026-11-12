// REGRAS DO VIGIA QUE SE TESTAM: as decisões puras do vigia.mjs, sem tocar disco, processo nem Orca.
// Teste: node --test ferramentas/testes/
import path from 'node:path';
import { expandir } from './config.mjs';

// Estados que a sessão (ou o dono) decide: o vigia nunca escreve por cima deles.
export const ESTADOS_DA_SESSAO = ['fechada', 'esperando-dono', 'esperando-cliente', 'pausada-pelo-dono'];
// Estados em que o vigia não faz nada na etapa (nem abre, nem retoma, nem cutuca).
export const ESTADOS_DE_ESPERA = ['esperando-dono', 'esperando-cliente', 'pausada-pelo-dono'];

export function vigiaPodeGravar(atual, { forcar = false } = {}) {
  if (atual?.estado === 'ilegivel') return false;
  if (forcar) return true;
  return !(atual && ESTADOS_DA_SESSAO.includes(atual.estado));
}

// Filas de que o vigia cuida: com lista de etapas, sem "acompanhamento": true (fila que só agrupa
// sessões) e sem "exemplo": true (o arquivo de exemplo que vem no repositório).
export function filasDoVigia(filas) {
  return filas.filter((f) => f && typeof f === 'object' && Array.isArray(f.etapas) && f.acompanhamento !== true && f.exemplo !== true);
}

// "prioridade": true passa na frente (na ordem de priorizadaEm); o resto na ordem de sempre.
export function ordenarFilas(filas) {
  const quando = (f) => Date.parse(f?.priorizadaEm ?? '') || 0;
  return filas
    .map((fila, i) => ({ fila, i }))
    .sort((a, b) => {
      const pa = a.fila?.prioridade === true ? 0 : 1;
      const pb = b.fila?.prioridade === true ? 0 : 1;
      if (pa !== pb) return pa - pb;
      if (pa === 0 && quando(a.fila) !== quando(b.fila)) return quando(a.fila) - quando(b.fila);
      return a.i - b.i;
    })
    .map(({ fila }) => fila);
}

// As etapas de que o vigia cuida agora: a primeira não fechada e, junto com ela, as seguintes marcadas
// "paralela": true (não dependem da anterior e nunca esperam na fila). Para na primeira etapa em sequência.
export function etapasAtivas(etapas, estadoDe) {
  const ativas = [];
  let achouAberta = false;
  for (const e of etapas) {
    const fechada = estadoDe(e)?.estado === 'fechada';
    if (!achouAberta) {
      if (fechada) continue;
      achouAberta = true;
      ativas.push(e);
      continue;
    }
    if (e.paralela !== true) break;
    if (!fechada) ativas.push(e);
  }
  return ativas;
}

// Resolve a etapa da fila com a configuração: pasta pelo projeto, prompt relativo à pasta de prompts,
// estado em <pastaEstado>/<fila>/<etapa>.json (ou o arquivoEstado combinado). Lança erro se faltar algo.
const ID = /^[A-Za-z0-9._-]{1,80}$/;
export function resolverEtapa(fila, etapa, config) {
  if (!ID.test(fila.fila ?? '')) throw new Error(`fila sem nome válido (a-z, 0-9, ponto, hífen): ${JSON.stringify(fila.fila)}`);
  if (!ID.test(etapa.etapa ?? '')) throw new Error(`etapa sem nome válido em ${fila.fila}: ${JSON.stringify(etapa.etapa)}`);
  const projeto = etapa.projeto ? config.projetos.find((p) => p.nome === etapa.projeto) : null;
  if (etapa.projeto && !projeto) throw new Error(`projeto ${JSON.stringify(etapa.projeto)} não está em maestro.config.json`);
  const pasta = etapa.pasta ? expandir(etapa.pasta) : projeto?.pasta;
  if (!pasta) throw new Error(`etapa ${fila.fila}/${etapa.etapa} sem pasta nem projeto`);
  const nome = etapa.nome ?? `${fila.fila}-${etapa.etapa}`;
  if (!ID.test(nome)) throw new Error(`nome de sessão inválido: ${JSON.stringify(nome)}`);
  const prompt = etapa.prompt ? path.resolve(config.pastaPrompts, etapa.prompt) : null;
  const arquivoEstado = etapa.arquivoEstado
    ? path.resolve(config.pastaEstado, etapa.arquivoEstado)
    : path.join(config.pastaEstado, fila.fila, `${etapa.etapa}.json`);
  const rel = path.relative(config.pastaEstado, arquivoEstado);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`arquivoEstado fora da pasta de estado: ${etapa.arquivoEstado}`);
  return {
    ...etapa, nome, pasta, prompt, arquivoEstado,
    titulo: etapa.titulo ?? nome,
    projetoOrca: projeto?.orcaProjeto ?? fila.orcaProjeto ?? config.orca?.projetoPadrao ?? null,
  };
}

// Aba fechada pelo dono: a aba em que a sessão foi vista viva sumiu, a máquina não reiniciou desde então
// e o Orca também não (outra aba vista na rodada anterior continua lá). Fechar a aba é decisão dele.
export function abaFechadaPeloDono({ aba, abaVistaEm, abasAgora, abasAntes, bootEm }) {
  if (!aba || !abaVistaEm) return false;
  if (abasAgora.includes(aba)) return false;
  if (!(bootEm < abaVistaEm)) return false;
  return abasAntes.some((h) => h !== aba && abasAgora.includes(h));
}

// Texto da caixa de entrada do Claude Code na tela: da última linha com ❯ até a régua de baixo.
export function caixaDeTexto(linhas) {
  let k = -1;
  for (let i = linhas.length - 1; i >= 0; i--) if (/^\s*❯/.test(linhas[i])) { k = i; break; }
  if (k < 0) return null;
  const partes = [];
  for (let i = k; i < linhas.length && !/^─{10,}\s*$/.test(linhas[i]); i++) {
    partes.push(i === k ? linhas[i].replace(/^\s*❯\s?/, '') : linhas[i].trim());
  }
  return partes.join(' ').trim();
}

// Retomadas que contam para o limite: a sessão que escreveu progressoRespostas desde a última zera o contador.
export function cutucoesEfetivas(st, respostasAgora, progressoRespostas) {
  const cut = st?.cutucoes ?? 0;
  if (cut > 0 && respostasAgora - (st?.respostasNaCutucada ?? 0) >= progressoRespostas) return 0;
  return cut;
}

// A decisão da rodada para uma etapa. Devolve { acao, motivo? }. Ações:
//   ilegivel | concluida | fechar-aba | espera | freio | dependencia | fechada-pelo-dono |
//   aguardando-abertura | esperando-dono | abrir | retomar | trabalhando | aguardando-cutucao | cutucar | parada-sem-aba
export function decidir(c) {
  const { st, agora } = c;
  if (st?.estado === 'ilegivel') return { acao: 'ilegivel' };
  if (st?.estado === 'fechada') {
    const quieta = !c.sessaoViva || (c.ultimaAtividade != null && agora - c.ultimaAtividade >= c.quietoMs);
    if (c.podeFechar && c.temAba && !c.abaJaFechada && quieta) return { acao: 'fechar-aba' };
    return { acao: 'concluida' };
  }
  if (st && ESTADOS_DE_ESPERA.includes(st.estado)) return { acao: 'espera', motivo: st.estado };
  const ate = st?.aguardandoAte ? Date.parse(st.aguardandoAte) : 0;
  if (ate > agora) return { acao: 'freio', motivo: 'espera-declarada' };
  if (c.dependenciaPendente) return { acao: 'dependencia', motivo: c.dependenciaPendente };
  if (!c.sessaoViva) {
    if (c.abaFechadaPeloDono) return { acao: 'fechada-pelo-dono' };
    if (st?.abertoEm && agora - st.abertoEm < c.esperaAberturaMs) return { acao: 'aguardando-abertura' };
    if (c.cutucoes >= c.maxCutucoes) return { acao: 'esperando-dono', motivo: 'sessao-caiu-varias-vezes' };
    if (c.memoriaLivreGB < c.memoriaMinimaGB) return { acao: 'freio', motivo: 'memoria-baixa' };
    if (!c.temPrompt && !c.temTranscricao) return { acao: 'esperando-dono', motivo: 'sem-prompt-de-abertura' };
    return { acao: c.temTranscricao ? 'retomar' : 'abrir' };
  }
  if (c.tarefasRodando > 0) return { acao: 'trabalhando', motivo: 'tarefa-rodando' };
  if (c.ultimaAtividade == null || agora - c.ultimaAtividade < c.paradaMs) return { acao: 'trabalhando' };
  if (st?.ultimaCutucada && agora - st.ultimaCutucada < c.paradaMs) return { acao: 'aguardando-cutucao' };
  if (c.cutucoes >= c.maxCutucoes) return { acao: 'esperando-dono', motivo: 'parada-sem-avancar' };
  if (!c.podeCutucar || !c.temAba) return { acao: 'parada-sem-aba' };
  return { acao: 'cutucar' };
}
