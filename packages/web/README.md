# @epistack/web

The Next.js app: UI, multiplayer layer, and the eve agent (`agent/`, mounted into the same
process by `withEve()` — no separate agent server).

- Setup, env keys, and run instructions: [root README](../../README.md)
- Technical architecture: [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md)
- Agent/LLM briefing: [CLAUDE.md](../../CLAUDE.md)

```sh
bun run dev        # next dev (app + eve; requires Node ≥ 24 and a running `supabase start`)
bun run check      # ultracite lint
bunx tsc --noEmit  # typecheck
```

This package began as a fork of Vercel's ai-chatbot template; some stripped-out template
patterns remain in git history as reference.
