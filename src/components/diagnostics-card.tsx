"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2, AlertCircle, Stethoscope } from "lucide-react";

type Status = { ok: boolean; msg: string; detail?: string };
type Diagnostics = {
  anthropic: Status;
  apollo: Status;
  hunter: Status;
  env: { uploadSecretSet: boolean; dbPath: string };
};

export function DiagnosticsCard() {
  const [data, setData] = useState<Diagnostics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/diagnostics");
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || `HTTP ${res.status}`);
      } else {
        setData(json);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "request failed");
    } finally {
      setLoading(false);
    }
  }

  function Row({ label, status }: { label: string; status: Status }) {
    return (
      <div className="flex items-center gap-3 py-1.5 text-xs border-t border-border first:border-t-0">
        <span className="font-medium w-20">{label}</span>
        {status.ok ? (
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
        ) : (
          <AlertCircle className="h-3.5 w-3.5 text-red-500 shrink-0" />
        )}
        <span className={status.ok ? "text-emerald-400" : "text-red-400"}>{status.msg}</span>
        {status.detail ? (
          <span className="text-muted-foreground truncate" title={status.detail}>
            · {status.detail}
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4 mb-6">
      <div className="flex items-center gap-3 mb-3">
        <Stethoscope className="h-4 w-4 text-blue-400" />
        <h3 className="text-sm font-semibold">API Diagnostics</h3>
        <Button onClick={run} disabled={loading} size="sm" variant="outline" className="ml-auto">
          {loading ? (
            <>
              <Loader2 className="h-3 w-3 mr-1.5 animate-spin" /> Checking...
            </>
          ) : (
            "Check now"
          )}
        </Button>
      </div>

      {error ? (
        <div className="flex items-center gap-2 text-xs text-red-400">
          <AlertCircle className="h-3 w-3" /> {error}
        </div>
      ) : null}

      {data ? (
        <div>
          <Row label="Anthropic" status={data.anthropic} />
          <Row label="Apollo" status={data.apollo} />
          <Row label="Hunter" status={data.hunter} />
        </div>
      ) : !error ? (
        <div className="text-xs text-muted-foreground">
          Click &quot;Check now&quot; to verify each enrichment API key is valid and live.
        </div>
      ) : null}
    </div>
  );
}
