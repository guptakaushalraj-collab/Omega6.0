#!/usr/bin/env bash
# Start / stop / check the site as a background process that survives logout.
#
#   ./serve.sh start     start it (default port 8000)
#   ./serve.sh stop      stop it
#   ./serve.sh status    is it running, and is it answering
#   ./serve.sh log       tail the log
#
#   PORT=9000 ./serve.sh start        # different port
#   HOST=127.0.0.1 ./serve.sh start   # localhost only (default is 0.0.0.0)
set -euo pipefail

cd "$(dirname "$0")"
PORT="${PORT:-8000}"
HOST="${HOST:-0.0.0.0}"
LOG="${LOG:-$PWD/server.log}"
PIDFILE="${PIDFILE:-$PWD/server.pid}"

running() { [[ -f "$PIDFILE" ]] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; }

start() {
  if running; then echo "Already running (pid $(cat "$PIDFILE")) — ./serve.sh stop first."; exit 1; fi

  # Build the frontend if it is missing, otherwise the server serves API only.
  if [[ ! -d frontend/dist ]]; then
    echo "frontend/dist missing — building..."
    npm --prefix frontend install --silent
    npm --prefix frontend run build
  fi

  # THE THREE REDIRECTIONS THAT MATTER, and why:
  #   </dev/null  detach stdin. A background job that reads the terminal is
  #               stopped with SIGTTIN the moment the terminal goes away.
  #   >"$LOG"     stdout to a file. Without it nohup writes ./nohup.out, and
  #               anything you needed to debug lands wherever you happened to be.
  #   2>&1        stderr to the same place. Crashes go to stderr; a log missing
  #               them tells you the process died and nothing about why.
  # setsid puts it in a NEW SESSION, so the shell's hangup on logout is never
  # delivered to it in the first place. nohup is the second layer. The app also
  # ignores SIGHUP itself (see server.js) — measured necessary: without that,
  # `nohup node ...` still dies on a direct SIGHUP.
  HOST="$HOST" PORT="$PORT" setsid nohup node backend/src/server.js </dev/null >"$LOG" 2>&1 &
  echo $! > "$PIDFILE"
  # disown removes the job from THIS shell's table, so the shell cannot send it
  # SIGHUP on exit. nohup already ignores SIGHUP; this closes the gap where a
  # shell signals before the exec, and makes the intent explicit.
  disown %% 2>/dev/null || true

  for _ in $(seq 40); do
    if curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
      echo "Running on http://$HOST:$PORT  (pid $(cat "$PIDFILE"), log $LOG)"
      exit 0
    fi
    sleep 0.25
  done
  echo "Started (pid $(cat "$PIDFILE")) but /api/health did not answer. Last log lines:"
  tail -20 "$LOG"; exit 1
}

stop() {
  if ! running; then echo "Not running."; rm -f "$PIDFILE"; exit 0; fi
  PID=$(cat "$PIDFILE")
  kill "$PID"
  for _ in $(seq 20); do kill -0 "$PID" 2>/dev/null || break; sleep 0.25; done
  kill -9 "$PID" 2>/dev/null || true
  rm -f "$PIDFILE"
  echo "Stopped."
}

case "${1:-start}" in
  start)  start ;;
  stop)   stop ;;
  restart) "$0" stop; "$0" start ;;
  status)
    if running; then
      echo "pid $(cat "$PIDFILE") — health: $(curl -fsS "http://127.0.0.1:$PORT/api/health" 2>/dev/null || echo 'NOT ANSWERING')"
    else
      echo "Not running."
    fi ;;
  log)    tail -f "$LOG" ;;
  *)      echo "usage: $0 {start|stop|restart|status|log}"; exit 1 ;;
esac
