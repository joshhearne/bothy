# Running Bothy on Cloudflare

Two ways, and they are not the same thing:

- **The container behind a Cloudflare Tunnel.** Bothy keeps running in Docker on
  your own host; Cloudflare publishes it at `https://bothy.yourdomain.com` with
  no port open to the internet. Start here — it is the least that can go wrong.
- **[A Cloudflare Worker](#running-as-a-worker).** No server at all, but the
  database moves to Hyperdrive, attachments to R2, and the vault sidecar needs a
  tunnel of its own.

Both run the same code against the same schema, and password hashes are
interchangeable between them.

## Behind a Cloudflare Tunnel

`cloudflared` runs on the same host as the container and dials out to
Cloudflare, so nothing needs to be forwarded or exposed:

```
browser -> Cloudflare edge -> tunnel -> cloudflared (this host) -> 127.0.0.1:3080 -> container
```

**1. Point `APP_URL` at the hostname people will type.**

```bash
APP_URL=https://bothy.yourdomain.com
```

This is the setting to get right. Session cookies are marked `Secure` as soon as
`APP_URL` is `https`, the OAuth state check is built from it, and every absolute
link comes from it. A mismatch shows up as a sign-in page that loops, or as
`state_mismatch` on single sign-on. `docker compose up -d` to apply it.

**2. Publish the hostname.** A tunnel started with `--token` is managed from the
dashboard, so its routes live there rather than in a local config file: **Zero
Trust → Networks → Tunnels →** your tunnel **→ Public Hostname → Add**.

| Field | Value |
|---|---|
| Subdomain / Domain | `bothy` / `yourdomain.com` |
| Path | leave empty |
| Type | HTTP |
| URL | `127.0.0.1:3080` |

Plain HTTP over loopback is the point: the encrypted hop is the tunnel itself.
Leave **HTTP Host Header** empty — Bothy needs the browser's own `Host`, which
is what tells Next.js a form post came from where it says it did. Saving the
hostname creates the DNS record for you.

If instead your tunnel runs from `/etc/cloudflared/config.yml`, the same thing
in that file, followed by
`cloudflared tunnel route dns <tunnel> bothy.yourdomain.com`:

```yaml
ingress:
  - hostname: bothy.yourdomain.com
    service: http://127.0.0.1:3080
  - service: http_status:404
```

**3. Close the port to everything else**, now that the tunnel reaches it over
loopback:

```bash
APP_BIND=127.0.0.1
```

Then `docker compose up -d`. The container is now reachable only from this host
and only through Cloudflare. Leave it at `0.0.0.0` if you also want the app on
your own network — but note that signing in over plain HTTP will not work once
`APP_URL` is `https`, because the browser refuses to send a `Secure` cookie
back over an insecure origin.

**4. Check it end to end**, from somewhere that is not this host:

```bash
curl https://bothy.yourdomain.com/api/health     # {"status":"ok"}
```

Then sign in through the hostname. If sign-in returns you to the sign-in page,
`APP_URL` does not match what you typed.

### Worth knowing

**Uploads** pass through Cloudflare, which caps a request body at 100 MB on the
free and Pro plans. `MAX_UPLOAD_MB` defaults to 25; keep it under your plan's
limit or the upload fails at the edge, before Bothy sees it.

**Cloudflare Access** can sit in front of the hostname for a second gate, and it
composes with Bothy's own sign-in rather than replacing it. If you add it, leave
`/api/*` out of the policy or scope it to a service token: an Access login page
is HTML, and an API client or an MCP client presenting a bearer token has
nowhere to put it.

**Single sign-on** redirect URIs move with the hostname. Register
`https://bothy.yourdomain.com/api/auth/callback/oidc` with your identity
provider.

**The vault sidecar** does not change. It stays on the internal Docker network
with no published port, exactly as in [VAULT_INTEGRATION.md](VAULT_INTEGRATION.md).

## Running as a Worker

### What you need

| Piece | Why |
|---|---|
| A Postgres database | Neon, Supabase, RDS — anything Hyperdrive can reach |
| Hyperdrive | Pools those connections at the edge. A Worker cannot hold one open |
| An R2 bucket | Attachments. Workers have no filesystem |
| Workers paid plan | Argon2id costs a few hundred milliseconds of CPU per sign-in, past the free allowance |

### Deploy

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

### What differs from the container

**Webhook retries come from a Cron Trigger.** The container runs a timer in
process; a Worker has no process to hold one. The trigger in `wrangler.jsonc`
fires every five minutes and calls `/api/internal/webhooks`, which stays inert
unless `CRON_SECRET` is set. Backoff and the eight-attempt limit are unchanged.

**Attachments go to R2** through the `BOTHY_UPLOADS` binding, with
`STORAGE_DRIVER=r2`. No credentials to carry.

**Each request gets its own database connection.** A Worker may not reuse a
socket across requests, so the pool is created per request; Hyperdrive keeps the
real connections warm.

### Secrets in a cloud deployment

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

### Local development against the Workers build

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
