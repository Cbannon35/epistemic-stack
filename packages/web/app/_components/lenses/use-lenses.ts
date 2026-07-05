"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { GraphData, GraphNode } from "@/app/_components/graph/types";
import { listLenses, saveLens } from "@/app/(chat)/lens-actions";
import { BUILTIN_LENSES, RAW_LENS_ID } from "@/lib/lenses/builtins";
import {
  computeDivergences,
  type Divergence,
  type EvalContext,
  explainScore,
  scoreAll,
} from "@/lib/lenses/evaluate";
import type { LensDefinition, LensRule } from "@/lib/lenses/types";

const ACTIVE_KEY = "epistack-lens";

export type LensDiffState = { a: LensDefinition; b: LensDefinition };

export type LensState = {
  lenses: LensDefinition[];
  active: LensDefinition;
  setActiveId: (id: string) => void;
  diff: LensDiffState | null;
  setDiffIds: (pair: { aId: string; bId: string } | null) => void;
  // Per-node trust scores under the active lens; null when nothing dims
  // (raw lens, no data) so the panel can skip styling entirely.
  scores: Map<string, number> | null;
  // Both sides of the comparison, when diff mode is on.
  diffScores: { a: Map<string, number>; b: Map<string, number> } | null;
  divergences: Divergence[] | null;
  explain: (node: GraphNode) => LensRule[];
  save: (input: {
    name: string;
    description?: string;
    rules: LensRule[];
  }) => Promise<boolean>;
};

export function useLensState(data: GraphData | null): LensState {
  const [saved, setSaved] = useState<LensDefinition[]>([]);
  const [activeId, setActiveIdRaw] = useState<string>(RAW_LENS_ID);
  const [diffIds, setDiffIds] = useState<{ aId: string; bId: string } | null>(
    null
  );

  useEffect(() => {
    // Saved server-side; the choice of lens is personal and device-local.
    const stored = window.localStorage.getItem(ACTIVE_KEY);
    if (stored) {
      setActiveIdRaw(stored);
    }
    listLenses()
      .then(setSaved)
      .catch(() => {
        // Offline/unauthenticated: built-ins still work.
      });
  }, []);

  const setActiveId = useCallback((id: string) => {
    setActiveIdRaw(id);
    window.localStorage.setItem(ACTIVE_KEY, id);
  }, []);

  const lenses = useMemo(() => [...BUILTIN_LENSES, ...saved], [saved]);

  const active = useMemo(
    () => lenses.find((l) => l.id === activeId) ?? lenses[0],
    [lenses, activeId]
  );

  const diff = useMemo(() => {
    if (!diffIds) {
      return null;
    }
    const a = lenses.find((l) => l.id === diffIds.aId);
    const b = lenses.find((l) => l.id === diffIds.bId);
    return a && b ? { a, b } : null;
  }, [lenses, diffIds]);

  const ctx = useMemo<EvalContext | null>(() => {
    if (!data) {
      return null;
    }
    return { provenance: data.provenance ?? {}, nowMs: Date.now() };
  }, [data]);

  const scores = useMemo(() => {
    if (!(ctx && data) || active.rules.length === 0) {
      return null;
    }
    return scoreAll(data.nodes, active, ctx);
  }, [ctx, data, active]);

  const diffScores = useMemo(() => {
    if (!(ctx && data && diff)) {
      return null;
    }
    return {
      a: scoreAll(data.nodes, diff.a, ctx),
      b: scoreAll(data.nodes, diff.b, ctx),
    };
  }, [ctx, data, diff]);

  const divergences = useMemo(() => {
    if (!(ctx && data && diff)) {
      return null;
    }
    return computeDivergences(data.nodes, diff.a, diff.b, ctx);
  }, [ctx, data, diff]);

  const explain = useCallback(
    (node: GraphNode) => (ctx ? explainScore(node, active.rules, ctx) : []),
    [ctx, active]
  );

  const save = useCallback(
    async (input: {
      name: string;
      description?: string;
      rules: LensRule[];
    }) => {
      const id = await saveLens(input).catch(() => null);
      if (!id) {
        return false;
      }
      const fresh = await listLenses().catch(() => null);
      if (fresh) {
        setSaved(fresh);
      }
      setActiveId(id);
      return true;
    },
    [setActiveId]
  );

  return {
    lenses,
    active,
    setActiveId,
    diff,
    setDiffIds,
    scores,
    diffScores,
    divergences,
    explain,
    save,
  };
}
