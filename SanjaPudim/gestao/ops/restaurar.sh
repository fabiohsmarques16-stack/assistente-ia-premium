#!/usr/bin/env bash
# Restaura um backup do SANJA Gestão.
# Uso: ops/restaurar.sh sanja-AAAA-MM-DD.dump.gpg "postgresql://...connection string do projeto de destino..."
# Recomendado: restaurar num projeto Supabase NOVO e vazio (sem rodar as migrações antes),
# conferir os dados e só então apontar o app e o bot para ele.
set -euo pipefail
arquivo=${1:?informe o arquivo .dump.gpg}
destino=${2:?informe a connection string do banco de destino}
dump="${arquivo%.gpg}"

gpg --batch --yes --pinentry-mode loopback --decrypt --output "$dump" "$arquivo"
psql "$destino" -v ON_ERROR_STOP=1 -c "select 1" >/dev/null

# o schema public já existe no projeto novo: restaura todo o resto
pg_restore -l "$dump" | grep -v " SCHEMA - public " > "$dump.lista"
pg_restore --dbname="$destino" --no-owner --single-transaction --exit-on-error -L "$dump.lista" "$dump"
# o Supabase reaplica permissões padrão às tabelas recriadas; volta às do sistema
psql "$destino" -v ON_ERROR_STOP=1 -q -c "select sanja_aplicar_permissoes()"
rm -f "$dump.lista"
echo "Restaurado. Confira: psql \"$destino\" -c 'select count(*) from pedidos'"
