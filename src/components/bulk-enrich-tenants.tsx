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

  async function enrichOne(tenantId: number, tenantName: string): Promise<RowResult> {
    try {
      // Step 1: run the full-stack find-contacts pipeline (Hunter + PDL
      // + Apollo + Apify + web_search-fallback) for this tenant company.
      const findRes = await fetch("/api/find-contacts-for-company", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company: tenantName }),
      });
      const findData = await findRes.json();
      if (!findRes.ok) {
        return { state: "error", error: findData.error || `HTTP ${findRes.status}` };
      }
      const candidates = (findData.candidates ?? []) as Array<{
        name: string;
        title: string | null;
        email: string | null;
        phone: string | null;
        linkedinUrl: string | null;
        source: string;
      }>;

      // Step 2: auto-create only candidates with a confirmed email and
      // a senior-looking title (CEO/President/COO/VP/Director/Owner/
      // Founder/Real Estate/Operations/Facilities). Anything weaker
      // stays as a candidate for the user to review manually via the
      // per-company Find People flow.
      const SENIOR = /\b(ceo|president|coo|cfo|vp|vice president|director|head of|chief|owner|founder|principal|managing|real estate|leasing|facilit|operations|asset manager)\b/i;
      const winners = candidates.filter(
        (c) => c.email && c.name && (c.title ? SENIOR.test(c.title) : true),
      ).slice(0, 3);

      let created = 0;
      let skipped = 0;
      for (const c of winners) {
        const noteParts: string[] = [];
        if (c.linkedinUrl) noteParts.push(`LinkedIn: ${c.linkedinUrl}`);
        noteParts.push(`Bulk enrich via ${c.source}`);
        const r = await fetch("/api/contacts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: c.name,
            email: c.email,
            phone: c.phone,
            company: tenantName,
            title: c.title,
            type: "tenant",
            source: `bulk-enrich/${c.source}`,
            notes: noteParts.join("\n"),
          }),
        });
        if (r.ok) created++;
        else skipped++;
      }

      return {
        state: "done",
        created,
        skipped,
        candidates: candidates.length,
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
      const t = tenants.find((x) => x.id === id);
      if (!t) continue;
      setResults((prev) => ({ ...prev, [id]: { state: "running" } }));
      const result = await enrichOne(id, t.name);
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
                    Searching…
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
