import { redirect } from "next/navigation";
import { AppShell } from "@/app/_components/app-shell";
import { listInvestigations } from "@/lib/investigations";
import { createClient } from "@/lib/supabase/server";

// Re-fetch the investigation list on every navigation / router.refresh().
export const dynamic = "force-dynamic";

export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const investigations = await listInvestigations(user.id);

  return (
    <AppShell investigations={investigations} userEmail={user.email ?? null}>
      {children}
    </AppShell>
  );
}
