import { execFileSync } from "node:child_process";

const PROJECT = process.env.E2E_COMPOSE_PROJECT ?? "strata-test";
const CWD = process.env.E2E_REPO ?? process.cwd();

/** Runs SQL against the stack under test. Used for assertions the UI cannot show. */
export function psql(sql: string): string {
  return execFileSync(
    "docker",
    ["compose", "-p", PROJECT, "exec", "-T", "db", "psql", "-U", "strata", "-d", "strata",
     "-v", "ON_ERROR_STOP=1", "-tAc", sql],
    { cwd: CWD, encoding: "utf8" },
  ).trim();
}

/** Creates a local account directly, which is the only way to add a non-admin. */
export function createUser(email: string, role: "tech" | "readonly", password: string): void {
  const hash = execFileSync(
    "node",
    ["-e",
     "import('@node-rs/argon2').then(async m=>console.log(await m.hash(process.argv[1]," +
     "{algorithm:2,memoryCost:19456,timeCost:2,parallelism:1})))",
     password],
    { cwd: CWD, encoding: "utf8" },
  ).trim();

  // The audit trail references users, so an existing account is reused rather
  // than deleted — audit_log is append-only by design.
  const existing = psql(`select id from users where email='${email}';`).split("\n")[0];
  const id =
    existing ||
    psql(
      `insert into users (email, name, role, email_verified) ` +
        `values ('${email}','${role}','${role}',true) returning id;`,
    ).split("\n")[0];

  if (existing) psql(`update users set role='${role}' where id='${id}';`);
  psql(`delete from accounts where user_id='${id}';`);
  psql(
    `insert into accounts (user_id, account_id, provider_id, password) ` +
      `values ('${id}','${id}','credential','${hash}');`,
  );
}
