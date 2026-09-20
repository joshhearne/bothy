# Running Bothy on Cloudflare

Bothy runs two ways. The Docker container is the primary path and needs nothing
but a host. This page covers the other: a Cloudflare Worker at
`https://bothy.yourdomain.com`, with no server to maintain.

Both deployments run the same code against the same schema, and password hashes
are interchangeable between them.

## What you need

| Piece | Why |
|---|---|
| A Postgres database | Neon, Supabase, RDS — anything Hyperdrive can reach |
| Hyperdrive | Pools those connections at the edge. A Worker cannot hold one open |
| An R2 bucket | Attachments. Workers have no filesystem |
| Workers paid plan | Argon2id costs a few hundred milliseconds of CPU per sign-in, past the free allowance |

## Deploy

```bash
npx wrangler hyperdrive create bothy --connection-string="postgres://…"
npx wrangler r2 bucket create bothy-uploads
```

Put the Hyperdrive id into `wrangler.jsonc`, then set the secrets:

```bash
npx wrangler secret put AUTH_SECRET      # openssl rand -base64 32
npx wrangler secret put APP_URL          # https://bothy.yourdomain.com
npx wrangler secret put CRON_SECRET      # openssl rand -base64 32
```

Migrate the database once from your own machine, then deploy:

```bash
DATABASE_URL="postgres://…" npm run db:migrate
DATABASE_URL="postgres://…" npm run db:seed    # optional starter doc types
npm run cf:deploy
```

Point `bothy.yourdomain.com` at the Worker with a route in `wrangler.jsonc` or a
custom domain in the dashboard. `APP_URL` must match the hostname people
actually use, or single sign-on fails its state check.

## What differs from the container

**Webhook retries come from a Cron Trigger.** The container runs a timer in
process; a Worker has no process to hold one. The trigger in `wrangler.jsonc`
fires every five minutes and calls `/api/internal/webhooks`, which stays inert
unless `CRON_SECRET` is set. Backoff and the eight-attempt limit are unchanged.

**Attachments go to R2** through the `BOTHY_UPLOADS` binding, with
`STORAGE_DRIVER=r2`. No credentials to carry.

**Each request gets its own database connection.** A Worker may not reuse a
socket across requests, so the pool is created per request; Hyperdrive keeps the
real connections warm.

## Secrets in a cloud deployment

The vault sidecar cannot run on Workers: `bw serve` is a long-lived process
holding an unlocked vault, and there is nowhere to put it. Two options.

**Link mode** (the default, nothing to run). Secret fields store a deep link
into your web vault. No brokering, no reveal inside Bothy.

**Keep the sidecar on your own network and reach it through a tunnel.** You
still run `bw-serve` where you control it — an office machine, a VM, the same
compose file with `--profile vault`. `cloudflared` publishes it at a hostname
that only Cloudflare Access can get through, and the Worker presents a service
token on every call:

```bash
npx wrangler secret put BW_SERVE_URL                  # https://vault-bridge.yourdomain.com
npx wrangler secret put BW_SERVE_ACCESS_CLIENT_ID
npx wrangler secret put BW_SERVE_ACCESS_CLIENT_SECRET
```

Create the Access application over that hostname with a policy that accepts only
that service token. `bw serve` still has no authentication of its own — Access
is what stands in front of it, the job the private docker network does in the
container deployment. If Access refuses the token, or the sidecar is down,
secret fields degrade to link mode and say so, exactly as they do on a private
network.

The risk statement in [VAULT_INTEGRATION.md](VAULT_INTEGRATION.md) still
applies, with one addition: a tunnel means the sidecar is reachable from
Cloudflare's edge rather than only from your own network, so the service token
is a credential worth protecting like any other.

## Local development against the Workers build

```bash
docker run -d --name bothy-pg -p 55432:5432 \
  -e POSTGRES_USER=bothy -e POSTGRES_DB=bothy -e POSTGRES_PASSWORD=dev postgres:16-alpine
DATABASE_URL="postgres://bothy:dev@127.0.0.1:55432/bothy" npm run db:migrate

npm run cf:build
WRANGLER_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE="postgres://bothy:dev@127.0.0.1:55432/bothy" \
  npx wrangler dev --local
```

Put `AUTH_SECRET`, `APP_URL`, and `CRON_SECRET` in a `.dev.vars` file, which is
git-ignored.
