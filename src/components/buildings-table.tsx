"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { format } from "date-fns";
import { toast } from "sonner";
import {
  Search,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Building,
  ChevronDown,
  ChevronRight,
  MapPin,
  Users,
  Clock,
  AlertTriangle,
  Sparkles,
  Loader2,
  Pencil,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { GenericEditDialog } from "@/components/generic-edit-dialog";

import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type BuildingRow = {
  id: number;
  name: string | null;
  address: string;
  city: string | null;
  state: string | null;
  submarket: string | null;
  district: string | null;
  propertyClass: string | null;
  propertySubtype: string | null;
  propertySizeSf: number | null;
  landlordName: string | null;
  landlordContactId: number | null;
  landlordContactName: string | null;
  sourceFile: string | null;
};

type LeaseRow = {
  id: number;
  buildingId: number | null;
  tenantId: number;
  tenantName: string;
  tenantIndustry: string | null;
  suiteUnit: string | null;
  squareFeet: number | null;
  leaseStartDate: string | null;
  leaseEndDate: string | null;
  monthsRemaining: number | null;
  rentPsf: number | null;
  annualRent: number | null;
  leaseType: string | null;
  isSublease: number | null;
  // First non-landlord contact at this tenant's company, if any.
  tenantContactId: number | null;
};

type SortField =
  | "name"
  | "city"
  | "tenantCount"
  | "totalSf"
  | "soonestExpiry"
  | "propertyClass";
type SortDir = "asc" | "desc";

const numberFmt = new Intl.NumberFormat("en-US");
const currencyFmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const wholeCurrencyFmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

function SortIcon({
  field,
  sortField,
  sortDir,
}: {
  field: SortField;
  sortField: SortField;
  sortDir: SortDir;
}) {
  if (sortField !== field)
    return <ArrowUpDown className="ml-1 size-3 text-muted-foreground/50" />;
  return sortDir === "asc" ? (
    <ArrowUp className="ml-1 size-3 text-emerald-600" />
  ) : (
    <ArrowDown className="ml-1 size-3 text-emerald-600" />
  );
}

function formatDate(d: string | null) {
  if (!d) return "---";
  try {
    return format(new Date(d), "MMM d, yyyy");
  } catch {
    return d;
  }
}

function urgencyColor(months: number | null) {
  if (months == null) return "gray";
  if (months < 0) return "gray";
  if (months <= 6) return "red";
  if (months <= 12) return "amber";
  if (months <= 24) return "blue";
  return "gray";
}

const URGENCY_BADGE: Record<string, string> = {
  red: "bg-red-500/20 text-red-600 border-red-500/30",
  amber: "bg-amber-500/20 text-amber-600 border-amber-500/30",
  blue: "bg-blue-500/20 text-blue-600 border-blue-500/30",
  gray: "bg-zinc-500/20 text-slate-600 border-zinc-500/30",
};

const CLASS_BADGE: Record<string, string> = {
  A: "bg-emerald-500/20 text-emerald-600 border-emerald-500/30",
  B: "bg-blue-500/20 text-blue-600 border-blue-500/30",
  C: "bg-zinc-500/20 text-slate-600 border-zinc-500/30",
};

type EnrichedBuilding = BuildingRow & {
  leases: LeaseRow[];
  tenantCount: number;
  totalSf: number;
  soonestExpiry: string | null;
  soonestMonths: number | null;
};

export function BuildingsTable({
  buildings: rawBuildings,
  leases: allLeases,
}: {
  buildings: BuildingRow[];
  leases: LeaseRow[];
}) {
  const [search, setSearch] = useState("");
  const [cityFilter, setCityFilter] = useState("all");
  const [classFilter, setClassFilter] = useState("all");
  const [sortField, setSortField] = useState<SortField>("soonestExpiry");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
  const [enrichingTenantId, setEnrichingTenantId] = useState<number | null>(null);
  const rowRefs = useRef<Map<number, HTMLTableRowElement>>(new Map());
  const router = useRouter();

  async function handleTenantClick(lease: LeaseRow) {
    if (lease.tenantContactId) {
      router.push(`/contacts/${lease.tenantContactId}`);
      return;
    }
    if (enrichingTenantId !== null) return;
    setEnrichingTenantId(lease.tenantId);
    try {
      toast.message(`Searching Apollo for decision-makers at ${lease.tenantName}…`);
      const res = await fetch("/api/enrich-tenant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: lease.tenantId }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || `HTTP ${res.status}`);
        return;
      }
      const newIds: number[] = data.createdContactIds || [];
      if (newIds.length > 0) {
        toast.success(`Created ${newIds.length} contact${newIds.length === 1 ? "" : "s"} at ${lease.tenantName}`);
        router.push(`/contacts/${newIds[0]}`);
        return;
      }
      toast.message(
        `Apollo found ${data.candidatesFound ?? 0} candidates but none matched the decision-maker title filter.`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Enrichment failed");
    } finally {
      setEnrichingTenantId(null);
    }
  }

  // Deep-link support: ?id=<buildingId> → auto-expand + scroll into view.
  // Used by the /map popup's "Open in Buildings" link.
  const searchParams = useSearchParams();
  const deepLinkId = searchParams.get("id");
  useEffect(() => {
    if (!deepLinkId) return;
    const id = parseInt(deepLinkId, 10);
    if (!Number.isFinite(id)) return;
    // Clear filters so the deep-linked row isn't filtered out, and expand it.
    /* eslint-disable react-hooks/set-state-in-effect */
    setSearch("");
    setCityFilter("all");
    setClassFilter("all");
    setExpandedRows((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    /* eslint-enable react-hooks/set-state-in-effect */
    // Scroll on next paint so the row exists in the DOM.
    const t = setTimeout(() => {
      const el = rowRefs.current.get(id);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("ring-2", "ring-blue-500/40");
        setTimeout(() => el.classList.remove("ring-2", "ring-blue-500/40"), 2500);
      }
    }, 50);
    return () => clearTimeout(t);
  }, [deepLinkId]);

  // Group leases by buildingId once.
  const leasesByBuilding = useMemo(() => {
    const m = new Map<number, LeaseRow[]>();
    for (const l of allLeases) {
      if (l.buildingId == null) continue;
      if (!m.has(l.buildingId)) m.set(l.buildingId, []);
      m.get(l.buildingId)!.push(l);
    }
    return m;
  }, [allLeases]);

  // Enrich each building with its rollover stats.
  const enriched: EnrichedBuilding[] = useMemo(() => {
    return rawBuildings.map((b) => {
      const ls = leasesByBuilding.get(b.id) ?? [];
      const totalSf = ls.reduce((acc, l) => acc + (l.squareFeet ?? 0), 0);

      // Soonest *future* expiration. Past expirations don't count toward urgency.
      let soonestExpiry: string | null = null;
      let soonestMonths: number | null = null;
      for (const l of ls) {
        if (l.monthsRemaining == null || l.monthsRemaining < 0) continue;
        if (soonestMonths == null || l.monthsRemaining < soonestMonths) {
          soonestMonths = l.monthsRemaining;
          soonestExpiry = l.leaseEndDate;
        }
      }

      return {
        ...b,
        leases: ls,
        tenantCount: ls.length,
        totalSf,
        soonestExpiry,
        soonestMonths,
      };
    });
  }, [rawBuildings, leasesByBuilding]);

  const cities = useMemo(() => {
    const s = new Set<string>();
    for (const b of rawBuildings) {
      if (b.city) s.add(b.city);
    }
    return Array.from(s).sort();
  }, [rawBuildings]);

  const classes = useMemo(() => {
    const s = new Set<string>();
    for (const b of rawBuildings) {
      if (b.propertyClass) s.add(b.propertyClass);
    }
    return Array.from(s).sort();
  }, [rawBuildings]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    const list = enriched.filter((b) => {
      if (q) {
        const hay = [
          b.name,
          b.address,
          b.city,
          b.landlordContactName,
          b.landlordName,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (cityFilter !== "all" && b.city !== cityFilter) return false;
      if (classFilter !== "all" && b.propertyClass !== classFilter) return false;
      return true;
    });

    list.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "name":
          cmp = (a.name || a.address).localeCompare(b.name || b.address);
          break;
        case "city":
          cmp = (a.city || "").localeCompare(b.city || "");
          break;
        case "tenantCount":
          cmp = a.tenantCount - b.tenantCount;
          break;
        case "totalSf":
          cmp = a.totalSf - b.totalSf;
          break;
        case "soonestExpiry":
          // Buildings with no future expirations sort to the end on asc.
          cmp = (a.soonestMonths ?? 9999) - (b.soonestMonths ?? 9999);
          break;
        case "propertyClass":
          cmp = (a.propertyClass || "").localeCompare(b.propertyClass || "");
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });

    return list;
  }, [enriched, search, cityFilter, classFilter, sortField, sortDir]);

  const stats = useMemo(() => {
    let in6 = 0,
      in12 = 0;
    let totalLeases = 0;
    let totalSf = 0;
    for (const b of enriched) {
      totalLeases += b.tenantCount;
      totalSf += b.totalSf;
      if (b.soonestMonths != null) {
        if (b.soonestMonths <= 6) in6++;
        if (b.soonestMonths <= 12) in12++;
      }
    }
    return {
      total: enriched.length,
      totalLeases,
      totalSf,
      buildingsRollingIn6: in6,
      buildingsRollingIn12: in12,
    };
  }, [enriched]);

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  }

  function toggleRow(id: number) {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Buildings</h1>
        <p className="text-sm text-muted-foreground">
          Every building Bobby tracks, with its tenant roster and rollover schedule
        </p>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-4 gap-3">
        <Card className="p-3 border-zinc-500/30">
          <div className="flex items-center gap-2 text-xs text-slate-600 font-medium uppercase tracking-wider">
            <Building className="size-3.5" />
            Buildings
          </div>
          <div className="text-2xl font-bold text-slate-700 mt-1">
            {stats.total}
          </div>
        </Card>
        <Card className="p-3 border-zinc-500/30">
          <div className="flex items-center gap-2 text-xs text-slate-600 font-medium uppercase tracking-wider">
            <Users className="size-3.5" />
            Tracked Leases
          </div>
          <div className="text-2xl font-bold text-slate-700 mt-1">
            {numberFmt.format(stats.totalLeases)}
          </div>
        </Card>
        <Card className="p-3 border-amber-500/30 bg-amber-950/10">
          <div className="flex items-center gap-2 text-xs text-amber-600 font-medium uppercase tracking-wider">
            <Clock className="size-3.5" />
            Rolling in 12 mo
          </div>
          <div className="text-2xl font-bold text-amber-600 mt-1">
            {stats.buildingsRollingIn12}
          </div>
        </Card>
        <Card className="p-3 border-red-500/30 bg-red-950/10">
          <div className="flex items-center gap-2 text-xs text-red-600 font-medium uppercase tracking-wider">
            <AlertTriangle className="size-3.5" />
            Rolling in 6 mo
          </div>
          <div className="text-2xl font-bold text-red-600 mt-1">
            {stats.buildingsRollingIn6}
          </div>
        </Card>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-end gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Search building, address, landlord..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-8"
          />
        </div>

        <Select value={cityFilter} onValueChange={(v) => setCityFilter(v ?? "all")}>
          <SelectTrigger size="sm" className="w-[160px]">
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

        <Select value={classFilter} onValueChange={(v) => setClassFilter(v ?? "all")}>
          <SelectTrigger size="sm" className="w-[120px]">
            <SelectValue placeholder="Class" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Classes</SelectItem>
            {classes.map((c) => (
              <SelectItem key={c} value={c}>
                Class {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="text-xs text-muted-foreground">
        Showing {filtered.length} of {enriched.length} buildings
      </div>

      <div className="rounded-lg border border-border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-6" />
              <TableHead>
                <button
                  onClick={() => toggleSort("name")}
                  className="flex items-center font-medium"
                >
                  Building
                  <SortIcon field="name" sortField={sortField} sortDir={sortDir} />
                </button>
              </TableHead>
              <TableHead>
                <button
                  onClick={() => toggleSort("city")}
                  className="flex items-center font-medium"
                >
                  Location
                  <SortIcon field="city" sortField={sortField} sortDir={sortDir} />
                </button>
              </TableHead>
              <TableHead>
                <button
                  onClick={() => toggleSort("propertyClass")}
                  className="flex items-center font-medium"
                >
                  Class
                  <SortIcon field="propertyClass" sortField={sortField} sortDir={sortDir} />
                </button>
              </TableHead>
              <TableHead>Landlord</TableHead>
              <TableHead className="text-right">
                <button
                  onClick={() => toggleSort("tenantCount")}
                  className="flex items-center justify-end font-medium ml-auto"
                >
                  Tenants
                  <SortIcon field="tenantCount" sortField={sortField} sortDir={sortDir} />
                </button>
              </TableHead>
              <TableHead className="text-right">
                <button
                  onClick={() => toggleSort("totalSf")}
                  className="flex items-center justify-end font-medium ml-auto"
                >
                  Tracked SF
                  <SortIcon field="totalSf" sortField={sortField} sortDir={sortDir} />
                </button>
              </TableHead>
              <TableHead>
                <button
                  onClick={() => toggleSort("soonestExpiry")}
                  className="flex items-center font-medium"
                >
                  Next Rollover
                  <SortIcon field="soonestExpiry" sortField={sortField} sortDir={sortDir} />
                </button>
              </TableHead>
              <TableHead className="w-8" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={9}
                  className="text-center py-12 text-muted-foreground"
                >
                  No buildings match your filters
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((b) => (
                <BuildingRowGroup
                  key={b.id}
                  building={b}
                  isExpanded={expandedRows.has(b.id)}
                  onToggle={() => toggleRow(b.id)}
                  rowRef={(el) => {
                    if (el) rowRefs.current.set(b.id, el);
                    else rowRefs.current.delete(b.id);
                  }}
                  onTenantClick={handleTenantClick}
                  enrichingTenantId={enrichingTenantId}
                />
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function BuildingRowGroup({
  building: b,
  isExpanded,
  onToggle,
  rowRef,
  onTenantClick,
  enrichingTenantId,
}: {
  building: EnrichedBuilding;
  isExpanded: boolean;
  onToggle: () => void;
  rowRef?: (el: HTMLTableRowElement | null) => void;
  onTenantClick: (lease: LeaseRow) => void;
  enrichingTenantId: number | null;
}) {
  const color = urgencyColor(b.soonestMonths);
  const landlord = b.landlordContactName || b.landlordName;
  const [editing, setEditing] = useState(false);

  return (
    <>
      <TableRow
        ref={rowRef}
        onClick={onToggle}
        className="cursor-pointer transition-colors hover:bg-muted/50"
      >
        <TableCell className="w-6 px-2">
          {isExpanded ? (
            <ChevronDown className="size-3.5 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-3.5 text-muted-foreground" />
          )}
        </TableCell>
        <TableCell>
          <div className="font-semibold text-foreground">
            {b.name || b.address}
          </div>
          {b.name && (
            <div className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
              <MapPin className="size-3" />
              {b.address}
            </div>
          )}
        </TableCell>
        <TableCell className="text-muted-foreground">
          {b.city && b.state
            ? `${b.city}, ${b.state}`
            : b.city || b.state || "---"}
        </TableCell>
        <TableCell>
          {b.propertyClass ? (
            <Badge
              className={`${
                CLASS_BADGE[b.propertyClass] || CLASS_BADGE.C
              } text-[11px]`}
            >
              Class {b.propertyClass}
            </Badge>
          ) : (
            <span className="text-muted-foreground text-xs">---</span>
          )}
        </TableCell>
        <TableCell className="text-muted-foreground text-xs">
          {b.landlordContactId && landlord ? (
            <a
              href={`/contacts?id=${b.landlordContactId}`}
              className="text-blue-600 hover:text-blue-500"
              onClick={(e) => e.stopPropagation()}
            >
              {landlord}
            </a>
          ) : (
            landlord || "---"
          )}
        </TableCell>
        <TableCell className="text-right tabular-nums">
          {b.tenantCount > 0 ? b.tenantCount : <span className="text-muted-foreground">---</span>}
        </TableCell>
        <TableCell className="text-right tabular-nums text-muted-foreground">
          {b.totalSf > 0 ? numberFmt.format(b.totalSf) : "---"}
        </TableCell>
        <TableCell>
          {b.soonestMonths != null ? (
            <div className="flex items-center gap-2">
              <Badge
                className={`${URGENCY_BADGE[color]} tabular-nums text-[11px] font-semibold`}
              >
                {b.soonestMonths} mo
              </Badge>
              <span className="text-xs text-muted-foreground tabular-nums">
                {formatDate(b.soonestExpiry)}
              </span>
            </div>
          ) : (
            <span className="text-muted-foreground text-xs">
              {b.tenantCount > 0 ? "all expired" : "no leases"}
            </span>
          )}
        </TableCell>
        <TableCell className="w-8 px-1" onClick={(e) => e.stopPropagation()}>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-1.5"
            onClick={(e) => {
              e.stopPropagation();
              setEditing(true);
            }}
            title="Edit building"
          >
            <Pencil className="size-3.5" />
          </Button>
        </TableCell>
      </TableRow>
      {editing && (
        <GenericEditDialog
          open={editing}
          onOpenChange={setEditing}
          resource="Building"
          endpoint={`/api/buildings/${b.id}`}
          row={b as unknown as Record<string, unknown>}
          preview={b.address ?? b.name ?? `Building ${b.id}`}
          fields={[
            { key: "name", label: "Name", type: "text" },
            { key: "address", label: "Address", type: "text", full: true },
            { key: "city", label: "City", type: "text" },
            { key: "state", label: "State", type: "text" },
            { key: "submarket", label: "Submarket", type: "text" },
            { key: "district", label: "District", type: "text" },
            { key: "propertyClass", label: "Property class", type: "select", options: ["A", "B", "C"] },
            { key: "propertySubtype", label: "Property subtype", type: "text" },
            { key: "propertySizeSf", label: "Total SF", type: "number" },
            { key: "landlordName", label: "Landlord", type: "text" },
            { key: "notes", label: "Notes", type: "textarea", full: true },
          ]}
        />
      )}

      {isExpanded && (
        <TableRow className="bg-muted/30 hover:bg-muted/30">
          <TableCell colSpan={9} className="px-6 py-4">
            <BuildingDetail
              building={b}
              onTenantClick={onTenantClick}
              enrichingTenantId={enrichingTenantId}
            />
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

function BuildingDetail({
  building: b,
  onTenantClick,
  enrichingTenantId,
}: {
  building: EnrichedBuilding;
  onTenantClick: (lease: LeaseRow) => void;
  enrichingTenantId: number | null;
}) {
  return (
    <div className="space-y-4">
      {/* Property facts */}
      <div className="grid grid-cols-4 gap-4 text-sm">
        <DetailField label="Address" value={b.address} />
        <DetailField
          label="Property Subtype"
          value={b.propertySubtype || "---"}
        />
        <DetailField
          label="Building Size"
          value={
            b.propertySizeSf ? `${numberFmt.format(b.propertySizeSf)} SF` : "---"
          }
        />
        <DetailField
          label="Submarket / District"
          value={
            b.submarket && b.district
              ? `${b.submarket} · ${b.district}`
              : b.submarket || b.district || "---"
          }
        />
      </div>

      {/* Rollover schedule */}
      <div>
        <h4 className="font-semibold text-xs uppercase tracking-wider text-muted-foreground mb-2">
          Rollover Schedule ({b.leases.length} {b.leases.length === 1 ? "lease" : "leases"})
        </h4>
        {b.leases.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No leases tracked for this building yet.
          </p>
        ) : (
          <div className="rounded border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="text-xs">Tenant</TableHead>
                  <TableHead className="text-xs">Suite</TableHead>
                  <TableHead className="text-xs text-right">SF</TableHead>
                  <TableHead className="text-xs">Start</TableHead>
                  <TableHead className="text-xs">End</TableHead>
                  <TableHead className="text-xs">Mo. Left</TableHead>
                  <TableHead className="text-xs text-right">Rent PSF</TableHead>
                  <TableHead className="text-xs text-right">Annual Rent</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {b.leases.map((l) => {
                  const c = urgencyColor(l.monthsRemaining);
                  return (
                    <TableRow key={l.id}>
                      <TableCell className="text-xs font-medium">
                        <button
                          type="button"
                          onClick={(e) => {
                            // Stop the building row from toggling its expand state.
                            e.stopPropagation();
                            onTenantClick(l);
                          }}
                          disabled={enrichingTenantId === l.tenantId}
                          className={`inline-flex items-center gap-1.5 text-left transition-colors ${
                            l.tenantContactId
                              ? "text-blue-600 hover:text-blue-500 hover:underline"
                              : "text-amber-300 hover:text-amber-200 hover:underline"
                          } disabled:opacity-60`}
                          title={
                            l.tenantContactId
                              ? "Open contact"
                              : "No contact tracked — click to search Apollo for decision-makers"
                          }
                        >
                          {l.tenantName}
                          {enrichingTenantId === l.tenantId ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : !l.tenantContactId ? (
                            <Sparkles className="h-3 w-3 opacity-70" />
                          ) : null}
                        </button>
                        {l.isSublease ? (
                          <span className="ml-1 text-[10px] text-muted-foreground">
                            (sublease)
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {l.suiteUnit || "---"}
                      </TableCell>
                      <TableCell className="text-xs text-right tabular-nums">
                        {l.squareFeet != null
                          ? numberFmt.format(l.squareFeet)
                          : "---"}
                      </TableCell>
                      <TableCell className="text-xs tabular-nums">
                        {formatDate(l.leaseStartDate)}
                      </TableCell>
                      <TableCell className="text-xs tabular-nums">
                        {formatDate(l.leaseEndDate)}
                      </TableCell>
                      <TableCell>
                        {l.monthsRemaining != null ? (
                          <Badge
                            className={`${URGENCY_BADGE[c]} tabular-nums text-[11px] font-semibold`}
                          >
                            {l.monthsRemaining} mo
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">---</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-right tabular-nums">
                        {l.rentPsf != null ? currencyFmt.format(l.rentPsf) : "---"}
                      </TableCell>
                      <TableCell className="text-xs text-right tabular-nums">
                        {l.annualRent != null
                          ? wholeCurrencyFmt.format(l.annualRent)
                          : "---"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {b.sourceFile && (
        <p className="text-xs text-muted-foreground">Source: {b.sourceFile}</p>
      )}
    </div>
  );
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="text-sm mt-0.5">{value}</div>
    </div>
  );
}
