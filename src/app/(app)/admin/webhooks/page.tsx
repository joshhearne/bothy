import { redirect } from "next/navigation";

/** Webhooks are how notifications go out; the section is named for the job. */
export default function WebhooksPage() {
  redirect("/admin/notifications");
}
