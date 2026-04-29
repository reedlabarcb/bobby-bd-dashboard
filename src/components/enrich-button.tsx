"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Sparkles, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

type DiffEntry = { old: string | null; new: string };

export function EnrichButton({ contactId }: { contactId: number }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [diff, setDiff] = useState<Record<string, DiffEntry> | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [applying, setApplying] = useState(false);

  async function handleEnrich() {
    setLoading(true);
    setDiff(null);
    setErrors([]);
    try {
      const res = await fetch("/api/enrich-contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactId }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Enrichment failed");
      }
      const data = await res.json();
      if (data.errors?.length) {
        setErrors(data.errors);
      }
      if (data.diff && Object.keys(data.diff).length > 0) {
        setDiff(data.diff);
      } else {
        // Show what we actually tried instead of a vacuous "no data" toast.
        const sources = (data.errors?.length ? data.errors.join(" · ") : null)
          ?? `${data.enrichmentCount ?? 0} of 4 providers responded — none returned new fields`;
        toast.info(sources, { duration: 7000 });
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Enrichment failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleApply() {
    if (!diff) return;
    setApplying(true);
    try {
      const updates: Record<string, string> = {};
      for (const [key, val] of Object.entries(diff)) {
        updates[key] = val.new;
      }
      const res = await fetch("/api/enrich-contact", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactId, updates }),
      });
      if (!res.ok) throw new Error("Failed to apply updates");
      toast.success("Enrichment applied");
      setDiff(null);
      router.refresh();
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Failed to apply enrichment"
      );
    } finally {
      setApplying(false);
    }
  }

  const FIELD_LABELS: Record<string, string> = {
    phone: "Phone",
    title: "Title",
    company: "Company",
    city: "City",
    state: "State",
    email: "Email",
    notes: "Notes",
    source: "Source",
    tags: "Tags",
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={handleEnrich}
        disabled={loading}
      >
        {loading ? (
          <Loader2 className="size-4 mr-1 animate-spin" />
        ) : (
          <Sparkles className="size-4 mr-1" />
        )}
        {loading ? "Enriching..." : "Enrich"}
      </Button>

      <Dialog open={diff !== null} onOpenChange={(open) => !open && setDiff(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Enrichment Results</DialogTitle>
            <DialogDescription>
              Review the changes below before applying.
            </DialogDescription>
          </DialogHeader>
          {errors.length > 0 && (
            <div className="rounded-md bg-amber-500/10 border border-amber-500/30 p-3 text-xs text-amber-400 space-y-1">
              <p className="font-medium">Warnings:</p>
              {errors.map((err, i) => (
                <p key={i}>{err}</p>
              ))}
            </div>
          )}
          {diff && (
            <div className="space-y-3 py-2">
              {Object.entries(diff).map(([field, val]) => (
                <div
                  key={field}
                  className="rounded-md border border-border/50 p-3 space-y-1"
                >
                  <p className="text-xs font-medium text-muted-foreground">
                    {FIELD_LABELS[field] || field}
                  </p>
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-red-400 line-through">
                      {val.old || "(empty)"}
                    </span>
                    <span className="text-muted-foreground">&rarr;</span>
                    <span className="text-emerald-400">{val.new}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDiff(null)}
              disabled={applying}
            >
              Cancel
            </Button>
            <Button onClick={handleApply} disabled={applying}>
              {applying ? "Applying..." : "Apply Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
