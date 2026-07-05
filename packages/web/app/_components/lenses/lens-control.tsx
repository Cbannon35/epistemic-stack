"use client";

import { ApertureIcon, CheckIcon } from "lucide-react";
import { useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { LensDefinition } from "@/lib/lenses/types";
import { LENS_A_COLOR, LENS_B_COLOR } from "./colors";
import { LensEditor } from "./lens-editor";
import type { LensState } from "./use-lenses";

const selectClass =
  "flex-1 rounded-md border border-border/60 bg-background px-1.5 py-1 text-xs outline-none transition-colors duration-150 focus:border-border";

function LensRow({
  lens,
  active,
  onSelect,
}: {
  lens: LensDefinition;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors duration-150 hover:bg-muted"
      onClick={onSelect}
      type="button"
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-xs">
          {lens.name}
          {lens.ownerName ? (
            <span className="font-normal text-muted-foreground">
              {" "}
              · by {lens.ownerName.split("@")[0]}
            </span>
          ) : null}
        </span>
        {lens.description ? (
          <span className="block truncate text-[10px] text-muted-foreground">
            {lens.description}
          </span>
        ) : null}
      </span>
      {active ? (
        <CheckIcon className="mt-0.5 size-3.5 shrink-0 text-foreground" />
      ) : (
        <span className="mt-0.5 size-3.5 shrink-0" />
      )}
    </button>
  );
}

export function LensControl({
  lens,
  contributors,
}: {
  lens: LensState;
  contributors: Array<{ id: string; name: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"list" | "editor">("list");
  const [compareA, setCompareA] = useState(lens.lenses[0]?.id ?? "");
  const [compareB, setCompareB] = useState(lens.lenses[1]?.id ?? "");

  const engaged = lens.diff !== null || lens.active.rules.length > 0;

  return (
    <Popover
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setMode("list");
        }
      }}
      open={open}
    >
      <PopoverTrigger asChild>
        <button
          className={`rounded-full border px-2 py-0.5 text-[10px] transition-[background-color,border-color,color,transform] duration-150 active:scale-[0.97] ${
            engaged
              ? "border-border bg-muted font-medium text-foreground"
              : "border-border/60 text-muted-foreground hover:bg-muted hover:text-foreground"
          }`}
          title="Lens: choose how much to trust each part of the record — applied at read time, nothing is deleted"
          type="button"
        >
          <span className="inline-flex items-center gap-1">
            <ApertureIcon className="size-3" />
            {lens.diff
              ? `${lens.diff.a.name} ⇄ ${lens.diff.b.name}`
              : lens.active.name.toLowerCase()}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72">
        {mode === "editor" ? (
          <LensEditor
            contributors={contributors}
            onCancel={() => setMode("list")}
            onSave={async (input) => {
              const ok = await lens.save(input);
              if (ok) {
                setMode("list");
              }
              return ok;
            }}
          />
        ) : (
          <div className="p-2">
            <p className="px-2 pt-1 pb-2 text-[10px] text-muted-foreground">
              The commons keeps everything. A lens decides how much weight each
              entry gets — for you, at read time.
            </p>
            <div className="space-y-0.5">
              {lens.lenses.map((l) => (
                <LensRow
                  active={!lens.diff && l.id === lens.active.id}
                  key={l.id}
                  lens={l}
                  onSelect={() => {
                    lens.setDiffIds(null);
                    lens.setActiveId(l.id);
                  }}
                />
              ))}
            </div>

            <div className="my-2 border-border/50 border-t" />

            <div className="space-y-1.5 px-2">
              <p className="font-medium text-[10px] text-muted-foreground uppercase tracking-wide">
                Compare two lenses
              </p>
              <div className="flex items-center gap-1.5">
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: LENS_A_COLOR }}
                />
                <select
                  className={selectClass}
                  onChange={(e) => setCompareA(e.target.value)}
                  value={compareA}
                >
                  {lens.lenses.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-1.5">
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: LENS_B_COLOR }}
                />
                <select
                  className={selectClass}
                  onChange={(e) => setCompareB(e.target.value)}
                  value={compareB}
                >
                  {lens.lenses.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </div>
              {lens.diff ? (
                <button
                  className="w-full rounded-md border border-border px-2 py-1 text-xs transition-colors duration-150 hover:bg-muted"
                  onClick={() => lens.setDiffIds(null)}
                  type="button"
                >
                  Stop comparing
                </button>
              ) : (
                <button
                  className="w-full rounded-md border border-border bg-muted px-2 py-1 font-medium text-xs transition-[background-color,transform] duration-150 hover:bg-muted/70 active:scale-[0.98] disabled:opacity-50"
                  disabled={compareA === compareB}
                  onClick={() => {
                    lens.setDiffIds({ aId: compareA, bId: compareB });
                    setOpen(false);
                  }}
                  type="button"
                >
                  {compareA === compareB
                    ? "Pick two different lenses"
                    : "Show where they part ways"}
                </button>
              )}
            </div>

            <div className="my-2 border-border/50 border-t" />

            <button
              className="w-full rounded-md px-2 py-1.5 text-left text-muted-foreground text-xs transition-colors duration-150 hover:bg-muted hover:text-foreground"
              onClick={() => setMode("editor")}
              type="button"
            >
              + New lens…
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
