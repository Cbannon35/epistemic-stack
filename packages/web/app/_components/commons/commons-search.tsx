"use client";

import { SearchIcon } from "lucide-react";
import { graphBus } from "@/app/_components/graph/graph-bus";
import { SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";

// The compounding read surface lives ON the graph now: clicking here
// fullscreens the graph in whole-commons scope with the search bar open,
// instead of the old ⌘K dialog.
export function CommonsSearchMenuItem({ active }: { active?: boolean }) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        className="justify-start"
        isActive={active}
        onClick={() => graphBus.emit("openCommonsSearch", {})}
      >
        <SearchIcon className="size-4" />
        Search the commons
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
