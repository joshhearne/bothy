import { execFileSync } from "node:child_process";

/**
 * A webhook receiver that lives on the stack's own docker network, because the
 * app container cannot reach a server on the host.
 */
/**
 * A unique name per receiver, so a delivery still being retried from an earlier
 * run cannot resolve to this one and arrive signed with a stale secret.
 */
const PORT = 9099;
let current: string | null = null;

const RECEIVER_SCRIPT = `
require('http')
  .createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      console.log(JSON.stringify({ headers: req.headers, body }));
      res.writeHead(200).end('ok');
    });
  })
  .listen(${PORT}, '0.0.0.0');
`;

function docker(args: string[], cwd = process.cwd()): string {
  return execFileSync("docker", args, { cwd, encoding: "utf8" });
}

export type ReceivedRequest = { headers: Record<string, string>; body: string };

export function startHookReceiver(network: string): string {
  stopHookReceiver();
  const name = `strata-e2e-hook-${Date.now().toString(36)}`;
  docker([
    "run", "-d", "--name", name, "--network", network,
    "node:22-alpine", "node", "-e", RECEIVER_SCRIPT,
  ]);
  current = name;
  return `http://${name}:${PORT}/hook`;
}

export function readReceived(): ReceivedRequest[] {
  if (!current) return [];

  let logs = "";
  try {
    logs = docker(["logs", current]);
  } catch {
    return [];
  }

  return logs
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("{"))
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as ReceivedRequest];
      } catch {
        return [];
      }
    });
}

export function stopHookReceiver(): void {
  if (!current) return;
  try {
    docker(["rm", "-f", current]);
  } catch {
    // Already gone.
  }
  current = null;
}
