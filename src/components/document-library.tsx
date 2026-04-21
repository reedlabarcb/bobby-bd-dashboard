"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  FileText,
  FileSpreadsheet,
  Upload,
  Search,
  Loader2,
  ChevronDown,
  ChevronUp,
  Cloud,
  CloudOff,
  FolderSync,
  Building2,
  DollarSign,
  MapPin,
  Calendar,
  Users,
  ScrollText,
  Check,
  AlertCircle,
  Clock,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@/components/ui/tooltip";
import { formatDistanceToNow } from "date-fns";
import type { Document } from "@/lib/db/schema";

interface DocumentLibraryProps {
  documents: Document[];
  stats: {
    totalDocs: number;
    processedDocs: number;
    totalLeases: number;
    totalTenants: number;
  };
}

const DOC_TYPE_LABELS: Record<string, string> = {
  om: "Offering Memo",
  rent_roll: "Rent Roll",
  lease_abstract: "Lease Abstract",
  market_report: "Market Report",
  other: "Other",
};

const PROPERTY_TYPE_COLORS: Record<string, string> = {
  office: "text-blue-400 bg-blue-400/10",
  retail: "text-amber-400 bg-amber-400/10",
  industrial: "text-orange-400 bg-orange-400/10",
  multifamily: "text-emerald-400 bg-emerald-400/10",
  hospitality: "text-violet-400 bg-violet-400/10",
  land: "text-lime-400 bg-lime-400/10",
  mixed_use: "text-cyan-400 bg-cyan-400/10",
};

function formatCurrency(value: number | null): string {
  if (value == null) return "";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function getFileIcon(filename: string) {
  const ext = filename.split(".").pop()?.toLowerCase();
  if (ext === "xlsx" || ext === "xls" || ext === "csv") {
    return <FileSpreadsheet className="h-5 w-5 text-emerald-400" />;
  }
  return <FileText className="h-5 w-5 text-blue-400" />;
}

function StatusBadge({ status }: { status: string | null }) {
  const config: Record<string, { className: string; label: string }> = {
    pending: {
      className: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30",
      label: "Pending",
    },
    processing: {
      className:
        "bg-blue-500/20 text-blue-400 border-blue-500/30 animate-pulse",
      label: "Processing",
    },
    done: {
      className: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
      label: "Done",
    },
    error: {
      className: "bg-red-500/20 text-red-400 border-red-500/30",
      label: "Error",
    },
  };
  const c = config[status ?? "pending"] ?? config.pending;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${c.className}`}
    >
      {status === "done" && <Check className="h-3 w-3" />}
      {status === "error" && <AlertCircle className="h-3 w-3" />}
      {status === "processing" && <Loader2 className="h-3 w-3 animate-spin" />}
      {status === "pending" && <Clock className="h-3 w-3" />}
      {c.label}
    </span>
  );
}

export function DocumentLibrary({ documents: docs, stats }: DocumentLibraryProps) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [propTypeFilter, setPropTypeFilter] = useState("all");
  const [uploading, setUploading] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [boxStatus, setBoxStatus] = useState<
    "unknown" | "checking" | "connected" | "disconnected" | "no_credentials"
  >("unknown");
  const [boxAuthUrl, setBoxAuthUrl] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  // --- Box connection ---
  async function checkBoxStatus() {
    setBoxStatus("checking");
    try {
      const res = await fetch("/api/box/status");
      if (!res.ok) {
        setBoxStatus("no_credentials");
        return;
      }
      const data = await res.json();
      if (data.connected) {
        setBoxStatus("connected");
      } else if (data.authUrl) {
        setBoxAuthUrl(data.authUrl);
        setBoxStatus("disconnected");
      } else {
        setBoxStatus("no_credentials");
      }
    } catch {
      setBoxStatus("no_credentials");
    }
  }

  // --- Upload ---
  async function handleUpload(file: File) {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/process-document", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Upload failed" }));
        throw new Error(err.error || "Upload failed");
      }
      toast.success("Document processed successfully");
      router.refresh();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Upload failed";
      toast.error(msg);
    } finally {
      setUploading(false);
    }
  }

  // --- Box sync ---
  async function handleSync() {
    const folderId = prompt("Enter Box folder ID to sync:");
    if (!folderId) return;
    setSyncing(true);
    try {
      const res = await fetch("/api/box/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folderId }),
      });
      if (!res.ok) throw new Error("Sync failed");
      const data = await res.json();
      toast.success(`Synced ${data.count ?? 0} documents from Box`);
      router.refresh();
    } catch {
      toast.error("Box sync failed");
    } finally {
      setSyncing(false);
    }
  }

  // --- Filtering ---
  const filtered = docs.filter((doc) => {
    if (typeFilter !== "all" && doc.documentType !== typeFilter) return false;
    if (statusFilter !== "all" && doc.status !== statusFilter) return false;
    if (propTypeFilter !== "all" && doc.propertyType !== propTypeFilter)
      return false;
    if (search) {
      const q = search.toLowerCase();
      const haystack = [
        doc.filename,
        doc.propertyName,
        doc.aiSummary,
        doc.propertyCity,
        doc.propertyState,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  // --- Stats row ---
  const statCards = [
    {
      label: "Documents Indexed",
      value: stats.totalDocs,
      icon: FileText,
      color: "text-blue-400",
      bg: "bg-blue-400/10",
    },
    {
      label: "Processed",
      value: stats.processedDocs,
      icon: Check,
      color: "text-emerald-400",
      bg: "bg-emerald-400/10",
    },
    {
      label: "Tenants Found",
      value: stats.totalTenants,
      icon: Users,
      color: "text-amber-400",
      bg: "bg-amber-400/10",
    },
    {
      label: "Leases Extracted",
      value: stats.totalLeases,
      icon: ScrollText,
      color: "text-violet-400",
      bg: "bg-violet-400/10",
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Document Library
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            AI-powered document processing and lease extraction
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Box connect */}
          <TooltipProvider>
            {boxStatus === "connected" ? (
              <Badge className="bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 gap-1">
                <Cloud className="h-3 w-3" />
                Box Connected
              </Badge>
            ) : boxStatus === "disconnected" && boxAuthUrl ? (
              <a href={boxAuthUrl} target="_blank" rel="noopener noreferrer">
                <Button variant="outline" size="sm">
                  <Cloud className="h-4 w-4 mr-1" />
                  Connect Box
                </Button>
              </a>
            ) : boxStatus === "no_credentials" ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button variant="outline" size="sm" disabled>
                      <CloudOff className="h-4 w-4 mr-1" />
                      Connect Box
                    </Button>
                  }
                />
                <TooltipContent>
                  Box credentials not configured
                </TooltipContent>
              </Tooltip>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={checkBoxStatus}
                disabled={boxStatus === "checking"}
              >
                {boxStatus === "checking" ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <Cloud className="h-4 w-4 mr-1" />
                )}
                Connect Box
              </Button>
            )}
          </TooltipProvider>

          {/* Sync Box */}
          {boxStatus === "connected" && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleSync}
              disabled={syncing}
            >
              {syncing ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <FolderSync className="h-4 w-4 mr-1" />
              )}
              Sync Box Folder
            </Button>
          )}

          {/* Upload */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.xlsx,.xls,.docx"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleUpload(file);
              e.target.value = "";
            }}
          />
          <Button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="bg-blue-600 hover:bg-blue-500 text-white"
          >
            {uploading ? (
              <>
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                Processing with AI...
              </>
            ) : (
              <>
                <Upload className="h-4 w-4 mr-1" />
                Upload Document
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {statCards.map((stat) => {
          const Icon = stat.icon;
          return (
            <Card key={stat.label} className="border-0 bg-zinc-900/60">
              <CardHeader className="flex-row items-center justify-between pb-2">
                <CardDescription className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {stat.label}
                </CardDescription>
                <div className={`rounded-md p-2 ${stat.bg}`}>
                  <Icon className={`h-4 w-4 ${stat.color}`} />
                </div>
              </CardHeader>
              <CardContent>
                <div
                  className={`text-3xl font-bold tabular-nums ${stat.color}`}
                >
                  {stat.value.toLocaleString()}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Search & Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search documents..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 bg-zinc-900/60 border-zinc-700"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <Select
          value={typeFilter}
          onValueChange={(v) => setTypeFilter(v ?? "all")}
        >
          <SelectTrigger className="w-[160px] bg-zinc-900/60 border-zinc-700">
            <SelectValue placeholder="Doc Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="om">Offering Memo</SelectItem>
            <SelectItem value="rent_roll">Rent Roll</SelectItem>
            <SelectItem value="lease_abstract">Lease Abstract</SelectItem>
            <SelectItem value="market_report">Market Report</SelectItem>
            <SelectItem value="other">Other</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={statusFilter}
          onValueChange={(v) => setStatusFilter(v ?? "all")}
        >
          <SelectTrigger className="w-[140px] bg-zinc-900/60 border-zinc-700">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="processing">Processing</SelectItem>
            <SelectItem value="done">Done</SelectItem>
            <SelectItem value="error">Error</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={propTypeFilter}
          onValueChange={(v) => setPropTypeFilter(v ?? "all")}
        >
          <SelectTrigger className="w-[160px] bg-zinc-900/60 border-zinc-700">
            <SelectValue placeholder="Property Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Properties</SelectItem>
            <SelectItem value="office">Office</SelectItem>
            <SelectItem value="retail">Retail</SelectItem>
            <SelectItem value="industrial">Industrial</SelectItem>
            <SelectItem value="multifamily">Multifamily</SelectItem>
            <SelectItem value="hospitality">Hospitality</SelectItem>
            <SelectItem value="land">Land</SelectItem>
            <SelectItem value="mixed_use">Mixed Use</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Document List */}
      {filtered.length === 0 ? (
        <Card className="border-0 bg-zinc-900/60">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <FileText className="h-12 w-12 text-muted-foreground/40 mb-4" />
            <p className="text-lg font-medium text-muted-foreground">
              {docs.length === 0
                ? "No documents yet"
                : "No documents match your filters"}
            </p>
            <p className="text-sm text-muted-foreground/70 mt-1">
              {docs.length === 0
                ? "Upload a PDF or connect Box to get started."
                : "Try adjusting your search or filters."}
            </p>
            {docs.length === 0 && (
              <Button
                onClick={() => fileInputRef.current?.click()}
                className="mt-4 bg-blue-600 hover:bg-blue-500 text-white"
              >
                <Upload className="h-4 w-4 mr-1" />
                Upload Document
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((doc) => {
            const isExpanded = expandedId === doc.id;
            let parsedTenants: Array<{
              name?: string;
              suite?: string;
              squareFeet?: number;
              leaseStart?: string;
              leaseEnd?: string;
              rentPsf?: number;
            }> = [];
            let parsedHighlights: string[] = [];
            let parsedBroker: { name?: string; firm?: string; phone?: string; email?: string } | null = null;

            if (isExpanded && doc.rawExtracted) {
              try {
                const raw = JSON.parse(doc.rawExtracted);
                parsedTenants = raw.tenants || [];
                parsedHighlights = raw.highlights || raw.key_highlights || [];
                parsedBroker = raw.broker || raw.brokerInfo || null;
              } catch {
                // invalid JSON, ignore
              }
            }

            const propColor =
              PROPERTY_TYPE_COLORS[doc.propertyType ?? ""] ??
              "text-zinc-400 bg-zinc-400/10";

            return (
              <Card
                key={doc.id}
                className="border-0 bg-zinc-900/60 transition-colors hover:bg-zinc-900/80 cursor-pointer"
                onClick={() =>
                  setExpandedId(isExpanded ? null : doc.id)
                }
              >
                <CardContent className="p-4">
                  {/* Main row */}
                  <div className="flex items-start gap-3">
                    {/* File icon */}
                    <div className="mt-0.5 shrink-0">
                      {getFileIcon(doc.filename)}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0 space-y-1.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-zinc-100 truncate max-w-[400px]">
                          {doc.filename}
                        </span>
                        <StatusBadge status={doc.status} />
                        {doc.documentType && (
                          <span className="inline-flex items-center rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-zinc-300">
                            {DOC_TYPE_LABELS[doc.documentType] ??
                              doc.documentType}
                          </span>
                        )}
                        {doc.boxFileId ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/10 px-2 py-0.5 text-[10px] font-medium text-blue-400 border border-blue-500/20">
                            <Cloud className="h-2.5 w-2.5" />
                            Box
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] font-medium text-zinc-400">
                            <Upload className="h-2.5 w-2.5" />
                            Upload
                          </span>
                        )}
                      </div>

                      {/* Property info row */}
                      {(doc.propertyName ||
                        doc.propertyCity ||
                        doc.propertyType) && (
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                          {doc.propertyName && (
                            <span className="flex items-center gap-1 text-zinc-300">
                              <Building2 className="h-3 w-3" />
                              {doc.propertyName}
                            </span>
                          )}
                          {(doc.propertyAddress ||
                            doc.propertyCity ||
                            doc.propertyState) && (
                            <span className="flex items-center gap-1">
                              <MapPin className="h-3 w-3" />
                              {[
                                doc.propertyAddress,
                                doc.propertyCity,
                                doc.propertyState,
                              ]
                                .filter(Boolean)
                                .join(", ")}
                            </span>
                          )}
                          {doc.propertyType && (
                            <span
                              className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${propColor}`}
                            >
                              {doc.propertyType.replace("_", " ")}
                            </span>
                          )}
                        </div>
                      )}

                      {/* Price + Summary */}
                      <div className="flex items-center gap-4 text-xs">
                        {doc.askingPrice != null && (
                          <span className="flex items-center gap-1 text-emerald-400 font-semibold">
                            <DollarSign className="h-3 w-3" />
                            {formatCurrency(doc.askingPrice)}
                          </span>
                        )}
                        {doc.aiSummary && (
                          <span className="text-muted-foreground truncate max-w-[500px]">
                            {doc.aiSummary.slice(0, 150)}
                            {doc.aiSummary.length > 150 ? "..." : ""}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Right side: date + expand icon */}
                    <div className="shrink-0 text-right flex flex-col items-end gap-1">
                      <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {doc.processedAt || doc.createdAt
                          ? formatDistanceToNow(
                              new Date(doc.processedAt || doc.createdAt!),
                              { addSuffix: true }
                            )
                          : ""}
                      </span>
                      {isExpanded ? (
                        <ChevronUp className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      )}
                    </div>
                  </div>

                  {/* Expanded details */}
                  {isExpanded && (
                    <div
                      className="mt-4 border-t border-zinc-800 pt-4 space-y-4"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {/* Full AI Summary */}
                      {doc.aiSummary && (
                        <div>
                          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                            AI Summary
                          </h4>
                          <p className="text-sm text-zinc-300 leading-relaxed whitespace-pre-wrap">
                            {doc.aiSummary}
                          </p>
                        </div>
                      )}

                      {/* Key Highlights */}
                      {parsedHighlights.length > 0 && (
                        <div>
                          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                            Key Highlights
                          </h4>
                          <ul className="space-y-1">
                            {parsedHighlights.map((h, i) => (
                              <li
                                key={i}
                                className="text-sm text-zinc-300 flex items-start gap-2"
                              >
                                <span className="text-emerald-400 mt-0.5">
                                  &bull;
                                </span>
                                {h}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Tenants */}
                      {parsedTenants.length > 0 && (
                        <div>
                          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                            Tenants ({parsedTenants.length})
                          </h4>
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="border-b border-zinc-800 text-muted-foreground">
                                  <th className="text-left py-1.5 pr-4 font-medium">
                                    Tenant
                                  </th>
                                  <th className="text-left py-1.5 pr-4 font-medium">
                                    Suite
                                  </th>
                                  <th className="text-right py-1.5 pr-4 font-medium">
                                    SF
                                  </th>
                                  <th className="text-left py-1.5 pr-4 font-medium">
                                    Lease Start
                                  </th>
                                  <th className="text-left py-1.5 pr-4 font-medium">
                                    Lease End
                                  </th>
                                  <th className="text-right py-1.5 font-medium">
                                    Rent/SF
                                  </th>
                                </tr>
                              </thead>
                              <tbody>
                                {parsedTenants.map((t, i) => (
                                  <tr
                                    key={i}
                                    className="border-b border-zinc-800/50 text-zinc-300"
                                  >
                                    <td className="py-1.5 pr-4 font-medium">
                                      {t.name ?? "—"}
                                    </td>
                                    <td className="py-1.5 pr-4">
                                      {t.suite ?? "—"}
                                    </td>
                                    <td className="py-1.5 pr-4 text-right tabular-nums">
                                      {t.squareFeet?.toLocaleString() ?? "—"}
                                    </td>
                                    <td className="py-1.5 pr-4">
                                      {t.leaseStart ?? "—"}
                                    </td>
                                    <td className="py-1.5 pr-4">
                                      {t.leaseEnd ?? "—"}
                                    </td>
                                    <td className="py-1.5 text-right tabular-nums">
                                      {t.rentPsf != null
                                        ? `$${t.rentPsf.toFixed(2)}`
                                        : "—"}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {/* Broker Info */}
                      {parsedBroker && (
                        <div>
                          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                            Broker
                          </h4>
                          <div className="text-sm text-zinc-300 space-y-0.5">
                            {parsedBroker.name && <p>{parsedBroker.name}</p>}
                            {parsedBroker.firm && (
                              <p className="text-muted-foreground">
                                {parsedBroker.firm}
                              </p>
                            )}
                            {parsedBroker.phone && <p>{parsedBroker.phone}</p>}
                            {parsedBroker.email && <p>{parsedBroker.email}</p>}
                          </div>
                        </div>
                      )}

                      {/* Linked deal */}
                      {doc.dealId && (
                        <div>
                          <a
                            href={`/deals/${doc.dealId}`}
                            className="inline-flex items-center gap-1.5 text-sm text-blue-400 hover:text-blue-300 transition-colors"
                          >
                            <Building2 className="h-3.5 w-3.5" />
                            View Linked Deal
                          </a>
                        </div>
                      )}

                      {/* Error message */}
                      {doc.status === "error" && doc.errorMessage && (
                        <div className="rounded-md bg-red-500/10 border border-red-500/20 p-3">
                          <p className="text-xs font-medium text-red-400">
                            Error: {doc.errorMessage}
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
