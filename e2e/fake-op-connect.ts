import { execFileSync } from "node:child_process";

/**
 * A stand-in for a 1Password Connect server, on the stack's internal network.
 * Enough of the Connect REST API to exercise picking an item, revealing its
 * password, and reading a one-time code, without a 1Password account.
 *
 * It also checks the bearer token, because a provider that ignores its token
 * would pass every test and fail the moment it met a real Connect.
 */
const NAME = "op-connect";
const PORT = 8080;

export const OP_TOKEN = "fake-connect-token";
export const OP_VAULT = "vault-alpha";
export const OP_OTHER_VAULT = "vault-beta";
export const OP_ITEM_NAME = "Client firewall";
export const OP_ITEM_PASSWORD = "op-correct-horse";
/** The RFC 6238 seed, so the code the app computes can be checked. */
export const OP_TOTP_SEED = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

const SCRIPT = `
const TOKEN = ${JSON.stringify(OP_TOKEN)};
const ITEMS = {
  ${JSON.stringify(OP_VAULT)}: [
    {
      id: 'item-fw',
      title: ${JSON.stringify(OP_ITEM_NAME)},
      category: 'LOGIN',
      urls: [{ primary: true, href: 'https://10.0.0.1' }],
      fields: [
        { id: 'username', type: 'STRING', purpose: 'USERNAME', value: 'opadmin' },
        { id: 'password', type: 'CONCEALED', purpose: 'PASSWORD', value: ${JSON.stringify(OP_ITEM_PASSWORD)} },
        { id: 'otp', type: 'OTP', label: 'one-time password', value: ${JSON.stringify(OP_TOTP_SEED)} },
      ],
    },
  ],
  ${JSON.stringify(OP_OTHER_VAULT)}: [
    {
      id: 'item-other',
      title: 'Someone elses switch',
      category: 'LOGIN',
      urls: [],
      fields: [
        { id: 'password', type: 'CONCEALED', purpose: 'PASSWORD', value: 'not-yours' },
      ],
    },
  ],
};

require('http')
  .createServer((req, res) => {
    const url = new URL(req.url, 'http://op-connect');
    res.setHeader('Content-Type', 'application/json');

    if (req.headers.authorization !== 'Bearer ' + TOKEN) {
      res.statusCode = 401;
      return res.end(JSON.stringify({ status: 401, message: 'Invalid token' }));
    }

    if (url.pathname === '/v1/vaults') {
      return res.end(JSON.stringify(Object.keys(ITEMS).map((id) => ({ id, name: id }))));
    }

    const listing = /^\\/v1\\/vaults\\/([^/]+)\\/items$/.exec(url.pathname);
    if (listing) {
      const items = ITEMS[listing[1]] || [];
      // Connect omits fields from the list response, as the real one does.
      return res.end(JSON.stringify(items.map(({ fields, ...rest }) => rest)));
    }

    const detail = /^\\/v1\\/vaults\\/([^/]+)\\/items\\/([^/]+)$/.exec(url.pathname);
    if (detail) {
      const item = (ITEMS[detail[1]] || []).find((candidate) => candidate.id === detail[2]);
      if (!item) { res.statusCode = 404; return res.end(JSON.stringify({ status: 404 })); }
      return res.end(JSON.stringify(item));
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ status: 404, message: 'Unknown endpoint' }));
  })
  .listen(${PORT}, '0.0.0.0');
`;

function docker(args: string[]): string {
  return execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

export function startFakeConnect(network: string): void {
  stopFakeConnect();
  docker(["run", "-d", "--name", NAME, "--network", network, "node:22-alpine", "node", "-e", SCRIPT]);
}

export function stopFakeConnect(): void {
  try {
    docker(["rm", "-f", NAME]);
  } catch {
    // Not running.
  }
}
