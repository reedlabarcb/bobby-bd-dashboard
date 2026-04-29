"use client";

import { useState, useRef } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Upload, Loader2, CheckCircle2, AlertCircle, FileSpreadsheet } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

type ImportType = "prospecting" | "contacts";

const IMPORT_OPTIONS: Record<ImportType, { label: string; hint: string; endpoint: string }> = {
  prospecting: {
    label: "Rent roll / lease tracker (full)",
    hint: "Buildings + tenants + leases + contacts. Use for prospecting sheets, LXDs, rent rolls, or any multi-entity Excel.",
    endpoint: "/api/import-prospecting-sheet",
  },
  contacts: {
    label: "Contact list only",
    hint: "Just people — name, email, phone, company. Use for plain contact spreadsheets.",
    endpoint: "/api/auto-import-contacts",
  },
};

type ImportResult =
  | {
      kind: "prospecting";
      stats: {
        sheets: number;
        rowsProcessed: number;
        rowsSkipped: number;
        buildingsCreated: number;
        tenantsCreated: number;
        leasesInserted: number;
        contactsCreated: number;
        landlordContactsCreated: number;
        errors: string[];
      };
    }
  | {
      kind: "contacts";
      imported: number;
      updated: number;
      skipped: number;
      total: number;
    };

export function HomeImportCard() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [importType, setImportType] = useState<ImportType>("prospecting");
  const [file, setFile] = useState<File | null>(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!file) {
      toast.error("Pick a file first");
      return;
    }
    setRunning(true);
    setError(null);
    setResult(null);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch(IMPORT_OPTIONS[importType].endpoint, {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || `HTTP ${res.status}`);
        toast.error(data.error || "Import failed");
        return;
      }

      if (importType === "prospecting") {
        setResult({ kind: "prospecting", stats: data.stats });
        const s = data.stats;
        toast.success(
          `Imported ${s.buildingsCreated} buildings · ${s.tenantsCreated} tenants · ${s.leasesInserted} leases · ${s.contactsCreated} contacts`,
        );
      } else {
        setResult({ kind: "contacts", imported: data.imported, updated: data.updated, skipped: data.skipped, total: data.total });
        toast.success(`Imported ${data.imported} new contacts (${data.updated} updated, ${data.skipped} skipped)`);
      }

      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      router.refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "request failed";
      setError(msg);
      toast.error(msg);
    } finally {
      setRunning(false);
    }
  }

  return (
    <Card className="border-0 bg-zinc-900/60">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Upload className="h-4 w-4 text-blue-400" />
          <CardTitle className="text-base font-medium">Import Excel</CardTitle>
        </div>
        <CardDescription>
          Rent rolls, contact lists, lease trackers — drop in any Excel and pick the format.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Format picker */}
        <div className="space-y-2">
          {(Object.keys(IMPORT_OPTIONS) as ImportType[]).map((key) => {
            const opt = IMPORT_OPTIONS[key];
            const selected = importType === key;
            return (
              <label
                key={key}
                className={`flex items-start gap-3 rounded-md border p-3 cursor-pointer transition-colors ${
                  selected
                    ? "border-blue-500/50 bg-blue-500/5"
                    : "border-border bg-zinc-900/40 hover:border-zinc-700"
                }`}
              >
                <input
                  type="radio"
                  name="importType"
                  checked={selected}
                  onChange={() => setImportType(key)}
                  disabled={running}
                  className="mt-1"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{opt.label}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{opt.hint}</div>
                </div>
              </label>
            );
          })}
        </div>

        {/* File picker + submit */}
        <div className="flex items-center gap-3">
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            disabled={running}
            className="flex-1 text-xs file:mr-3 file:rounded-md file:border-0 file:bg-zinc-800 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-zinc-100 hover:file:bg-zinc-700 disabled:opacity-50"
          />
          <Button onClick={submit} disabled={running || !file}>
            {running ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Importing...
              </>
            ) : (
              <>
                <FileSpreadsheet className="h-4 w-4 mr-2" />
                Import
              </>
            )}
          </Button>
        </div>

        {/* Result */}
        {error ? (
          <div className="flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/5 p-3 text-xs">
            <AlertCircle className="h-4 w-4 text-red-400 mt-0.5 shrink-0" />
            <div>
              <div className="font-medium text-red-300">Import failed</div>
              <div className="text-red-300/80 mt-0.5">{error}</div>
            </div>
          </div>
        ) : null}

        {result?.kind === "prospecting" ? (
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs">
            <div className="flex items-center gap-2 text-emerald-400 font-medium mb-2">
              <CheckCircle2 className="h-4 w-4" />
              Imported {result.stats.sheets} sheet{result.stats.sheets === 1 ? "" : "s"}, {result.stats.rowsProcessed} rows
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-muted-foreground">
              <span>Buildings created: <span className="text-zinc-200 font-medium">{result.stats.buildingsCreated}</span></span>
              <span>Tenants created: <span className="text-zinc-200 font-medium">{result.stats.tenantsCreated}</span></span>
              <span>Leases inserted: <span className="text-zinc-200 font-medium">{result.stats.leasesInserted}</span></span>
              <span>Contacts created: <span className="text-zinc-200 font-medium">{result.stats.contactsCreated}</span></span>
              {result.stats.landlordContactsCreated > 0 ? (
                <span>Landlords: <span className="text-zinc-200 font-medium">{result.stats.landlordContactsCreated}</span></span>
              ) : null}
              {result.stats.rowsSkipped > 0 ? (
                <span>Rows skipped: <span className="text-amber-300 font-medium">{result.stats.rowsSkipped}</span></span>
              ) : null}
            </div>
            {result.stats.errors.length > 0 ? (
              <div className="mt-2 pt-2 border-t border-emerald-500/20">
                <div className="text-amber-300 font-medium mb-1">{result.stats.errors.length} non-fatal error{result.stats.errors.length === 1 ? "" : "s"}:</div>
                <ul className="space-y-0.5 text-amber-300/80 max-h-24 overflow-y-auto">
                  {result.stats.errors.slice(0, 5).map((e, i) => (
                    <li key={i} className="truncate">· {e}</li>
                  ))}
                  {result.stats.errors.length > 5 ? (
                    <li className="text-amber-300/60">…{result.stats.errors.length - 5} more</li>
                  ) : null}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}

        {result?.kind === "contacts" ? (
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs">
            <div className="flex items-center gap-2 text-emerald-400 font-medium mb-2">
              <CheckCircle2 className="h-4 w-4" />
              Processed {result.total} row{result.total === 1 ? "" : "s"}
            </div>
            <div className="grid grid-cols-3 gap-x-4 text-muted-foreground">
              <span>New: <span className="text-zinc-200 font-medium">{result.imported}</span></span>
              <span>Updated: <span className="text-zinc-200 font-medium">{result.updated}</span></span>
              <span>Skipped: <span className="text-zinc-200 font-medium">{result.skipped}</span></span>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
