"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2, AlertCircle, Wand2 } from "lucide-react";
import { useRouter } from "next/navigation";

type Result = {
  tenantsUpdated: number;
  contactsUpdated: number;
  buildingsUpdated: number;
  leasesUpdated: number;
  examples: Array<{ table: string; old: string; next: string }>;
};

export function NormalizeCompaniesCard() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/admin/normalize-companies", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || `HTTP ${res.status}`);
      } else {
        setResult(data);
        router.refresh();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "request failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4 mb-6">
      <div className="flex items-center gap-3 mb-2">
        <Wand2 className="h-4 w-4 text-blue-400" />
        <h3 className="text-sm font-semibold">Normalize company punctuation</h3>
        <Button onClick={run} disabled={loading} size="sm" variant="outline" className="ml-auto">
          {loading ? (
            <>
              <Loader2 className="h-3 w-3 mr-1.5 animate-spin" /> Running...
            </>
          ) : (
            "Run cleanup"
          )}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground mb-2">
        Strips commas/parens and collapses whitespace in tenant names, contact companies, landlord
        names, and lease property names. Hunter&apos;s company resolver fails on commas — this fixes
        the source data so future enrichments hit. Idempotent.
      </p>

      {error ? (
        <div className="flex items-center gap-2 text-xs text-red-400">
          <AlertCircle className="h-3 w-3" /> {error}
        </div>
      ) : null}

      {result ? (
        <div className="text-xs">
          <div className="flex items-center gap-2 text-emerald-400 font-medium mb-1.5">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Updated · {result.tenantsUpdated} tenants · {result.contactsUpdated} contact companies ·{" "}
            {result.buildingsUpdated} landlords · {result.leasesUpdated} lease properties
          </div>
          {result.examples.length > 0 ? (
            <div className="space-y-0.5 mt-2 pl-4 max-h-40 overflow-y-auto">
              {result.examples.map((ex, i) => (
                <div key={i} className="text-muted-foreground">
                  <span className="text-zinc-500">{ex.table}</span>{" "}
                  <span className="text-red-400 line-through">{ex.old}</span>{" "}
                  <span>→</span>{" "}
                  <span className="text-emerald-400">{ex.next}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
