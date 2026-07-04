import { none } from "eve/channels/auth";
import { eveChannel } from "eve/channels/eve";

// HTTP channel only, no Vercel coupling (no vercelOidc). Routes are PUBLIC
// (none()) for local dev so the Next.js UI can call the agent without creds —
// identity/access is handled by Supabase Auth at the UI layer. Tighten here
// (localDev + httpBasic, or a Supabase-JWT check) before exposing the agent
// on a public origin.
export default eveChannel({
  auth: [none()],
});
