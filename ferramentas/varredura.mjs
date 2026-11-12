#!/usr/bin/env node
// VARREDURA DE PRIVACIDADE: barra dado pessoal ou interno antes de qualquer coisa sair para o GitHub.
// Sem IA, custo zero. Use quando este repositório (ou uma cópia dele) vai ser compartilhado.
//
// USO
//   node ferramentas/varredura.mjs              varre os arquivos que vão para o git (rastreados e novos)
//   node ferramentas/varredura.mjs --historico  varre o histórico inteiro (autor, mensagem e conteúdo)
//   node ferramentas/varredura.mjs --pre-push   usado pelo gancho .githooks/pre-push (lê a entrada do git)
//
// O QUE BARRA
//   - Sempre: e-mail, telefone, número longo (10+ dígitos), caminho de pasta pessoal do computador,
//     IP, chave e token com formato conhecido.
//   - O que você listar em publicar.local.json (fica só na sua máquina, nunca vai para o git):
//     {
//       "termos":   ["Nome da Empresa", "=Ana"],    // "=" na frente: diferencia maiúscula de minúscula
//       "fontes":   [                              // arquivos seus de onde os termos são lidos na hora
//         { "caminho": "/pasta/clientes.json", "modo": "json", "chaves": ["nome", "slug"] },
//         { "caminho": "/pasta/contatos.md",   "modo": "numeros" }
//       ],
//       "permitir": ["texto que pode aparecer"],     // exceções exatas
//       "autor":    { "nome": "Maestro", "email": "maestro@users.noreply.github.com" }
//     }
//     Os termos nunca são copiados para o repositório: são lidos das fontes a cada varredura.
//
// SAÍDA: código 0 sem nada achado; 1 com a lista arquivo:linha; 2 erro de configuração.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG = join(RAIZ, 'publicar.local.json');
const git = (args, opts = {}) => execFileSync('git', args, { cwd: RAIZ, encoding: 'utf8', maxBuffer: 1 << 28, ...opts });

// ---------- padrões fixos ----------
const DOMINIOS_OK = /(^noreply@anthropic\.com|@users\.noreply\.github\.com|@example\.(com|org)|@exemplo\.com(\.br)?)$/i;
const PADROES = [
  ['e-mail', /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, (m) => !DOMINIOS_OK.test(m)],
  ['telefone', /\+\d{2}[\s-]?\(?\d{2}\)?[\s-]?\d{4,5}[\s-]?\d{4}\b/g],
  ['número longo', /(?<![\w.])\d{10,}(?![\w.])/g],
  ['pasta pessoal', /[A-Za-z]:[\\/]+Users[\\/]+(?![<%$])[A-Za-z][\w.-]*/gi],
  ['pasta pessoal', /\/(?:Users|home)\/(?![<$~])[A-Za-z][\w.-]*/g],
  ['IP', /\b(?:\d{1,3}\.){3}\d{1,3}\b/g, (m) => !/^(127\.0\.0\.1|0\.0\.0\.0)$/.test(m) && m.split('.').every((p) => +p <= 255)],
  ['chave/token', /\b(?:sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{30,}|gho_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|EAA[A-Za-z0-9]{40,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|xox[abp]-[A-Za-z0-9-]{10,})\b/g],
  ['chave/token', /-----BEGIN [A-Z ]*PRIVATE KEY-----/g],
  ['chave/token', /\beyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}/g],
];

// ---------- termos do dono, lidos na hora ----------
function folhas(obj, chaves, dentro = false, saida = []) {
  if (Array.isArray(obj)) { for (const v of obj) folhas(v, chaves, dentro, saida); return saida; }
  if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) folhas(v, chaves, dentro || !chaves || chaves.includes(k), saida);
    return saida;
  }
  if (dentro && (typeof obj === 'string' || typeof obj === 'number')) saida.push(String(obj));
  return saida;
}
const numerosDe = (txt) => (txt.match(/\+?\d[\d\s().-]{6,}\d/g) || []).map((s) => s.replace(/\D/g, '')).filter((s) => s.length >= 8);

function carregarTermos() {
  if (!existsSync(CONFIG)) return { textos: [], numeros: [], permitir: [] };
  let cfg;
  try { cfg = JSON.parse(readFileSync(CONFIG, 'utf8')); } catch (e) { console.error(`publicar.local.json ilegível: ${e.message}`); process.exit(2); }
  const textos = new Set(cfg.termos || []);
  const numeros = new Set();
  for (const f of cfg.fontes || []) {
    if (!existsSync(f.caminho)) { console.error(`fonte não encontrada: ${f.caminho}`); process.exit(2); }
    const bruto = readFileSync(f.caminho, 'utf8');
    if (f.modo === 'numeros') { numerosDe(bruto).forEach((n) => numeros.add(n)); continue; }
    if (f.modo !== 'json') { console.error(`modo desconhecido: ${f.modo}`); process.exit(2); }
    for (const v of folhas(JSON.parse(bruto), f.chaves)) {
      numerosDe(v).forEach((n) => numeros.add(n));
      const limpo = v.trim();
      // palavra comum solta ("todas", "ativo") não é termo: só nome próprio, slug ou valor com dígito
      if (/^[a-zà-ÿ]+$/.test(limpo)) continue;
      if (/[A-Za-zÀ-ÿ]/.test(limpo) && limpo.length >= 4 && limpo.length <= 60 && !/\s{2,}|[.:;!?]\s/.test(limpo)) textos.add(limpo);
    }
  }
  return { textos: [...textos], numeros: [...numeros], permitir: cfg.permitir || [] };
}

function compilar(t) {
  const sensivel = t.startsWith('=');
  const termo = sensivel ? t.slice(1) : t;
  const esc = termo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [termo, new RegExp(`(?<![\\p{L}\\p{N}_])${esc}(?![\\p{L}\\p{N}_])`, sensivel ? 'gu' : 'giu')];
}

// ---------- varredura de um texto ----------
function varrerTexto(nome, texto, ctx, achados, filtroLinha = () => true) {
  const linhas = texto.split(/\r?\n/);
  linhas.forEach((linha, i) => {
    if (!filtroLinha(linha)) return;
    let l = linha;
    for (const p of ctx.permitir) l = l.split(p).join(' ');
    for (const [cat, re, ok] of PADROES) {
      for (const m of l.matchAll(re)) if (!ok || ok(m[0])) achados.push([nome, i + 1, cat, cat === 'chave/token' ? m[0].slice(0, 6) + '…' : m[0]]);
    }
    for (const [termo, re] of ctx.regex) if (re.test(l)) { re.lastIndex = 0; achados.push([nome, i + 1, 'termo privado', termo]); }
    if (ctx.numeros.length) {
      for (const run of numerosDe(l)) for (const n of ctx.numeros) if (run.includes(n)) achados.push([nome, i + 1, 'número privado', n]);
    }
  });
}

function arquivosDoGit() {
  return git(['ls-files', '-co', '--exclude-standard', '-z']).split('\0').filter((f) => f && existsSync(join(RAIZ, f)));
}

function lerEntradaPadrao() { try { return readFileSync(0, 'utf8'); } catch { return ''; } }

function intervalosDoPush(entrada) {
  const zero = /^0+$/;
  const r = [];
  for (const linha of entrada.split(/\r?\n/).filter(Boolean)) {
    const [, localSha, , remotoSha] = linha.split(' ');
    if (!localSha || zero.test(localSha)) continue;
    r.push(zero.test(remotoSha) ? [localSha, '--not', '--remotes'] : [`${remotoSha}..${localSha}`]);
  }
  return r;
}

export function varrer({ modo = 'arquivos', entrada = '' } = {}) {
  const t = carregarTermos();
  const ctx = { regex: t.textos.map(compilar), numeros: t.numeros, permitir: t.permitir };
  const achados = [];
  if (modo === 'arquivos') {
    for (const f of arquivosDoGit()) {
      const buf = readFileSync(join(RAIZ, f));
      if (buf.includes(0)) continue;
      varrerTexto(f, buf.toString('utf8'), ctx, achados);
    }
  } else {
    const faixas = modo === 'historico' ? [['--all']] : intervalosDoPush(entrada);
    for (const faixa of faixas) {
      const log = git(['log', '-p', '--no-color', '--format=commit %H%nautor %an <%ae>%ncommitter %cn <%ce>%n%B', ...faixa]);
      // linha removida ("-") já passou pela varredura quando entrou; o resto (cabeçalho, mensagem, "+") se varre
      varrerTexto('historico', log, ctx, achados, (l) => !(l.startsWith('-') && !l.startsWith('---')));
    }
  }
  return { achados, termos: ctx.regex.length + ctx.numeros.length };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const arg = process.argv[2] || '';
  const modo = arg === '--historico' ? 'historico' : arg === '--pre-push' ? 'push' : 'arquivos';
  const { achados, termos } = varrer({ modo, entrada: modo === 'push' ? lerEntradaPadrao() : '' });
  if (!achados.length) { console.log(`varredura limpa (${modo}; ${termos} termos privados + padrões fixos)`); process.exit(0); }
  console.error(`VARREDURA BARROU ${achados.length} ocorrência(s) (${modo}):`);
  for (const [f, l, c, v] of achados.slice(0, 50)) console.error(`  ${f}:${l}  [${c}]  ${v}`);
  if (achados.length > 50) console.error(`  ... e mais ${achados.length - 50}`);
  console.error('Nada sai até zerar. Tire o dado ou, se for falso positivo, ponha o texto exato em "permitir" no publicar.local.json.');
  process.exit(1);
}

// Para os testes: varre um texto solto com termos dados (sem ler o publicar.local.json).
export function acharEmTexto(texto, termos = [], numeros = []) {
  const achados = [];
  varrerTexto('texto', texto, { regex: termos.map(compilar), numeros, permitir: [] }, achados);
  return achados.map(([, , cat, v]) => [cat, v]);
}
