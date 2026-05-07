"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Telescope, Loader2, ExternalLink, Plus, Check, ShieldCheck, AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";

type Person = {
  name: string;
  title: string | null;
  email: string | null;
  emailConfidence: "verified" | "found-unverified" | "none";
  predictedEmail: string | null;
  predictedEmailConfidence: "high — pattern + verified" | "medium — pattern unverified" | null;
  phone: string | null;
  linkedinUrl: string | null;
  source: "hunter" | "pdl" | "web_search";
  confidence: number;
};

type Result = {
  company: string;
  domain: string | null;
  people: Person[];
  emailPattern: string | null;
  patternConfidence: "verified" | "inferred" | null;
  counts: { hunter: number; pdl: number; web_search: number };
  errors: string[];
  notFound: string[];
};

const SOURCE_BADGE: Record<Person["source"], string> = {
  hunter: "bg-blue-100 text-blue-700 border-blue-200",
  pdl: "bg-emerald-100 text-emerald-700 border-emerald-200",
  web_search: "bg-amber-100 text-amber-700 border-amber-200",
};

export function DeepSearchCompanyButton({
  company,
  domain,
  size = "sm",
  variant = "outline",
  label = "Deep Search",
  onSaved,
}: {
  company: string;
  domain?: string;
  size?: "sm" | "default";
  variant?: "outline" | "ghost" | "default";
  label?: string;
  onSaved?: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [bulkSaving, setBulkSaving] = useState(false);

  async function run() {
    setOpen(true);
    setLoading(true);
    setResult(null);
    setAdded(new Set());
    try {
      const res = await fetch("/api/deep-search-company", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company, domain }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Deep search failed");
      setResult(data);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Deep search failed");
      setOpen(false);
    } finally {
      setLoading(false);
    }
  }

  function keyFor(p: Person): string {
    return p.email ?? p.predictedEmail ?? p.name;
  }

  async function addOne(p: Person) {
    const k = keyFor(p);
    setAdding(k);
    try {
      const noteParts: string[] = [];
      if (p.linkedinUrl) noteParts.push(`LinkedIn: ${p.linkedinUrl}`);
      if (p.predictedEmail && !p.email) {
        noteParts.push(`Predicted email: ${p.predictedEmail} (${p.predictedEmailConfidence ?? "unverified"})`);
      }
      const res = await fetch("/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: p.name,
          email: p.email,
          phone: p.phone,
          company,
          title: p.title,
          type: "tenant",
          source: `deep-search/${p.source}`,
          notes: noteParts.length > 0 ? noteParts.join("\n") : undefined,
        }),
      });
      if (!res.ok) throw new Error("Failed to create contact");
      setAdded((s) => new Set(s).add(k));
      toast.success(`Added ${p.name}`);
      onSaved?.();
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add");
    } finally {
      setAdding(null);
    }
  }

  async function addAll() {
    if (!result) return;
    setBulkSaving(true);
    for (const p of result.people) {
      const k = keyFor(p);
      if (added.has(k)) continue;
      // sequential — easier to debug, respects rate limits
      await addOne(p);
    }
    setBulkSaving(false);
  }

  return (
    <>
      <Button variant={variant} size={size} onClick={run} disabled={loading} className="gap-1">
        {loading ? <Loader2 className="size-3.5 animate-spin" /> : <Telescope className="size-3.5" />}
        {label}
      </Button>

      <Dialog open={open} onOpenChange={(v) => !loading && !bulkSaving && setOpen(v)}>
        <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>People at {company}</DialogTitle>
            <DialogDescription>
              {loading
                ? "Searching Hunter, PDL, and the web…"
                : result
                ? `${result.people.length} candidate${result.people.length === 1 ? "" : "s"} found.`
                : ""}
            </DialogDescription>
          </DialogHeader>

          {loading && (
            <div className="py-12 flex items-center justify-center text-muted-foreground">
              <Loader2 className="size-5 mr-2 animate-spin" />
              Running deep search…
            </div>
          )}

          {result && !loading && (
            <div className="space-y-3">
              {/* Pattern summary */}
              {result.emailPattern && (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                  <p className="font-medium flex items-center gap-1">
                    <AlertTriangle className="size-3.5" />
                    Email pattern detected: <span className="font-mono">{result.emailPattern}</span>
                  </p>
                  <p className="mt-0.5">
                    Confidence: <strong>{result.patternConfidence}</strong>. Predicted emails for people
                    without a confirmed one are shown in amber and flagged.
                  </p>
                </div>
              )}

              {/* Source counts */}
              <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                <span>Hunter: {result.counts.hunter}</span>
                <span>PDL: {result.counts.pdl}</span>
                <span>Web: {result.counts.web_search}</span>
                {result.domain && <span>Domain: <span className="font-mono">{result.domain}</span></span>}
              </div>

              {result.errors.length > 0 && (
                <div className="rounded-md bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800 space-y-1">
                  <p className="font-medium">Errors:</p>
                  {result.errors.map((e, i) => (<p key={i}>{e}</p>))}
                </div>
              )}
              {result.notFound.length > 0 && (
                <div className="rounded-md bg-slate-50 border border-slate-200 p-3 text-xs text-slate-600 space-y-1">
                  <p className="font-medium">No data from:</p>
                  {result.notFound.map((n, i) => (<p key={i}>· {n}</p>))}
                </div>
              )}

              {/* Actions */}
              {result.people.length > 0 && (
                <div className="flex justify-between items-center">
                  <p className="text-xs text-muted-foreground">
                    {added.size} of {result.people.length} added
                  </p>
                  <Button size="sm" onClick={addAll} disabled={bulkSaving || added.size === result.people.length}>
                    {bulkSaving ? <Loader2 className="size-3.5 mr-1 animate-spin" /> : <Plus className="size-3.5 mr-1" />}
                    Add All
                  </Button>
                </div>
              )}

              {/* Person cards */}
              <div className="space-y-2">
                {result.people.map((p) => {
                  const k = keyFor(p);
                  const isAdded = added.has(k);
                  const isAdding = adding === k;
                  return (
                    <div
                      key={k}
                      className="flex items-start justify-between gap-3 p-3 rounded-md border border-border hover:bg-muted/40"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium">{p.name}</span>
                          <Badge variant="outline" className={`text-[10px] uppercase tracking-wider ${SOURCE_BADGE[p.source]}`}>
                            {p.source.replace("_", " ")}
                          </Badge>
                          {p.confidence > 0 && (
                            <span className="text-[10px] text-muted-foreground">{p.confidence}% conf</span>
                          )}
                        </div>
                        {p.title && <p className="text-xs text-muted-foreground mt-0.5">{p.title}</p>}
                        <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs mt-1">
                          {p.email && (
                            <span className="text-blue-700 inline-flex items-center gap-1">
                              {p.email}
                              {p.emailConfidence === "verified" && (
                                <ShieldCheck className="size-3 text-emerald-600" />
                              )}
                            </span>
                          )}
                          {!p.email && p.predictedEmail && (
                            <span className="text-amber-700 inline-flex items-center gap-1">
                              {p.predictedEmail}
                              <Badge variant="outline" className="text-[9px] bg-amber-100 text-amber-800 border-amber-200">
                                {p.predictedEmailConfidence?.startsWith("high") ? "predicted ✓" : "predicted"}
                              </Badge>
                            </span>
                          )}
                          {p.phone && <span className="text-slate-700">{p.phone}</span>}
                          {p.linkedinUrl && (
                            <a
                              href={p.linkedinUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-700 hover:underline inline-flex items-center gap-1"
                            >
                              LinkedIn <ExternalLink className="size-3" />
                            </a>
                          )}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant={isAdded ? "ghost" : "default"}
                        disabled={isAdded || isAdding}
                        onClick={() => addOne(p)}
                      >
                        {isAdded ? (<><Check className="size-3.5 mr-1" /> Added</>)
                          : isAdding ? <Loader2 className="size-3.5 mr-1 animate-spin" />
                          : (<><Plus className="size-3.5 mr-1" /> Add</>)}
                      </Button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
