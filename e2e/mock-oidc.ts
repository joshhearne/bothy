import { execFileSync } from "node:child_process";

/**
 * A real OIDC provider for the sign-in test: navikt/mock-oauth2-server, which
 * builds its discovery document from the request's Host header. That lets one
 * URL work from both the app container (docker DNS) and the browser (mapped to
 * localhost by Playwright's host resolver rules).
 */
const NAME = "mock-oidc";
const PORT = 8080;

export const ISSUER = `http://${NAME}:${PORT}/default`;
export const CLIENT_ID = "bothy-e2e";
export const CLIENT_SECRET = "bothy-e2e-secret";

function docker(args: string[]): string {
  try {
    return execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    const err = error as { stderr?: Buffer | string; message?: string };
    throw new Error(`docker ${args.join(" ")} failed: ${String(err.stderr ?? err.message)}`);
  }
}

export function startMockOidc(network: string): void {
  stopMockOidc();
  docker([
    "run", "-d", "--name", NAME,
    "--network", network,
    // Published so the browser can reach the same host:port the app uses.
    "-p", `${PORT}:${PORT}`,
    "ghcr.io/navikt/mock-oauth2-server:2.1.10",
  ]);

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      execFileSync("curl", ["-sf", `http://127.0.0.1:${PORT}/default/.well-known/openid-configuration`], {
        stdio: "ignore",
      });
      return;
    } catch {
      execFileSync("sleep", ["1"]);
    }
  }
  throw new Error("mock OIDC provider did not start");
}

export function stopMockOidc(): void {
  try {
    execFileSync("docker", ["rm", "-f", NAME], { stdio: "ignore" });
  } catch {
    // Not running.
  }
}
