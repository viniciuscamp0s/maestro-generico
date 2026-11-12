// Testa a trava de trabalho pesado de verdade, pelo bash (Git Bash no Windows, bash no Mac).
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const TRAVA = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'trava.sh');
// No Windows, "bash" pode ser o do WSL (System32): usa o do Git quando existe.
const BASH = (() => {
  if (process.platform !== 'win32') return 'bash';
  const git = [process.env.ProgramW6432, process.env.ProgramFiles].filter(Boolean).map((p) => path.join(p, 'Git', 'bin', 'bash.exe'));
  return git.find((g) => fs.existsSync(g)) ?? 'bash';
})();
const novaPasta = () => fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-trava-'));
const env = (pasta, extra = {}) => ({ ...process.env, TRAVA_PASTA: pasta, TRAVA_INTERVALO_S: '1', ...extra });

test('roda o comando e devolve o código de saída dele; solta a trava', () => {
  const pasta = novaPasta();
  const ok = spawnSync(BASH, [TRAVA, 'pesada', 'bash', '-c', 'echo feito'], { env: env(pasta), encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /feito/);
  const falha = spawnSync(BASH, [TRAVA, 'pesada', 'bash', '-c', 'exit 7'], { env: env(pasta), encoding: 'utf8' });
  assert.equal(falha.status, 7);
  assert.equal(fs.existsSync(path.join(pasta, 'pesada.lock')), false);
});

test('recusa nome fora do formato e comando faltando', () => {
  const pasta = novaPasta();
  assert.equal(spawnSync(BASH, [TRAVA, 'Pesada!', 'true'], { env: env(pasta) }).status, 2);
  assert.equal(spawnSync(BASH, [TRAVA, 'pesada'], { env: env(pasta) }).status, 2);
});

test('segundo comando espera o primeiro e desiste com 75 quando passa da espera', async () => {
  const pasta = novaPasta();
  const primeiro = spawn(BASH, [TRAVA, 'pesada', 'bash', '-c', 'sleep 6'], { env: env(pasta) });
  const fim = new Promise((r) => primeiro.on('exit', r));
  for (let i = 0; i < 50 && !fs.existsSync(path.join(pasta, 'pesada.lock', 'dono')); i++) await new Promise((r) => setTimeout(r, 200));
  assert.ok(fs.existsSync(path.join(pasta, 'pesada.lock', 'dono')), 'a primeira não pegou a trava');
  const segundo = spawnSync(BASH, [TRAVA, 'pesada', 'true'], { env: env(pasta, { TRAVA_ESPERA_S: '2' }), encoding: 'utf8' });
  assert.equal(segundo.status, 75, segundo.stderr);
  const terceiro = spawnSync(BASH, [TRAVA, 'pesada', 'bash', '-c', 'echo minha-vez'], { env: env(pasta, { TRAVA_ESPERA_S: '30' }), encoding: 'utf8' });
  assert.equal(terceiro.status, 0, terceiro.stderr);
  assert.match(terceiro.stdout, /minha-vez/);
  assert.equal(await fim, 0);
});

test('trava de processo que já morreu é desfeita', () => {
  const pasta = novaPasta();
  fs.mkdirSync(path.join(pasta, 'pesada.lock'), { recursive: true });
  fs.writeFileSync(path.join(pasta, 'pesada.lock', 'dono'), `pid=999999\ndesde=${Math.floor(Date.now() / 1000)}\nquem=teste\n`);
  const r = spawnSync(BASH, [TRAVA, 'pesada', 'bash', '-c', 'echo liberada'], { env: env(pasta, { TRAVA_ESPERA_S: '10' }), encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /já morreu/);
});
