import { Workspace } from "@/app/_components/workspace";

// A shared investigation room, deep-linked by eve session id. The layout-level
// AppShell derives the room from the URL; the page body is the same workspace.
export default function Page() {
  return <Workspace />;
}
