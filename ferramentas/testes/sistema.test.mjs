import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { comandoClaude, lerPrompt } from '../comando.mjs';
import {
  ehClaude, lerListaDeProcessos, lerVmStat, listarProcessos, memoriaLivreGB, nomeDaPastaDeProjeto, sessaoDaEtapa,
  tarefasRodando, ultimaFala,
} from '../sistema.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-teste-'));

test('lista de processos real desta máquina (Windows ou Mac) traz o próprio node com o pai', () => {
  const procs = listarProcessos(tmp);
  const eu = procs.find((p) => p.pid === process.pid);
  assert.ok(eu, `pid ${process.pid} não apareceu entre ${procs.length} processos`);
  assert.equal(eu.ppid, process.ppid);
  assert.ok(ehClaude({ nome: eu.nome }) || /node/i.test(eu.nome), eu.nome);
});

test('leitura da lista de processos nos dois formatos', () => {
  assert.deepEqual(lerListaDeProcessos('10\t1\tclaude.exe\r\n11\t10\tbash.exe\n'), [
    { pid: 10, ppid: 1, nome: 'claude.exe' }, { pid: 11, ppid: 10, nome: 'bash.exe' },
  ]);
  assert.deepEqual(lerListaDeProcessos('  321   1 /usr/local/bin/claude\n  322 321 /bin/zsh\n'), [
    { pid: 321, ppid: 1, nome: 'claude' }, { pid: 322, ppid: 321, nome: 'zsh' },
  ]);
});

test('tarefa rodando = shell pendurado no claude e o que roda embaixo; MCP não conta', () => {
  const procs = [
    { pid: 1, ppid: 0, nome: 'claude' }, { pid: 2, ppid: 1, nome: 'node' }, { pid: 3, ppid: 1, nome: 'zsh' },
    { pid: 4, ppid: 3, nome: 'npm' }, { pid: 5, ppid: 4, nome: 'node' },
  ];
  assert.deepEqual(tarefasRodando(1, procs).map((p) => p.pid), [3, 4, 5]);
  assert.deepEqual(tarefasRodando(1, procs.slice(0, 2)), []);
});

test('memória livre: número positivo e leitura do vm_stat do Mac', () => {
  assert.ok(memoriaLivreGB() > 0);
  const vm = 'Mach Virtual Memory Statistics: (page size of 16384 bytes)\nPages free:      65536.\nPages inactive:  65536.\nPages speculative: 0.\n';
  assert.equal(lerVmStat(vm), 2);
});

test('sessão da etapa pelo nome e, sem ele, pela pasta (uma pasta, uma sessão)', () => {
  const vivas = [
    { pid: 1, sessao: { name: 'outra', cwd: path.resolve('/projetos/app') } },
    { pid: 2, sessao: { name: 'etapa-x', cwd: path.resolve('/projetos/outro') } },
  ];
  assert.equal(sessaoDaEtapa({ nome: 'etapa-x', pasta: path.resolve('/projetos/app') }, vivas).pid, 2);
  assert.equal(sessaoDaEtapa({ nome: 'etapa-y', pasta: path.resolve('/projetos/app') }, vivas).pid, 1);
  assert.equal(sessaoDaEtapa({ nome: 'etapa-y', pasta: path.resolve('/projetos/nada') }, vivas), null);
});

test('pasta de transcrição do Claude Code: tudo que não é letra ou número vira hífen', () => {
  assert.match(nomeDaPastaDeProjeto(path.resolve('/projetos/meu app')), /-projetos-meu-app$/);
});

test('última fala ignora compactação e linhas de sistema', () => {
  const t1 = new Date(Date.now() - 60_000).toISOString();
  const t2 = new Date().toISOString();
  const texto = [
    JSON.stringify({ type: 'assistant', timestamp: t1 }),
    JSON.stringify({ type: 'user', timestamp: t2, isCompactSummary: true }),
    'lixo',
  ].join('\n');
  assert.equal(ultimaFala(texto), Date.parse(t1));
  assert.equal(ultimaFala(''), null);
});

test('comando do Claude no Windows (PowerShell) e no Mac (zsh)', () => {
  const etapa = { nome: 'app-tela', pasta: '/projetos/app', modelo: 'opus', esforco: 'high', env: { MODO: 'teste' } };
  const win = comandoClaude(etapa, { arquivoPrompt: '/p/abrir.txt', so: 'win32', modoPermissao: 'bypassPermissions' });
  assert.match(win, /^Set-Location -LiteralPath '\/projetos\/app'; \$env:MODO='teste'; claude --name 'app-tela' --model opus --effort high --strict-mcp-config --permission-mode bypassPermissions \(Get-Content -Raw -Encoding UTF8 -LiteralPath '\/p\/abrir\.txt'\)\.Trim\(\)$/);
  const mac = comandoClaude(etapa, { arquivoPrompt: '/p/abrir.txt', so: 'darwin', resume: '0f8fad5b-d9cb-469f-a165-7a8b6c7d2e0f', modoPermissao: 'bypassPermissions' });
  assert.equal(mac, `cd '/projetos/app' && export MODO='teste' && claude --resume 0f8fad5b-d9cb-469f-a165-7a8b6c7d2e0f --name 'app-tela' --model opus --effort high --strict-mcp-config --permission-mode bypassPermissions "$(cat '/p/abrir.txt')"`);
});

test('modo de permissão padrão pede licença para comando', () => {
  assert.match(comandoClaude({ nome: 'app', pasta: '/projetos/app' }, { arquivoPrompt: '/p', so: 'darwin' }), /--permission-mode acceptEdits /);
});

test('comando recusa valor fora do formato (nada de injeção no shell)', () => {
  const etapa = { nome: 'app', pasta: '/projetos/app' };
  assert.throws(() => comandoClaude({ ...etapa, pasta: "/x'; rm -rf ~; '" }, { arquivoPrompt: '/p' }), /aspas simples/);
  assert.throws(() => comandoClaude({ ...etapa, nome: 'a b' }, { arquivoPrompt: '/p' }), /nome/);
  assert.throws(() => comandoClaude({ ...etapa, modelo: 'opus; calc' }, { arquivoPrompt: '/p' }), /modelo/);
  assert.throws(() => comandoClaude(etapa, { arquivoPrompt: '/p', resume: 'nao-e-uuid' }), /sessionId/);
  assert.throws(() => comandoClaude({ ...etapa, env: { 'a;b': 'x' } }, { arquivoPrompt: '/p' }), /env/);
  assert.throws(() => comandoClaude(etapa, { arquivoPrompt: '/p', modoPermissao: 'tudo' }), /modoPermissao/);
});

test('prompt: uma linha, sem aspas', () => {
  const ok = path.join(tmp, 'ok.txt');
  fs.writeFileSync(ok, '﻿faca a etapa e grave o estado\n');
  assert.equal(lerPrompt(ok), 'faca a etapa e grave o estado');
  const ruim = path.join(tmp, 'ruim.txt');
  fs.writeFileSync(ruim, 'linha 1\nlinha 2');
  assert.throws(() => lerPrompt(ruim), /quebra de linha/);
  fs.writeFileSync(ruim, 'diga "oi"');
  assert.throws(() => lerPrompt(ruim), /aspas/);
});
