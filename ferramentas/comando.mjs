// O COMANDO QUE ABRE O CLAUDE NUMA ABA OU JANELA: PowerShell no Windows, zsh/bash no Mac.
// O comando é digitado num shell, então todo valor passa por lista fechada ou por aspas simples, e
// caminho com aspas simples é recusado. O prompt entra lido de um arquivo, nunca colado no comando.
import fs from 'node:fs';
import { UUID } from './sistema.mjs';

const NOME = /^[A-Za-z0-9._-]{1,80}$/;
const MODELO = /^[a-z0-9.-]{1,60}$/;
const ESFORCO = /^(low|medium|high|xhigh|max)$/;
const PERMISSAO = /^(default|acceptEdits|plan|bypassPermissions)$/;
const VAR = /^[A-Z_][A-Z0-9_]*$/;

export function seguro(valor, re, campo) {
  if (!re.test(String(valor))) throw new Error(`valor recusado em ${campo}: fora do formato`);
  return String(valor);
}
export function aspas(s) {
  const t = String(s);
  if (t.includes("'")) throw new Error(`aspas simples não são aceitas em caminho ou valor: ${t}`);
  return `'${t}'`;
}

// Prompt de abertura e de retomada: uma linha, sem aspas (a aba recebe o comando como se fosse digitado,
// e o PowerShell 5.1 do Windows estraga aspas duplas passadas a um programa).
export function lerPrompt(arquivo) {
  const texto = fs.readFileSync(arquivo, 'utf8').replace(/^﻿/, '').trim();
  if (!texto) throw new Error(`prompt vazio: ${arquivo}`);
  if (/['"\r\n]/.test(texto)) throw new Error(`prompt com aspas ou quebra de linha: ${arquivo}`);
  return texto;
}

// so: "win32" (PowerShell) ou qualquer outro (sh/zsh/bash).
export function comandoClaude(etapa, { resume = null, arquivoPrompt, so = process.platform, modoPermissao = 'bypassPermissions', mcpEstrito = true } = {}) {
  if (!arquivoPrompt) throw new Error('falta o arquivo do prompt');
  const win = so === 'win32';
  const claude = ['claude'];
  if (resume) claude.push('--resume', seguro(resume, UUID, 'sessionId'));
  claude.push('--name', aspas(seguro(etapa.nome, NOME, 'nome')));
  if (etapa.modelo) claude.push('--model', seguro(etapa.modelo, MODELO, 'modelo'));
  if (etapa.esforco) claude.push('--effort', seguro(etapa.esforco, ESFORCO, 'esforco'));
  // --mcp-config aceita vários valores: vem antes de outra opção, senão engole o prompt.
  if (etapa.mcpConfig) claude.push('--mcp-config', aspas(etapa.mcpConfig));
  if (mcpEstrito) claude.push('--strict-mcp-config');
  claude.push('--permission-mode', seguro(modoPermissao, PERMISSAO, 'modoPermissao'));
  const env = Object.entries(etapa.env ?? {}).map(([k, v]) => [seguro(k, VAR, 'env'), aspas(String(v))]);
  if (win) {
    claude.push(`(Get-Content -Raw -Encoding UTF8 -LiteralPath ${aspas(arquivoPrompt)}).Trim()`);
    return [`Set-Location -LiteralPath ${aspas(etapa.pasta)}`, ...env.map(([k, v]) => `$env:${k}=${v}`), claude.join(' ')].join('; ');
  }
  claude.push(`"$(cat ${aspas(arquivoPrompt)})"`);
  return [`cd ${aspas(etapa.pasta)}`, ...env.map(([k, v]) => `export ${k}=${v}`), claude.join(' ')].join(' && ');
}
