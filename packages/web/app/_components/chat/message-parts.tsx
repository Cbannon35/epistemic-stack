"use client";

import type { EveMessagePart } from "eve/client";
import { memo } from "react";
import { ReasoningBlock } from "@/app/_components/chat/reasoning-block";
import { ToolCard } from "@/app/_components/chat/tool-cards";
import {
  NodeRefText,
  transformNodeRefs,
} from "@/app/_components/weave/node-ref";
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
    case "text": {
      if (!part.text) {
        return null;
      }
      // `#[kind:id|label]` node references render as inline chips (markdown
      // links under the hood, so paragraphs stay intact).
      const text = transformNodeRefs(part.text);
      if (text === part.text) {
        return <MessageResponse>{part.text}</MessageResponse>;
      }
      return (
        <NodeRefText>
          <MessageResponse>{text}</MessageResponse>
        </NodeRefText>
      );
    }
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
