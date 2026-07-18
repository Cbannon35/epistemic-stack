// Shared scaffolding for the public vending pages (topic slices, releases).

export function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-border/60 bg-background px-4 py-3">
      <p className="font-semibold text-xl tabular-nums">{value}</p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
