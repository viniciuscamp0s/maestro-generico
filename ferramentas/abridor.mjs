// ABRIDOR: o ÚNICO ponto do Maestro que depende do Orca. Trocar de ferramenta é mexer só aqui.
//
//   abridor "orca"    abre a sessão numa aba do Orca, lê a tela, digita o cutucão, aceita a tela de
//                     confiança da pasta e fecha a aba quando a etapa fecha.
//   abridor "janela"  sem Orca (quem trabalha no VS Code): abre a sessão numa janela de terminal solta
//                     (PowerShell no Windows, Terminal no Mac). Não lê tela, não cutuca e não fecha:
//                     só retoma a sessão que caiu. Sessão viva e parada fica registrada na
//                     ultima-rodada.json para o Maestro ver.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MAC, WINDOWS, normal, rodar } from './sistema.mjs';

function acharOrca(config) {
  if (config.orca?.executavel) return config.orca.executavel;
  const candidatos = WINDOWS
    ? [path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Programs', 'orca', 'resources', 'bin', 'orca.exe')]
    : ['/Applications/Orca.app/Contents/Resources/bin/orca', path.join(os.homedir(), 'Applications', 'Orca.app', 'Contents', 'Resources', 'bin', 'orca'), '/opt/homebrew/bin/orca', '/usr/local/bin/orca'];
  return candidatos.find((c) => fs.existsSync(c)) ?? 'orca';
}

const ESC = '\u001b';
const titulo = (t) => String(t ?? '').replace(/['"`$\\\r\n]/g, '').slice(0, 80);

function abridorOrca(config) {
  const exe = acharOrca(config);
  const orca = (argv, timeout = 60_000) => {
    let saida;
    try { saida = rodar(exe, [...argv, '--json'], { timeout }); } catch (e) {
      throw new Error(`orca ${argv.slice(0, 2).join(' ')}: ${String(e.stdout || e.stderr || e.message).slice(0, 400)}`);
    }
    const j = JSON.parse(saida);
    if (!j.ok) throw new Error(`orca ${argv.slice(0, 2).join(' ')}: ${saida.slice(0, 300)}`);
    return j.result;
  };
  const tela = (handle) => {
    try { return orca(['terminal', 'read', '--terminal', handle, '--screen'], 30_000)?.terminal?.tail ?? []; } catch { return []; }
  };
  return {
    tipo: 'orca', podeCutucar: true, podeFechar: true,
    pronto() {
      try {
        const r = orca(['status'], 120_000);
        return r?.runtime?.state === 'ready' || { erro: `Orca: runtime ${r?.runtime?.state}` };
      } catch (e) { return { erro: String(e?.stderr || e?.message || e).slice(0, 300) }; }
    },
    // Terminal desconectado (aba já fechada, registro que o Orca ainda guarda) não conta como aba.
    abas() { return (orca(['terminal', 'list'])?.terminals ?? []).filter((t) => t.connected !== false); },
    // Aba da sessão: pela aba que o vigia abriu, senão pelo título (o --name ou o título dado na abertura).
    acharAba(nome, abas, handle, tituloAba) {
      return abas.find((t) => handle && t.handle === handle)
        ?? abas.find((t) => { const tt = (t.title ?? '').trim(); return tt === nome || tt.endsWith(` ${nome}`) || (tituloAba && tt === titulo(tituloAba)); })
        ?? null;
    },
    abrir({ projetoOrca, tituloAba, comando, pasta }) {
      if (!projetoOrca) throw new Error('falta o projeto do Orca (orcaProjeto do projeto, ou orca.projetoPadrao na configuração)');
      const r = orca(['terminal', 'create', '--worktree', `path:${projetoOrca.replaceAll('\\', '/')}`, '--title', titulo(tituloAba), '--command', comando]);
      let handle = r?.terminal?.handle ?? r?.handle ?? null;
      if (!handle) {
        try { const da = this.abas().filter((t) => normal(t.worktreePath) === normal(pasta)); handle = da.at(-1)?.handle ?? null; } catch {}
      }
      return handle;
    },
    tela,
    enviar(handle, texto) { orca(['terminal', 'send', '--terminal', handle, '--text', texto], 60_000); },
    esc(handle) { orca(['terminal', 'send', '--terminal', handle, '--text', ESC]); },
    fechar(handle) { orca(['terminal', 'close', '--terminal', handle, '--tab']); },
    // Pasta nova abre "Is this a project you trust?" (e às vezes "Allow external CLAUDE.md file imports?")
    // antes do prompt. O vigia só abre pastas das filas do Maestro, então confia: seta para baixo e Enter.
    aceitarConfianca(handle) {
      if (!handle) return false;
      if (!tela(handle).some((l) => /Yes, I trust this folder|Yes, allow external imports/i.test(l))) return false;
      orca(['terminal', 'send', '--terminal', handle, '--text', `${ESC}[B`]);
      orca(['terminal', 'send', '--terminal', handle, '--text', '\r']);
      return true;
    },
  };
}

function abridorJanela() {
  return {
    tipo: 'janela', podeCutucar: false, podeFechar: false,
    pronto: () => true,
    abas: () => [],
    acharAba: () => null,
    abrir({ tituloAba, comando }) {
      if (WINDOWS) {
        const filho = spawn('powershell.exe', ['-NoExit', '-Command', `$Host.UI.RawUI.WindowTitle='${titulo(tituloAba)}'; ${comando}`], {
          detached: true, stdio: 'ignore', windowsHide: false,
        });
        filho.unref();
      } else if (MAC) {
        const texto = comando.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
        rodar('osascript', ['-e', `tell application "Terminal" to do script "${texto}"`], { timeout: 30_000 });
      } else {
        throw new Error('abridor "janela" só existe para Windows e Mac');
      }
      return null;
    },
    tela: () => [],
    enviar() { throw new Error('sem Orca não há como digitar na janela'); },
    esc() {},
    fechar() {},
    aceitarConfianca: () => false,
  };
}

export function criarAbridor(config) {
  return config.abridor === 'janela' ? abridorJanela() : abridorOrca(config);
}
