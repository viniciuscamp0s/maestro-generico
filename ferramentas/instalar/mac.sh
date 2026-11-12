#!/usr/bin/env bash
# Instala o vigia do Maestro no Mac: um LaunchAgent (launchd) que roda ferramentas/vigia.mjs no login e a
# cada 10 minutos, sem janela. Cria maestro.config.json a partir do exemplo se ainda não existir. Idempotente.
# Uso:      bash ferramentas/instalar/mac.sh
# Remover:  bash ferramentas/instalar/mac.sh --remover
# Desligar sem remover: launchctl bootout gui/$(id -u)/com.maestro.vigia
set -euo pipefail
ROTULO="com.maestro.vigia"
PLIST="$HOME/Library/LaunchAgents/$ROTULO.plist"
DOMINIO="gui/$(id -u)"

if [ "${1:-}" = "--remover" ]; then
  launchctl bootout "$DOMINIO/$ROTULO" 2>/dev/null || true
  rm -f "$PLIST"
  echo "Vigia removido."
  exit 0
fi

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
if [ ! -f "$RAIZ/maestro.config.json" ]; then
  cp "$RAIZ/maestro.config.exemplo.json" "$RAIZ/maestro.config.json"
  echo "Criado $RAIZ/maestro.config.json (preencha os projetos)."
fi
NODE="$(command -v node || true)"
if [ -z "$NODE" ]; then
  echo "Node.js não encontrado. Instale em https://nodejs.org (ou brew install node) e rode de novo." >&2
  exit 1
fi
CLAUDE="$(command -v claude || true)"
[ -n "$CLAUDE" ] || echo "Aviso: Claude Code não encontrado no PATH; o vigia não vai conseguir abrir sessões." >&2

# O launchd roda com um PATH mínimo: leva junto as pastas do node, do claude e as de costume.
CAMINHO="$(dirname "$NODE")"
[ -n "$CLAUDE" ] && CAMINHO="$CAMINHO:$(dirname "$CLAUDE")"
CAMINHO="$CAMINHO:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
xml() { printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }

mkdir -p "$RAIZ/estado" "$HOME/Library/LaunchAgents"
{
  echo '<?xml version="1.0" encoding="UTF-8"?>'
  echo '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">'
  echo '<plist version="1.0">'
  echo '<dict>'
  echo "  <key>Label</key><string>$ROTULO</string>"
  echo '  <key>ProgramArguments</key>'
  echo '  <array>'
  echo "    <string>$(xml "$NODE")</string>"
  echo "    <string>$(xml "$RAIZ/ferramentas/vigia.mjs")</string>"
  echo '  </array>'
  echo "  <key>WorkingDirectory</key><string>$(xml "$RAIZ")</string>"
  echo '  <key>EnvironmentVariables</key>'
  echo '  <dict>'
  echo "    <key>PATH</key><string>$(xml "$CAMINHO")</string>"
  echo "    <key>HOME</key><string>$(xml "$HOME")</string>"
  echo '  </dict>'
  echo '  <key>RunAtLoad</key><true/>'
  echo '  <key>StartInterval</key><integer>600</integer>'
  echo '  <key>ProcessType</key><string>Background</string>'
  echo "  <key>StandardErrorPath</key><string>$(xml "$RAIZ/estado/lancador.log")</string>"
  echo '</dict>'
  echo '</plist>'
} > "$PLIST"
plutil -lint "$PLIST" >/dev/null
launchctl bootout "$DOMINIO/$ROTULO" 2>/dev/null || true
launchctl bootstrap "$DOMINIO" "$PLIST"
echo "Vigia instalado: roda no login e a cada 10 minutos ($PLIST)."
echo "Teste agora: node \"$RAIZ/ferramentas/vigia.mjs\" --check"
