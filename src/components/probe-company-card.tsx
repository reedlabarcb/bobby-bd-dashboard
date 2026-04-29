"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Search, AlertCircle, CheckCircle2 } from "lucide-react";

type ProbeResult = {
  context?: string;
  companyName?: string;
  hunter?: {
    ok: boolean;
    error?: string;
    domain?: string | null;
    organization?: string | null;
    emailCount?: number;
    firstThree?: Array<{
      email: string;
      name: string;
      position: string | null;
      confidence: number;
      phone: string | null;
      linkedin: string | null;
    }>;
  };
  apollo?: {
    ok: boolean;
    error?: string;
    peopleCount?: number;
    contactsCount?: number;
    firstThree?: Array<{
      name?: string;
      title?: string;
      email?: string;
      phoneCount?: number;
      organization?: string;
    }>;
  };
};

export function ProbeCompanyCard() {
  const [company, setCompany] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ProbeResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function probe() {
    if (!company.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/debug-enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company: company.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || `HTTP ${res.status}`);
      } else {
        setResult(data);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "request failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4 mb-6">
      <div className="flex items-center gap-3 mb-3">
        <Search className="h-4 w-4 text-blue-400" />
        <h3 className="text-sm font-semibold">Probe one company (raw Apollo + Hunter)</h3>
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        Pick a tenant company and see exactly what each provider returns. Useful when bulk enrichment finds nothing.
      </p>

      <div className="flex items-center gap-2 mb-3">
        <Input
          placeholder="e.g. Sharp Rees-Stealy"
          value={company}
          onChange={(e) => setCompany(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && probe()}
          disabled={loading}
          className="text-xs"
        />
        <Button onClick={probe} disabled={loading || !company.trim()} size="sm">
          {loading ? (
            <>
              <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />
              Probing...
            </>
          ) : (
            "Probe"
          )}
        </Button>
      </div>

      {error ? (
        <div className="flex items-center gap-2 text-xs text-red-400">
          <AlertCircle className="h-3 w-3" /> {error}
        </div>
      ) : null}

      {result ? (
        <div className="space-y-3 text-xs mt-3">
          {/* Hunter */}
          <div className="rounded-md border border-border bg-zinc-900/40 p-3">
            <div className="flex items-center gap-2 mb-2 font-medium">
              {result.hunter?.ok ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
              ) : (
                <AlertCircle className="h-3.5 w-3.5 text-red-500" />
              )}
              <span>Hunter</span>
              {result.hunter?.ok ? (
                <span className="text-muted-foreground font-normal">
                  · {result.hunter.organization || result.hunter.domain || "unknown org"}
                  {" · "}
                  <span className={result.hunter.emailCount ? "text-emerald-400" : "text-amber-400"}>
                    {result.hunter.emailCount ?? 0} emails
                  </span>
                </span>
              ) : (
                <span className="text-red-400 font-normal">· {result.hunter?.error}</span>
              )}
            </div>
            {result.hunter?.firstThree && result.hunter.firstThree.length > 0 ? (
              <div className="space-y-1">
                {result.hunter.firstThree.map((p, i) => (
                  <div key={i} className="flex flex-wrap items-baseline gap-2 border-t border-border pt-1 first:border-t-0 first:pt-0">
                    <span className="font-medium">{p.name || "—"}</span>
                    {p.position ? <span className="text-muted-foreground">{p.position}</span> : null}
                    {p.email ? <span className="text-emerald-400">{p.email}</span> : null}
                    {p.phone ? <span className="text-blue-300">{p.phone}</span> : null}
                    {p.linkedin ? (
                      <a href={p.linkedin} target="_blank" rel="noopener noreferrer" className="text-[#0A66C2] underline">
                        LinkedIn
                      </a>
                    ) : null}
                    <span className="text-muted-foreground">conf:{p.confidence}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          {/* Apollo */}
          <div className="rounded-md border border-border bg-zinc-900/40 p-3">
            <div className="flex items-center gap-2 mb-2 font-medium">
              {result.apollo?.ok ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
              ) : (
                <AlertCircle className="h-3.5 w-3.5 text-red-500" />
              )}
              <span>Apollo</span>
              {result.apollo?.ok ? (
                <span className="text-muted-foreground font-normal">
                  · <span className={(result.apollo.peopleCount ?? 0) + (result.apollo.contactsCount ?? 0) ? "text-emerald-400" : "text-amber-400"}>
                    {result.apollo.peopleCount ?? 0} people, {result.apollo.contactsCount ?? 0} contacts
                  </span>
                </span>
              ) : (
                <span className="text-red-400 font-normal">· {result.apollo?.error}</span>
              )}
            </div>
            {result.apollo?.firstThree && result.apollo.firstThree.length > 0 ? (
              <div className="space-y-1">
                {result.apollo.firstThree.map((p, i) => (
                  <div key={i} className="flex flex-wrap items-baseline gap-2 border-t border-border pt-1 first:border-t-0 first:pt-0">
                    <span className="font-medium">{p.name || "—"}</span>
                    {p.title ? <span className="text-muted-foreground">{p.title}</span> : null}
                    {p.email ? <span className="text-emerald-400">{p.email}</span> : <span className="text-amber-400 italic">no email</span>}
                    {p.phoneCount ? <span className="text-blue-300">{p.phoneCount} phones</span> : null}
                    {p.organization ? <span className="text-muted-foreground">@{p.organization}</span> : null}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
