"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Search, Loader2, Plus, Check, ExternalLink, Telescope, ShieldCheck, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";

type Candidate = {
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  source: "hunter" | "apollo" | "pdl" | "web_search";
  confidence: number;
};

type Counts = {
  hunter: number;
  apollo: number;
  pdl: number;
  web_search: number;
};

const SOURCE_LABELS: Record<Candidate["source"], string> = {
  hunter: "Hunter",
  apollo: "Apollo",
  pdl: "PDL",
  web_search: "Web Search",
};

const SOURCE_COLORS: Record<Candidate["source"], string> = {
  hunter: "bg-blue-100 text-blue-700 border-blue-200",
  apollo: "bg-violet-100 text-violet-700 border-violet-200",
  pdl: "bg-emerald-100 text-emerald-700 border-emerald-200",
  web_search: "bg-amber-100 text-amber-700 border-amber-200",
};

export function FindContactsButton({
  company,
  domain,
  city,
  state,
  size = "sm",
  variant = "outline",
  label = "Find People",
  onAdded,
}: {
  company: string;
  domain?: string;
  city?: string;
  state?: string;
  size?: "sm" | "default";
  variant?: "outline" | "ghost" | "default";
  label?: string;
  onAdded?: () => void;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [notFound, setNotFound] = useState<string[]>([]);
  const [adding, setAdding] = useState<string | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());
  // Per-candidate deep-research state. `deepLoading` tracks which row is
  // currently running the deep search; `deepResults` holds the enriched
  // payload keyed by candidate row key.
  type DeepResult = {
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
  };
  const [deepLoading, setDeepLoading] = useState<string | null>(null);
  const [deepResults, setDeepResults] = useState<Record<string, DeepResult>>({});

  async function run() {
    setLoading(true);
    setOpen(true);
    setCandidates([]);
    setErrors([]);
    setNotFound([]);
    setCounts(null);
    setAdded(new Set());
    try {
      const res = await fetch("/api/find-contacts-for-company", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company, domain, city, state }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Find failed");
      }
      const data = await res.json();
      setCandidates(data.candidates ?? []);
      setCounts(data.counts ?? null);
      setErrors(data.errors ?? []);
      setNotFound(data.notFound ?? []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Find contacts failed");
      setOpen(false);
    } finally {
      setLoading(false);
    }
  }

  async function deepResearch(c: Candidate) {
    const key = c.email ?? c.name;
    setDeepLoading(key);
    try {
      const res = await fetch("/api/deep-search-person", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: c.name, company }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Deep research failed");
      setDeepResults((prev) => ({ ...prev, [key]: data }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Deep research failed");
    } finally {
      setDeepLoading(null);
    }
  }

  async function addCandidate(c: Candidate) {
    const key = c.email ?? c.name;
    const enriched = deepResults[key];
    // Asterisk: prefer enriched fields when present, fall back to original
    const asStr = (v: unknown) =>
      typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
    const email = asStr(enriched?.email) ?? asStr(c.email);
    const phone = asStr(enriched?.phone) ?? asStr(c.phone);
    const title = asStr(enriched?.title) ?? asStr(c.title);
    const linkedinUrl = asStr(enriched?.linkedinUrl) ?? asStr(c.linkedinUrl);
    const city = asStr(enriched?.city);
    const state = asStr(enriched?.state);

    const noteParts: string[] = [];
    if (linkedinUrl) noteParts.push(`LinkedIn: ${linkedinUrl}`);
    if (enriched?.predictedEmail && !email) {
      noteParts.push(
        `Predicted email: ${enriched.predictedEmail} (${enriched.predictedEmailConfidence ?? "unverified"})`,
      );
    }
    if (enriched?.summary) noteParts.push(`---\nDeep Search Summary: ${enriched.summary}`);

    setAdding(key);
    try {
      const res = await fetch("/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: c.name,
          email,
          phone,
          company,
          title,
          city,
          state,
          type: "tenant",
          source: enriched ? `find-contacts/${c.source}+deep` : `find-contacts/${c.source}`,
          notes: noteParts.length > 0 ? noteParts.join("\n") : undefined,
        }),
      });
      if (!res.ok) throw new Error("Failed to create contact");
      setAdded((s) => new Set(s).add(key));
      toast.success(`Added ${c.name}`);
      onAdded?.();
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add");
    } finally {
      setAdding(null);
    }
  }

  return (
    <>
      <Button
        variant={variant}
        size={size}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          run();
        }}
        disabled={loading}
      >
        {loading ? (
          <Loader2 className="size-3.5 mr-1 animate-spin" />
        ) : (
          <Search className="size-3.5 mr-1" />
        )}
        {label}
      </Button>

      <Dialog open={open} onOpenChange={(v) => !loading && setOpen(v)}>
        <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>People at {company}</DialogTitle>
            <DialogDescription>
              {loading
                ? "Searching Hunter, Apollo, PDL, and the web…"
                : `${candidates.length} candidate${candidates.length === 1 ? "" : "s"} found.`}
            </DialogDescription>
          </DialogHeader>

          {counts && (
            <div className="text-xs text-muted-foreground flex flex-wrap gap-3">
              <span>Hunter: {counts.hunter}</span>
              <span>Apollo: {counts.apollo}</span>
              <span>PDL: {counts.pdl}</span>
              <span>Web: {counts.web_search}</span>
            </div>
          )}

          {errors.length > 0 && (
            <div className="rounded-md bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800 space-y-1">
              <p className="font-medium">Errors:</p>
              {errors.map((e, i) => (<p key={i}>{e}</p>))}
            </div>
          )}

          {notFound.length > 0 && (
            <div className="rounded-md bg-slate-50 border border-slate-200 p-3 text-xs text-slate-600 space-y-1">
              <p className="font-medium">No data from:</p>
              {notFound.map((n, i) => (<p key={i}>· {n}</p>))}
            </div>
          )}

          {loading ? (
            <div className="py-12 flex items-center justify-center text-muted-foreground">
              <Loader2 className="size-5 mr-2 animate-spin" />
              Searching…
            </div>
          ) : candidates.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              No candidates found across the configured sources.
            </div>
          ) : (
            <div className="space-y-2">
              {candidates.map((c) => {
                const key = c.email ?? c.name;
                const isAdded = added.has(key);
                const isAdding = adding === key;
                const isDeepLoading = deepLoading === key;
                const enriched = deepResults[key];
                // Display fields prefer enriched values when present
                const dispEmail = enriched?.email ?? c.email;
                const dispPhone = enriched?.phone ?? c.phone;
                const dispTitle = enriched?.title ?? c.title;
                const dispLinkedIn = enriched?.linkedinUrl ?? c.linkedinUrl;
                return (
                  <div
                    key={key}
                    className="rounded-md border border-border hover:bg-muted/40"
                  >
                    <div className="flex items-start justify-between gap-3 p-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium">{c.name}</span>
                          <Badge
                            className={`text-[10px] uppercase tracking-wider ${SOURCE_COLORS[c.source]}`}
                            variant="outline"
                          >
                            {SOURCE_LABELS[c.source]}
                          </Badge>
                          {c.confidence > 0 && (
                            <span className="text-[10px] text-muted-foreground">
                              {c.confidence}% conf
                            </span>
                          )}
                          {enriched && (
                            <Badge variant="outline" className="text-[10px] bg-purple-100 text-purple-700 border-purple-200">
                              <Telescope className="size-3 mr-1" />
                              Deep enriched
                            </Badge>
                          )}
                        </div>
                        {dispTitle && (
                          <p className="text-xs text-muted-foreground mt-0.5">{dispTitle}</p>
                        )}
                        <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs mt-1">
                          {dispEmail && (
                            <span className="text-blue-700 inline-flex items-center gap-1">
                              {dispEmail}
                              {enriched?.emailConfidence === "verified" && (
                                <ShieldCheck className="size-3 text-emerald-600" />
                              )}
                            </span>
                          )}
                          {!dispEmail && enriched?.predictedEmail && (
                            <span className="text-amber-700 inline-flex items-center gap-1">
                              {enriched.predictedEmail}
                              <Badge variant="outline" className="text-[9px] bg-amber-100 text-amber-800 border-amber-200">
                                <AlertTriangle className="size-2.5 mr-0.5" />
                                {enriched.predictedEmailConfidence?.startsWith("high") ? "predicted ✓" : "predicted"}
                              </Badge>
                            </span>
                          )}
                          {dispPhone && <span className="text-slate-700">{dispPhone}</span>}
                          {dispLinkedIn && (
                            <a
                              href={dispLinkedIn}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-700 hover:underline inline-flex items-center gap-1"
                            >
                              LinkedIn <ExternalLink className="size-3" />
                            </a>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-col gap-1.5 shrink-0">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={isDeepLoading || isAdded}
                          onClick={() => deepResearch(c)}
                          className="gap-1"
                        >
                          {isDeepLoading ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <Telescope className="size-3.5" />
                          )}
                          {enriched ? "Re-research" : "Deep Research"}
                        </Button>
                        <Button
                          size="sm"
                          variant={isAdded ? "ghost" : "default"}
                          disabled={isAdded || isAdding}
                          onClick={() => addCandidate(c)}
                        >
                          {isAdded ? (
                            <><Check className="size-3.5 mr-1" /> Added</>
                          ) : isAdding ? (
                            <Loader2 className="size-3.5 mr-1 animate-spin" />
                          ) : (
                            <><Plus className="size-3.5 mr-1" /> Add</>
                          )}
                        </Button>
                      </div>
                    </div>
                    {/* Inline enriched panel — appears under the row when Deep Research finishes */}
                    {enriched?.summary && (
                      <div className="border-t border-border/60 p-3 bg-purple-50/40 text-xs space-y-1">
                        <p className="text-muted-foreground"><span className="font-medium text-foreground">Summary:</span> {enriched.summary}</p>
                        {(enriched.city || enriched.state) && (
                          <p className="text-muted-foreground">Location: {[enriched.city, enriched.state].filter(Boolean).join(", ")}</p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
