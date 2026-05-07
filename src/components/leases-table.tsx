"use client";

import { useState, useMemo, useCallback } from "react";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  Search,
  FileSpreadsheet,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Clock,
  AlertTriangle,
  Building2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  UserPlus,
  Pencil,
} from "lucide-react";
import { GenericEditDialog } from "@/components/generic-edit-dialog";

import { Button } from "@/components/ui/button";
import { FindPeopleInlinePanel } from "@/components/find-people-inline-panel";
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

// ---- Types ----

type TenantContact = {
  id: number;
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  type: string | null;
};

type LandlordContact = {
  id: number;
  name: string;
};

type LeaseRow = {
  id: number;
  tenantName: string;
  tenantIndustry: string | null;
  tenantCreditRating: string | null;
  tenantId: number;
  buildingId: number | null;
  landlordContactId: number | null;
  propertyName: string | null;
  propertyAddress: string | null;
  propertyCity: string | null;
  propertyState: string | null;
  propertyType: string | null;
  suiteUnit: string | null;
  squareFeet: number | null;
  leaseStartDate: string | null;
  leaseEndDate: string | null;
  monthsRemaining: number | null;
  rentPsf: number | null;
  annualRent: number | null;
  leaseType: string | null;
  options: string | null;
  escalations: string | null;
  sourceFile: string | null;
  confidence: string | null;
  documentId: number | null;
  dealId: number | null;
  tenantContacts: TenantContact[];
  landlordContact: LandlordContact | null;
};

type SortField =
  | "tenantName"
  | "propertyName"
  | "propertyCity"
  | "squareFeet"
  | "leaseEndDate"
  | "monthsRemaining"
  | "rentPsf"
  | "annualRent"
  | "leaseType"
  | "confidence";
type SortDir = "asc" | "desc";

// ---- Formatters ----

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

const numberFmt = new Intl.NumberFormat("en-US");

function formatDate(d: string | null) {
  if (!d) return "---";
  try {
    return format(new Date(d), "MMM d, yyyy");
  } catch {
    return d;
  }
}

// ---- Urgency helpers ----

function urgencyColor(months: number | null) {
  if (months == null) return "gray";
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

const URGENCY_ROW_BG: Record<string, string> = {
  red: "bg-red-950/20 border-l-2 border-l-red-500",
  amber: "border-l-2 border-l-amber-500",
  blue: "border-l-2 border-l-blue-500",
  gray: "",
};

const CONFIDENCE_BADGE: Record<string, string> = {
  high: "bg-emerald-500/20 text-emerald-600 border-emerald-500/30",
  medium: "bg-amber-500/20 text-amber-600 border-amber-500/30",
  low: "bg-red-500/20 text-red-600 border-red-500/30",
};

const LEASE_TYPE_BADGE = "bg-violet-500/20 text-violet-600 border-violet-500/30";

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

// ---- Component ----

export function LeasesTable({ leases }: { leases: LeaseRow[] }) {
  // Filters
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("6");
  const [propertyTypeFilter, setPropertyTypeFilter] = useState("all");
  const [locationFilter, setLocationFilter] = useState("all");
  const [leaseTypeFilter, setLeaseTypeFilter] = useState("all");
  const [minRentPsf, setMinRentPsf] = useState("");
  const [maxRentPsf, setMaxRentPsf] = useState("");
  const [minSF, setMinSF] = useState("");
  const [maxSF, setMaxSF] = useState("");

  // Sort
  const [sortField, setSortField] = useState<SortField>("monthsRemaining");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  // Expanded rows
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
  const [addingContact, setAddingContact] = useState<number | null>(null);

  // Derived filter options
  const propertyTypes = useMemo(
    () =>
      Array.from(new Set(leases.map((l) => l.propertyType).filter(Boolean))).sort() as string[],
    [leases]
  );

  const locations = useMemo(() => {
    const locs = new Set<string>();
    for (const l of leases) {
      if (l.propertyCity && l.propertyState)
        locs.add(`${l.propertyCity}, ${l.propertyState}`);
      else if (l.propertyState) locs.add(l.propertyState);
    }
    return Array.from(locs).sort();
  }, [leases]);

  const leaseTypes = useMemo(
    () =>
      Array.from(new Set(leases.map((l) => l.leaseType).filter(Boolean))).sort() as string[],
    [leases]
  );

  // Filter logic
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    const minR = minRentPsf ? parseFloat(minRentPsf) : null;
    const maxR = maxRentPsf ? parseFloat(maxRentPsf) : null;
    const minS = minSF ? parseInt(minSF) : null;
    const maxS = maxSF ? parseInt(maxSF) : null;

    const now = new Date();
    now.setHours(0, 0, 0, 0);

    // Exclusive horizon bands: each tab shows ONLY leases inside its own
    // window — no cumulative overlap.
    //   "6"  → end ≤ today + 6mo
    //   "12" → today + 6mo  < end ≤ today + 12mo
    //   "24" → today + 12mo < end ≤ today + 24mo
    //   "all" → everything (any future, any expired)
    function makeCutoff(months: number) {
      const c = new Date(now);
      c.setMonth(c.getMonth() + months);
      return c;
    }
    const upperByTab: Record<string, Date> = {
      "6": makeCutoff(6),
      "12": makeCutoff(12),
      "24": makeCutoff(24),
    };
    const lowerByTab: Record<string, Date | null> = {
      "6": null,
      "12": makeCutoff(6),
      "24": makeCutoff(12),
    };

    const list = leases.filter((l) => {
      if (tab !== "all") {
        if (!l.leaseEndDate) return false;
        const end = new Date(l.leaseEndDate + "T00:00:00");
        if (isNaN(end.getTime()) || end < now) return false;
        const upper = upperByTab[tab];
        const lower = lowerByTab[tab];
        if (upper && end > upper) return false;
        if (lower && end <= lower) return false;
      }

      // Search
      if (q) {
        const haystack = [l.tenantName, l.propertyName, l.propertyAddress, l.propertyCity]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }

      // Property type
      if (propertyTypeFilter !== "all" && l.propertyType !== propertyTypeFilter) return false;

      // Location
      if (locationFilter !== "all") {
        const loc =
          l.propertyCity && l.propertyState
            ? `${l.propertyCity}, ${l.propertyState}`
            : l.propertyState || "";
        if (loc !== locationFilter) return false;
      }

      // Lease type
      if (leaseTypeFilter !== "all" && l.leaseType !== leaseTypeFilter) return false;

      // Rent PSF range
      if (minR != null && (l.rentPsf == null || l.rentPsf < minR)) return false;
      if (maxR != null && (l.rentPsf == null || l.rentPsf > maxR)) return false;

      // Square feet range
      if (minS != null && (l.squareFeet == null || l.squareFeet < minS)) return false;
      if (maxS != null && (l.squareFeet == null || l.squareFeet > maxS)) return false;

      return true;
    });

    // Sort
    list.sort((a, b) => {
      let aVal: string | number = "";
      let bVal: string | number = "";

      switch (sortField) {
        case "tenantName":
          aVal = a.tenantName;
          bVal = b.tenantName;
          break;
        case "propertyName":
          aVal = a.propertyName || "";
          bVal = b.propertyName || "";
          break;
        case "propertyCity":
          aVal = `${a.propertyCity || ""}, ${a.propertyState || ""}`;
          bVal = `${b.propertyCity || ""}, ${b.propertyState || ""}`;
          break;
        case "squareFeet":
          aVal = a.squareFeet ?? 0;
          bVal = b.squareFeet ?? 0;
          break;
        case "leaseEndDate":
          aVal = a.leaseEndDate || "";
          bVal = b.leaseEndDate || "";
          break;
        case "monthsRemaining":
          aVal = a.monthsRemaining ?? 9999;
          bVal = b.monthsRemaining ?? 9999;
          break;
        case "rentPsf":
          aVal = a.rentPsf ?? 0;
          bVal = b.rentPsf ?? 0;
          break;
        case "annualRent":
          aVal = a.annualRent ?? 0;
          bVal = b.annualRent ?? 0;
          break;
        case "leaseType":
          aVal = a.leaseType || "";
          bVal = b.leaseType || "";
          break;
        case "confidence":
          aVal = a.confidence || "";
          bVal = b.confidence || "";
          break;
      }

      let cmp: number;
      if (typeof aVal === "number" && typeof bVal === "number") {
        cmp = aVal - bVal;
      } else {
        cmp = String(aVal).localeCompare(String(bVal));
      }
      return sortDir === "asc" ? cmp : -cmp;
    });

    return list;
  }, [
    leases,
    search,
    tab,
    propertyTypeFilter,
    locationFilter,
    leaseTypeFilter,
    minRentPsf,
    maxRentPsf,
    minSF,
    maxSF,
    sortField,
    sortDir,
  ]);

  // Summary stats (computed from all leases, not filtered). "Expiring in N mo"
  // counts only future expirations — expired leases show up in Total but not in
  // the urgency buckets.
  const stats = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const cut6 = new Date(today); cut6.setMonth(cut6.getMonth() + 6);
    const cut12 = new Date(today); cut12.setMonth(cut12.getMonth() + 12);
    const cut24 = new Date(today); cut24.setMonth(cut24.getMonth() + 24);
    // Exclusive bands so the stat cards match the tab filters:
    //   in6  = 0..6 mo, in12 = 6..12 mo, in24 = 12..24 mo
    let in6 = 0, in12 = 0, in24 = 0, expired = 0;
    for (const l of leases) {
      if (!l.leaseEndDate) continue;
      const end = new Date(l.leaseEndDate + "T00:00:00");
      if (isNaN(end.getTime())) continue;
      if (end < today) { expired++; continue; }
      if (end <= cut6) in6++;
      else if (end <= cut12) in12++;
      else if (end <= cut24) in24++;
    }
    return { in6, in12, in24, expired, total: leases.length };
  }, [leases]);

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

  // Export CSV
  const exportCSV = useCallback(() => {
    const headers = [
      "Tenant",
      "Industry",
      "Credit Rating",
      "Property",
      "Address",
      "City",
      "State",
      "Property Type",
      "Suite/Unit",
      "Square Feet",
      "Lease Start",
      "Lease End",
      "Months Remaining",
      "Rent PSF",
      "Annual Rent",
      "Lease Type",
      "Options",
      "Escalations",
      "Confidence",
    ];

    const rows = filtered.map((l) => [
      l.tenantName,
      l.tenantIndustry || "",
      l.tenantCreditRating || "",
      l.propertyName || "",
      l.propertyAddress || "",
      l.propertyCity || "",
      l.propertyState || "",
      l.propertyType || "",
      l.suiteUnit || "",
      l.squareFeet?.toString() || "",
      l.leaseStartDate || "",
      l.leaseEndDate || "",
      l.monthsRemaining?.toString() || "",
      l.rentPsf?.toString() || "",
      l.annualRent?.toString() || "",
      l.leaseType || "",
      l.options || "",
      l.escalations || "",
      l.confidence || "",
    ]);

    const csvContent = [headers, ...rows]
      .map((row) =>
        row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")
      )
      .join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `expiring-leases-${format(new Date(), "yyyy-MM-dd")}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${filtered.length} leases to CSV`);
  }, [filtered]);

  // Add to contacts
  async function addToContacts(lease: LeaseRow) {
    setAddingContact(lease.id);
    try {
      const res = await fetch("/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: lease.tenantName,
          company: lease.tenantName,
          type: "other",
          source: "lease-expiration",
          city: lease.propertyCity || "",
          state: lease.propertyState || "",
          notes: `From lease expiration tracking. Property: ${lease.propertyName || "N/A"}. Lease expires: ${lease.leaseEndDate || "N/A"}.`,
        }),
      });
      if (!res.ok) throw new Error("Failed to create contact");
      toast.success(`Added ${lease.tenantName} to contacts`);
    } catch {
      toast.error("Failed to add contact");
    } finally {
      setAddingContact(null);
    }
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Expiring Leases</h1>
          <p className="text-sm text-muted-foreground">
            Find tenants with leases expiring soon — your next BD opportunity
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={exportCSV}
          className="gap-1.5"
        >
          <FileSpreadsheet className="size-4" />
          Export CSV
        </Button>
      </div>

      {/* Summary stat cards */}
      <div className="grid grid-cols-4 gap-3">
        <Card className="p-3 border-red-500/30 bg-red-950/10">
          <div className="flex items-center gap-2 text-xs text-red-600 font-medium uppercase tracking-wider">
            <AlertTriangle className="size-3.5" />
            Expiring 6 mo
          </div>
          <div className="text-2xl font-bold text-red-600 mt-1">
            {stats.in6}
          </div>
        </Card>
        <Card className="p-3 border-amber-500/30 bg-amber-950/10">
          <div className="flex items-center gap-2 text-xs text-amber-600 font-medium uppercase tracking-wider">
            <Clock className="size-3.5" />
            Expiring 12 mo
          </div>
          <div className="text-2xl font-bold text-amber-600 mt-1">
            {stats.in12}
          </div>
        </Card>
        <Card className="p-3 border-blue-500/30 bg-blue-950/10">
          <div className="flex items-center gap-2 text-xs text-blue-600 font-medium uppercase tracking-wider">
            <Clock className="size-3.5" />
            Expiring 24 mo
          </div>
          <div className="text-2xl font-bold text-blue-600 mt-1">
            {stats.in24}
          </div>
        </Card>
        <Card className="p-3 border-zinc-500/30">
          <div className="flex items-center gap-2 text-xs text-slate-600 font-medium uppercase tracking-wider">
            <Building2 className="size-3.5" />
            Total Tracked
          </div>
          <div className="text-2xl font-bold text-slate-700 mt-1">
            {stats.total}
          </div>
        </Card>
      </div>

      {/* Time horizon tabs — plain buttons (base-ui Tabs was flaky in controlled mode) */}
      <div className="flex flex-wrap gap-1 border-b border-border">
        {(
          [
            { v: "6", l: `Expiring 6 mo (${stats.in6})` },
            { v: "12", l: `Expiring 12 mo (${stats.in12})` },
            { v: "24", l: `Expiring 24 mo (${stats.in24})` },
            { v: "all", l: `All Leases (${stats.total})` },
          ] as const
        ).map(({ v, l }) => (
          <button
            key={v}
            type="button"
            onClick={() => setTab(v)}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              tab === v
                ? "text-foreground border-foreground"
                : "text-muted-foreground border-transparent hover:text-foreground hover:border-muted-foreground/50"
            }`}
          >
            {l}
          </button>
        ))}
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-end gap-2">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Search tenant, property, address..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-8"
          />
        </div>

        {/* Property type */}
        <Select
          value={propertyTypeFilter}
          onValueChange={(v) => setPropertyTypeFilter(v ?? "all")}
        >
          <SelectTrigger size="sm" className="w-[140px]">
            <SelectValue placeholder="Property Type" />
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

        {/* Location */}
        <Select
          value={locationFilter}
          onValueChange={(v) => setLocationFilter(v ?? "all")}
        >
          <SelectTrigger size="sm" className="w-[160px]">
            <SelectValue placeholder="City/State" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Locations</SelectItem>
            {locations.map((loc) => (
              <SelectItem key={loc} value={loc}>
                {loc}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Lease type */}
        <Select
          value={leaseTypeFilter}
          onValueChange={(v) => setLeaseTypeFilter(v ?? "all")}
        >
          <SelectTrigger size="sm" className="w-[130px]">
            <SelectValue placeholder="Lease Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Lease Types</SelectItem>
            {leaseTypes.map((t) => (
              <SelectItem key={t} value={t}>
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Rent PSF range */}
        <div className="flex items-center gap-1">
          <Input
            placeholder="Min $/SF"
            value={minRentPsf}
            onChange={(e) => setMinRentPsf(e.target.value)}
            className="h-7 w-[80px] text-xs"
            type="number"
          />
          <span className="text-muted-foreground text-xs">-</span>
          <Input
            placeholder="Max $/SF"
            value={maxRentPsf}
            onChange={(e) => setMaxRentPsf(e.target.value)}
            className="h-7 w-[80px] text-xs"
            type="number"
          />
        </div>

        {/* SF range */}
        <div className="flex items-center gap-1">
          <Input
            placeholder="Min SF"
            value={minSF}
            onChange={(e) => setMinSF(e.target.value)}
            className="h-7 w-[80px] text-xs"
            type="number"
          />
          <span className="text-muted-foreground text-xs">-</span>
          <Input
            placeholder="Max SF"
            value={maxSF}
            onChange={(e) => setMaxSF(e.target.value)}
            className="h-7 w-[80px] text-xs"
            type="number"
          />
        </div>
      </div>

      {/* Results count */}
      <div className="text-xs text-muted-foreground">
        Showing {filtered.length} of {leases.length} leases
      </div>

      {/* Table */}
      <div className="rounded-lg border border-border overflow-hidden">
        <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-6" />
                  <TableHead>
                    <button
                      onClick={() => toggleSort("tenantName")}
                      className="flex items-center font-medium"
                    >
                      Tenant
                      <SortIcon field="tenantName" sortField={sortField} sortDir={sortDir} />
                    </button>
                  </TableHead>
                  <TableHead>
                    <button
                      onClick={() => toggleSort("propertyName")}
                      className="flex items-center font-medium"
                    >
                      Property
                      <SortIcon field="propertyName" sortField={sortField} sortDir={sortDir} />
                    </button>
                  </TableHead>
                  <TableHead>
                    <button
                      onClick={() => toggleSort("propertyCity")}
                      className="flex items-center font-medium"
                    >
                      Location
                      <SortIcon field="propertyCity" sortField={sortField} sortDir={sortDir} />
                    </button>
                  </TableHead>
                  <TableHead>Suite/Unit</TableHead>
                  <TableHead className="text-right">
                    <button
                      onClick={() => toggleSort("squareFeet")}
                      className="flex items-center justify-end font-medium ml-auto"
                    >
                      SF
                      <SortIcon field="squareFeet" sortField={sortField} sortDir={sortDir} />
                    </button>
                  </TableHead>
                  <TableHead>
                    <button
                      onClick={() => toggleSort("leaseEndDate")}
                      className="flex items-center font-medium"
                    >
                      Lease End
                      <SortIcon field="leaseEndDate" sortField={sortField} sortDir={sortDir} />
                    </button>
                  </TableHead>
                  <TableHead>
                    <button
                      onClick={() => toggleSort("monthsRemaining")}
                      className="flex items-center font-medium"
                    >
                      Mo. Left
                      <SortIcon field="monthsRemaining" sortField={sortField} sortDir={sortDir} />
                    </button>
                  </TableHead>
                  <TableHead className="text-right">
                    <button
                      onClick={() => toggleSort("rentPsf")}
                      className="flex items-center justify-end font-medium ml-auto"
                    >
                      Rent PSF
                      <SortIcon field="rentPsf" sortField={sortField} sortDir={sortDir} />
                    </button>
                  </TableHead>
                  <TableHead className="text-right">
                    <button
                      onClick={() => toggleSort("annualRent")}
                      className="flex items-center justify-end font-medium ml-auto"
                    >
                      Annual Rent
                      <SortIcon field="annualRent" sortField={sortField} sortDir={sortDir} />
                    </button>
                  </TableHead>
                  <TableHead>
                    <button
                      onClick={() => toggleSort("leaseType")}
                      className="flex items-center font-medium"
                    >
                      Type
                      <SortIcon field="leaseType" sortField={sortField} sortDir={sortDir} />
                    </button>
                  </TableHead>
                  <TableHead>
                    <button
                      onClick={() => toggleSort("confidence")}
                      className="flex items-center font-medium"
                    >
                      Conf.
                      <SortIcon field="confidence" sortField={sortField} sortDir={sortDir} />
                    </button>
                  </TableHead>
                  <TableHead className="w-8" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={13}
                      className="text-center py-12 text-muted-foreground"
                    >
                      No leases match your filters
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((l) => {
                    const color = urgencyColor(l.monthsRemaining);
                    const isExpanded = expandedRows.has(l.id);

                    return (
                      <LeaseRowGroup
                        key={l.id}
                        lease={l}
                        color={color}
                        isExpanded={isExpanded}
                        onToggle={() => toggleRow(l.id)}
                        onAddContact={() => addToContacts(l)}
                        isAddingContact={addingContact === l.id}
                      />
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
    </div>
  );
}

// ---- Row sub-component ----

function LeaseRowGroup({
  lease: l,
  color,
  isExpanded,
  onToggle,
  onAddContact,
  isAddingContact,
}: {
  lease: LeaseRow;
  color: string;
  isExpanded: boolean;
  onToggle: () => void;
  onAddContact: () => void;
  isAddingContact: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [findPeopleOpen, setFindPeopleOpen] = useState(false);
  return (
    <>
      <TableRow
        onClick={onToggle}
        className={`cursor-pointer transition-colors hover:bg-muted/50 ${URGENCY_ROW_BG[color]}`}
      >
        <TableCell className="w-6 px-2">
          {isExpanded ? (
            <ChevronDown className="size-3.5 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-3.5 text-muted-foreground" />
          )}
        </TableCell>
        <TableCell className="font-semibold text-foreground">
          <a
            href={`/contacts?view=company&search=${encodeURIComponent(l.tenantName)}`}
            onClick={(e) => e.stopPropagation()}
            className="hover:text-blue-600 hover:underline transition-colors"
            title={`See contacts at ${l.tenantName}`}
          >
            {l.tenantName}
          </a>
        </TableCell>
        <TableCell className="text-muted-foreground">
          {l.buildingId ? (
            <a
              href={`/buildings?id=${l.buildingId}`}
              onClick={(e) => e.stopPropagation()}
              className="hover:text-blue-600 hover:underline transition-colors"
              title="Open building"
            >
              {l.propertyName || l.propertyAddress || "---"}
            </a>
          ) : (
            l.propertyName || "---"
          )}
        </TableCell>
        <TableCell className="text-muted-foreground">
          {l.propertyCity && l.propertyState
            ? `${l.propertyCity}, ${l.propertyState}`
            : l.propertyCity || l.propertyState || "---"}
        </TableCell>
        <TableCell className="text-muted-foreground">
          {l.suiteUnit || "---"}
        </TableCell>
        <TableCell className="text-right tabular-nums">
          {l.squareFeet != null ? numberFmt.format(l.squareFeet) : "---"}
        </TableCell>
        <TableCell className="tabular-nums">
          {formatDate(l.leaseEndDate)}
        </TableCell>
        <TableCell>
          <Badge
            className={`${URGENCY_BADGE[color]} tabular-nums text-[11px] font-semibold`}
          >
            {l.monthsRemaining != null ? `${l.monthsRemaining} mo` : "---"}
          </Badge>
        </TableCell>
        <TableCell className="text-right tabular-nums">
          {l.rentPsf != null ? currencyFmt.format(l.rentPsf) : "---"}
        </TableCell>
        <TableCell className="text-right tabular-nums">
          {l.annualRent != null ? wholeCurrencyFmt.format(l.annualRent) : "---"}
        </TableCell>
        <TableCell>
          {l.leaseType ? (
            <Badge className={`${LEASE_TYPE_BADGE} text-[11px]`}>
              {l.leaseType}
            </Badge>
          ) : (
            "---"
          )}
        </TableCell>
        <TableCell>
          {l.confidence ? (
            <Badge
              className={`${CONFIDENCE_BADGE[l.confidence] || CONFIDENCE_BADGE.low} text-[11px]`}
            >
              {l.confidence}
            </Badge>
          ) : (
            "---"
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
            title="Edit lease"
          >
            <Pencil className="size-3.5" />
          </Button>
        </TableCell>
      </TableRow>
      {editing && (
        <GenericEditDialog
          open={editing}
          onOpenChange={setEditing}
          resource="Lease"
          endpoint={`/api/leases/${l.id}`}
          row={l as unknown as Record<string, unknown>}
          preview={`${l.tenantName} — ${l.propertyName ?? l.propertyAddress ?? ""}`}
          fields={[
            { key: "propertyName", label: "Property name", type: "text" },
            { key: "propertyAddress", label: "Property address", type: "text" },
            { key: "propertyCity", label: "City", type: "text" },
            { key: "propertyState", label: "State", type: "text" },
            { key: "propertyType", label: "Property type", type: "text" },
            { key: "suiteUnit", label: "Suite/Unit", type: "text" },
            { key: "squareFeet", label: "Square Feet", type: "number" },
            { key: "leaseStartDate", label: "Lease Start", type: "date" },
            { key: "leaseEndDate", label: "Lease End", type: "date" },
            { key: "rentPsf", label: "Rent PSF", type: "number" },
            { key: "annualRent", label: "Annual Rent", type: "number" },
            { key: "leaseType", label: "Lease Type", type: "select", options: ["NNN", "gross", "modified_gross", "ground"] },
            { key: "options", label: "Renewal options", type: "textarea", full: true },
            { key: "escalations", label: "Escalations", type: "textarea", full: true },
            { key: "confidence", label: "Confidence", type: "select", options: ["high", "medium", "low"] },
          ]}
        />
      )}

      {/* Expanded detail row */}
      {isExpanded && (
        <TableRow className="bg-muted/30 hover:bg-muted/30">
          <TableCell colSpan={13} className="px-6 py-4">
            <div className="grid grid-cols-3 gap-6 text-sm">
              {/* Lease details */}
              <div className="space-y-2">
                <h4 className="font-semibold text-xs uppercase tracking-wider text-muted-foreground">
                  Lease Details
                </h4>
                <div className="space-y-1">
                  <DetailRow
                    label="Start Date"
                    value={formatDate(l.leaseStartDate)}
                  />
                  <DetailRow
                    label="End Date"
                    value={formatDate(l.leaseEndDate)}
                  />
                  <DetailRow label="Lease Type" value={l.leaseType || "---"} />
                  <DetailRow
                    label="Industry"
                    value={l.tenantIndustry || "---"}
                  />
                  <DetailRow
                    label="Credit Rating"
                    value={l.tenantCreditRating || "---"}
                  />
                </div>
              </div>

              {/* Contacts */}
              <div className="space-y-2">
                <h4 className="font-semibold text-xs uppercase tracking-wider text-muted-foreground">
                  Contacts
                </h4>
                <div className="space-y-2">
                  {/* Tenant-side people */}
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground/70 mb-1">
                      At {l.tenantName}
                    </p>
                    {l.tenantContacts.length === 0 ? (
                      <div
                        className="space-y-2"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex items-center gap-2 flex-wrap">
                          <Button
                            variant="outline"
                            size="sm"
                            className="gap-1"
                            onClick={() => setFindPeopleOpen((v) => !v)}
                          >
                            <Search className="size-3.5" />
                            {findPeopleOpen ? "Hide" : "Find People"}
                          </Button>
                          <a
                            href={`/contacts?view=company&search=${encodeURIComponent(l.tenantName)}`}
                            className="text-xs text-blue-600 hover:text-blue-500"
                          >
                            add manually →
                          </a>
                        </div>
                        {findPeopleOpen && (
                          <FindPeopleInlinePanel
                            company={l.tenantName}
                            city={l.propertyCity ?? undefined}
                            state={l.propertyState ?? undefined}
                            leaseId={l.id}
                            onClose={() => setFindPeopleOpen(false)}
                          />
                        )}
                      </div>
                    ) : (
                      <div className="space-y-1">
                        {l.tenantContacts.slice(0, 4).map((c) => (
                          <a
                            key={c.id}
                            href={`/contacts/${c.id}`}
                            onClick={(e) => e.stopPropagation()}
                            className="block text-xs hover:bg-muted/40 rounded px-1.5 py-1 -mx-1.5 transition-colors"
                          >
                            <span className="font-medium text-foreground">{c.name}</span>
                            {c.title && (
                              <span className="text-muted-foreground"> · {c.title}</span>
                            )}
                            {(c.email || c.phone) && (
                              <span className="text-muted-foreground/70 ml-1">
                                {c.email ? `· ${c.email}` : `· ${c.phone}`}
                              </span>
                            )}
                          </a>
                        ))}
                        {l.tenantContacts.length > 4 && (
                          <a
                            href={`/contacts?view=company&search=${encodeURIComponent(l.tenantName)}`}
                            onClick={(e) => e.stopPropagation()}
                            className="text-xs text-blue-600 hover:text-blue-500"
                          >
                            + {l.tenantContacts.length - 4} more →
                          </a>
                        )}
                      </div>
                    )}
                  </div>
                  {/* Landlord */}
                  {l.landlordContact && (
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground/70 mb-1">
                        Landlord
                      </p>
                      <a
                        href={`/contacts/${l.landlordContact.id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="block text-xs hover:bg-muted/40 rounded px-1.5 py-1 -mx-1.5 transition-colors"
                      >
                        <span className="font-medium text-foreground">
                          {l.landlordContact.name}
                        </span>
                      </a>
                    </div>
                  )}
                  {/* Options/Escalations as a small footnote — surfaced from
                      the source doc, useful but not the primary thing here */}
                  {(l.options || l.escalations) && (
                    <div className="pt-1 border-t border-border/40">
                      {l.options && (
                        <p className="text-[10px] text-muted-foreground mt-1">
                          <span className="font-medium">Options:</span> {l.options}
                        </p>
                      )}
                      {l.escalations && (
                        <p className="text-[10px] text-muted-foreground mt-1">
                          <span className="font-medium">Escalations:</span> {l.escalations}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Actions & Links */}
              <div className="space-y-2">
                <h4 className="font-semibold text-xs uppercase tracking-wider text-muted-foreground">
                  Links & Actions
                </h4>
                <div className="space-y-2">
                  {l.documentId && (
                    <a
                      href={`/library?doc=${l.documentId}`}
                      className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-500 transition-colors"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <ExternalLink className="size-3" />
                      View Source Document
                    </a>
                  )}
                  {l.dealId && (
                    <a
                      href={`/deals?id=${l.dealId}`}
                      className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-500 transition-colors"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <ExternalLink className="size-3" />
                      View Related Deal
                    </a>
                  )}
                  {l.sourceFile && (
                    <p className="text-xs text-muted-foreground">
                      Source: {l.sourceFile}
                    </p>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 mt-1"
                    onClick={(e) => {
                      e.stopPropagation();
                      onAddContact();
                    }}
                    disabled={isAddingContact}
                  >
                    <UserPlus className="size-3.5" />
                    {isAddingContact ? "Adding..." : "Add to Contacts"}
                  </Button>
                </div>
              </div>
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="text-xs font-medium">{value}</span>
    </div>
  );
}
