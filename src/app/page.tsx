import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth/session";
import { isSetupComplete } from "@/server/services/setup";

export const dynamic = "force-dynamic";

export default async function RootPage() {
  if (!(await isSetupComplete())) redirect("/setup");
  if (!(await getCurrentUser())) redirect("/sign-in");
  redirect("/companies");
}
