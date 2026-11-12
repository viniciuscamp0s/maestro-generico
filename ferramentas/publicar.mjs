#!/usr/bin/env node
// PUBLICAR: leva as mudanças deste repositório para o GitHub, sem IA, só com a varredura zerada.
//
// USO
//   node ferramentas/publicar.mjs "mensagem do commit"
//   (pela trava, se outras sessões estiverem rodando testes: bash ferramentas/trava.sh pesada node ferramentas/publicar.mjs "...")
//
// PASSOS (para no primeiro que falhar)
//   1. Liga o gancho de push deste repositório (.githooks/pre-push), se ainda não estiver ligado.
//   2. Varredura de privacidade nos arquivos que vão para o git (ferramentas/varredura.mjs).
//   3. Testes (npm test).
//   4. Commit só dos arquivos deste repositório que mudaram, com o autor de publicar.local.json
//      ("autor": {"nome","email"}) ou, sem ele, o autor configurado no git.
//   5. Push. O gancho de push varre de novo cada commit que vai subir (autor, mensagem e conteúdo).
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { varrer } from './varredura.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const git = (args) => execFileSync('git', args, { cwd: RAIZ, encoding: 'utf8' }).trim();
const parar = (msg) => { console.error(`PUBLICAÇÃO PARADA: ${msg}`); process.exit(1); };

const mensagem = process.argv.slice(2).join(' ').trim();
if (!mensagem) parar('falta a mensagem do commit: node ferramentas/publicar.mjs "o que mudou"');

// 1. gancho
let hooks = '';
try { hooks = git(['config', '--get', 'core.hooksPath']); } catch { /* não configurado */ }
if (hooks !== '.githooks') git(['config', 'core.hooksPath', '.githooks']);

// 2. varredura
const { achados } = varrer({ modo: 'arquivos' });
if (achados.length) {
  for (const [f, l, c, v] of achados.slice(0, 50)) console.error(`  ${f}:${l}  [${c}]  ${v}`);
  parar(`a varredura achou ${achados.length} dado(s) privado(s). Nada foi commitado.`);
}
console.log('1/3 varredura limpa');

// 3. testes
const teste = spawnSync('npm', ['test', '--silent'], { cwd: RAIZ, encoding: 'utf8', shell: process.platform === 'win32' });
if (teste.status !== 0) {
  console.error((teste.stdout + teste.stderr).split(/\r?\n/).filter((l) => /not ok|fail|erro|Error/i.test(l)).slice(0, 30).join('\n'));
  parar('testes falharam. Nada foi commitado.');
}
console.log('2/3 testes verdes');

// 4. commit
const mudados = git(['ls-files', '-mo', '--deleted', '--exclude-standard']).split(/\r?\n/).filter(Boolean);
const unicos = [...new Set(mudados)];
if (unicos.length) {
  git(['add', '--', ...unicos]);
  let autor = [];
  const cfg = join(RAIZ, 'publicar.local.json');
  if (existsSync(cfg)) {
    const a = JSON.parse(readFileSync(cfg, 'utf8')).autor;
    if (a?.nome && a?.email) autor = ['-c', `user.name=${a.nome}`, '-c', `user.email=${a.email}`];
  }
  execFileSync('git', [...autor, 'commit', '-q', '-m', mensagem], { cwd: RAIZ, stdio: 'inherit' });
}

// 5. push
const pendentes = git(['rev-list', '--count', '@{u}..HEAD']);
if (pendentes === '0') { console.log('3/3 nada novo para publicar'); process.exit(0); }
const push = spawnSync('git', ['push', '-q'], { cwd: RAIZ, stdio: 'inherit' });
if (push.status !== 0) parar('o push falhou (a varredura do gancho ou a rede). O commit ficou só nesta máquina.');
console.log(`3/3 publicado: ${git(['rev-parse', '--short', 'HEAD'])} (${pendentes} commit(s))`);
