import { redirect } from "next/navigation";

/** The area opens on the section an admin reaches for most. */
export default function AdminIndexPage() {
  redirect("/admin/users");
}
