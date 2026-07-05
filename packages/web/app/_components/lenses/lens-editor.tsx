"use client";

import { PlusIcon, XIcon } from "lucide-react";
import { useState } from "react";
import type { LensMatch, LensRule } from "@/lib/lenses/types";

// Form-based rule builder: each row is a readable condition preset plus a
// "keep %" weight. Presets compile to the generic LensMatch format, so the
// evaluator stays open-ended while the editor stays approachable.

type PresetId =
  | "agent-written"
  | "human-written"
  | "unsourced"
  | "thin-sources"
  | "corroborated"
  | "hedged"
  | "not-peer-reviewed"
  | "peer-reviewed"
  | "older-than"
  | "by-contributor";

const PRESETS: Array<{
  id: PresetId;
  label: string;
  param?: "days" | "contributor";
  build: (param: string) => LensMatch;
}> = [
  {
    id: "agent-written",
    label: "written by an agent",
    build: () => ({ contributorKind: "agent" }),
  },
  {
    id: "human-written",
    label: "written by a human",
    build: () => ({ contributorKind: "human" }),
  },
  {
    id: "by-contributor",
    label: "written by…",
    param: "contributor",
    build: (id) => ({ contributorIds: [id] }),
  },
  {
    id: "unsourced",
    label: "claim with no source",
    build: () => ({ kinds: ["claim"], maxSources: 0 }),
  },
  {
    id: "thin-sources",
    label: "claim with ≤1 source",
    build: () => ({ kinds: ["claim"], maxSources: 1 }),
  },
  {
    id: "corroborated",
    label: "claim with 2+ sources",
    build: () => ({ kinds: ["claim"], minSources: 2 }),
  },
  {
    id: "hedged",
    label: "hedged (speculates/suggests)",
    build: () => ({ modality: ["speculates", "suggests"] }),
  },
  {
    id: "not-peer-reviewed",
    label: "source not peer-reviewed",
    build: () => ({ peerReviewed: false }),
  },
  {
    id: "peer-reviewed",
    label: "source peer-reviewed",
    build: () => ({ peerReviewed: true }),
  },
  {
    id: "older-than",
    label: "added more than … days ago",
    param: "days",
    build: (days) => ({ olderThanDays: Number(days) || 30 }),
  },
];

type RuleRow = {
  key: number;
  preset: PresetId;
  param: string;
  weight: number;
};

const inputClass =
  "w-full rounded-md border border-border/60 bg-background px-2 py-1 text-xs outline-none transition-colors duration-150 focus:border-border placeholder:text-muted-foreground/70";

const selectClass =
  "w-full rounded-md border border-border/60 bg-background px-1.5 py-1 text-xs outline-none transition-colors duration-150 focus:border-border";

export function LensEditor({
  contributors,
  onSave,
  onCancel,
}: {
  contributors: Array<{ id: string; name: string }>;
  onSave: (input: {
    name: string;
    description?: string;
    rules: LensRule[];
  }) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [rows, setRows] = useState<RuleRow[]>([
    { key: 0, preset: "agent-written", param: "", weight: 0.5 },
  ]);
  const [nextKey, setNextKey] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateRow = (key: number, patch: Partial<RuleRow>) => {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };

  const addRow = () => {
    setRows((rs) => [
      ...rs,
      { key: nextKey, preset: "thin-sources", param: "", weight: 0.6 },
    ]);
    setNextKey((k) => k + 1);
  };

  const buildRules = (): LensRule[] => {
    const rules: LensRule[] = [];
    for (const row of rows) {
      const preset = PRESETS.find((p) => p.id === row.preset);
      if (!preset) {
        continue;
      }
      if (preset.param === "contributor" && !row.param) {
        continue;
      }
      const param = preset.param === "days" && !row.param ? "30" : row.param;
      let label = preset.label;
      if (preset.param === "contributor") {
        const who = contributors.find((c) => c.id === row.param);
        label = `written by ${who?.name ?? "…"}`;
      }
      if (preset.param === "days") {
        label = `added more than ${param} days ago`;
      }
      rules.push({
        id: `${preset.id}-${row.key}`,
        label,
        match: preset.build(param),
        weight: row.weight,
      });
    }
    return rules;
  };

  const submit = async () => {
    const rules = buildRules();
    if (!name.trim() || rules.length === 0) {
      setError("Name the lens and give it at least one complete rule.");
      return;
    }
    setSaving(true);
    setError(null);
    const ok = await onSave({
      name: name.trim(),
      description: description.trim() || undefined,
      rules,
    });
    setSaving(false);
    if (!ok) {
      setError("Couldn't save — try again.");
    }
  };

  return (
    <div className="space-y-3 p-3">
      <input
        className={inputClass}
        maxLength={60}
        onChange={(e) => setName(e.target.value)}
        placeholder="Lens name"
        value={name}
      />
      <input
        className={inputClass}
        maxLength={300}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="What does this perspective trust? (optional)"
        value={description}
      />

      <div className="space-y-2">
        {rows.map((row) => {
          const preset = PRESETS.find((p) => p.id === row.preset);
          return (
            <div
              className="space-y-1.5 rounded-md border border-border/50 p-2"
              key={row.key}
            >
              <div className="flex items-center gap-1.5">
                <select
                  className={selectClass}
                  onChange={(e) =>
                    updateRow(row.key, {
                      preset: e.target.value as PresetId,
                      param: "",
                    })
                  }
                  value={row.preset}
                >
                  {PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
                <button
                  aria-label="Remove rule"
                  className="rounded-md p-1 text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground"
                  onClick={() =>
                    setRows((rs) => rs.filter((r) => r.key !== row.key))
                  }
                  type="button"
                >
                  <XIcon className="size-3" />
                </button>
              </div>
              {preset?.param === "days" ? (
                <input
                  className={inputClass}
                  min={1}
                  onChange={(e) =>
                    updateRow(row.key, { param: e.target.value })
                  }
                  placeholder="days (default 30)"
                  type="number"
                  value={row.param}
                />
              ) : null}
              {preset?.param === "contributor" ? (
                <select
                  className={selectClass}
                  onChange={(e) =>
                    updateRow(row.key, { param: e.target.value })
                  }
                  value={row.param}
                >
                  <option value="">choose a contributor…</option>
                  {contributors.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              ) : null}
              <div className="flex items-center gap-2">
                <input
                  className="h-1 flex-1 accent-foreground"
                  max={150}
                  min={0}
                  onChange={(e) =>
                    updateRow(row.key, {
                      weight: Number(e.target.value) / 100,
                    })
                  }
                  step={5}
                  type="range"
                  value={Math.round(row.weight * 100)}
                />
                <span className="w-16 text-right text-[10px] text-muted-foreground tabular-nums">
                  keep {Math.round(row.weight * 100)}%
                </span>
              </div>
            </div>
          );
        })}
        <button
          className="flex items-center gap-1 text-muted-foreground text-xs transition-colors duration-150 hover:text-foreground"
          onClick={addRow}
          type="button"
        >
          <PlusIcon className="size-3" /> add rule
        </button>
      </div>

      {error ? <p className="text-destructive text-xs">{error}</p> : null}

      <div className="flex items-center justify-end gap-2">
        <button
          className="rounded-md px-2 py-1 text-muted-foreground text-xs transition-colors duration-150 hover:bg-muted hover:text-foreground"
          onClick={onCancel}
          type="button"
        >
          Cancel
        </button>
        <button
          className="rounded-md border border-border bg-muted px-2.5 py-1 font-medium text-xs transition-[background-color,transform] duration-150 hover:bg-muted/70 active:scale-[0.97] disabled:opacity-50"
          disabled={saving}
          onClick={submit}
          type="button"
        >
          {saving ? "Saving…" : "Save lens"}
        </button>
      </div>
    </div>
  );
}
