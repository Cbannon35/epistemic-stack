# Polish pass — loose ends from the feature forks

Five surgical workstreams; no schema changes, no new dependencies.

## 1. Delegation UX

- **Chat entry point**: a Delegate button in the chat header (next to Fork) emits a new
  `openDelegate` graph-bus event; Workspace opens the graph pane on it (same pattern as
  `focusNode`), and the dock opens itself with the composer focused.
- **Refresh resume**: the delegator's tab records its hosted run ids in **sessionStorage**
  (per-tab, survives refresh — matching how hosting is per-tab, so a second tab of the same
  user doesn't hijack the run). On reload, once the dock list loads, any `running` row that is
  mine (delegatorId) *and* in the tab's hosted set resumes: re-broadcast `delegation-start`,
  respawn the cursor, and continue driving `/api/delegate/step` from the server-persisted
  phase cursor. True resume is cheap because the phase machine already keeps its state on the
  row — the client loop is stateless between steps. The step loop is extracted from `start()`
  into a shared `drive()`.

## 2. Edge (relation) challenges

- Relation edges already carry ids `rel:<id>` matching the challenge rollup keys; attach the
  rollup to edges in the graph payload (additive `challenges` field on `GraphEdgeData`).
- Click an edge → select it; the Inspector renders a relation subject (label built from the
  two claim labels) and the existing `NodeProvenance` handles receipts + disputes once
  `getNodeReceipts` learns the `rel:` prefix (`NodeReceipts.kind` gains `"relation"`).
- Contested edges wear a ⚑ edge label (red while open, muted once answered) — the edge
  equivalent of the node corner flag. Selected edges get a width/opacity bump.

## 3. Room-wide eve memory

Tour/answer memory was a per-tab ref; teammates' @eve exchanges didn't build on each other.
New `lib/realtime/eve-memory.ts` module store (per-room bounded ring, 8 entries) + a new
`eve-memory` room broadcast: whoever completes an exchange pushes locally and broadcasts;
every present client accumulates the same ring. Completed delegations contribute their
summaries too. **Deliberately session-lifetime**: late joiners start from now (no schema
change; the memory only tunes eve's context, so degradation is graceful).

## 4. Onboarding & affordances

- Fresh-room empty state gains a verb cheat-sheet (ask · `/` cursor chat · `@eve` ask/tour ·
  `@eve investigate` delegate · highlight → comment).
- `?` opens a keyboard/verb reference dialog (documents only bindings that exist: `/`,
  `@eve`, `@eve investigate`, Escape, ⌘K, Enter).
- The avatar stack's +N overflow chip becomes a popover listing everyone.

## 5. Visual once-over

- Lens-diff outline vs selection ring: bump `outlineOffset` on selected diverging nodes so
  the divergence outline and the selection ring read as two rings, not a smear.
