"use client";

import type { EveMessagePart } from "eve/client";
import { memo } from "react";
import { ReasoningBlock } from "@/app/_components/chat/reasoning-block";
import { ToolCard } from "@/app/_components/chat/tool-cards";
import { MessageResponse } from "@/components/ai-elements/message";

// One renderable message part. Memoized on the part reference — the reducer
// replaces changed parts immutably, so unchanged parts skip re-render during
// streaming.
export const MessagePart = memo(function MessagePartInner({
  part,
}: {
  part: EveMessagePart;
}) {
  switch (part.type) {
    case "text":
      return part.text ? <MessageResponse>{part.text}</MessageResponse> : null;
    case "reasoning":
      return part.text ? (
        <ReasoningBlock
          streaming={part.state === "streaming"}
          text={part.text}
        />
      ) : null;
    case "dynamic-tool":
      return <ToolCard part={part} />;
    default:
      return null;
  }
});
