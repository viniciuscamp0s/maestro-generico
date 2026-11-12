// CONFIGURAÇÃO DO MAESTRO: lê maestro.config.json (na raiz do repositório, fora do git) e completa com os
// valores padrão. Nenhum caminho fixo mora no código: tudo sai daqui.
//   "~/pasta"   vira a pasta pessoal do usuário (Windows e Mac)
//   "pasta"     relativo vira relativo à raiz deste repositório
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ARQUIVO_CONFIG = path.join(RAIZ, 'maestro.config.json');

export const PADRAO = Object.freeze({
  abridor: 'orca',              // "orca" (abre e fecha abas) ou "janela" (sem Orca: janela de terminal solta)
  pastaEstado: 'estado',        // estado das etapas, log, travas (fora do git)
  pastaFilas: 'ferramentas/filas',
  pastaPrompts: 'ferramentas/prompts',
  paradaMin: 30,                // sessão viva sem falar há mais que isso, e sem tarefa rodando = parada
  esperaAberturaMin: 15,        // depois de abrir ou retomar, espera isso antes de agir de novo na etapa
  quietoParaFecharMin: 10,      // etapa fechada e sessão quieta há isso: a aba sai do Orca
  memoriaMinimaGB: 0.5,         // abaixo disso não abre nem retoma sessão
  maxCutucoes: 3,               // retomadas sem progresso antes de virar esperando-dono
  progressoRespostas: 15,       // respostas desde a última retomada que contam como progresso
  modoPermissao: 'bypassPermissions',
  mcpEstrito: true,             // --strict-mcp-config: evita a tela de aprovação de MCP antes do prompt
  orca: { executavel: null, projetoPadrao: null },
  projetos: [],                 // [{ nome, pasta, orcaProjeto }]
});

export function expandir(p, base = RAIZ) {
  if (p == null || p === '') return p;
  let s = String(p);
  if (s === '~' || s.startsWith('~/') || s.startsWith('~\\')) s = path.join(os.homedir(), s.slice(1));
  return path.resolve(base, s);
}

export function lerJson(arquivo) {
  return JSON.parse(fs.readFileSync(arquivo, 'utf8').replace(/^﻿/, '')); // PowerShell 5.1 grava com BOM
}

export function carregarConfig(arquivo = ARQUIVO_CONFIG) {
  if (!fs.existsSync(arquivo)) return null;
  const bruto = lerJson(arquivo);
  const c = { ...PADRAO, ...bruto, orca: { ...PADRAO.orca, ...(bruto.orca ?? {}) } };
  if (!['orca', 'janela'].includes(c.abridor)) throw new Error(`abridor deve ser "orca" ou "janela", veio ${JSON.stringify(c.abridor)}`);
  c.pastaEstado = expandir(c.pastaEstado);
  c.pastaFilas = expandir(c.pastaFilas);
  c.pastaPrompts = expandir(c.pastaPrompts);
  if (c.orca.executavel) c.orca.executavel = expandir(c.orca.executavel);
  if (c.orca.projetoPadrao) c.orca.projetoPadrao = expandir(c.orca.projetoPadrao);
  c.projetos = (c.projetos ?? []).map((p) => ({
    ...p, pasta: expandir(p.pasta), orcaProjeto: p.orcaProjeto ? expandir(p.orcaProjeto) : expandir(p.pasta),
  }));
  return c;
}
