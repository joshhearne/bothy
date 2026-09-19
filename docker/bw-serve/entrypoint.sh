#!/bin/sh
set -e
bw config server "${BW_SERVER_URL:?BW_SERVER_URL required}"
bw login --apikey >/dev/null 2>&1 || true   # uses BW_CLIENTID / BW_CLIENTSECRET
export BW_PASSWORD="$(cat /run/secrets/bw_master_password)"
export BW_SESSION="$(bw unlock --passwordenv BW_PASSWORD --raw)"
unset BW_PASSWORD
bw sync
exec bw serve --hostname 0.0.0.0 --port 8087
