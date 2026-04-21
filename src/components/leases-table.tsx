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
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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

type LeaseRow = {
  id: number;
  tenantName: string;
  tenantIndustry: string | null;
  tenantCreditRating: string | null;
  tenantId: number;
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
  red: "bg-red-500/20 text-red-400 border-red-500/30",
  amber: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  blue: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  gray: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30",
};

const URGENCY_ROW_BG: Record<string, string> = {
  red: "bg-red-950/20 border-l-2 border-l-red-500",
  amber: "border-l-2 border-l-amber-500",
  blue: "border-l-2 border-l-blue-500",
  gray: "",
};

const CONFIDENCE_BADGE: Record<string, string> = {
  high: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  medium: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  low: "bg-red-500/20 text-red-400 border-red-500/30",
};

const LEASE_TYPE_BADGE = "bg-violet-500/20 text-violet-400 border-violet-500/30";

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

    let list = leases.filter((l) => {
      // Tab / time horizon
      if (tab !== "all") {
        const horizon = parseInt(tab);
        if (l.monthsRemaining == null || l.monthsRemaining > horizon) return false;
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

  // Summary stats (computed from all leases, not filtered)
  const stats = useMemo(() => {
    let in6 = 0,
      in12 = 0,
      in24 = 0;
    for (const l of leases) {
      if (l.monthsRemaining != null) {
        if (l.monthsRemaining <= 6) in6++;
        if (l.monthsRemaining <= 12) in12++;
        if (l.monthsRemaining <= 24) in24++;
      }
    }
    return { in6, in12, in24, total: leases.length };
  }, [leases]);

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  }

  function SortIcon({ field }: { field: SortField }) {
    if (sortField !== field)
      return <ArrowUpDown className="ml-1 size-3 text-muted-foreground/50" />;
    return sortDir === "asc" ? (
      <ArrowUp className="ml-1 size-3 text-emerald-400" />
    ) : (
      <ArrowDown className="ml-1 size-3 text-emerald-400" />
    );
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
          <div className="flex items-center gap-2 text-xs text-red-400 font-medium uppercase tracking-wider">
            <AlertTriangle className="size-3.5" />
            Expiring 6 mo
          </div>
          <div className="text-2xl font-bold text-red-400 mt-1">
            {stats.in6}
          </div>
        </Card>
        <Card className="p-3 border-amber-500/30 bg-amber-950/10">
          <div className="flex items-center gap-2 text-xs text-amber-400 font-medium uppercase tracking-wider">
            <Clock className="size-3.5" />
            Expiring 12 mo
          </div>
          <div className="text-2xl font-bold text-amber-400 mt-1">
            {stats.in12}
          </div>
        </Card>
        <Card className="p-3 border-blue-500/30 bg-blue-950/10">
          <div className="flex items-center gap-2 text-xs text-blue-400 font-medium uppercase tracking-wider">
            <Clock className="size-3.5" />
            Expiring 24 mo
          </div>
          <div className="text-2xl font-bold text-blue-400 mt-1">
            {stats.in24}
          </div>
        </Card>
        <Card className="p-3 border-zinc-500/30">
          <div className="flex items-center gap-2 text-xs text-zinc-400 font-medium uppercase tracking-wider">
            <Building2 className="size-3.5" />
            Total Tracked
          </div>
          <div className="text-2xl font-bold text-zinc-300 mt-1">
            {stats.total}
          </div>
        </Card>
      </div>

      {/* Time horizon tabs */}
      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v ?? "6")}
      >
        <TabsList variant="line">
          <TabsTrigger value="6">Expiring 6 mo</TabsTrigger>
          <TabsTrigger value="12">Expiring 12 mo</TabsTrigger>
          <TabsTrigger value="24">Expiring 24 mo</TabsTrigger>
          <TabsTrigger value="all">All Leases</TabsTrigger>
        </TabsList>
      </Tabs>

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
                      <SortIcon field="tenantName" />
                    </button>
                  </TableHead>
                  <TableHead>
                    <button
                      onClick={() => toggleSort("propertyName")}
                      className="flex items-center font-medium"
                    >
                      Property
                      <SortIcon field="propertyName" />
                    </button>
                  </TableHead>
                  <TableHead>
                    <button
                      onClick={() => toggleSort("propertyCity")}
                      className="flex items-center font-medium"
                    >
                      Location
                      <SortIcon field="propertyCity" />
                    </button>
                  </TableHead>
                  <TableHead>Suite/Unit</TableHead>
                  <TableHead className="text-right">
                    <button
                      onClick={() => toggleSort("squareFeet")}
                      className="flex items-center justify-end font-medium ml-auto"
                    >
                      SF
                      <SortIcon field="squareFeet" />
                    </button>
                  </TableHead>
                  <TableHead>
                    <button
                      onClick={() => toggleSort("leaseEndDate")}
                      className="flex items-center font-medium"
                    >
                      Lease End
                      <SortIcon field="leaseEndDate" />
                    </button>
                  </TableHead>
                  <TableHead>
                    <button
                      onClick={() => toggleSort("monthsRemaining")}
                      className="flex items-center font-medium"
                    >
                      Mo. Left
                      <SortIcon field="monthsRemaining" />
                    </button>
                  </TableHead>
                  <TableHead className="text-right">
                    <button
                      onClick={() => toggleSort("rentPsf")}
                      className="flex items-center justify-end font-medium ml-auto"
                    >
                      Rent PSF
                      <SortIcon field="rentPsf" />
                    </button>
                  </TableHead>
                  <TableHead className="text-right">
                    <button
                      onClick={() => toggleSort("annualRent")}
                      className="flex items-center justify-end font-medium ml-auto"
                    >
                      Annual Rent
                      <SortIcon field="annualRent" />
                    </button>
                  </TableHead>
                  <TableHead>
                    <button
                      onClick={() => toggleSort("leaseType")}
                      className="flex items-center font-medium"
                    >
                      Type
                      <SortIcon field="leaseType" />
                    </button>
                  </TableHead>
                  <TableHead>
                    <button
                      onClick={() => toggleSort("confidence")}
                      className="flex items-center font-medium"
                    >
                      Conf.
                      <SortIcon field="confidence" />
                    </button>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={12}
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
          {l.tenantName}
        </TableCell>
        <TableCell className="text-muted-foreground">
          {l.propertyName || "---"}
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
      </TableRow>

      {/* Expanded detail row */}
      {isExpanded && (
        <TableRow className="bg-muted/30 hover:bg-muted/30">
          <TableCell colSpan={12} className="px-6 py-4">
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

              {/* Options & Escalations */}
              <div className="space-y-2">
                <h4 className="font-semibold text-xs uppercase tracking-wider text-muted-foreground">
                  Options & Escalations
                </h4>
                <div className="space-y-1">
                  <div>
                    <span className="text-muted-foreground text-xs">
                      Options:
                    </span>
                    <p className="text-xs mt-0.5">
                      {l.options || "None specified"}
                    </p>
                  </div>
                  <div>
                    <span className="text-muted-foreground text-xs">
                      Escalations:
                    </span>
                    <p className="text-xs mt-0.5">
                      {l.escalations || "None specified"}
                    </p>
                  </div>
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
                      className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 transition-colors"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <ExternalLink className="size-3" />
                      View Source Document
                    </a>
                  )}
                  {l.dealId && (
                    <a
                      href={`/deals?id=${l.dealId}`}
                      className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 transition-colors"
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
