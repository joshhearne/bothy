# Backup and restore

Everything Strata owns lives in two places: the Postgres database and the
uploads volume. Secrets are not among them — passwords and TOTP seeds stay in
your vault (see [VAULT_INTEGRATION.md](VAULT_INTEGRATION.md)), so a Strata
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
docker compose exec -T db pg_dump -U strata -Fc strata > strata-$(date +%F).dump

# Attachments, when STORAGE_DRIVER=local.
docker run --rm -v strata_uploads:/data -v "$PWD:/backup" alpine \
  tar czf /backup/strata-uploads-$(date +%F).tar.gz -C /data .
```

Store `.env` alongside them. Without `AUTH_SECRET` every session cookie is
invalid after a restore, and everyone signs in again.

A nightly cron on the host is enough for most installs:

```cron
15 2 * * * cd /srv/strata && docker compose exec -T db pg_dump -U strata -Fc strata > /backups/strata-$(date +\%F).dump
```

## Restore

```bash
docker compose down
docker volume rm strata_pgdata strata_uploads     # only when starting clean
docker compose up -d db
# Wait for the healthcheck, then load the dump.
docker compose exec -T db pg_restore -U strata -d strata --clean --if-exists < strata-2026-03-01.dump

docker run --rm -v strata_uploads:/data -v "$PWD:/backup" alpine \
  tar xzf /backup/strata-uploads-2026-03-01.tar.gz -C /data

docker compose up -d
```

Migrations run automatically on start, so a dump from an older version is
brought up to date by the container it is restored into.

## Verify a backup

Restore into a throwaway stack rather than trusting the file:

```bash
APP_PORT=3099 docker compose -p strata-verify up -d db
docker compose -p strata-verify exec -T db pg_restore -U strata -d strata --clean --if-exists < strata-2026-03-01.dump
APP_PORT=3099 docker compose -p strata-verify up -d
# Sign in, open a company, then tear it down.
docker compose -p strata-verify down -v
```

## Exports are not backups

The per-company export (JSON and Markdown, from the company page or
`GET /api/v1/companies/:id/export`) is for reading and handover. It leaves out
revisions, the audit trail, API keys, and webhook configuration. Use `pg_dump`
for anything you intend to restore from.
