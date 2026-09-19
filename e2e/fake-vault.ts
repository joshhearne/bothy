import { execFileSync } from "node:child_process";

/**
 * A stand-in for the `bw serve` sidecar, on the stack's internal network under
 * the name the app expects. Enough of the Vault Management API to exercise
 * picking, revealing, and TOTP without a real Bitwarden account.
 */
const NAME = "bw-serve";
const PORT = 8087;

const SCRIPT = `
const ITEMS = [
  {
    id: 'item-firewall',
    name: 'Firewall admin',
    collectionIds: ['col-alpha'],
    login: { username: 'admin', password: 'correct-horse-battery', totp: 'JBSWY3DPEHPK3PXP',
             uris: [{ uri: 'https://10.0.0.1' }] },
  },
  {
    id: 'item-other-client',
    name: 'Someone elses router',
    collectionIds: ['col-beta'],
    login: { username: 'root', password: 'not-yours', uris: [] },
  },
];

const ok = (data) => JSON.stringify({ success: true, data });

require('http')
  .createServer((req, res) => {
    const url = new URL(req.url, 'http://bw-serve');
    res.setHeader('Content-Type', 'application/json');

    if (url.pathname === '/status') {
      return res.end(ok({ template: { status: 'unlocked' } }));
    }
    if (url.pathname === '/sync') {
      return res.end(ok({ success: true }));
    }
    if (url.pathname === '/list/object/items') {
      const collection = url.searchParams.get('collectionid');
      const search = (url.searchParams.get('search') || '').toLowerCase();
      const items = ITEMS.filter((item) => item.collectionIds.includes(collection))
        .filter((item) => !search || item.name.toLowerCase().includes(search));
      return res.end(ok({ data: items }));
    }
    if (url.pathname.startsWith('/object/item/')) {
      const item = ITEMS.find((candidate) => candidate.id === url.pathname.split('/').pop());
      if (!item) { res.statusCode = 404; return res.end(JSON.stringify({ success: false, message: 'Not found' })); }
      return res.end(ok(item));
    }
    if (url.pathname.startsWith('/object/password/')) {
      const item = ITEMS.find((candidate) => candidate.id === url.pathname.split('/').pop());
      if (!item) { res.statusCode = 404; return res.end(JSON.stringify({ success: false, message: 'Not found' })); }
      return res.end(ok({ data: item.login.password }));
    }
    if (url.pathname.startsWith('/object/totp/')) {
      const item = ITEMS.find((candidate) => candidate.id === url.pathname.split('/').pop());
      if (!item || !item.login.totp) { res.statusCode = 404; return res.end(JSON.stringify({ success: false, message: 'No TOTP' })); }
      return res.end(ok({ data: '123456' }));
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ success: false, message: 'Unknown endpoint' }));
  })
  .listen(${PORT}, '0.0.0.0');
`;

function docker(args: string[]): string {
  return execFileSync("docker", args, { encoding: "utf8" });
}

export const VAULT_COLLECTION = "col-alpha";
export const OTHER_COLLECTION = "col-beta";
export const VAULT_ITEM_NAME = "Firewall admin";
export const VAULT_ITEM_PASSWORD = "correct-horse-battery";
export const OTHER_ITEM_ID = "item-other-client";

export function startFakeVault(network: string): void {
  stopFakeVault();
  docker([
    "run", "-d", "--name", NAME, "--network", network,
    "node:22-alpine", "node", "-e", SCRIPT,
  ]);
}

export function stopFakeVault(): void {
  try {
    docker(["rm", "-f", NAME]);
  } catch {
    // Not running.
  }
}
