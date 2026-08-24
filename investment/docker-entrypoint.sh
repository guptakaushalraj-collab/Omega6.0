#!/bin/sh
# Migrations run on every boot: they are idempotent (each file is recorded in
# schema_migrations), so a restart against an existing volume is a no-op and a
# fresh volume is initialised without a separate deploy step.
set -e
node database/migrate.js
exec node backend/src/server.js
