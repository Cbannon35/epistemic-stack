import { createBrowserClient } from "@supabase/ssr";

// Browser-side Supabase client (uses the publishable key). Safe to call in
// client components.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string
  );
}
