"use server";

import { redirect } from "next/navigation";
import { ensureContributor } from "@/lib/contributors";
import { createClient } from "@/lib/supabase/server";

export type AuthState = { error?: string } | undefined;

// One action for sign-in and sign-up (the submit button carries `intent`).
// enable_confirmations=false locally, so sign-up returns a session immediately.
export async function authenticate(
  _prev: AuthState,
  formData: FormData
): Promise<AuthState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const intent = String(formData.get("intent") ?? "signin");

  const supabase = await createClient();
  const result =
    intent === "signup"
      ? await supabase.auth.signUp({ email, password })
      : await supabase.auth.signInWithPassword({ email, password });

  if (result.error) {
    return { error: result.error.message };
  }
  const user = result.data.user;
  if (user) {
    await ensureContributor(user.id, user.email ?? email);
  }
  redirect("/");
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
