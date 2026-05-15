"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Telescope, Loader2, ExternalLink, Save, X, ShieldCheck, AlertTriangle, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";

type DeepResult = {
  name: string;
  title: string | null;
  company: string | null;
  email: string | null;
  emailConfidence: "verified" | "found-unverified" | "none";
  predictedEmail: string | null;
  predictedEmailConfidence: "high — pattern + verified" | "medium — pattern unverified" | null;
  phone: string | null;
  linkedinUrl: string | null;
  city: string | null;
  state: string | null;
  summary: string;
  sources: string[];
  errors: string[];
  notFound: string[];
};

type Stage = "idle" | "hunter" | "pdl" | "apollo" | "apify" | "web_search" | "pattern" | "done";

const STAGE_LABEL: Record<Stage, string> = {
  idle: "",
  hunter: "Searching Hunter…",
  pdl: "Searching People Data Labs…",
  apollo: "Searching Apollo…",
  apify: "Running LinkedIn scrape…",
  web_search: "Running web search…",
  pattern: "Matching email pattern…",
  done: "Done",
};

export function DeepSearchPersonButton({
  contactId,
  variant = "outline",
}: {
  contactId: number;
  variant?: "outline" | "default";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState<Stage>("idle");
  const [result, setResult] = useState<DeepResult | null>(null);
  const [saving, setSaving] = useState(false);

  async function run() {
    setOpen(true);
    setLoading(true);
    setResult(null);
    setStage("hunter");
    // Visual cue: bump through stages while the request runs. The actual
    // server pipeline runs sequentially and we don't get progress events
    // back, so this is a UI affordance — synced to expected stage timing.
    const stages: Stage[] = ["hunter", "pdl", "apollo", "apify", "web_search", "pattern"];
    let i = 0;
    const timer = setInterval(() => {
      i++;
      if (i < stages.length) setStage(stages[i]);
    }, 1500);
    try {
      const res = await fetch("/api/deep-search-person", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Deep search failed");
      setResult(data);
      setStage("done");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Deep search failed");
      setOpen(false);
    } finally {
      clearInterval(timer);
      setLoading(false);
    }
  }

  async function save() {
    if (!result) return;
    setSaving(true);
    try {
      // Apply blank-only fields via the PUT half of /api/enrich-contact —
      // it has the same "never overwrite non-empty" behavior we want.
      // We send a flat updates object; Claude/server-side check for blanks.
      const updates: Record<string, string> = {};
      // Strict string coercion — server returned data may include
      // non-string sentinels (e.g. `true`) from web_search that would
      // blow up a TEXT column write.
      const asStr = (v: unknown) =>
        typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
      const title = asStr(result.title);
      const email = asStr(result.email);
      const phone = asStr(result.phone);
      const city = asStr(result.city);
      const state = asStr(result.state);
      if (title) updates.title = title;
      if (email) updates.email = email;
      if (phone) updates.phone = phone;
      if (city) updates.city = city;
      if (state) updates.state = state;

      // Notes append: predicted email + summary go here so the user can review.
      const notesAdditions: string[] = [];
      if (result.linkedinUrl) notesAdditions.push(`LinkedIn: ${result.linkedinUrl}`);
      if (result.predictedEmail && !result.email) {
        notesAdditions.push(
          `Predicted email: ${result.predictedEmail} (${result.predictedEmailConfidence ?? "unverified"})`,
        );
      }
      if (result.summary) notesAdditions.push(`---\nDeep Search Summary: ${result.summary}`);
      if (notesAdditions.length > 0) updates.notes = notesAdditions.join("\n");

      const res = await fetch("/api/enrich-contact", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactId, updates }),
      });
      if (!res.ok) throw new Error("Failed to apply");
      toast.success("Deep search findings saved");
      setOpen(false);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button variant={variant} size="sm" onClick={run} disabled={loading} className="gap-1">
        {loading ? <Loader2 className="size-4 animate-spin" /> : <Telescope className="size-4" />}
        Enrich
      </Button>

      <Dialog open={open} onOpenChange={(v) => !loading && !saving && setOpen(v)}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Enrich Contact</DialogTitle>
            <DialogDescription>
              Exhaustive multi-source research. Nothing is saved until you click Save.
            </DialogDescription>
          </DialogHeader>

          {loading && (
            <div className="space-y-2 py-4">
              {(["hunter", "pdl", "apollo", "apify", "web_search", "pattern"] as const).map((s) => (
                <div key={s} className="flex items-center gap-2 text-sm">
                  {stage === s ? (
                    <Loader2 className="size-4 animate-spin text-blue-600" />
                  ) : (["hunter", "pdl", "apollo", "apify", "web_search", "pattern"].indexOf(stage) >
                    ["hunter", "pdl", "apollo", "apify", "web_search", "pattern"].indexOf(s)) ? (
                    <ShieldCheck className="size-4 text-emerald-600" />
                  ) : (
                    <div className="size-4 rounded-full border border-border" />
                  )}
                  <span className={stage === s ? "font-medium" : "text-muted-foreground"}>
                    {STAGE_LABEL[s]}
                  </span>
                </div>
              ))}
            </div>
          )}

          {result && !loading && (
            <div className="space-y-4">
              {/* Summary */}
              <div className="rounded-md border border-border p-3 bg-muted/30">
                <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Summary</p>
                <p className="text-sm">{result.summary}</p>
              </div>

              {/* Sources */}
              <div className="flex flex-wrap gap-1.5 text-[10px]">
                {result.sources.map((s) => (
                  <Badge key={s} variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                    <Sparkles className="size-3 mr-1" />
                    {s}
                  </Badge>
                ))}
              </div>

              {/* Field grid */}
              <div className="grid grid-cols-2 gap-3 text-sm">
                <Field label="Title" value={result.title} />
                <Field label="Company" value={result.company} />
                <Field
                  label="Email"
                  value={result.email}
                  badge={
                    result.email ? (
                      result.emailConfidence === "verified" ? (
                        <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200" variant="outline">
                          <ShieldCheck className="size-3 mr-1" /> Verified
                        </Badge>
                      ) : (
                        <Badge className="bg-blue-100 text-blue-700 border-blue-200" variant="outline">
                          Found
                        </Badge>
                      )
                    ) : null
                  }
                />
                {result.predictedEmail && (
                  <Field
                    label="Predicted email"
                    value={result.predictedEmail}
                    valueClass="text-amber-700"
                    badge={
                      <Badge
                        className={
                          result.predictedEmailConfidence?.startsWith("high")
                            ? "bg-amber-100 text-amber-800 border-amber-200"
                            : "bg-slate-100 text-slate-700 border-slate-200"
                        }
                        variant="outline"
                      >
                        <AlertTriangle className="size-3 mr-1" />
                        {result.predictedEmailConfidence ?? "predicted"}
                      </Badge>
                    }
                  />
                )}
                <Field label="Phone" value={result.phone} />
                <Field
                  label="LinkedIn"
                  value={
                    result.linkedinUrl ? (
                      <a href={result.linkedinUrl} target="_blank" rel="noopener noreferrer" className="text-blue-700 hover:underline inline-flex items-center gap-1">
                        Open <ExternalLink className="size-3" />
                      </a>
                    ) : null
                  }
                />
                <Field label="City" value={result.city} />
                <Field label="State" value={result.state} />
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
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={loading || saving}>
              <X className="size-4 mr-1" /> Discard
            </Button>
            <Button onClick={save} disabled={!result || loading || saving}>
              {saving ? <Loader2 className="size-4 mr-1 animate-spin" /> : <Save className="size-4 mr-1" />}
              Save to Contact
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Field({
  label,
  value,
  badge,
  valueClass,
}: {
  label: string;
  value: string | React.ReactNode | null;
  badge?: React.ReactNode;
  valueClass?: string;
}) {
  return (
    <div className="rounded-md border border-border p-2.5">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <div className={`mt-0.5 flex items-center gap-2 flex-wrap ${valueClass ?? ""}`}>
        {value ? (
          typeof value === "string" ? <span className="text-sm">{value}</span> : value
        ) : (
          <span className="text-sm text-muted-foreground italic">—</span>
        )}
        {badge}
      </div>
    </div>
  );
}
