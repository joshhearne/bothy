import { json, readJson, withApi } from "@/server/api/http";
import { listUsers, provisionUser } from "@/server/services/users";

export const dynamic = "force-dynamic";

function serializeUser(user: { id: string; email: string; name: string; role: string; allCompanies: boolean; createdAt: Date }) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    all_companies: user.allCompanies,
    created_at: user.createdAt.toISOString(),
  };
}

/** Every account, for an integration that grants collections by person. */
export const GET = withApi("admin", async () => {
  return json({ data: (await listUsers()).map(serializeUser) });
});

/**
 * Creates an account by email, or returns the one that exists, so a person
 * can be granted a collection before their first sign-in. No password is
 * set; the person signs in through single sign-on, or an administrator sets
 * a temporary password.
 */
export const POST = withApi("admin", async ({ key, request }) => {
  const body = await readJson(request);
  const result = await provisionUser(
    {
      email: body.email as string,
      name: body.name as string,
      role: body.role as "admin" | "tech" | "readonly" | undefined,
      allCompanies: body.all_companies as boolean | undefined,
    },
    { apiKeyId: key.id, apiKeyName: key.name },
  );
  const user = (await listUsers()).find((row) => row.id === result.id);
  if (!user) throw new Error("The user was not found after creation");
  return json(serializeUser(user), result.created ? 201 : 200);
});
