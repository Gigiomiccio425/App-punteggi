#!/usr/bin/env bash
# Esegue la migrazione e i test SQL su un PostgreSQL temporaneo locale (non serve Docker).
# Uso: npm run test:sql   (richiede i binari di PostgreSQL 15+: initdb, pg_ctl, psql)
set -euo pipefail
cd "$(dirname "$0")/../.."

PG_BIN="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1 || true)}"
if [ -z "$PG_BIN" ] || [ ! -x "$PG_BIN/initdb" ]; then PG_BIN="$(dirname "$(command -v initdb)")"; fi
PORT="${PG_PORT:-54329}"
WORK="$(mktemp -d -t party-casino-pg-XXXXXX)"
RUN=()
if [ "$(id -u)" = "0" ]; then chown postgres "$WORK"; RUN=(runuser -u postgres --); fi

cleanup() {
  "${RUN[@]}" "$PG_BIN/pg_ctl" -D "$WORK/data" stop -m immediate >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

"${RUN[@]}" "$PG_BIN/initdb" -D "$WORK/data" -U postgres -A trust >/dev/null
"${RUN[@]}" "$PG_BIN/pg_ctl" -D "$WORK/data" -o "-p $PORT -k $WORK -c listen_addresses=''" -l "$WORK/log" -w start >/dev/null
PSQL=("${RUN[@]}" "$PG_BIN/psql" -X -h "$WORK" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q)

"${PSQL[@]}" -f supabase/tests/00_supabase_stubs.sql
for f in supabase/migrations/*.sql; do
  echo "→ migrazione $f"
  "${PSQL[@]}" -f "$f"
done
"${PSQL[@]}" -o /dev/null -f supabase/tests/10_flow_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
