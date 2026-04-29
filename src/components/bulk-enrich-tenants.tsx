"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2, AlertCircle, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

type Tenant = {
  id: number;
  name: string;
  industry: string | null;
};

type RowState = "idle" | "running" | "done" | "error";
type RowResult = {
  state: RowState;
  created?: number;
  skipped?: number;
  candidates?: number;
  error?: string;
};

export function BulkEnrichTenants({ tenants }: { tenants: Tenant[] }) {
  const router = useRouter();
  const [results, setResults] = useState<Record<number, RowResult>>({});
  const [running, setRunning] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set(tenants.map((t) => t.id)));

  function toggle(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    setSelectedIds(new Set(tenants.map((t) => t.id)));
  }
  function selectNone() {
    setSelectedIds(new Set());
  }

  async function enrichOne(tenantId: number): Promise<RowResult> {
    try {
      const res = await fetch("/api/enrich-tenant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId }),
      });
      const data = await res.json();
      if (!res.ok) {
        return { state: "error", error: data.error || `HTTP ${res.status}` };
      }
      return {
        state: "done",
        created: data.createdContactIds?.length ?? 0,
        skipped: data.skippedExisting?.length ?? 0,
        candidates: data.candidatesFound ?? 0,
      };
    } catch (e) {
      return { state: "error", error: e instanceof Error ? e.message : "request failed" };
    }
  }

  async function runBulk() {
    if (selectedIds.size === 0) {
      toast.error("Select at least one tenant first");
      return;
    }
    setRunning(true);
    const ids = tenants.map((t) => t.id).filter((id) => selectedIds.has(id));
    let totalCreated = 0;
    let totalErrors = 0;

    for (const id of ids) {
      setResults((prev) => ({ ...prev, [id]: { state: "running" } }));
      const result = await enrichOne(id);
      setResults((prev) => ({ ...prev, [id]: result }));
      if (result.state === "done") totalCreated += result.created || 0;
      if (result.state === "error") totalErrors += 1;
    }

    setRunning(false);
    toast.success(`Bulk enrichment complete — ${totalCreated} contacts created across ${ids.length} tenants${totalErrors ? `, ${totalErrors} errors` : ""}`);
    router.refresh();
  }

  if (tenants.length === 0) {
    return (
      <div className="text-sm text-muted-foreground py-6 text-center">
        Every tenant already has at least one contact. Nothing to enrich.
      </div>
    );
  }

  return (
    <div>
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
              Enrich {selectedIds.size} tenant{selectedIds.size === 1 ? "" : "s"}
            </>
          )}
        </Button>
        <div className="ml-auto flex items-center gap-2 text-xs">
          <button
            type="button"
            onClick={selectAll}
            disabled={running}
            className="text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            Select all
          </button>
          <span className="text-muted-foreground">·</span>
          <button
            type="button"
            onClick={selectNone}
            disabled={running}
            className="text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            Select none
          </button>
        </div>
      </div>

      <div className="space-y-1 max-h-[60vh] overflow-y-auto">
        {tenants.map((t) => {
          const result = results[t.id];
          const checked = selectedIds.has(t.id);
          return (
            <div
              key={t.id}
              className="flex items-center gap-3 p-2 rounded-md hover:bg-muted/50 text-sm"
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggle(t.id)}
                disabled={running}
                className="h-4 w-4"
              />
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{t.name}</div>
                {t.industry ? (
                  <div className="text-xs text-muted-foreground truncate">{t.industry}</div>
                ) : null}
              </div>
              <div className="text-xs text-right min-w-[140px]">
                {result?.state === "running" ? (
                  <span className="flex items-center gap-1.5 text-muted-foreground justify-end">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Searching Apollo...
                  </span>
                ) : result?.state === "done" ? (
                  <span className="flex items-center gap-1.5 text-emerald-500 justify-end">
                    <CheckCircle2 className="h-3 w-3" />
                    {result.created ?? 0} created
                    {result.skipped ? ` · ${result.skipped} dupes` : ""}
                  </span>
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
