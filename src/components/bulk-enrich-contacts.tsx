"use client";

import { useState, useMemo, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2, AlertCircle, Sparkles, Mail, Phone } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

type Contact = {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  type: string | null;
};

type RowState = "idle" | "running" | "done" | "error";
type RowResult = {
  state: RowState;
  fieldsChanged?: number;
  error?: string;
  enrichmentCount?: number;
  errors?: string[];
};

type Filter = "missing-email" | "missing-phone" | "missing-either" | "all";

const FILTER_LABELS: Record<Filter, string> = {
  "missing-email": "Missing email",
  "missing-phone": "Missing phone",
  "missing-either": "Missing email or phone",
  all: "All contacts",
};

export function BulkEnrichContacts({ contacts }: { contacts: Contact[] }) {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("missing-either");
  const [results, setResults] = useState<Record<number, RowResult>>({});
  const [running, setRunning] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const filtered = useMemo(() => {
    return contacts.filter((c) => {
      switch (filter) {
        case "missing-email": return !c.email;
        case "missing-phone": return !c.phone;
        case "missing-either": return !c.email || !c.phone;
        case "all": return true;
      }
    });
  }, [contacts, filter]);

  // Keep selection in sync with filter — default-select everything visible.
  useEffect(() => {
    setSelectedIds(new Set(filtered.map((c) => c.id)));
  }, [filtered]);

  function toggle(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function selectAll() {
    setSelectedIds(new Set(filtered.map((c) => c.id)));
  }
  function selectNone() {
    setSelectedIds(new Set());
  }

  async function enrichOne(contactId: number): Promise<RowResult> {
    try {
      const res = await fetch("/api/enrich-contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactId, autoApply: true }),
      });
      const data = await res.json();
      if (!res.ok) {
        return { state: "error", error: data.error || `HTTP ${res.status}` };
      }
      return {
        state: "done",
        fieldsChanged: Object.keys(data.diff || {}).length,
        enrichmentCount: data.enrichmentCount ?? 0,
        errors: Array.isArray(data.errors) ? data.errors : [],
      };
    } catch (e) {
      return { state: "error", error: e instanceof Error ? e.message : "request failed" };
    }
  }

  async function runBulk() {
    if (selectedIds.size === 0) {
      toast.error("Select at least one contact first");
      return;
    }
    setRunning(true);
    const ids = filtered.map((c) => c.id).filter((id) => selectedIds.has(id));
    let totalEnriched = 0;
    let totalErrors = 0;

    for (const id of ids) {
      setResults((prev) => ({ ...prev, [id]: { state: "running" } }));
      const result = await enrichOne(id);
      setResults((prev) => ({ ...prev, [id]: result }));
      if (result.state === "done" && (result.fieldsChanged ?? 0) > 0) totalEnriched += 1;
      if (result.state === "error") totalErrors += 1;
    }

    setRunning(false);
    toast.success(
      `Enrichment complete — ${totalEnriched}/${ids.length} contacts updated${totalErrors ? `, ${totalErrors} errors` : ""}`,
    );
    router.refresh();
  }

  return (
    <div>
      {/* Filter bar */}
      <div className="flex items-center gap-2 mb-3 text-xs">
        <span className="text-muted-foreground">Show:</span>
        {(Object.keys(FILTER_LABELS) as Filter[]).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            disabled={running}
            className={`px-2.5 py-1 rounded-md transition-colors ${
              filter === f
                ? "bg-blue-500/15 text-blue-300 border border-blue-500/40"
                : "border border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50"
            }`}
          >
            {FILTER_LABELS[f]}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2 mb-4 pb-3 border-b border-border">
        <Button onClick={runBulk} disabled={running || selectedIds.size === 0}>
          {running ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Enriching...
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4 mr-2" />
              Enrich {selectedIds.size} contact{selectedIds.size === 1 ? "" : "s"}
            </>
          )}
        </Button>
        <span className="text-xs text-muted-foreground">
          ({filtered.length} match{filtered.length === 1 ? "" : "es"} current filter)
        </span>
        <div className="ml-auto flex items-center gap-2 text-xs">
          <button type="button" onClick={selectAll} disabled={running} className="text-muted-foreground hover:text-foreground disabled:opacity-50">
            Select all
          </button>
          <span className="text-muted-foreground">·</span>
          <button type="button" onClick={selectNone} disabled={running} className="text-muted-foreground hover:text-foreground disabled:opacity-50">
            Select none
          </button>
        </div>
      </div>

      <div className="space-y-1 max-h-[60vh] overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="text-sm text-muted-foreground py-6 text-center">
            No contacts match this filter.
          </div>
        ) : null}
        {filtered.map((c) => {
          const result = results[c.id];
          const checked = selectedIds.has(c.id);
          return (
            <div
              key={c.id}
              className="flex items-center gap-3 p-2 rounded-md hover:bg-muted/50 text-sm"
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggle(c.id)}
                disabled={running}
                className="h-4 w-4"
              />
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{c.name}</div>
                <div className="text-xs text-muted-foreground truncate flex items-center gap-2">
                  {c.company ? <span>{c.company}</span> : <span className="italic">no company</span>}
                  <span className={c.email ? "text-emerald-500/70" : "text-amber-500/70"}>
                    <Mail className="h-3 w-3 inline" /> {c.email ? "✓" : "—"}
                  </span>
                  <span className={c.phone ? "text-emerald-500/70" : "text-amber-500/70"}>
                    <Phone className="h-3 w-3 inline" /> {c.phone ? "✓" : "—"}
                  </span>
                </div>
              </div>
              <div className="text-xs text-right min-w-[150px]">
                {result?.state === "running" ? (
                  <span className="flex items-center gap-1.5 text-muted-foreground justify-end">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Apollo + Hunter...
                  </span>
                ) : result?.state === "done" ? (
                  result.fieldsChanged && result.fieldsChanged > 0 ? (
                    <span className="flex items-center gap-1.5 text-emerald-500 justify-end">
                      <CheckCircle2 className="h-3 w-3" />
                      {result.fieldsChanged} field{result.fieldsChanged === 1 ? "" : "s"} updated
                    </span>
                  ) : (result.errors?.length ?? 0) > 0 ? (
                    <span
                      className="flex items-start gap-1.5 text-amber-400 justify-end"
                      title={result.errors?.join("\n")}
                    >
                      <AlertCircle className="h-3 w-3 mt-0.5" />
                      <span className="text-right text-[10px] leading-tight max-w-[260px] truncate">
                        {result.errors![0]}
                        {result.errors!.length > 1 ? ` (+${result.errors!.length - 1})` : ""}
                      </span>
                    </span>
                  ) : (
                    <span className="text-muted-foreground">no providers responded</span>
                  )
                ) : result?.state === "error" ? (
                  <span className="flex items-center gap-1.5 text-red-500 justify-end" title={result.error}>
                    <AlertCircle className="h-3 w-3" />
                    {result.error?.slice(0, 30)}
                  </span>
                ) : (
                  <span className="text-muted-foreground">queued</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
