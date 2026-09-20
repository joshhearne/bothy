# Backup and restore

Everything Bothy owns lives in two places: the Postgres database and the
uploads volume. Secrets are not among them — passwords and TOTP seeds stay in
your vault (see [VAULT_INTEGRATION.md](VAULT_INTEGRATION.md)), so a Bothy
backup never contains one.

| What | Where | Needed to restore |
|---|---|---|
| Database | `pgdata` volume, Postgres 16 | Yes |
| Attachments | `uploads` volume, or your S3 bucket | Yes, unless `STORAGE_DRIVER=s3` |
| `.env` | Your secret store | Yes: `AUTH_SECRET` signs sessions, `POSTGRES_PASSWORD` opens the database |
| `secrets/bw_master_password.txt` | Your secret store | Only in `bw_serve` mode |

## Back up

```bash
# Database, compressed custom format.
docker compose exec -T db pg_dump -U bothy -Fc bothy > bothy-$(date +%F).dump

# Attachments, when STORAGE_DRIVER=local.
docker run --rm -v bothy_uploads:/data -v "$PWD:/backup" alpine \
  tar czf /backup/bothy-uploads-$(date +%F).tar.gz -C /data .
```

Store `.env` alongside them. Without `AUTH_SECRET` every session cookie is
invalid after a restore, and everyone signs in again.

A nightly cron on the host is enough for most installs:

```cron
15 2 * * * cd /srv/bothy && docker compose exec -T db pg_dump -U bothy -Fc bothy > /backups/bothy-$(date +\%F).dump
```

## Restore

```bash
docker compose down
docker volume rm bothy_pgdata bothy_uploads     # only when starting clean
docker compose up -d db
# Wait for the healthcheck, then load the dump.
docker compose exec -T db pg_restore -U bothy -d bothy --clean --if-exists < bothy-2026-03-01.dump

docker run --rm -v bothy_uploads:/data -v "$PWD:/backup" alpine \
  tar xzf /backup/bothy-uploads-2026-03-01.tar.gz -C /data

docker compose up -d
```

Migrations run automatically on start, so a dump from an older version is
brought up to date by the container it is restored into.

## Verify a backup

Restore into a throwaway stack rather than trusting the file:

```bash
APP_PORT=3099 docker compose -p bothy-verify up -d db
docker compose -p bothy-verify exec -T db pg_restore -U bothy -d bothy --clean --if-exists < bothy-2026-03-01.dump
APP_PORT=3099 docker compose -p bothy-verify up -d
# Sign in, open a company, then tear it down.
docker compose -p bothy-verify down -v
```

## Exports are not backups

The per-company export (JSON and Markdown, from the company page or
`GET /api/v1/companies/:id/export`) is for reading and handover. It leaves out
revisions, the audit trail, API keys, and webhook configuration. Use `pg_dump`
for anything you intend to restore from.
