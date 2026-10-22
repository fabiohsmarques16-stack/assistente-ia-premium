#!/usr/bin/env bash
# Roda as migrações e os testes num PostgreSQL temporário.
# Uso: supabase/tests/run.sh   (precisa de initdb/pg_ctl/psql no PATH ou em /usr/lib/postgresql/*/bin)
set -euo pipefail
cd "$(dirname "$0")/.."

PGBIN=${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}
export PATH="$PGBIN:$PATH"
TMP=$(mktemp -d)
PORT=${PGPORT_TESTE:-54329}

# initdb não roda como root: usa o usuário postgres quando necessário
run() { if [ "$(id -u)" = "0" ]; then runuser -u postgres -- env PATH="$PATH" "$@"; else "$@"; fi; }
if [ "$(id -u)" = "0" ]; then chown -R postgres "$TMP"; fi
trap 'run pg_ctl -D "$TMP/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$TMP"' EXIT

run initdb -D "$TMP/data" -U postgres -A trust >/dev/null
run pg_ctl -D "$TMP/data" -o "-p $PORT -k $TMP -c listen_addresses=''" -l "$TMP/log" start >/dev/null
PSQL=(psql -h "$TMP" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q -X)

"${PSQL[@]}" -f tests/supabase_stub.sql
for f in migrations/*.sql; do
  echo "migração: $(basename "$f")"
  "${PSQL[@]}" -1 -f "$f"
done
echo "testes:"
"${PSQL[@]}" -f tests/testes.sql
