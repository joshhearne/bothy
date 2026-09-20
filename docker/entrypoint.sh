#!/bin/sh
set -e

# Apply pending migrations before serving. Safe to run on every container start:
# drizzle records applied migrations in __drizzle_migrations.
echo "bothy: applying database migrations"
node /app/dist/migrate.js

if [ "${SEED_ON_START:-false}" = "true" ]; then
  echo "bothy: seeding starter data"
  node /app/dist/seed.js
fi

echo "bothy: starting server on ${HOSTNAME:-0.0.0.0}:${PORT:-3000}"
exec node /app/server.js
