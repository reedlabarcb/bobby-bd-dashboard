"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { format, formatDistanceToNow, parseISO, isAfter, isBefore, startOfDay } from "date-fns";
import { Phone, Mail, Calendar, FileText, Plus, Search, Filter } from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type ActivityItem = {
  id: number;
  type: string;
  subject: string | null;
  body: string | null;
  date: string | null;
  contactId: number | null;
  dealId: number | null;
  contactName: string | null;
  dealName: string | null;
};

type ContactOption = { id: number; name: string };
type DealOption = { id: number; name: string };

const typeConfig: Record<string, { icon: typeof Phone; color: string; bg: string; badge: string }> = {
  call: { icon: Phone, color: "text-emerald-400", bg: "bg-emerald-400/10", badge: "bg-emerald-400/15 text-emerald-400 border-emerald-400/20" },
  email: { icon: Mail, color: "text-blue-400", bg: "bg-blue-400/10", badge: "bg-blue-400/15 text-blue-400 border-blue-400/20" },
  meeting: { icon: Calendar, color: "text-violet-400", bg: "bg-violet-400/10", badge: "bg-violet-400/15 text-violet-400 border-violet-400/20" },
  note: { icon: FileText, color: "text-zinc-400", bg: "bg-zinc-400/10", badge: "bg-zinc-400/15 text-zinc-400 border-zinc-400/20" },
};

export function ActivitiesFeed({
  activities,
  contacts,
  deals,
}: {
  activities: ActivityItem[];
  contacts: ContactOption[];
  deals: DealOption[];
}) {
  const router = useRouter();
  const [typeFilter, setTypeFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);

  // Form state
  const [formType, setFormType] = useState<string>("call");
  const [formSubject, setFormSubject] = useState("");
  const [formBody, setFormBody] = useState("");
  const [formContactId, setFormContactId] = useState<string>("");
  const [formDealId, setFormDealId] = useState<string>("");
  const [formDate, setFormDate] = useState(new Date().toISOString().slice(0, 16));
  const [submitting, setSubmitting] = useState(false);

  const filtered = activities.filter((a) => {
    if (typeFilter !== "all" && a.type !== typeFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      const matchSubject = a.subject?.toLowerCase().includes(q);
      const matchBody = a.body?.toLowerCase().includes(q);
      const matchContact = a.contactName?.toLowerCase().includes(q);
      const matchDeal = a.dealName?.toLowerCase().includes(q);
      if (!matchSubject && !matchBody && !matchContact && !matchDeal) return false;
    }
    if (dateFrom && a.date) {
      if (isBefore(parseISO(a.date), startOfDay(parseISO(dateFrom)))) return false;
    }
    if (dateTo && a.date) {
      const end = new Date(dateTo);
      end.setDate(end.getDate() + 1);
      if (isAfter(parseISO(a.date), end)) return false;
    }
    return true;
  });

  async function handleSubmit() {
    if (!formType) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/activities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: formType,
          subject: formSubject || null,
          body: formBody || null,
          contactId: formContactId && formContactId !== "none" ? Number(formContactId) : null,
          dealId: formDealId && formDealId !== "none" ? Number(formDealId) : null,
          date: formDate ? new Date(formDate).toISOString().replace("T", " ").split(".")[0] : undefined,
        }),
      });
      if (!res.ok) throw new Error("Failed to create activity");
      toast.success("Activity logged");
      setDialogOpen(false);
      resetForm();
      router.refresh();
    } catch {
      toast.error("Failed to create activity");
    } finally {
      setSubmitting(false);
    }
  }

  function resetForm() {
    setFormType("call");
    setFormSubject("");
    setFormBody("");
    setFormContactId("");
    setFormDealId("");
    setFormDate(new Date().toISOString().slice(0, 16));
  }

  return (
    <div className="space-y-6">
      {/* Filter Bar */}
      <Card className="border-0 bg-card">
        <CardContent className="pt-4 pb-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v ?? "all")}>
                <SelectTrigger className="w-[140px] h-9 bg-zinc-800 border-zinc-700">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="call">Calls</SelectItem>
                  <SelectItem value="email">Emails</SelectItem>
                  <SelectItem value="meeting">Meetings</SelectItem>
                  <SelectItem value="note">Notes</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search subject, body, contact, deal..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 h-9 bg-zinc-800 border-zinc-700"
              />
            </div>

            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>From</span>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="h-9 w-[140px] bg-zinc-800 border-zinc-700 text-xs"
              />
              <span>To</span>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="h-9 w-[140px] bg-zinc-800 border-zinc-700 text-xs"
              />
            </div>

            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger
                render={
                  <Button size="sm" className="bg-blue-600 hover:bg-blue-500 text-white h-9">
                    <Plus className="h-4 w-4 mr-1" />
                    Add Activity
                  </Button>
                }
              />
              <DialogContent className="bg-zinc-900 border-zinc-800 max-w-md">
                <DialogHeader>
                  <DialogTitle>Log Activity</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 pt-2">
                  <div className="space-y-2">
                    <Label>Type</Label>
                    <Select value={formType} onValueChange={(v) => setFormType(v ?? "call")}>
                      <SelectTrigger className="bg-zinc-800 border-zinc-700">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="call">Call</SelectItem>
                        <SelectItem value="email">Email</SelectItem>
                        <SelectItem value="meeting">Meeting</SelectItem>
                        <SelectItem value="note">Note</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Subject</Label>
                    <Input
                      value={formSubject}
                      onChange={(e) => setFormSubject(e.target.value)}
                      placeholder="Brief description"
                      className="bg-zinc-800 border-zinc-700"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Body</Label>
                    <Textarea
                      value={formBody}
                      onChange={(e) => setFormBody(e.target.value)}
                      placeholder="Details..."
                      rows={3}
                      className="bg-zinc-800 border-zinc-700 resize-none"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label>Contact</Label>
                      <Select value={formContactId} onValueChange={(v) => setFormContactId(v ?? "")}>
                        <SelectTrigger className="bg-zinc-800 border-zinc-700">
                          <SelectValue placeholder="None" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">None</SelectItem>
                          {contacts.map((c) => (
                            <SelectItem key={c.id} value={String(c.id)}>
                              {c.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label>Deal</Label>
                      <Select value={formDealId} onValueChange={(v) => setFormDealId(v ?? "")}>
                        <SelectTrigger className="bg-zinc-800 border-zinc-700">
                          <SelectValue placeholder="None" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">None</SelectItem>
                          {deals.map((d) => (
                            <SelectItem key={d.id} value={String(d.id)}>
                              {d.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Date & Time</Label>
                    <Input
                      type="datetime-local"
                      value={formDate}
                      onChange={(e) => setFormDate(e.target.value)}
                      className="bg-zinc-800 border-zinc-700"
                    />
                  </div>

                  <Button
                    onClick={handleSubmit}
                    disabled={submitting}
                    className="w-full bg-blue-600 hover:bg-blue-500 text-white"
                  >
                    {submitting ? "Saving..." : "Log Activity"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </CardContent>
      </Card>

      {/* Results count */}
      <p className="text-xs text-muted-foreground">
        {filtered.length} {filtered.length === 1 ? "activity" : "activities"}
        {typeFilter !== "all" || search || dateFrom || dateTo ? " (filtered)" : ""}
      </p>

      {/* Timeline */}
      {filtered.length === 0 ? (
        <Card className="border-0 bg-card">
          <CardContent className="py-12 text-center">
            <p className="text-sm text-muted-foreground">
              No activities found. Log your first activity to get started.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="relative pl-8">
          {/* Vertical timeline line */}
          <div className="absolute left-3 top-2 bottom-2 w-px bg-zinc-800" />

          <div className="space-y-3">
            {filtered.map((a) => {
              const config = typeConfig[a.type] ?? typeConfig.note;
              const Icon = config.icon;

              return (
                <div key={a.id} className="relative">
                  {/* Timeline dot */}
                  <div
                    className={`absolute -left-8 top-4 flex h-6 w-6 items-center justify-center rounded-full ${config.bg} ring-4 ring-zinc-950`}
                  >
                    <Icon className={`h-3 w-3 ${config.color}`} />
                  </div>

                  <Card className="border-0 bg-card hover:bg-card transition-colors">
                    <CardContent className="py-4 px-5">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm text-zinc-100">
                              {a.subject || `${a.type.charAt(0).toUpperCase() + a.type.slice(1)} logged`}
                            </span>
                            <Badge
                              variant="outline"
                              className={`text-[10px] uppercase tracking-wider border ${config.badge}`}
                            >
                              {a.type}
                            </Badge>
                          </div>

                          {a.body && (
                            <p className="text-xs text-muted-foreground leading-relaxed">
                              {a.body.length > 200 ? a.body.slice(0, 200) + "..." : a.body}
                            </p>
                          )}

                          <div className="flex items-center gap-3 pt-1">
                            {a.contactName && a.contactId && (
                              <Link
                                href={`/contacts/${a.contactId}`}
                                className="text-xs text-blue-400 hover:text-blue-300 hover:underline"
                              >
                                {a.contactName}
                              </Link>
                            )}
                            {a.contactName && a.dealName && (
                              <span className="text-xs text-zinc-600">/</span>
                            )}
                            {a.dealName && a.dealId && (
                              <Link
                                href={`/deals/${a.dealId}`}
                                className="text-xs text-emerald-400 hover:text-emerald-300 hover:underline"
                              >
                                {a.dealName}
                              </Link>
                            )}
                          </div>
                        </div>

                        <div className="shrink-0 text-right">
                          {a.date && (
                            <>
                              <p className="text-xs text-muted-foreground">
                                {formatDistanceToNow(parseISO(a.date), { addSuffix: true })}
                              </p>
                              <p className="text-[10px] text-zinc-600 mt-0.5">
                                {format(parseISO(a.date), "MMM d, yyyy h:mm a")}
                              </p>
                            </>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
