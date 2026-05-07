"use client";

import { useState, useRef } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Upload, Loader2, CheckCircle2, AlertCircle, FileSpreadsheet, FileText, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

type ExcelFormat = "prospecting" | "contacts";

const EXCEL_OPTIONS: Record<ExcelFormat, { label: string; hint: string; endpoint: string }> = {
  prospecting: {
    label: "Rent roll / lease tracker (full)",
    hint: "Buildings + tenants + leases + contacts. Use for prospecting sheets, LXDs, or any multi-entity Excel.",
    endpoint: "/api/import-prospecting-sheet",
  },
  contacts: {
    label: "Contact list only",
    hint: "Just people — name, email, phone, company. Use for plain contact spreadsheets.",
    endpoint: "/api/auto-import-contacts",
  },
};

type FileState = "queued" | "processing" | "done" | "error" | "skipped";
type FileRow = {
  file: File;
  state: FileState;
  message?: string;
  detail?: string;
};

function classify(filename: string): "pdf" | "excel" | "other" {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  if (ext === "pdf") return "pdf";
  if (["xlsx", "xls", "csv"].includes(ext)) return "excel";
  return "other";
}

function summarizeProspecting(stats: Record<string, number>): string {
  const parts: string[] = [];
  if (stats.buildingsCreated) parts.push(`${stats.buildingsCreated} buildings`);
  if (stats.tenantsCreated) parts.push(`${stats.tenantsCreated} tenants`);
  if (stats.leasesInserted) parts.push(`${stats.leasesInserted} leases`);
  if (stats.contactsCreated) parts.push(`${stats.contactsCreated} contacts`);
  return parts.length ? parts.join(" · ") : "no new records";
}

export function HomeImportCard() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [excelFormat, setExcelFormat] = useState<ExcelFormat>("prospecting");
  const [files, setFiles] = useState<FileRow[]>([]);
  const [running, setRunning] = useState(false);

  const hasExcel = files.some((f) => classify(f.file.name) === "excel");

  function addFiles(list: FileList | null) {
    if (!list) return;
    const next: FileRow[] = Array.from(list).map((file) => ({ file, state: "queued" }));
    setFiles((prev) => [...prev, ...next]);
  }

  function removeFile(idx: number) {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  }

  function clearAll() {
    setFiles([]);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function processOne(row: FileRow): Promise<FileRow> {
    const kind = classify(row.file.name);
    if (kind === "other") {
      return { ...row, state: "skipped", message: "unsupported file type" };
    }
    const endpoint =
      kind === "pdf" ? "/api/process-document" : EXCEL_OPTIONS[excelFormat].endpoint;
    try {
      const formData = new FormData();
      formData.append("file", row.file);
      const res = await fetch(endpoint, { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) {
        return { ...row, state: "error", message: data.error || `HTTP ${res.status}` };
      }
      if (kind === "pdf") {
        return {
          ...row,
          state: "done",
          message: data.aiSummary
            ? `OM parsed`
            : data.documentType
            ? `${data.documentType} parsed`
            : "parsed",
          detail:
            (data.propertyName && data.propertyAddress)
              ? `${data.propertyName} · ${data.propertyAddress}`
              : data.propertyName || data.propertyAddress || data.filename,
        };
      }
      // Excel response shape varies by endpoint.
      if (excelFormat === "prospecting" && data.stats) {
        return { ...row, state: "done", message: summarizeProspecting(data.stats) };
      }
      if (excelFormat === "contacts") {
        return {
          ...row,
          state: "done",
          message: `${data.imported ?? 0} new · ${data.updated ?? 0} updated · ${data.skipped ?? 0} skipped`,
        };
      }
      return { ...row, state: "done", message: "imported" };
    } catch (e) {
      return { ...row, state: "error", message: e instanceof Error ? e.message : "request failed" };
    }
  }

  async function runAll() {
    if (files.length === 0) {
      toast.error("Add at least one file first");
      return;
    }
    setRunning(true);
    let totalDone = 0;
    let totalErr = 0;

    for (let i = 0; i < files.length; i++) {
      setFiles((prev) => {
        const next = [...prev];
        next[i] = { ...next[i], state: "processing" };
        return next;
      });
      const result = await processOne(files[i]);
      setFiles((prev) => {
        const next = [...prev];
        next[i] = result;
        return next;
      });
      if (result.state === "done") totalDone += 1;
      if (result.state === "error") totalErr += 1;
    }

    setRunning(false);
    toast.success(`Processed ${totalDone}/${files.length} file${files.length === 1 ? "" : "s"}${totalErr ? `, ${totalErr} errors` : ""}`);
    router.refresh();
  }

  return (
    <Card className="border-0 bg-card">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Upload className="h-4 w-4 text-blue-400" />
          <CardTitle className="text-base font-medium">Import Files</CardTitle>
        </div>
        <CardDescription>
          Drop in OMs (PDF) or Excel (rent rolls, lease trackers, contact lists). Multi-select supported — files are auto-routed by extension.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Excel format picker — only relevant if Excel files are in the queue */}
        <div className={`space-y-2 ${hasExcel ? "" : "opacity-40 pointer-events-none"}`}>
          <div className="text-xs font-medium text-muted-foreground flex items-center gap-2">
            Excel format
            {!hasExcel ? <span className="text-[10px]">(no Excel files queued)</span> : null}
          </div>
          {(Object.keys(EXCEL_OPTIONS) as ExcelFormat[]).map((key) => {
            const opt = EXCEL_OPTIONS[key];
            const selected = excelFormat === key;
            return (
              <label
                key={key}
                className={`flex items-start gap-3 rounded-md border p-2.5 cursor-pointer transition-colors ${
                  selected
                    ? "border-blue-500/50 bg-blue-500/5"
                    : "border-border bg-card/80 hover:border-zinc-700"
                }`}
              >
                <input
                  type="radio"
                  name="excelFormat"
                  checked={selected}
                  onChange={() => setExcelFormat(key)}
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

        {/* File picker + run */}
        <div className="flex items-center gap-3">
          <input
            ref={fileRef}
            type="file"
            multiple
            accept=".pdf,.xlsx,.xls,.csv"
            onChange={(e) => {
              addFiles(e.target.files);
              if (fileRef.current) fileRef.current.value = "";
            }}
            disabled={running}
            className="flex-1 text-xs file:mr-3 file:rounded-md file:border-0 file:bg-zinc-800 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-zinc-100 hover:file:bg-zinc-700 disabled:opacity-50"
          />
          {files.length > 0 ? (
            <Button onClick={clearAll} disabled={running} variant="outline" size="sm">
              Clear
            </Button>
          ) : null}
          <Button onClick={runAll} disabled={running || files.length === 0}>
            {running ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <Upload className="h-4 w-4 mr-2" />
                Process {files.length || ""}
              </>
            )}
          </Button>
        </div>

        {/* File queue */}
        {files.length > 0 ? (
          <div className="rounded-md border border-border bg-zinc-950/40 divide-y divide-border max-h-72 overflow-y-auto">
            {files.map((row, idx) => {
              const kind = classify(row.file.name);
              const Icon = kind === "pdf" ? FileText : FileSpreadsheet;
              const iconColor =
                kind === "pdf" ? "text-red-400" : kind === "excel" ? "text-emerald-400" : "text-zinc-500";
              return (
                <div key={idx} className="flex items-center gap-3 px-3 py-2 text-xs">
                  <Icon className={`h-4 w-4 shrink-0 ${iconColor}`} />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{row.file.name}</div>
                    {row.detail ? (
                      <div className="text-[11px] text-muted-foreground truncate">{row.detail}</div>
                    ) : null}
                  </div>
                  <div className="text-right min-w-[180px] shrink-0">
                    {row.state === "queued" ? (
                      <span className="text-muted-foreground">queued</span>
                    ) : row.state === "processing" ? (
                      <span className="flex items-center gap-1.5 justify-end text-muted-foreground">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        {kind === "pdf" ? "Claude parsing..." : "Importing..."}
                      </span>
                    ) : row.state === "done" ? (
                      <span className="flex items-center gap-1.5 justify-end text-emerald-400">
                        <CheckCircle2 className="h-3 w-3" />
                        {row.message}
                      </span>
                    ) : row.state === "skipped" ? (
                      <span className="text-amber-400">{row.message}</span>
                    ) : (
                      <span
                        className="flex items-center gap-1.5 justify-end text-red-400"
                        title={row.message}
                      >
                        <AlertCircle className="h-3 w-3" />
                        {row.message?.slice(0, 32)}
                      </span>
                    )}
                  </div>
                  {!running ? (
                    <button
                      type="button"
                      onClick={() => removeFile(idx)}
                      className="text-muted-foreground hover:text-foreground"
                      title="Remove from queue"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
