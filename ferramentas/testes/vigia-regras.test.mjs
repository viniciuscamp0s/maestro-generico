import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import {
  abaFechadaPeloDono, caixaDeTexto, cutucoesEfetivas, decidir, etapasAtivas, filasDoVigia, ordenarFilas,
  resolverEtapa, vigiaPodeGravar,
} from '../vigia-regras.mjs';

const MIN = 60_000;
const agora = Date.now();
const base = {
  agora, st: null, sessaoViva: false, tarefasRodando: 0, temTranscricao: false, temPrompt: true, ultimaAtividade: null,
  cutucoes: 0, dependenciaPendente: null, abaFechadaPeloDono: false, temAba: true, abaJaFechada: false,
  podeCutucar: true, podeFechar: true, memoriaLivreGB: 8, paradaMs: 30 * MIN, esperaAberturaMs: 15 * MIN,
  quietoMs: 10 * MIN, maxCutucoes: 3, memoriaMinimaGB: 0.5,
};
const d = (extra) => decidir({ ...base, ...extra }).acao;

test('vigia nunca grava por cima do que a sessão ou o dono decidiu', () => {
  for (const estado of ['fechada', 'esperando-dono', 'esperando-cliente', 'pausada-pelo-dono', 'ilegivel']) {
    assert.equal(vigiaPodeGravar({ estado }), false, estado);
  }
  assert.equal(vigiaPodeGravar(null), true);
  assert.equal(vigiaPodeGravar({ estado: 'em-andamento' }), true);
  assert.equal(vigiaPodeGravar({ estado: 'ilegivel' }, { forcar: true }), false);
});

test('filas de exemplo e de acompanhamento ficam de fora', () => {
  const filas = filasDoVigia([{ fila: 'a', etapas: [] }, { fila: 'b', exemplo: true, etapas: [] }, { fila: 'c', acompanhamento: true }, null, { fila: 'd' }]);
  assert.deepEqual(filas.map((f) => f.fila), ['a']);
});

test('fila com prioridade passa na frente, na ordem em que foi priorizada', () => {
  const filas = ordenarFilas([
    { fila: 'a' }, { fila: 'b', prioridade: true, priorizadaEm: '2026-01-02T00:00:00Z' }, { fila: 'c' },
    { fila: 'd', prioridade: true, priorizadaEm: '2026-01-01T00:00:00Z' },
  ]);
  assert.deepEqual(filas.map((f) => f.fila), ['d', 'b', 'a', 'c']);
});

test('etapas ativas: a primeira aberta e as paralelas seguintes, nunca a sequencial', () => {
  const etapas = [{ etapa: '1' }, { etapa: '2' }, { etapa: '3', paralela: true }, { etapa: '4' }, { etapa: '5', paralela: true }];
  const estados = { 1: 'fechada' };
  const ativas = etapasAtivas(etapas, (e) => (estados[e.etapa] ? { estado: estados[e.etapa] } : null));
  assert.deepEqual(ativas.map((e) => e.etapa), ['2', '3']);
  const espera = etapasAtivas(etapas, (e) => (e.etapa === '1' ? { estado: 'esperando-dono' } : null));
  assert.deepEqual(espera.map((e) => e.etapa), ['1']);
  assert.deepEqual(etapasAtivas(etapas, () => ({ estado: 'fechada' })), []);
});

test('etapa resolvida pelo projeto da configuração, com estado e prompt nas pastas certas', () => {
  const raiz = path.resolve('/tmp/maestro-teste');
  const config = {
    pastaEstado: path.join(raiz, 'estado'), pastaPrompts: path.join(raiz, 'prompts'),
    orca: { projetoPadrao: null }, projetos: [{ nome: 'App', pasta: path.join(raiz, 'app'), orcaProjeto: path.join(raiz, 'app') }],
  };
  const e = resolverEtapa({ fila: 'f1' }, { etapa: 'e1', projeto: 'App', prompt: 'p.txt' }, config);
  assert.equal(e.pasta, path.join(raiz, 'app'));
  assert.equal(e.nome, 'f1-e1');
  assert.equal(e.prompt, path.join(raiz, 'prompts', 'p.txt'));
  assert.equal(e.arquivoEstado, path.join(raiz, 'estado', 'f1', 'e1.json'));
  assert.equal(e.projetoOrca, path.join(raiz, 'app'));
  assert.throws(() => resolverEtapa({ fila: 'f1' }, { etapa: 'e1', projeto: 'Outro' }, config), /não está/);
  assert.throws(() => resolverEtapa({ fila: '../fora' }, { etapa: 'e1', projeto: 'App' }, config), /nome válido/);
  assert.throws(() => resolverEtapa({ fila: 'f1' }, { etapa: 'e1' }, config), /sem pasta/);
  assert.throws(() => resolverEtapa({ fila: 'f1' }, { etapa: 'e1', projeto: 'App', arquivoEstado: '../../fora.json' }, config), /fora da pasta/);
  assert.equal(resolverEtapa({ fila: 'f1' }, { etapa: 'e1', projeto: 'App', arquivoEstado: 'x/e.json' }, config).arquivoEstado, path.join(raiz, 'estado', 'x', 'e.json'));
});

test('sem sessão viva: abre do zero ou retoma pela transcrição', () => {
  assert.equal(d({}), 'abrir');
  assert.equal(d({ temTranscricao: true }), 'retomar');
  assert.equal(d({ temPrompt: false }), 'esperando-dono');
  assert.equal(d({ temPrompt: false, temTranscricao: true }), 'retomar');
});

test('estados de espera e espera declarada: o vigia não age', () => {
  for (const estado of ['esperando-dono', 'esperando-cliente', 'pausada-pelo-dono']) assert.equal(d({ st: { estado } }), 'espera');
  assert.equal(d({ st: { estado: 'em-andamento', aguardandoAte: new Date(agora + MIN).toISOString() } }), 'freio');
  assert.equal(d({ st: { estado: 'ilegivel' } }), 'ilegivel');
  assert.equal(d({ dependenciaPendente: 'outra/etapa' }), 'dependencia');
});

test('freios: memória baixa e abertura recente', () => {
  assert.equal(d({ memoriaLivreGB: 0.2 }), 'freio');
  assert.equal(d({ st: { estado: 'em-andamento', abertoEm: agora - 5 * MIN } }), 'aguardando-abertura');
  assert.equal(d({ st: { estado: 'em-andamento', abertoEm: agora - 20 * MIN }, temTranscricao: true }), 'retomar');
});

test('limite de retomadas sem progresso vira esperando-dono', () => {
  assert.equal(d({ cutucoes: 3, temTranscricao: true }), 'esperando-dono');
  assert.equal(d({ cutucoes: 3, sessaoViva: true, ultimaAtividade: agora - 40 * MIN }), 'esperando-dono');
  assert.equal(cutucoesEfetivas({ cutucoes: 3, respostasNaCutucada: 10 }, 30, 15), 0);
  assert.equal(cutucoesEfetivas({ cutucoes: 3, respostasNaCutucada: 10 }, 20, 15), 3);
  assert.equal(cutucoesEfetivas(null, 50, 15), 0);
});

test('sessão viva: trabalha, cutuca só parada e sem tarefa rodando', () => {
  const viva = { sessaoViva: true, st: { estado: 'em-andamento' } };
  assert.equal(d({ ...viva, ultimaAtividade: agora - 5 * MIN }), 'trabalhando');
  assert.equal(d({ ...viva, ultimaAtividade: agora - 40 * MIN, tarefasRodando: 2 }), 'trabalhando');
  assert.equal(d({ ...viva, ultimaAtividade: agora - 40 * MIN }), 'cutucar');
  assert.equal(d({ ...viva, st: { estado: 'em-andamento', ultimaCutucada: agora - 10 * MIN }, ultimaAtividade: agora - 40 * MIN }), 'aguardando-cutucao');
  assert.equal(d({ ...viva, ultimaAtividade: agora - 40 * MIN, podeCutucar: false }), 'parada-sem-aba');
  assert.equal(d({ ...viva, ultimaAtividade: agora - 40 * MIN, temAba: false }), 'parada-sem-aba');
});

test('etapa fechada: fecha a aba só com a sessão quieta, uma vez', () => {
  const fechada = { st: { estado: 'fechada' } };
  assert.equal(d({ ...fechada }), 'fechar-aba');
  assert.equal(d({ ...fechada, sessaoViva: true, ultimaAtividade: agora - 2 * MIN }), 'concluida');
  assert.equal(d({ ...fechada, sessaoViva: true, ultimaAtividade: agora - 12 * MIN }), 'fechar-aba');
  assert.equal(d({ ...fechada, abaJaFechada: true }), 'concluida');
  assert.equal(d({ ...fechada, podeFechar: false }), 'concluida');
  assert.equal(d({ ...fechada, temAba: false }), 'concluida');
});

test('aba fechada pelo dono: só quando nem a máquina nem o Orca reiniciaram', () => {
  const vista = agora - 20 * MIN;
  const caso = { aba: 'h1', abaVistaEm: vista, abasAgora: ['h2'], abasAntes: ['h1', 'h2'], bootEm: agora - 60 * MIN };
  assert.equal(abaFechadaPeloDono(caso), true);
  assert.equal(abaFechadaPeloDono({ ...caso, bootEm: agora - 5 * MIN }), false, 'máquina reiniciou');
  assert.equal(abaFechadaPeloDono({ ...caso, abasAgora: [] }), false, 'Orca reiniciou');
  assert.equal(abaFechadaPeloDono({ ...caso, abasAgora: ['h1', 'h2'] }), false, 'aba ainda existe');
  assert.equal(abaFechadaPeloDono({ ...caso, abaVistaEm: null }), false);
  assert.equal(d({ abaFechadaPeloDono: true, temTranscricao: true }), 'fechada-pelo-dono');
});

test('caixa de texto do Claude Code lida da tela', () => {
  const regua = '─'.repeat(40);
  assert.equal(caixaDeTexto(['saida', regua, '❯ ', regua, 'rodape']), '');
  assert.equal(caixaDeTexto(['saida', regua, '❯ rascunho do dono', '  continua', regua]), 'rascunho do dono continua');
  assert.equal(caixaDeTexto(['sem caixa']), null);
});
