// Client-safe shared constants for the commons seeding policy — one string,
// used verbatim by the browser composer (room-store) and the agent MCP
// send_message path so the two dialects can't drift.

export const FRESH_START_POLICY =
  "fresh-start: this investigation starts blank by choice. Do NOT call query_commons to seed from prior investigations — research the question fresh. Recording sources/claims to the commons is unchanged.";
