# Remove: lens UI + shared views

De-bloat pass (2026-07-06). Two features leave the app; the data model stays.

## Out

- **Shared views** — `weave/views-tray.tsx`, the `ViewsTray` toolbar mount and
  `captureView`/`applyView` in `graph-panel.tsx`, the `view-shared` room event.
  #-mentions and pings (the rest of the weave bundle) stay.
- **Lens UI (late-binding trust)** — `app/_components/lenses/*`, `lib/lenses/*`,
  `lens-actions.ts`; consumers stripped: graph-panel (state hook, opacity fading,
  diff outlines, toolbar pill, diff panel, presence effect, contributors memo,
  inspector prop), inspector (score block), person-card (lens row + Adopt),
  people-bus (adoptLens), PresenceMeta (`lensId`/`lensName`), use-room-channel
  (`setLens`).

## Stays

- `packages/db` untouched — the `lenses` table + migrations 0006 are append-only
  history, and late-binding trust remains a commons data-model concept
  (receipts + the lenses table). Only the app UI is removed; git history holds
  the full implementation.
- Credences / belief-compare (assessments) — separate feature, untouched.
- First-glance tier budget is now the sole graph-density mechanism.

## Docs

- CLAUDE.md: drop the lens feature-map row.
- ARCHITECTURE.md §7.3: replaced with a removal note.
