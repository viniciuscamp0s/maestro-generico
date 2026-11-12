#!/usr/bin/env bash
# TRAVA DE TRABALHO PESADO: um comando pesado por vez na máquina, entre todas as sessões abertas.
# Várias sessões rodando testes, build ou render ao mesmo tempo numa máquina com pouca memória derrubam
# umas às outras. Roda no Mac (bash/zsh) e no Windows (Git Bash).
#
# USO
#   bash ferramentas/trava.sh <nome> <comando...>
#   ex.: bash ferramentas/trava.sh pesada npm test
#        bash ferramentas/trava.sh deploy bash scripts/publicar.sh
#
# NOMES SUGERIDOS
#   pesada   build, bateria de testes, instalação de dependências, render (um por vez na máquina)
#   deploy   publicação (um por vez); quem publica e também compila pega a "pesada" antes
#
# REGRAS
#   - A trava é uma pasta criada de uma vez (mkdir é atômico): <estado>/travas/<nome>.lock
#   - Fila por ordem de chegada: quem espera se registra em travas/<nome>.espera/<pid>. Empate no mesmo
#     segundo: o pid menor. TRAVA_PRIORIDADE=1 passa na frente de quem não tem prioridade.
#   - Espera até TRAVA_ESPERA_MIN minutos (padrão 8, cabe no limite de 10 min da ferramenta Bash do
#     Claude Code). Não conseguiu: sai com código 75, e a sessão tenta de novo depois.
#   - Trava de processo morto, ou com mais de TRAVA_VELHA_MIN minutos (padrão 120), é desfeita.
#   - Ao sair, só apaga a trava se ela ainda for deste processo. O código de saída é o do comando.
#   - Ensaio e teste: TRAVA_PASTA (pasta das travas), TRAVA_ESPERA_S (espera em segundos),
#     TRAVA_INTERVALO_S (intervalo entre tentativas, padrão 15).
{
set -u
nome="${1:-}"
[ -n "$nome" ] || { echo "uso: trava.sh <nome> <comando...>" >&2; exit 2; }
shift
[ "$#" -gt 0 ] || { echo "trava.sh: falta o comando" >&2; exit 2; }
case "$nome" in *[!a-z0-9-]*) echo "trava.sh: nome só com a-z, 0-9 e -" >&2; exit 2;; esac

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PASTA="${TRAVA_PASTA:-$AQUI/../estado/travas}"
mkdir -p "$PASTA"
TRAVA="$PASTA/$nome.lock"
ESPERA="$PASTA/$nome.espera"
mkdir -p "$ESPERA"
MINHA="$ESPERA/$$"
ESPERA_S="${TRAVA_ESPERA_S:-$(( ${TRAVA_ESPERA_MIN:-8} * 60 ))}"
VELHA_S=$(( ${TRAVA_VELHA_MIN:-120} * 60 ))
INTERVALO_S="${TRAVA_INTERVALO_S:-15}"
PRIO="${TRAVA_PRIORIDADE:-0}"
quem="${TRAVA_QUEM:-$(basename "$PWD")}"
inicio="$(date +%s)"

campo() { sed -n "s/^$1=//p" "$2" 2>/dev/null; }

desfazer_se_velha() {
  [ -d "$TRAVA" ] || return 0
  local pid desde
  pid="$(campo pid "$TRAVA/dono")"
  desde="$(campo desde "$TRAVA/dono")"
  if [ -n "$pid" ] && ! kill -0 "$pid" 2>/dev/null; then
    echo "trava.sh: '$nome' era de um processo que já morreu ($pid); desfeita" >&2
    rm -rf "$TRAVA"
  elif [ -n "$desde" ] && [ $(( $(date +%s) - desde )) -gt "$VELHA_S" ]; then
    echo "trava.sh: '$nome' passou de ${TRAVA_VELHA_MIN:-120} min; desfeita" >&2
    rm -rf "$TRAVA"
  elif [ -z "$pid" ] && [ ! -f "$TRAVA/dono" ]; then
    # pasta criada e o dono ainda não escrito (ou quem criou morreu nesse instante): dá 30 s
    local idade
    idade=$(( $(date +%s) - $(stat -c %Y "$TRAVA" 2>/dev/null || stat -f %m "$TRAVA" 2>/dev/null || date +%s) ))
    [ "$idade" -gt 30 ] && rm -rf "$TRAVA"
  fi
}

registrar() {
  printf 'quem=%s\nprioridade=%s\npid=%s\ndesde=%s\nvisto=%s\n' "$quem" "$PRIO" "$$" "$inicio" "$(date +%s)" > "$MINHA.tmp" && mv -f "$MINHA.tmp" "$MINHA"
}

# Tira da fila quem morreu (processo que não existe mais ou sem sinal há 2 min).
limpar_esperas() {
  local f p v agora
  agora="$(date +%s)"
  for f in "$ESPERA"/*; do
    [ -f "$f" ] || continue
    case "$f" in *.tmp) continue;; esac
    p="$(campo pid "$f")"; v="$(campo visto "$f")"
    if { [ -n "$p" ] && ! kill -0 "$p" 2>/dev/null; } || { [ -n "$v" ] && [ $(( agora - v )) -gt 120 ]; }; then
      rm -f "$f"
    fi
  done
}

# 0 (verdadeiro) quando há outro na frente: com prioridade maior, ou igual e chegado antes.
alguem_na_frente() {
  local f p d o
  for f in "$ESPERA"/*; do
    [ -f "$f" ] || continue
    [ "$f" = "$MINHA" ] && continue
    case "$f" in *.tmp) continue;; esac
    p="$(campo prioridade "$f")"; p="${p:-0}"
    [ "$p" -gt "$PRIO" ] 2>/dev/null && return 0
    [ "$p" = "$PRIO" ] || continue
    d="$(campo desde "$f")"; o="$(campo pid "$f")"
    [ -n "$d" ] || continue
    [ "$d" -lt "$inicio" ] 2>/dev/null && return 0
    [ "$d" = "$inicio" ] && [ -n "$o" ] && [ "$o" -lt "$$" ] 2>/dev/null && return 0
  done
  return 1
}

trap 'rm -f "$MINHA" "$MINHA.tmp"' EXIT INT TERM
avisado=0
while :; do
  registrar
  limpar_esperas
  if ! alguem_na_frente && mkdir "$TRAVA" 2>/dev/null; then break; fi
  desfazer_se_velha
  if [ $(( $(date +%s) - inicio )) -ge "$ESPERA_S" ]; then
    echo "trava.sh: '$nome' ocupada por: $(tr '\n' ' ' < "$TRAVA/dono" 2>/dev/null). Tente de novo." >&2
    exit 75
  fi
  if [ "$avisado" -eq 0 ]; then
    echo "trava.sh: esperando '$nome' (ocupada por: $(campo quem "$TRAVA/dono"))" >&2
    avisado=1
  fi
  sleep "$INTERVALO_S"
done
rm -f "$MINHA" "$MINHA.tmp"

printf 'pid=%s\ndesde=%s\nquem=%s\ncomando=%s\n' "$$" "$(date +%s)" "$quem" "$*" > "$TRAVA/dono"
soltar() { [ "$(campo pid "$TRAVA/dono")" = "$$" ] && rm -rf "$TRAVA"; }
trap soltar EXIT INT TERM

"$@"
exit $?
}
