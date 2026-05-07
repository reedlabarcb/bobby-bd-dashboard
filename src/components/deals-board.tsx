"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Upload, Search, Loader2, Building2, DollarSign, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Deal } from "@/lib/db/schema";

const STATUS_COLUMNS = [
  { key: "prospect", label: "Prospect", color: "border-l-amber-500" },
  { key: "active", label: "Active", color: "border-l-blue-500" },
  { key: "closed", label: "Closed", color: "border-l-green-500" },
  { key: "dead", label: "Dead", color: "border-l-zinc-500" },
] as const;

const COLUMN_HEADER_COLORS: Record<string, string> = {
  prospect: "text-amber-600",
  active: "text-blue-600",
  closed: "text-green-400",
  dead: "text-slate-500",
};

const COLUMN_COUNT_COLORS: Record<string, string> = {
  prospect: "bg-amber-500/20 text-amber-600",
  active: "bg-blue-500/20 text-blue-600",
  closed: "bg-green-500/20 text-green-400",
  dead: "bg-zinc-500/20 text-slate-500",
};

function formatCurrency(value: number | null): string {
  if (value == null) return "N/A";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function getPropertyTypes(deals: Deal[]): string[] {
  const types = new Set<string>();
  deals.forEach((d) => {
    if (d.propertyType) types.add(d.propertyType);
  });
  return Array.from(types).sort();
}

function getCities(deals: Deal[]): string[] {
  const cities = new Set<string>();
  deals.forEach((d) => {
    if (d.city) cities.add(d.city);
  });
  return Array.from(cities).sort();
}

export function DealsBoard({ deals }: { deals: Deal[] }) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<string>("all");
  const [filterCity, setFilterCity] = useState<string>("all");

  const propertyTypes = getPropertyTypes(deals);
  const cities = getCities(deals);

  // Filter deals
  const filtered = deals.filter((deal) => {
    const q = search.toLowerCase();
    const matchesSearch =
      !q ||
      deal.name.toLowerCase().includes(q) ||
      deal.address?.toLowerCase().includes(q) ||
      deal.city?.toLowerCase().includes(q) ||
      deal.state?.toLowerCase().includes(q) ||
      deal.propertyType?.toLowerCase().includes(q);

    const matchesType =
      filterType === "all" || deal.propertyType === filterType;
    const matchesCity = filterCity === "all" || deal.city === filterCity;

    return matchesSearch && matchesType && matchesCity;
  });

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/parse-om", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Upload failed");
      }

      toast.success("OM parsed successfully — new deal created");
      router.refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to parse OM"
      );
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Deals</h1>
          <p className="text-sm text-muted-foreground">
            {deals.length} total &middot; {filtered.length} shown
          </p>
        </div>
        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf"
            className="hidden"
            onChange={handleUpload}
          />
          <Button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Parsing with AI...
              </>
            ) : (
              <>
                <Upload className="mr-2 h-4 w-4" />
                Upload OM
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search deals..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={filterType} onValueChange={(v) => setFilterType(v ?? "all")}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Property type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            {propertyTypes.map((t) => (
              <SelectItem key={t} value={t}>
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterCity} onValueChange={(v) => setFilterCity(v ?? "all")}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="City" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Cities</SelectItem>
            {cities.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Kanban Columns */}
      <div className="grid grid-cols-4 gap-4">
        {STATUS_COLUMNS.map((col) => {
          const colDeals = filtered.filter((d) => d.status === col.key);
          return (
            <div key={col.key} className="space-y-3">
              {/* Column header */}
              <div className="flex items-center justify-between px-1">
                <h2
                  className={`text-sm font-semibold uppercase tracking-wider ${COLUMN_HEADER_COLORS[col.key]}`}
                >
                  {col.label}
                </h2>
                <span
                  className={`text-xs font-medium px-2 py-0.5 rounded-full ${COLUMN_COUNT_COLORS[col.key]}`}
                >
                  {colDeals.length}
                </span>
              </div>

              {/* Cards */}
              <div className="space-y-2 min-h-[200px]">
                {colDeals.length === 0 && (
                  <div className="flex items-center justify-center h-[200px] rounded-lg border border-dashed border-border text-xs text-muted-foreground">
                    No deals
                  </div>
                )}
                {colDeals.map((deal) => (
                  <Link key={deal.id} href={`/deals/${deal.id}`}>
                    <Card
                      className={`border-l-4 ${col.color} cursor-pointer transition-colors hover:bg-muted/50`}
                    >
                      <CardContent className="space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <p className="font-semibold text-sm leading-tight">
                            {deal.name}
                          </p>
                        </div>
                        {deal.propertyType && (
                          <Badge variant="secondary" className="text-[10px]">
                            <Building2 className="mr-1 h-3 w-3" />
                            {deal.propertyType}
                          </Badge>
                        )}
                        {(deal.address || deal.city) && (
                          <p className="text-xs text-muted-foreground flex items-center gap-1">
                            <MapPin className="h-3 w-3 shrink-0" />
                            {[deal.address, deal.city, deal.state]
                              .filter(Boolean)
                              .join(", ")}
                          </p>
                        )}
                        {deal.askingPrice != null && (
                          <p className="text-xs font-medium text-emerald-600 flex items-center gap-1">
                            <DollarSign className="h-3 w-3" />
                            {formatCurrency(deal.askingPrice)}
                          </p>
                        )}
                        {deal.aiSummary && (
                          <p className="text-xs text-muted-foreground line-clamp-2">
                            {deal.aiSummary.slice(0, 100)}
                            {deal.aiSummary.length > 100 ? "..." : ""}
                          </p>
                        )}
                      </CardContent>
                    </Card>
                  </Link>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
