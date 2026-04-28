"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import {
  Search,
  ChevronDown,
  ChevronRight,
  Plus,
  Building2,
  Mail,
  Phone,
  ExternalLink,
  Users,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

import type { Contact } from "@/lib/db/schema";

const TYPE_COLORS: Record<string, string> = {
  buyer: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  seller: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  broker: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  lender: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  landlord: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
  other: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30",
};

const NO_COMPANY = "(No company)";

type CompanyGroup = {
  key: string;             // canonical group key (lowercase trimmed)
  display: string;         // human display name
  profile: Contact | null; // landlord-type entry that IS this company
  people: Contact[];       // non-landlord contacts at this company
};

export type SeedCompany = {
  name: string;
  industry?: string | null;
  source: "tenant" | "landlord";
};

function buildGroups(
  contacts: Contact[],
  seeds: SeedCompany[] = []
): CompanyGroup[] {
  const map = new Map<string, CompanyGroup>();
  function ensure(key: string, display: string): CompanyGroup {
    let g = map.get(key);
    if (!g) {
      g = { key, display, profile: null, people: [] };
      map.set(key, g);
    }
    return g;
  }

  // Seed empty groups for every company referenced from the leases / buildings
  // side, so a company can appear in the list even when no contacts exist yet.
  // These are placeholder groups that get populated below if any contact does
  // reference the same company.
  for (const s of seeds) {
    if (!s.name || !s.name.trim()) continue;
    ensure(s.name.trim().toLowerCase(), s.name.trim());
  }

  for (const c of contacts) {
    if (c.type === "landlord") {
      // The landlord's name IS the company name. Everything keys off that.
      const display = c.name.trim();
      const key = display.toLowerCase();
      const g = ensure(key, display);
      // First landlord wins as profile; later duplicates (shouldn't happen
      // after audit-fixes) become "people" so they're not lost.
      if (!g.profile) g.profile = c;
      else g.people.push(c);
    } else {
      const company = c.company?.trim();
      if (!company) {
        const g = ensure(NO_COMPANY.toLowerCase(), NO_COMPANY);
        g.people.push(c);
      } else {
        const key = company.toLowerCase();
        const g = ensure(key, company);
        g.people.push(c);
      }
    }
  }

  // Sort: companies with people first (descending by people count), then alphabetical.
  return Array.from(map.values()).sort((a, b) => {
    if (a.people.length !== b.people.length) {
      return b.people.length - a.people.length;
    }
    return a.display.localeCompare(b.display);
  });
}

export function ContactsByCompany({
  contacts,
  seedCompanies = [],
}: {
  contacts: Contact[];
  seedCompanies?: SeedCompany[];
}) {
  const router = useRouter();
  const params = useSearchParams();
  const initialSearch = params.get("search") ?? "";
  const [search, setSearch] = useState(initialSearch);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // If we deep-linked with ?search=<tenant>, auto-expand any company that
  // matches the search term so the user lands on an open list.
  // Defer using groups until they're built — see effect below.

  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [addForm, setAddForm] = useState({ name: "", title: "", email: "", phone: "" });
  const [saving, setSaving] = useState(false);

  const groups = useMemo(
    () => buildGroups(contacts, seedCompanies),
    [contacts, seedCompanies]
  );

  useEffect(() => {
    if (!initialSearch) return;
    const q = initialSearch.toLowerCase();
    const matching = groups
      .filter((g) => g.display.toLowerCase().includes(q))
      .map((g) => g.key);
    if (matching.length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setExpanded(new Set(matching));
    }
  }, [initialSearch, groups]);

  const filteredGroups = useMemo(() => {
    if (!search.trim()) return groups;
    const q = search.toLowerCase();
    return groups
      .map((g) => {
        const companyMatches = g.display.toLowerCase().includes(q);
        const peopleMatches = g.people.filter((p) =>
          [p.name, p.title, p.email, p.company].some((v) =>
            (v || "").toLowerCase().includes(q)
          )
        );
        if (companyMatches) return g; // show all people if the company name matched
        if (peopleMatches.length > 0) return { ...g, people: peopleMatches };
        return null;
      })
      .filter((g): g is CompanyGroup => g !== null);
  }, [groups, search]);

  function toggle(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function startAdd(group: CompanyGroup) {
    setAddingTo(group.key);
    setAddForm({ name: "", title: "", email: "", phone: "" });
    setExpanded((prev) => new Set(prev).add(group.key));
  }

  async function submitAdd(group: CompanyGroup) {
    if (!addForm.name.trim()) {
      toast.error("Name is required");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: addForm.name.trim(),
          title: addForm.title.trim() || null,
          email: addForm.email.trim() || null,
          phone: addForm.phone.trim() || null,
          company: group.display === NO_COMPANY ? null : group.display,
          type: "other",
          source: "Manual add (Contacts page)",
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      toast.success(`Added to ${group.display}`);
      setAddingTo(null);
      setAddForm({ name: "", title: "", email: "", phone: "" });
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add person");
    } finally {
      setSaving(false);
    }
  }

  // Quick stats for the header
  const stats = useMemo(() => {
    const totalCompanies = groups.length;
    const totalPeople = groups.reduce((acc, g) => acc + g.people.length, 0);
    const peopleWithEmail = groups.reduce(
      (acc, g) => acc + g.people.filter((p) => p.email).length,
      0
    );
    return { totalCompanies, totalPeople, peopleWithEmail };
  }, [groups]);

  return (
    <div className="space-y-4">
      {/* Stat cards */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="p-3 border-zinc-500/30">
          <div className="flex items-center gap-2 text-xs text-zinc-400 font-medium uppercase tracking-wider">
            <Building2 className="size-3.5" />
            Companies
          </div>
          <div className="text-2xl font-bold text-zinc-300 mt-1">{stats.totalCompanies}</div>
        </Card>
        <Card className="p-3 border-zinc-500/30">
          <div className="flex items-center gap-2 text-xs text-zinc-400 font-medium uppercase tracking-wider">
            <Users className="size-3.5" />
            People
          </div>
          <div className="text-2xl font-bold text-zinc-300 mt-1">{stats.totalPeople}</div>
        </Card>
        <Card className="p-3 border-emerald-500/30 bg-emerald-950/10">
          <div className="flex items-center gap-2 text-xs text-emerald-400 font-medium uppercase tracking-wider">
            <Mail className="size-3.5" />
            With Email
          </div>
          <div className="text-2xl font-bold text-emerald-400 mt-1">{stats.peopleWithEmail}</div>
        </Card>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by company, person, title, email..."
          className="pl-9 h-9"
        />
      </div>

      <div className="text-xs text-muted-foreground">
        Showing {filteredGroups.length} of {groups.length} companies
      </div>

      {/* Companies list */}
      <div className="space-y-2">
        {filteredGroups.length === 0 ? (
          <Card className="p-8 text-center text-muted-foreground">
            No companies match your search.
          </Card>
        ) : (
          filteredGroups.map((group) => {
            const isExpanded = expanded.has(group.key);
            const isAdding = addingTo === group.key;
            const headerClass = group.profile?.type === "landlord"
              ? "border-l-4 border-l-cyan-500/40"
              : "";

            return (
              <Card key={group.key} className={`overflow-hidden ${headerClass}`}>
                {/* Company header row */}
                <div
                  className="flex items-center gap-3 p-3 cursor-pointer hover:bg-muted/30 transition-colors"
                  onClick={() => toggle(group.key)}
                >
                  {isExpanded ? (
                    <ChevronDown className="size-4 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="size-4 text-muted-foreground" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-foreground truncate">
                        {group.display}
                      </span>
                      {group.profile && (
                        <Badge
                          className={
                            TYPE_COLORS[group.profile.type || "other"] ||
                            TYPE_COLORS.other
                          }
                        >
                          {group.profile.type}
                        </Badge>
                      )}
                    </div>
                    {group.profile && (group.profile.city || group.profile.state) && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {[group.profile.city, group.profile.state].filter(Boolean).join(", ")}
                      </p>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                    {group.people.length} {group.people.length === 1 ? "person" : "people"}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="gap-1"
                    onClick={(e) => {
                      e.stopPropagation();
                      startAdd(group);
                    }}
                  >
                    <Plus className="size-3.5" />
                    Add Person
                  </Button>
                </div>

                {/* Expanded panel */}
                {isExpanded && (
                  <div className="border-t border-border/50 bg-muted/10">
                    {/* Add person form */}
                    {isAdding && (
                      <div className="p-3 border-b border-border/50 space-y-2 bg-background/50">
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                            New person at {group.display}
                          </p>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => setAddingTo(null)}
                          >
                            <X className="size-4" />
                          </Button>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <Input
                            placeholder="Name *"
                            value={addForm.name}
                            onChange={(e) => setAddForm({ ...addForm, name: e.target.value })}
                            autoFocus
                          />
                          <Input
                            placeholder="Title"
                            value={addForm.title}
                            onChange={(e) => setAddForm({ ...addForm, title: e.target.value })}
                          />
                          <Input
                            placeholder="Email"
                            type="email"
                            value={addForm.email}
                            onChange={(e) => setAddForm({ ...addForm, email: e.target.value })}
                          />
                          <Input
                            placeholder="Phone"
                            value={addForm.phone}
                            onChange={(e) => setAddForm({ ...addForm, phone: e.target.value })}
                          />
                        </div>
                        <div className="flex justify-end gap-2 pt-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setAddingTo(null)}
                            disabled={saving}
                          >
                            Cancel
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => submitAdd(group)}
                            disabled={saving || !addForm.name.trim()}
                          >
                            {saving ? "Saving..." : "Add"}
                          </Button>
                        </div>
                      </div>
                    )}

                    {/* People list */}
                    {group.people.length === 0 ? (
                      <div className="p-6 text-center text-xs text-muted-foreground">
                        No people at this company yet.
                        {!isAdding && (
                          <button
                            type="button"
                            onClick={() => startAdd(group)}
                            className="ml-1 text-blue-400 hover:text-blue-300 underline"
                          >
                            Add the first one →
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="divide-y divide-border/50">
                        {group.people.map((p) => (
                          <PersonRow key={p.id} person={p} />
                        ))}
                      </div>
                    )}

                    {/* Profile-only metadata, if a landlord row exists */}
                    {group.profile && group.profile.notes && (
                      <div className="p-3 border-t border-border/50 bg-background/30">
                        <p className="text-xs text-muted-foreground whitespace-pre-wrap">
                          <span className="font-medium text-foreground">About: </span>
                          {group.profile.notes}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}

function PersonRow({ person: p }: { person: Contact }) {
  const subtitle = [p.title, p.businessType].filter(Boolean).join(" · ");

  return (
    <Link
      href={`/contacts/${p.id}`}
      className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors"
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground truncate">{p.name}</span>
          {p.type && p.type !== "other" && (
            <Badge className={`${TYPE_COLORS[p.type] || TYPE_COLORS.other} text-[10px]`}>
              {p.type}
            </Badge>
          )}
        </div>
        {subtitle && (
          <p className="text-xs text-muted-foreground mt-0.5 truncate">{subtitle}</p>
        )}
      </div>
      <div className="flex items-center gap-3 text-xs text-muted-foreground shrink-0">
        {p.email ? (
          <span className="flex items-center gap-1 max-w-[180px] truncate">
            <Mail className="size-3 shrink-0" />
            <span className="truncate">{p.email}</span>
          </span>
        ) : (
          <span className="text-amber-400/70 italic">no email</span>
        )}
        {p.phone && (
          <span className="flex items-center gap-1">
            <Phone className="size-3" />
            {p.phone}
          </span>
        )}
        <ExternalLink className="size-3.5 text-muted-foreground/50 shrink-0" />
      </div>
    </Link>
  );
}
