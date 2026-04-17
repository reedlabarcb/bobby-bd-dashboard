"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  Search,
  Plus,
  FileSpreadsheet,
  Trash2,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import type { Contact } from "@/lib/db/schema";

type SortField = "name" | "company" | "type" | "city" | "createdAt";
type SortDir = "asc" | "desc";

const TYPE_COLORS: Record<string, string> = {
  buyer: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  seller: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  broker: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  lender: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  other: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30",
};

const EMPTY_FORM = {
  name: "",
  email: "",
  phone: "",
  company: "",
  title: "",
  type: "other" as string,
  source: "",
  city: "",
  state: "",
  notes: "",
};

export function ContactsTable({
  contacts,
  autoOpenAdd,
}: {
  contacts: Contact[];
  autoOpenAdd?: boolean;
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [cityFilter, setCityFilter] = useState<string>("all");
  const [stateFilter, setStateFilter] = useState<string>("all");
  const [sortField, setSortField] = useState<SortField>("createdAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [addOpen, setAddOpen] = useState(autoOpenAdd ?? false);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Unique values for filter dropdowns
  const cities = useMemo(
    () =>
      Array.from(new Set(contacts.map((c) => c.city).filter(Boolean))).sort(),
    [contacts]
  );
  const states = useMemo(
    () =>
      Array.from(new Set(contacts.map((c) => c.state).filter(Boolean))).sort(),
    [contacts]
  );

  // Filter + sort
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    let list = contacts.filter((c) => {
      if (
        q &&
        !c.name.toLowerCase().includes(q) &&
        !(c.email || "").toLowerCase().includes(q) &&
        !(c.company || "").toLowerCase().includes(q)
      )
        return false;
      if (typeFilter !== "all" && c.type !== typeFilter) return false;
      if (cityFilter !== "all" && c.city !== cityFilter) return false;
      if (stateFilter !== "all" && c.state !== stateFilter) return false;
      return true;
    });

    list.sort((a, b) => {
      let aVal = "";
      let bVal = "";
      if (sortField === "createdAt") {
        aVal = a.createdAt || "";
        bVal = b.createdAt || "";
      } else {
        aVal = ((a as Record<string, unknown>)[sortField] as string) || "";
        bVal = ((b as Record<string, unknown>)[sortField] as string) || "";
      }
      const cmp = aVal.localeCompare(bVal);
      return sortDir === "asc" ? cmp : -cmp;
    });

    return list;
  }, [contacts, search, typeFilter, cityFilter, stateFilter, sortField, sortDir]);

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  }

  function SortIcon({ field }: { field: SortField }) {
    if (sortField !== field)
      return <ArrowUpDown className="ml-1 size-3 text-muted-foreground" />;
    return sortDir === "asc" ? (
      <ArrowUp className="ml-1 size-3" />
    ) : (
      <ArrowDown className="ml-1 size-3" />
    );
  }

  async function handleCreate() {
    if (!form.name.trim()) {
      toast.error("Name is required");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to create contact");
      }
      toast.success("Contact created");
      setForm(EMPTY_FORM);
      setAddOpen(false);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create contact");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteId) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/contacts/${deleteId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete");
      toast.success("Contact deleted");
      setDeleteId(null);
      router.refresh();
    } catch {
      toast.error("Failed to delete contact");
    } finally {
      setDeleting(false);
    }
  }

  function formatDate(d: string | null) {
    if (!d) return "-";
    try {
      return format(new Date(d), "MMM d, yyyy");
    } catch {
      return d;
    }
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Search name, email, company..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>

        <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v ?? "all")}>
          <SelectTrigger className="w-[130px]">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="buyer">Buyer</SelectItem>
            <SelectItem value="seller">Seller</SelectItem>
            <SelectItem value="broker">Broker</SelectItem>
            <SelectItem value="lender">Lender</SelectItem>
            <SelectItem value="other">Other</SelectItem>
          </SelectContent>
        </Select>

        {cities.length > 0 && (
          <Select value={cityFilter} onValueChange={(v) => setCityFilter(v ?? "all")}>
            <SelectTrigger className="w-[130px]">
              <SelectValue placeholder="City" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Cities</SelectItem>
              {cities.map((c) => (
                <SelectItem key={c!} value={c!}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {states.length > 0 && (
          <Select value={stateFilter} onValueChange={(v) => setStateFilter(v ?? "all")}>
            <SelectTrigger className="w-[120px]">
              <SelectValue placeholder="State" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All States</SelectItem>
              {states.map((s) => (
                <SelectItem key={s!} value={s!}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <div className="flex items-center gap-2 ml-auto">
          <Button
            variant="outline"
            size="sm"
            onClick={() => toast.info("Excel import coming soon")}
          >
            <FileSpreadsheet className="size-4 mr-1" />
            Import Excel
          </Button>
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger
              render={
                <Button size="sm">
                  <Plus className="size-4 mr-1" />
                  Add Contact
                </Button>
              }
            />
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>Add Contact</DialogTitle>
                <DialogDescription>
                  Create a new contact record.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-3 py-2">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="name">Name *</Label>
                    <Input
                      id="name"
                      value={form.name}
                      onChange={(e) =>
                        setForm({ ...form, name: e.target.value })
                      }
                      placeholder="John Smith"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="email">Email</Label>
                    <Input
                      id="email"
                      type="email"
                      value={form.email}
                      onChange={(e) =>
                        setForm({ ...form, email: e.target.value })
                      }
                      placeholder="john@example.com"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="phone">Phone</Label>
                    <Input
                      id="phone"
                      value={form.phone}
                      onChange={(e) =>
                        setForm({ ...form, phone: e.target.value })
                      }
                      placeholder="+1 (555) 000-0000"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="company">Company</Label>
                    <Input
                      id="company"
                      value={form.company}
                      onChange={(e) =>
                        setForm({ ...form, company: e.target.value })
                      }
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="title">Title</Label>
                    <Input
                      id="title"
                      value={form.title}
                      onChange={(e) =>
                        setForm({ ...form, title: e.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="type">Type</Label>
                    <Select
                      value={form.type}
                      onValueChange={(val) => setForm({ ...form, type: val ?? "other" })}
                    >
                      <SelectTrigger id="type" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="buyer">Buyer</SelectItem>
                        <SelectItem value="seller">Seller</SelectItem>
                        <SelectItem value="broker">Broker</SelectItem>
                        <SelectItem value="lender">Lender</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="city">City</Label>
                    <Input
                      id="city"
                      value={form.city}
                      onChange={(e) =>
                        setForm({ ...form, city: e.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="state">State</Label>
                    <Input
                      id="state"
                      value={form.state}
                      onChange={(e) =>
                        setForm({ ...form, state: e.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="source">Source</Label>
                    <Input
                      id="source"
                      value={form.source}
                      onChange={(e) =>
                        setForm({ ...form, source: e.target.value })
                      }
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="notes">Notes</Label>
                  <Textarea
                    id="notes"
                    value={form.notes}
                    onChange={(e) =>
                      setForm({ ...form, notes: e.target.value })
                    }
                    rows={2}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button onClick={handleCreate} disabled={saving}>
                  {saving ? "Creating..." : "Create Contact"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Results count */}
      <p className="text-xs text-muted-foreground">
        {filtered.length} contact{filtered.length !== 1 ? "s" : ""}
      </p>

      {/* Table */}
      <div className="rounded-lg border border-border/50 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/30 hover:bg-muted/30">
              <TableHead>
                <button
                  onClick={() => toggleSort("name")}
                  className="flex items-center font-medium"
                >
                  Name
                  <SortIcon field="name" />
                </button>
              </TableHead>
              <TableHead>Email</TableHead>
              <TableHead>
                <button
                  onClick={() => toggleSort("company")}
                  className="flex items-center font-medium"
                >
                  Company
                  <SortIcon field="company" />
                </button>
              </TableHead>
              <TableHead>
                <button
                  onClick={() => toggleSort("type")}
                  className="flex items-center font-medium"
                >
                  Type
                  <SortIcon field="type" />
                </button>
              </TableHead>
              <TableHead>
                <button
                  onClick={() => toggleSort("city")}
                  className="flex items-center font-medium"
                >
                  Location
                  <SortIcon field="city" />
                </button>
              </TableHead>
              <TableHead>
                <button
                  onClick={() => toggleSort("createdAt")}
                  className="flex items-center font-medium"
                >
                  Created
                  <SortIcon field="createdAt" />
                </button>
              </TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="text-center text-muted-foreground py-12"
                >
                  No contacts found
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((c) => (
                <TableRow
                  key={c.id}
                  className="cursor-pointer"
                  onClick={() => router.push(`/contacts/${c.id}`)}
                >
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {c.email || "-"}
                  </TableCell>
                  <TableCell>{c.company || "-"}</TableCell>
                  <TableCell>
                    <Badge
                      className={
                        TYPE_COLORS[c.type || "other"] || TYPE_COLORS.other
                      }
                    >
                      {c.type || "other"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {[c.city, c.state].filter(Boolean).join(", ") || "-"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(c.createdAt)}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteId(c.id);
                      }}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Delete confirmation dialog */}
      <Dialog
        open={deleteId !== null}
        onOpenChange={(open) => !open && setDeleteId(null)}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Contact</DialogTitle>
            <DialogDescription>
              This action cannot be undone. Are you sure you want to delete this
              contact?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteId(null)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
