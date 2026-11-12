// SISTEMA: o que muda entre Windows e Mac fica aqui (lista de processos, memória livre) junto com a
// leitura das sessões e transcrições do Claude Code, que é igual nos dois.
//   Processos  Windows: API Toolhelp (processos.cs compilado uma vez), reserva pelo PowerShell/CIM.
//              Mac: ps -axo pid=,ppid=,comm=
//   Memória    Windows: os.freemem(). Mac: vm_stat (livre + inativa + especulativa), porque o
//              os.freemem() do Mac não conta a memória que o sistema devolve na hora.
//   Sessões    ~/.claude/sessions/<pid>.json (gravado pelo Claude Code ao subir: pid, sessionId, cwd, name)
//   Transcrição ~/.claude/projects/<pasta com tudo que não é letra ou número trocado por ->/<sessionId>.jsonl
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
export const WINDOWS = process.platform === 'win32';
export const MAC = process.platform === 'darwin';
export const CLAUDE_HOME = process.env.MAESTRO_CLAUDE_HOME || path.join(os.homedir(), '.claude');
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function rodar(exe, argv, { timeout = 60_000, cwd, env } = {}) {
  return execFileSync(exe, argv, {
    encoding: 'utf8', windowsHide: true, timeout, cwd, env: env ? { ...process.env, ...env } : process.env,
    stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024,
  });
}

export const normal = (p) => (p ?? '').replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase();

// ---------- processos ----------
// Linha "pid<TAB>ppid<TAB>nome" (Windows) ou "  pid  ppid /caminho/do/comando" (ps do Mac).
export function lerListaDeProcessos(texto) {
  const out = [];
  for (const bruta of texto.split('\n')) {
    const l = bruta.replace(/\r$/, '');
    if (!l.trim()) continue;
    let m = l.split('\t');
    if (m.length >= 3) { out.push({ pid: Number(m[0]), ppid: Number(m[1]), nome: m.slice(2).join('\t').trim() }); continue; }
    m = l.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/);
    if (m) out.push({ pid: Number(m[1]), ppid: Number(m[2]), nome: path.posix.basename(m[3].trim()) });
  }
  return out.filter((p) => Number.isFinite(p.pid) && Number.isFinite(p.ppid));
}

function leitorWindows(pastaEstado) {
  const csc = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
  const fonte = path.join(AQUI, 'processos.cs');
  const exe = path.join(pastaEstado, 'bin', 'processos.exe');
  const pronto = fs.existsSync(exe) && fs.statSync(exe).mtimeMs >= fs.statSync(fonte).mtimeMs;
  if (!pronto) {
    if (!fs.existsSync(csc)) return null;
    fs.mkdirSync(path.dirname(exe), { recursive: true });
    rodar(csc, ['/nologo', '/optimize+', `/out:${exe}`, fonte], { timeout: 180_000 });
  }
  return exe;
}

export function listarProcessos(pastaEstado) {
  if (WINDOWS) {
    try {
      const exe = leitorWindows(pastaEstado);
      if (exe) return lerListaDeProcessos(rodar(exe, []));
    } catch {}
    const ps = 'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId)`t$($_.ParentProcessId)`t$($_.Name)" }';
    return lerListaDeProcessos(rodar('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { timeout: 300_000 }));
  }
  return lerListaDeProcessos(rodar('ps', ['-axo', 'pid=,ppid=,comm=']));
}

// O Claude Code roda como "claude" (instalação nativa) ou "node" (instalação pelo npm).
export const ehClaude = (p) => /^(claude|node)(\.exe)?$/i.test(p?.nome ?? '');

// Tarefa rodando = um shell de ferramenta (Bash, zsh, PowerShell) pendurado no claude, com o que ele roda
// embaixo (teste, build, tarefa em segundo plano). Servidor MCP é filho direto e vive o tempo todo: não conta.
export function tarefasRodando(pid, procs) {
  const shell = /^(bash|zsh|sh|dash|fish|powershell|pwsh)(\.exe)?$/i;
  const fila = procs.filter((p) => p.ppid === pid && shell.test(p.nome));
  const achados = [...fila];
  while (fila.length) {
    const atual = fila.shift();
    for (const p of procs) {
      if (p.ppid !== atual.pid || p.pid === atual.pid || achados.includes(p)) continue;
      achados.push(p);
      fila.push(p);
    }
  }
  return achados.filter((p) => !/^conhost\.exe$/i.test(p.nome));
}

// ---------- memória ----------
export function lerVmStat(texto) {
  const pagina = Number(texto.match(/page size of (\d+) bytes/)?.[1] ?? 4096);
  const n = (rotulo) => Number(texto.match(new RegExp(`${rotulo}:\\s+(\\d+)`))?.[1] ?? 0);
  return ((n('Pages free') + n('Pages inactive') + n('Pages speculative')) * pagina) / 2 ** 30;
}
export function memoriaLivreGB() {
  if (MAC) { try { return lerVmStat(rodar('vm_stat', [], { timeout: 10_000 })); } catch {} }
  return os.freemem() / 2 ** 30;
}
export const bootMs = () => Date.now() - os.uptime() * 1000;

// ---------- sessões do Claude Code ----------
export function sessaoDoPid(pid) {
  try { return JSON.parse(fs.readFileSync(path.join(CLAUDE_HOME, 'sessions', `${pid}.json`), 'utf8')); } catch { return null; }
}
export function sessoesVivas(procs) {
  const vivos = new Map(procs.filter(ehClaude).map((p) => [p.pid, p]));
  let dir = [];
  try { dir = fs.readdirSync(path.join(CLAUDE_HOME, 'sessions')).filter((f) => /^\d+\.json$/.test(f)); } catch {}
  const out = [];
  for (const f of dir) {
    const pid = Number(f.slice(0, -5));
    if (!vivos.has(pid)) continue;
    const s = sessaoDoPid(pid);
    if (s) out.push({ ...vivos.get(pid), sessao: s });
  }
  return out;
}
// A sessão da etapa: pelo --name e, sem ele, por qualquer Claude vivo na pasta de trabalho da etapa.
// Uma pasta, uma sessão: o vigia adota a que já está lá e nunca abre uma segunda.
export function sessaoDaEtapa(etapa, vivas) {
  return vivas.find((v) => v.sessao?.name === etapa.nome)
    ?? vivas.find((v) => v.sessao?.cwd && normal(v.sessao.cwd) === normal(etapa.pasta))
    ?? null;
}

// ---------- transcrições ----------
export const nomeDaPastaDeProjeto = (pasta) => path.resolve(pasta).replace(/[^A-Za-z0-9]/g, '-').toLowerCase();
export function pastasDeProjeto(pasta) {
  const alvo = nomeDaPastaDeProjeto(pasta);
  const raiz = path.join(CLAUDE_HOME, 'projects');
  try { return fs.readdirSync(raiz).filter((d) => d.toLowerCase() === alvo).map((d) => path.join(raiz, d)); } catch { return []; }
}
function lerTrecho(arquivo, inicio, tamanho) {
  const fd = fs.openSync(arquivo, 'r');
  try {
    const buf = Buffer.alloc(tamanho);
    const n = fs.readSync(fd, buf, 0, tamanho, inicio);
    return buf.subarray(0, n).toString('utf8');
  } finally { fs.closeSync(fd); }
}
// Pelo sessionId do estado; sem ele, a transcrição mais recente da pasta que tem o --name da etapa.
export function transcricao(etapa, sessionId) {
  if (sessionId && !UUID.test(sessionId)) return null; // vem do arquivo de estado: só UUID vira caminho
  const dirs = pastasDeProjeto(etapa.pasta);
  if (sessionId) {
    for (const dir of dirs) {
      const f = path.join(dir, `${sessionId}.jsonl`);
      if (fs.existsSync(f)) return { arquivo: f, sessionId, dir };
    }
    return null;
  }
  const marca = `"customTitle":${JSON.stringify(etapa.nome)}`;
  const candidatos = [];
  for (const dir of dirs) {
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.jsonl')) continue;
      const arquivo = path.join(dir, f);
      candidatos.push({ arquivo, dir, mtime: fs.statSync(arquivo).mtimeMs });
    }
  }
  candidatos.sort((a, b) => b.mtime - a.mtime);
  for (const c of candidatos.slice(0, 100)) {
    const tam = fs.statSync(c.arquivo).size;
    const texto = lerTrecho(c.arquivo, 0, 128 * 1024) + lerTrecho(c.arquivo, Math.max(0, tam - 512 * 1024), 512 * 1024);
    if (texto.includes(marca)) return { arquivo: c.arquivo, sessionId: path.basename(c.arquivo, '.jsonl'), dir: c.dir };
  }
  return null;
}
// A última fala de verdade (resposta do modelo ou resultado de ferramenta). A compactação automática da
// sessão parada escreve no arquivo e não conta como atividade. Sem linha legível, vale a data do arquivo.
export function ultimaFala(texto) {
  let mais = 0;
  for (const linha of texto.split('\n')) {
    if (!linha.startsWith('{')) continue;
    let j;
    try { j = JSON.parse(linha); } catch { continue; }
    if ((j.type !== 'assistant' && j.type !== 'user') || j.isCompactSummary || j.isMeta) continue;
    const ms = Date.parse(j.timestamp);
    if (ms > mais) mais = ms;
  }
  return mais || null;
}
export function ultimaAtividade(t) {
  const tam = fs.statSync(t.arquivo).size;
  let mais = ultimaFala(lerTrecho(t.arquivo, Math.max(0, tam - 512 * 1024), 512 * 1024)) ?? fs.statSync(t.arquivo).mtimeMs;
  const andar = (d, prof) => { // subagentes escrevem em <sessionId>/
    if (prof > 4) return;
    let itens = [];
    try { itens = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const i of itens) {
      const p = path.join(d, i.name);
      if (i.isDirectory()) andar(p, prof + 1);
      else { try { mais = Math.max(mais, fs.statSync(p).mtimeMs); } catch {} }
    }
  };
  andar(path.join(t.dir, t.sessionId), 0);
  return mais;
}
export function contarRespostas(arquivo) {
  try {
    let n = 0;
    for (const l of fs.readFileSync(arquivo, 'utf8').split('\n')) if (l.includes('"type":"assistant"')) n++;
    return n;
  } catch { return 0; }
}

export async function online() {
  for (let i = 0; i < 2; i++) {
    try {
      await fetch('https://api.anthropic.com', { method: 'HEAD', signal: AbortSignal.timeout(20_000) });
      return true;
    } catch {}
  }
  return false;
}
