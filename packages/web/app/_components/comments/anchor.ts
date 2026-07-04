// Text anchoring for comments: turn a live Selection into a durable
// {messageId, quote, prefix, suffix} anchor, and re-find that quote in the
// rendered message DOM later (text-node walking — markdown paragraphs carry no
// attributes to select on).

export type CommentAnchor = {
  messageId: string;
  quote: string;
  quotePrefix: string;
  quoteSuffix: string;
};

const CONTEXT_CHARS = 32;
const MIN_QUOTE = 3;
const MAX_QUOTE = 1000;

/** Offset of a range boundary within an element's full textContent. */
function offsetWithin(element: Element, node: Node, offset: number): number {
  const range = document.createRange();
  range.selectNodeContents(element);
  range.setEnd(node, offset);
  return range.toString().length;
}

export function anchorFromSelection(
  selection: Selection
): { anchor: CommentAnchor; rect: DOMRect } | null {
  if (selection.rangeCount === 0 || selection.isCollapsed) {
    return null;
  }
  const range = selection.getRangeAt(0);
  const container =
    range.commonAncestorContainer instanceof Element
      ? range.commonAncestorContainer
      : range.commonAncestorContainer.parentElement;
  const messageEl = container?.closest("[data-message-id]");
  if (!messageEl) {
    return null;
  }
  const messageId = messageEl.getAttribute("data-message-id");
  const quote = range.toString().trim();
  if (!messageId || quote.length < MIN_QUOTE || quote.length > MAX_QUOTE) {
    return null;
  }
  const text = messageEl.textContent ?? "";
  const start = offsetWithin(
    messageEl,
    range.startContainer,
    range.startOffset
  );
  const end = offsetWithin(messageEl, range.endContainer, range.endOffset);
  return {
    anchor: {
      messageId,
      quote: range.toString(),
      quotePrefix: text.slice(Math.max(0, start - CONTEXT_CHARS), start),
      quoteSuffix: text.slice(end, end + CONTEXT_CHARS),
    },
    rect: range.getBoundingClientRect(),
  };
}

/** All indexOf occurrences of needle in hay. */
function occurrences(hay: string, needle: string): number[] {
  const found: number[] = [];
  let index = hay.indexOf(needle);
  while (index !== -1 && found.length < 50) {
    found.push(index);
    index = hay.indexOf(needle, index + 1);
  }
  return found;
}

function contextScore(
  hay: string,
  start: number,
  end: number,
  prefix: string,
  suffix: string
): number {
  let score = 0;
  if (
    prefix &&
    hay.slice(Math.max(0, start - prefix.length), start) === prefix
  ) {
    score += 2;
  }
  if (suffix && hay.slice(end, end + suffix.length) === suffix) {
    score += 2;
  }
  return score;
}

/** Map a [start, end) textContent offset span to a DOM Range via text nodes. */
function rangeFromOffsets(
  element: Element,
  start: number,
  end: number
): Range | null {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let consumed = 0;
  let startSet = false;
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const length = node.textContent?.length ?? 0;
    if (!startSet && consumed + length > start) {
      range.setStart(node, start - consumed);
      startSet = true;
    }
    if (startSet && consumed + length >= end) {
      range.setEnd(node, end - consumed);
      return range;
    }
    consumed += length;
  }
  return null;
}

/** Re-find a stored quote inside a rendered message element. */
export function findQuoteRange(
  messageEl: Element,
  quote: string,
  prefix: string | null,
  suffix: string | null
): Range | null {
  const hay = messageEl.textContent ?? "";
  const starts = occurrences(hay, quote);
  if (starts.length === 0) {
    return null;
  }
  let best = starts[0];
  if (starts.length > 1 && (prefix || suffix)) {
    let bestScore = -1;
    for (const start of starts) {
      const score = contextScore(
        hay,
        start,
        start + quote.length,
        prefix ?? "",
        suffix ?? ""
      );
      if (score > bestScore) {
        bestScore = score;
        best = start;
      }
    }
  }
  return rangeFromOffsets(messageEl, best, best + quote.length);
}
