#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DAEMON_SH="$SCRIPT_DIR/daemon.sh"
CTI_HOME="${CTI_HOME:-$HOME/.claude-to-im}"
PID_FILE="$CTI_HOME/runtime/bridge.pid"
STATUS_FILE="$CTI_HOME/runtime/status.json"
RESTART_REQUEST_FILE="$CTI_HOME/runtime/restart-request.json"
LAUNCHD_LABEL="com.claude-to-im.bridge"
LAUNCHD_TARGET="gui/$(id -u)/$LAUNCHD_LABEL"

if [ ! -x "$DAEMON_SH" ]; then
  echo "daemon.sh not found or not executable: $DAEMON_SH" >&2
  exit 1
fi

is_running() {
  if [[ "$(uname -s)" == "Darwin" ]]; then
    local lc_pid
    lc_pid=$(launchctl print "$LAUNCHD_TARGET" 2>/dev/null | awk -F'= ' '/pid = / {print $2; exit}' | tr -d ' ')
    if [ -n "${lc_pid:-}" ] && [ "$lc_pid" != "0" ] && [ "$lc_pid" != "-" ]; then
      return 0
    fi
  fi

  if [ -f "$PID_FILE" ]; then
    local pid
    pid=$(cat "$PID_FILE" 2>/dev/null || true)
    if [ -n "${pid:-}" ] && kill -0 "$pid" 2>/dev/null; then
      return 0
    fi
  fi

  return 1
}

status_reports_running() {
  [ -f "$STATUS_FILE" ] && grep -q '"running"[[:space:]]*:[[:space:]]*true' "$STATUS_FILE" 2>/dev/null
}

current_bridge_pid() {
  if [[ "$(uname -s)" == "Darwin" ]]; then
    launchctl print "$LAUNCHD_TARGET" 2>/dev/null | awk -F'= ' '/pid = / {print $2; exit}' | tr -d ' '
    return
  fi

  if [ -f "$PID_FILE" ]; then
    cat "$PID_FILE" 2>/dev/null || true
  fi
}

process_has_ancestor() {
  local pid="$1"
  local target="$2"
  while [ -n "${pid:-}" ] && [ "$pid" != "1" ] && [ "$pid" != "$target" ]; do
    pid=$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ' || true)
  done
  [ -n "${pid:-}" ] && [ "$pid" = "$target" ]
}

invoked_from_bridge_process() {
  local bridge_pid
  bridge_pid=$(current_bridge_pid)
  [ -n "${bridge_pid:-}" ] || return 1
  process_has_ancestor "$$" "$bridge_pid"
}

request_in_process_restart() {
  mkdir -p "$CTI_HOME/runtime"
  cat > "$RESTART_REQUEST_FILE" <<EOF
{"requestedAt":"$(date -u +%Y-%m-%dT%H:%M:%SZ)","requestedBy":"daemon-restart-safe.sh","delayMs":15000}
EOF
  echo "[daemon-restart-safe] restart requested via $RESTART_REQUEST_FILE"
  echo "[daemon-restart-safe] daemon will exit non-zero after the current chat turn and launchd will relaunch it"
}

if invoked_from_bridge_process; then
  request_in_process_restart
  exit 0
fi

wait_until_stopped() {
  local attempts=20
  while [ "$attempts" -gt 0 ]; do
    if ! is_running; then
      rm -f "$PID_FILE"
      return 0
    fi
    sleep 1
    attempts=$((attempts - 1))
  done
  return 1
}

wait_until_started() {
  local attempts=20
  while [ "$attempts" -gt 0 ]; do
    if is_running && status_reports_running; then
      return 0
    fi
    sleep 1
    attempts=$((attempts - 1))
  done
  return 1
}

echo "[daemon-restart-safe] stop"
bash "$DAEMON_SH" stop

echo "[daemon-restart-safe] waiting for shutdown"
wait_until_stopped || {
  echo "[daemon-restart-safe] stop did not fully complete in time" >&2
  bash "$DAEMON_SH" status || true
  exit 1
}

sleep 2

echo "[daemon-restart-safe] start"
bash "$DAEMON_SH" start || {
  echo "[daemon-restart-safe] first start attempt failed, retrying once after cleanup wait"
  sleep 3
  wait_until_stopped || true
  bash "$DAEMON_SH" start
}

echo "[daemon-restart-safe] waiting for running status"
wait_until_started || {
  echo "[daemon-restart-safe] daemon did not report running=true in time" >&2
  bash "$DAEMON_SH" status || true
  exit 1
}

echo "[daemon-restart-safe] status"
bash "$DAEMON_SH" status
