"use client";

import { useState } from "react";
import { Sparkles, Loader2, AlertCircle, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Result = {
  question: string;
  sql: string;
  rowCount: number;
  rows: Record<string, unknown>[];
};

const EXAMPLES = [
  "all leases expiring in the next 10 months",
  "buildings over 100,000 sqft in Carlsbad",
  "contacts at Sharp Rees-Stealy",
  "leases with annual rent above 500000",
  "tenants whose lease expires before 2027",
];

const CURRENCY_FIELDS = new Set([
  "annual_rent",
  "rent_psf",
  "effective_rent",
  "asking_price",
  "ti_allowance",
]);

const NUMERIC_FORMAT_FIELDS = new Set([
  "sqft",
  "square_feet",
  "property_size_sf",
]);

const fmt = new Intl.NumberFormat("en-US");
const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function formatCell(key: string, value: unknown): string {
  if (value === null || value === undefined) return "—";
  const k = key.toLowerCase();
  if (CURRENCY_FIELDS.has(k) && typeof value === "number") return currency.format(value);
  if (NUMERIC_FORMAT_FIELDS.has(k) && typeof value === "number") return fmt.format(value);
  if (typeof value === "boolean") return value ? "yes" : "no";
  return String(value);
}

function rowsToCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const escape = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [
    headers.join(","),
    ...rows.map((r) => headers.map((h) => escape(r[h])).join(",")),
  ].join("\n");
}

export function AskBar() {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSql, setShowSql] = useState(false);

  async function ask(q?: string) {
    const text = (q ?? question).trim();
    if (!text) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: text }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || `HTTP ${res.status}`);
        return;
      }
      setResult(data);
      if (q) setQuestion(q);
    } catch (e) {
      setError(e instanceof Error ? e.message : "request failed");
    } finally {
      setLoading(false);
    }
  }

  function downloadCsv() {
    if (!result || result.rows.length === 0) return;
    const csv = rowsToCsv(result.rows);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const slug = result.question.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);
    a.download = `ask-${slug}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const headers = result && result.rows.length > 0 ? Object.keys(result.rows[0]) : [];

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-blue-400" />
        <h3 className="text-sm font-semibold">Ask anything about your data</h3>
      </div>

      <div className="flex items-center gap-2">
        <Input
          placeholder='e.g. "all leases expiring in the next 10 months"'
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && ask()}
          disabled={loading}
          className="text-sm"
        />
        <Button onClick={() => ask()} disabled={loading || !question.trim()}>
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Thinking...
            </>
          ) : (
            "Ask"
          )}
        </Button>
      </div>

      <div className="flex items-center gap-2 flex-wrap text-[11px]">
        <span className="text-muted-foreground">Try:</span>
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            onClick={() => ask(ex)}
            disabled={loading}
            className="px-2 py-0.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors disabled:opacity-50"
          >
            {ex}
          </button>
        ))}
      </div>

      {error ? (
        <div className="flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/5 p-3 text-xs">
          <AlertCircle className="h-4 w-4 text-red-400 mt-0.5 shrink-0" />
          <div>
            <div className="font-medium text-red-300">Couldn&apos;t answer</div>
            <div className="text-red-300/80 mt-0.5">{error}</div>
          </div>
        </div>
      ) : null}

      {result ? (
        <div className="space-y-2">
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span>
              <span className="text-foreground font-medium">{result.rowCount}</span> result
              {result.rowCount === 1 ? "" : "s"}
            </span>
            <button
              type="button"
              onClick={() => setShowSql((v) => !v)}
              className="text-muted-foreground hover:text-foreground underline"
            >
              {showSql ? "Hide" : "Show"} SQL
            </button>
            {result.rowCount > 0 ? (
              <button
                type="button"
                onClick={downloadCsv}
                className="ml-auto inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
              >
                <Download className="h-3 w-3" />
                Download CSV
              </button>
            ) : null}
          </div>

          {showSql ? (
            <pre className="text-[11px] bg-zinc-950/60 border border-border rounded p-2 overflow-x-auto whitespace-pre-wrap">
              {result.sql}
            </pre>
          ) : null}

          {result.rows.length > 0 ? (
            <div className="rounded-md border border-border overflow-x-auto max-h-[60vh] overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-zinc-900 border-b border-border">
                  <tr>
                    {headers.map((h) => (
                      <th key={h} className="text-left px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {result.rows.map((row, i) => (
                    <tr key={i} className="hover:bg-muted/30">
                      {headers.map((h) => (
                        <td key={h} className="px-3 py-1.5 align-top">
                          {formatCell(h, row[h])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-xs text-muted-foreground py-4 text-center">No rows matched.</div>
          )}
        </div>
      ) : null}
    </div>
  );
}
