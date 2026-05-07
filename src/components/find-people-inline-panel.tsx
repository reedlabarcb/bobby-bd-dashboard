"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Loader2, Plus, Check, Search, Telescope, ShieldCheck, AlertTriangle,
  X, ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

/**
 * Inline Find People → Add / Deep Search workflow embedded under a
 * lease row. Three phases:
 *
 *   1. Find People (cheap)        — Hunter + PDL, web_search only if zero
 *   2. Display + checkbox select  — pick whom to act on
 *   3. Action: Add to Contacts    — bulk-create + link to lease
 *      OR: Deep Search Selected   — sequential per-person enrichment,
 *         each result has its own Add button
 *
 * Nothing writes to the DB until the user explicitly clicks Add or
 * Add All Results. Closing the panel discards everything.
 */

type Candidate = {
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  source: "hunter" | "pdl" | "web_search";
  confidence: number;
};

type DeepResult = {
  name: string;
  title: string | null;
  email: string | null;
  emailConfidence: "verified" | "found-unverified" | "none";
  predictedEmail: string | null;
  predictedEmailConfidence: "high — pattern + verified" | "medium — pattern unverified" | null;
  phone: string | null;
  linkedinUrl: string | null;
  city: string | null;
  state: string | null;
  summary: string;
  notFound: string[];
};

type DeepEntry = {
  status: "pending" | "searching" | "done" | "error";
  result?: DeepResult;
  error?: string;
  added?: boolean;
};

const SOURCE_BADGE: Record<Candidate["source"], string> = {
  hunter: "bg-blue-100 text-blue-700 border-blue-200",
  pdl: "bg-emerald-100 text-emerald-700 border-emerald-200",
  web_search: "bg-amber-100 text-amber-700 border-amber-200",
};
const SOURCE_LABEL: Record<Candidate["source"], string> = {
  hunter: "Hunter",
  pdl: "PDL",
  web_search: "Web",
};

export function FindPeopleInlinePanel({
  company,
  city,
  state,
  leaseId,
  onAdded,
  onClose,
}: {
  company: string;
  city?: string;
  state?: string;
  leaseId?: number; // reserved — not currently linked to lease records
  onAdded?: () => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [counts, setCounts] = useState<{ hunter: number; pdl: number; web_search: number } | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [notFound, setNotFound] = useState<string[]>([]);
  const [webSearchUsed, setWebSearchUsed] = useState(false);

  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [addedKeys, setAddedKeys] = useState<Set<string>>(new Set());
  const [bulkAdding, setBulkAdding] = useState(false);

  // Deep Search Selected state
  const [deepRunning, setDeepRunning] = useState(false);
  const [deepEntries, setDeepEntries] = useState<Record<string, DeepEntry>>({});
  const [bulkSavingDeep, setBulkSavingDeep] = useState(false);

  function keyFor(c: Candidate): string {
    return c.email ?? c.name;
  }

  // ─── Phase 1: load candidates on mount ─────────────────────
  useEffect(() => {
    void runFind();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runFind() {
    setLoading(true);
    setCandidates([]);
    setChecked(new Set());
    setAddedKeys(new Set());
    setDeepEntries({});
    try {
      const res = await fetch("/api/find-contacts-for-company", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company, city, state }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Find failed");
      setCandidates(data.candidates ?? []);
      setCounts(data.counts ?? null);
      setErrors(data.errors ?? []);
      setNotFound(data.notFound ?? []);
      setWebSearchUsed(!!data.webSearchUsed);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Find failed");
      onClose();
    } finally {
      setLoading(false);
    }
  }

  function toggleCheck(key: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  function toggleAll() {
    setChecked((prev) => {
      const allKeys = candidates.map(keyFor);
      const allSelected = allKeys.every((k) => prev.has(k));
      return new Set(allSelected ? [] : allKeys);
    });
  }

  // ─── Phase 3: Add to Contacts (selected only) ──────────────
  async function addSelected() {
    if (checked.size === 0) return;
    setBulkAdding(true);
    let saved = 0;
    for (const c of candidates) {
      const k = keyFor(c);
      if (!checked.has(k) || addedKeys.has(k)) continue;
      try {
        const noteParts: string[] = [];
        if (c.linkedinUrl) noteParts.push(`LinkedIn: ${c.linkedinUrl}`);
        const res = await fetch("/api/contacts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: c.name,
            email: c.email,
            phone: c.phone,
            company,
            title: c.title,
            type: "tenant",
            source: `find-people/${c.source}`,
            notes: noteParts.length > 0 ? noteParts.join("\n") : undefined,
          }),
        });
        if (res.ok) {
          saved++;
          setAddedKeys((prev) => new Set(prev).add(k));
        }
      } catch {
        /* skip on failure */
      }
    }
    setBulkAdding(false);
    setChecked(new Set());
    toast.success(`Added ${saved} contact${saved === 1 ? "" : "s"} at ${company}`);
    onAdded?.();
    router.refresh();
  }

  // ─── Phase 4: Deep Search Selected ─────────────────────────
  async function deepSearchSelected() {
    if (checked.size === 0) return;
    setDeepRunning(true);
    const targets = candidates.filter((c) => checked.has(keyFor(c)));
    // initialise pending statuses
    setDeepEntries(() => {
      const init: Record<string, DeepEntry> = {};
      for (const c of targets) init[keyFor(c)] = { status: "pending" };
      return init;
    });
    for (const c of targets) {
      const k = keyFor(c);
      setDeepEntries((prev) => ({ ...prev, [k]: { status: "searching" } }));
      try {
        const res = await fetch("/api/deep-search-person", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: c.name, company }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Deep search failed");
        setDeepEntries((prev) => ({ ...prev, [k]: { status: "done", result: data } }));
      } catch (e) {
        setDeepEntries((prev) => ({
          ...prev,
          [k]: { status: "error", error: e instanceof Error ? e.message : "failed" },
        }));
      }
    }
    setDeepRunning(false);
  }

  async function addDeepResult(key: string) {
    const entry = deepEntries[key];
    if (!entry?.result) return;
    const r = entry.result;
    const noteParts: string[] = [];
    if (r.linkedinUrl) noteParts.push(`LinkedIn: ${r.linkedinUrl}`);
    if (r.predictedEmail && !r.email) {
      noteParts.push(`Predicted email: ${r.predictedEmail} (${r.predictedEmailConfidence ?? "unverified"})`);
    }
    if (r.summary) noteParts.push(`---\nDeep Search Summary: ${r.summary}`);
    try {
      const res = await fetch("/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: r.name,
          email: r.email,
          phone: r.phone,
          company,
          title: r.title,
          city: r.city,
          state: r.state,
          type: "tenant",
          source: "deep-search",
          notes: noteParts.length > 0 ? noteParts.join("\n") : undefined,
        }),
      });
      if (!res.ok) throw new Error("Add failed");
      setDeepEntries((prev) => ({ ...prev, [key]: { ...prev[key], added: true } }));
      toast.success(`Added ${r.name}`);
      onAdded?.();
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add");
    }
  }

  async function addAllDeepResults() {
    setBulkSavingDeep(true);
    for (const k of Object.keys(deepEntries)) {
      const e = deepEntries[k];
      if (e.status !== "done" || e.added) continue;
      await addDeepResult(k);
    }
    setBulkSavingDeep(false);
  }

  // ─── render ────────────────────────────────────────────────
  const allKeys = candidates.map(keyFor);
  const allChecked = allKeys.length > 0 && allKeys.every((k) => checked.has(k));
  const anyChecked = checked.size > 0;
  const deepDoneCount = Object.values(deepEntries).filter((e) => e.status === "done").length;
  const deepUnaddedCount = Object.values(deepEntries).filter((e) => e.status === "done" && !e.added).length;

  return (
    <div className="rounded-md border border-blue-200 bg-blue-50/50 p-3 space-y-3 mt-2">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm">
          <Search className="size-4 text-blue-700" />
          <span className="font-medium">People at {company}</span>
          {!loading && (
            <span className="text-xs text-muted-foreground">
              · {candidates.length} found
              {counts && (
                <>
                  {" "}(Hunter {counts.hunter}, PDL {counts.pdl}
                  {webSearchUsed ? `, Web ${counts.web_search}` : ""})
                </>
              )}
            </span>
          )}
        </div>
        <Button variant="ghost" size="sm" className="h-7 px-2" onClick={onClose}>
          <X className="size-3.5" />
        </Button>
      </div>

      {webSearchUsed && (
        <div className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1">
          Hunter + PDL returned no matches — web search ran as a last-resort fallback.
        </div>
      )}
      {errors.length > 0 && (
        <div className="rounded-md bg-amber-50 border border-amber-200 p-2 text-[11px] text-amber-800 space-y-0.5">
          <p className="font-medium">Errors:</p>
          {errors.map((e, i) => (<p key={i}>{e}</p>))}
        </div>
      )}
      {notFound.length > 0 && (
        <div className="rounded-md bg-slate-50 border border-slate-200 p-2 text-[11px] text-slate-600 space-y-0.5">
          {notFound.map((n, i) => (<p key={i}>· {n}</p>))}
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="py-6 flex items-center justify-center text-muted-foreground text-sm">
          <Loader2 className="size-4 mr-2 animate-spin" />
          Searching Hunter + PDL…
        </div>
      )}

      {/* Empty state */}
      {!loading && candidates.length === 0 && (
        <div className="py-4 text-center text-sm text-muted-foreground">
          No candidates found.
        </div>
      )}

      {/* Phase 2: Candidate list with checkboxes */}
      {!loading && candidates.length > 0 && (
        <>
          <div className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={allChecked}
              onChange={toggleAll}
              className="size-4 cursor-pointer accent-blue-600"
              aria-label="Select all"
            />
            <span className="text-muted-foreground">
              Select all ({candidates.length})
            </span>
            <span className="ml-auto text-muted-foreground">
              {checked.size} selected
            </span>
          </div>

          <div className="space-y-1.5">
            {candidates.map((c) => {
              const k = keyFor(c);
              const isChecked = checked.has(k);
              const isAdded = addedKeys.has(k);
              const deepEntry = deepEntries[k];
              return (
                <div key={k} className="rounded-md border border-border bg-white">
                  <div className="flex items-start gap-3 p-2.5">
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => toggleCheck(k)}
                      disabled={isAdded}
                      className="mt-0.5 size-4 cursor-pointer accent-blue-600"
                      aria-label={`Select ${c.name}`}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">{c.name}</span>
                        <Badge
                          variant="outline"
                          className={`text-[10px] uppercase ${SOURCE_BADGE[c.source]}`}
                        >
                          {SOURCE_LABEL[c.source]}
                        </Badge>
                        {c.confidence > 0 && (
                          <span className="text-[10px] text-muted-foreground">
                            {c.confidence}% conf
                          </span>
                        )}
                        {isAdded && (
                          <Badge variant="outline" className="text-[10px] bg-emerald-100 text-emerald-700 border-emerald-200">
                            <Check className="size-2.5 mr-0.5" />
                            added
                          </Badge>
                        )}
                      </div>
                      {c.title && <p className="text-xs text-muted-foreground mt-0.5">{c.title}</p>}
                      <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs mt-1">
                        {c.email && <span className="text-blue-700">{c.email}</span>}
                        {c.phone && <span className="text-slate-700">{c.phone}</span>}
                        {c.linkedinUrl && (
                          <a
                            href={c.linkedinUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-700 hover:underline inline-flex items-center gap-1"
                          >
                            LinkedIn <ExternalLink className="size-3" />
                          </a>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Per-row Deep Search progress / result */}
                  {deepEntry && (
                    <div className="border-t border-border/60 px-2.5 py-2 bg-purple-50/40 text-xs space-y-1">
                      {deepEntry.status === "searching" && (
                        <div className="flex items-center gap-2 text-purple-700">
                          <Loader2 className="size-3.5 animate-spin" />
                          Deep searching {c.name}… Hunter / PDL / Web search / Pattern
                        </div>
                      )}
                      {deepEntry.status === "pending" && (
                        <div className="text-muted-foreground italic">queued…</div>
                      )}
                      {deepEntry.status === "error" && (
                        <div className="text-red-700">Deep search failed: {deepEntry.error}</div>
                      )}
                      {deepEntry.status === "done" && deepEntry.result && (
                        <DeepResultCard
                          k={k}
                          r={deepEntry.result}
                          added={!!deepEntry.added}
                          onAdd={() => addDeepResult(k)}
                        />
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Bottom action bar — only when something is checked */}
          {anyChecked && (
            <div className="flex items-center justify-end gap-2 pt-1 border-t border-border/60">
              <span className="text-xs text-muted-foreground mr-auto">
                {checked.size} selected
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={bulkAdding || deepRunning}
                onClick={addSelected}
                className="gap-1"
              >
                {bulkAdding ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
                Add to Contacts
              </Button>
              <Button
                size="sm"
                disabled={deepRunning || bulkAdding}
                onClick={deepSearchSelected}
                className="gap-1"
              >
                {deepRunning ? <Loader2 className="size-3.5 animate-spin" /> : <Telescope className="size-3.5" />}
                Deep Search Selected
              </Button>
            </div>
          )}

          {/* Add All Results — appears once any deep results land */}
          {deepDoneCount > 0 && (
            <div className="flex justify-end pt-1">
              <Button
                size="sm"
                variant="outline"
                disabled={bulkSavingDeep || deepUnaddedCount === 0}
                onClick={addAllDeepResults}
                className="gap-1"
              >
                {bulkSavingDeep ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
                Add All Results ({deepUnaddedCount})
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function DeepResultCard({
  k: _k, r, added, onAdd,
}: {
  k: string;
  r: DeepResult;
  added: boolean;
  onAdd: () => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-0.5 flex-1 min-w-0">
          <p className="text-foreground">{r.summary}</p>
          <div className="flex flex-wrap gap-x-4 gap-y-0.5">
            {r.title && <span>· {r.title}</span>}
            {r.email && (
              <span className="text-blue-700 inline-flex items-center gap-1">
                · {r.email}
                {r.emailConfidence === "verified" && <ShieldCheck className="size-3 text-emerald-600" />}
              </span>
            )}
            {!r.email && r.predictedEmail && (
              <span className="text-amber-700 inline-flex items-center gap-1">
                · {r.predictedEmail}
                <Badge variant="outline" className="text-[9px] bg-amber-100 text-amber-800 border-amber-200">
                  <AlertTriangle className="size-2.5 mr-0.5" />
                  {r.predictedEmailConfidence?.startsWith("high") ? "predicted ✓" : "predicted"}
                </Badge>
              </span>
            )}
            {r.phone && <span>· {r.phone}</span>}
            {(r.city || r.state) && (
              <span>· {[r.city, r.state].filter(Boolean).join(", ")}</span>
            )}
          </div>
        </div>
        <Button
          size="sm"
          variant={added ? "ghost" : "outline"}
          disabled={added}
          onClick={onAdd}
          className="gap-1"
        >
          {added ? <><Check className="size-3.5" /> Added</> : <><Plus className="size-3.5" /> Add</>}
        </Button>
      </div>
    </div>
  );
}
