#!/bin/sh
# Installs or removes watercooler as a macOS LaunchAgent, so it runs at login and restarts if it stops.
# Usage: scripts/service.sh install | uninstall
set -eu

LABEL="cc.steen.watercooler"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="$HOME/.watercooler"
DOMAIN="gui/$(id -u)"

# Point at the version manager's shim rather than one Node version, so Node upgrades don't break the service.
NODE="$(command -v node)"

install() {
  (cd "$PROJECT_DIR" && pnpm build)
  mkdir -p "$LOG_DIR" "$(dirname "$PLIST")"

  cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>$PROJECT_DIR/dist/index.mjs</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$PROJECT_DIR</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$LOG_DIR/server.log</string>
  <key>StandardErrorPath</key>
  <string>$LOG_DIR/server.log</string>
</dict>
</plist>
EOF

  # Reinstalling replaces the running service with the fresh build.
  launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
  launchctl bootstrap "$DOMAIN" "$PLIST"
  # RunAtLoad isn't always honored right after a bootout, so start it explicitly.
  launchctl kickstart "$DOMAIN/$LABEL"
  echo "Watercooler runs at http://127.0.0.1:4747. Log: $LOG_DIR/server.log"
}

uninstall() {
  launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  echo "Watercooler service removed."
}

case "${1:-}" in
  install) install ;;
  uninstall) uninstall ;;
  *) echo "Usage: $0 install | uninstall" >&2; exit 1 ;;
esac
