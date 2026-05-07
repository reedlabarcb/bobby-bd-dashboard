"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Telescope, Loader2, Check, X, AlertTriangle, ShieldCheck,
} from "lucide-react";
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
  contactId: number;
  name: string;
  title: string | null;
  email: string | null;
  emailConfidence: "verified" | "found-unverified" | "none";
  predictedEmail: string | null;
  predictedEmailConfidence: "high — pattern + verified" | "medium — pattern unverified" | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  linkedinUrl: string | null;
  summary: string;
  notFound: string[];
  approved: boolean;
};

export function DeepSearchBulkButton({
  contactIds,
  contactNamesByID,
  onComplete,
}: {
  contactIds: number[];
  contactNamesByID: Map<number, string>;
  onComplete?: () => void;
}) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [results, setResults] = useState<DeepResult[]>([]);
  const [savingAll, setSavingAll] = useState(false);

  function startConfirm() {
    if (contactIds.length === 0) {
      toast.info("Select contacts first");
      return;
    }
    setConfirmOpen(true);
  }

  async function run() {
    setConfirmOpen(false);
    setOpen(true);
    setRunning(true);
    setResults([]);
    setProgress({ done: 0, total: contactIds.length });

    for (const id of contactIds) {
      try {
        const res = await fetch("/api/deep-search-person", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contactId: id }),
        });
        const data = await res.json();
        if (res.ok) {
          setResults((prev) => [...prev, { ...data, contactId: id, approved: true }]);
        } else {
          toast.error(`${contactNamesByID.get(id) ?? id}: ${data.error ?? "failed"}`);
        }
      } catch (e) {
        toast.error(`${contactNamesByID.get(id) ?? id}: ${e instanceof Error ? e.message : "failed"}`);
      }
      setProgress((p) => ({ ...p, done: p.done + 1 }));
    }
    setRunning(false);
  }

  function toggleApprove(idx: number) {
    setResults((prev) => {
      const copy = [...prev];
      copy[idx] = { ...copy[idx], approved: !copy[idx].approved };
      return copy;
    });
  }

  async function saveAll() {
    setSavingAll(true);
    let saved = 0;
    for (const r of results) {
      if (!r.approved) continue;
      const updates: Record<string, string> = {};
      if (r.title) updates.title = r.title;
      if (r.email) updates.email = r.email;
      if (r.phone) updates.phone = r.phone;
      if (r.city) updates.city = r.city;
      if (r.state) updates.state = r.state;
      const noteParts: string[] = [];
      if (r.linkedinUrl) noteParts.push(`LinkedIn: ${r.linkedinUrl}`);
      if (r.predictedEmail && !r.email) {
        noteParts.push(`Predicted email: ${r.predictedEmail} (${r.predictedEmailConfidence ?? "unverified"})`);
      }
      if (r.summary) noteParts.push(`---\nDeep Search Summary: ${r.summary}`);
      if (noteParts.length > 0) updates.notes = noteParts.join("\n");

      try {
        const res = await fetch("/api/enrich-contact", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contactId: r.contactId, updates }),
        });
        if (res.ok) saved++;
      } catch {
        /* skip */
      }
    }
    setSavingAll(false);
    setOpen(false);
    toast.success(`Saved findings for ${saved} contact${saved === 1 ? "" : "s"}`);
    onComplete?.();
    router.refresh();
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={startConfirm} className="gap-1">
        <Telescope className="size-3.5" />
        Deep Search ({contactIds.length})
      </Button>

      {/* Confirm — credit usage warning */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Run Deep Search on {contactIds.length} contact{contactIds.length === 1 ? "" : "s"}?</DialogTitle>
            <DialogDescription>
              Each contact uses approximately:
              <span className="block mt-2 font-mono text-xs">
                ~1 PDL credit (free tier: 100/mo)<br />
                ~5 Hunter requests<br />
                ~5 Anthropic web_search calls
              </span>
              <span className="block mt-2 text-amber-700 text-xs">
                <AlertTriangle className="size-3 inline mr-1" />
                Total estimated usage: <strong>{contactIds.length} PDL credits</strong>.
              </span>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>Cancel</Button>
            <Button onClick={run}>Run Deep Search</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Live results */}
      <Dialog open={open} onOpenChange={(v) => !running && !savingAll && setOpen(v)}>
        <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Deep Search — bulk</DialogTitle>
            <DialogDescription>
              Reviewing {results.length} of {progress.total} results. Toggle each to approve or skip, then save all approved.
            </DialogDescription>
          </DialogHeader>

          {/* Progress */}
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{running ? "Running…" : "Done"}</span>
              <span>{progress.done} / {progress.total}</span>
            </div>
            <div className="w-full bg-muted rounded-full h-1.5">
              <div
                className="bg-blue-600 h-1.5 rounded-full transition-all"
                style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }}
              />
            </div>
          </div>

          {/* Result rows */}
          <div className="space-y-2 mt-2">
            {results.map((r, i) => (
              <div
                key={r.contactId}
                className={`rounded-md border p-3 ${r.approved ? "border-emerald-200 bg-emerald-50/40" : "border-slate-200 bg-slate-50"}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">{r.name || contactNamesByID.get(r.contactId)}</span>
                      {r.email && (
                        <Badge variant="outline" className="bg-blue-100 text-blue-700 border-blue-200 text-[10px]">
                          {r.emailConfidence === "verified" ? <><ShieldCheck className="size-3 mr-1" /> Verified</> : "Found"}
                        </Badge>
                      )}
                      {!r.email && r.predictedEmail && (
                        <Badge variant="outline" className="bg-amber-100 text-amber-800 border-amber-200 text-[10px]">
                          Predicted email
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">{r.summary}</p>
                    <div className="flex flex-wrap gap-x-4 text-xs mt-1">
                      {r.title && <span>· {r.title}</span>}
                      {r.email && <span className="text-blue-700">· {r.email}</span>}
                      {!r.email && r.predictedEmail && <span className="text-amber-700">· {r.predictedEmail}</span>}
                      {r.phone && <span>· {r.phone}</span>}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant={r.approved ? "default" : "outline"}
                    onClick={() => toggleApprove(i)}
                  >
                    {r.approved ? <><Check className="size-3.5 mr-1" /> Approved</> : <><X className="size-3.5 mr-1" /> Skipped</>}
                  </Button>
                </div>
              </div>
            ))}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={running || savingAll}>
              Close
            </Button>
            <Button
              onClick={saveAll}
              disabled={running || savingAll || results.filter((r) => r.approved).length === 0}
            >
              {savingAll ? <Loader2 className="size-4 mr-1 animate-spin" /> : <Check className="size-4 mr-1" />}
              Save All Approved ({results.filter((r) => r.approved).length})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
