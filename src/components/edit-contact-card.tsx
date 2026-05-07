"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { toast } from "sonner";
import {
  Mail,
  Phone,
  Building2,
  MapPin,
  Briefcase,
  Calendar,
  Pencil,
  Save,
  X,
  Trash2,
  Smartphone,
  PhoneCall,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const TYPE_COLORS: Record<string, string> = {
  buyer: "bg-emerald-500/20 text-emerald-600 border-emerald-500/30",
  seller: "bg-blue-500/20 text-blue-600 border-blue-500/30",
  broker: "bg-amber-500/20 text-amber-600 border-amber-500/30",
  lender: "bg-purple-500/20 text-purple-600 border-purple-500/30",
  landlord: "bg-cyan-500/20 text-cyan-600 border-cyan-500/30",
  other: "bg-zinc-500/20 text-slate-500 border-zinc-500/30",
};

const TYPE_OPTIONS = ["buyer", "seller", "broker", "lender", "landlord", "other"] as const;

export type ContactRecord = {
  id: number;
  name: string;
  type: string | null;
  title: string | null;
  company: string | null;
  businessType: string | null;
  email: string | null;
  phone: string | null;
  directPhone: string | null;
  mobilePhone: string | null;
  city: string | null;
  state: string | null;
  source: string | null;
  sourceFile: string | null;
  tags: string | null; // JSON-stringified array
  notes: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

function formatDate(d: string | null) {
  if (!d) return "-";
  try {
    return format(new Date(d), "MMM d, yyyy");
  } catch {
    return d;
  }
}

function parseTags(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

type FormState = {
  name: string;
  type: string;
  title: string;
  company: string;
  businessType: string;
  email: string;
  phone: string;
  directPhone: string;
  mobilePhone: string;
  city: string;
  state: string;
  tagsCsv: string;
  notes: string;
};

function toFormState(c: ContactRecord): FormState {
  return {
    name: c.name ?? "",
    type: c.type ?? "other",
    title: c.title ?? "",
    company: c.company ?? "",
    businessType: c.businessType ?? "",
    email: c.email ?? "",
    phone: c.phone ?? "",
    directPhone: c.directPhone ?? "",
    mobilePhone: c.mobilePhone ?? "",
    city: c.city ?? "",
    state: c.state ?? "",
    tagsCsv: parseTags(c.tags).join(", "),
    notes: c.notes ?? "",
  };
}

function diff(form: FormState): Record<string, unknown> {
  // Send everything; the API does a full upsert. Empty strings → null so we
  // don't overwrite NULLs with empty strings.
  const out: Record<string, unknown> = {
    name: form.name.trim(),
    type: form.type,
    title: form.title.trim() || null,
    company: form.company.trim() || null,
    businessType: form.businessType.trim() || null,
    email: form.email.trim() || null,
    phone: form.phone.trim() || null,
    directPhone: form.directPhone.trim() || null,
    mobilePhone: form.mobilePhone.trim() || null,
    city: form.city.trim() || null,
    state: form.state.trim() || null,
    notes: form.notes.trim() || null,
  };
  const tags = form.tagsCsv
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  out.tags = tags.length > 0 ? tags : null;
  return out;
}

export function EditContactCard({ contact }: { contact: ContactRecord }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<FormState>(() => toFormState(contact));
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const tags = parseTags(contact.tags);
  const location = [contact.city, contact.state].filter(Boolean).join(", ");

  function startEdit() {
    setForm(toFormState(contact));
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
  }

  async function save() {
    if (!form.name.trim()) {
      toast.error("Name is required");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/contacts/${contact.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(diff(form)),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      toast.success("Contact updated");
      setEditing(false);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function del() {
    if (
      !confirm(
        `Delete ${contact.name}? This cannot be undone. Activities linked to this contact will keep the contact name in their history but lose the link.`
      )
    )
      return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/contacts/${contact.id}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      toast.success("Contact deleted");
      window.location.assign("/contacts");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete");
      setDeleting(false);
    }
  }

  // ---- Render ----

  if (editing) {
    return (
      <Card className="lg:col-span-1">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle>Edit Contact</CardTitle>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={cancelEdit} disabled={saving}>
              <X className="size-4" />
            </Button>
            <Button size="sm" onClick={save} disabled={saving} className="gap-1">
              <Save className="size-4" />
              {saving ? "Saving..." : "Save"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <Field label="Name *">
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Full name"
            />
          </Field>
          <Field label="Type">
            <Select
              value={form.type}
              onValueChange={(v) => setForm({ ...form, type: v ?? "other" })}
            >
              <SelectTrigger size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TYPE_OPTIONS.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Title">
              <Input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </Field>
            <Field label="Company">
              <Input
                value={form.company}
                onChange={(e) => setForm({ ...form, company: e.target.value })}
              />
            </Field>
          </div>
          <Field label="Industry / Business Type">
            <Input
              value={form.businessType}
              onChange={(e) => setForm({ ...form, businessType: e.target.value })}
            />
          </Field>
          <Field label="Email">
            <Input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </Field>
          <div className="grid grid-cols-3 gap-2">
            <Field label="Phone">
              <Input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </Field>
            <Field label="Direct">
              <Input
                value={form.directPhone}
                onChange={(e) => setForm({ ...form, directPhone: e.target.value })}
              />
            </Field>
            <Field label="Mobile">
              <Input
                value={form.mobilePhone}
                onChange={(e) => setForm({ ...form, mobilePhone: e.target.value })}
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="City">
              <Input
                value={form.city}
                onChange={(e) => setForm({ ...form, city: e.target.value })}
              />
            </Field>
            <Field label="State">
              <Input
                value={form.state}
                onChange={(e) => setForm({ ...form, state: e.target.value })}
                maxLength={20}
              />
            </Field>
          </div>
          <Field label="Tags (comma separated)">
            <Input
              value={form.tagsCsv}
              onChange={(e) => setForm({ ...form, tagsCsv: e.target.value })}
              placeholder="e.g. tenant-contact, decision-maker"
            />
          </Field>
          <Field label="Notes">
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={5}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-blue-500 resize-y"
            />
          </Field>

          <Separator />

          <div className="flex justify-between items-center pt-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={del}
              disabled={deleting}
              className="text-red-600 hover:text-red-300 hover:bg-red-950/30 gap-1"
            >
              <Trash2 className="size-4" />
              {deleting ? "Deleting..." : "Delete contact"}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Read-only view
  return (
    <Card className="lg:col-span-1">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle>Contact Info</CardTitle>
        <Button variant="ghost" size="sm" onClick={startEdit} className="gap-1">
          <Pencil className="size-3.5" />
          Edit
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2">
          <Badge className={TYPE_COLORS[contact.type || "other"] || TYPE_COLORS.other}>
            {contact.type || "other"}
          </Badge>
          {tags.map((t) => (
            <Badge key={t} variant="outline" className="text-[11px]">
              {t}
            </Badge>
          ))}
        </div>

        {contact.email && (
          <Row icon={<Mail className="size-4" />}>
            <a
              href={`mailto:${contact.email}`}
              className="text-sm text-blue-600 hover:underline truncate"
            >
              {contact.email}
            </a>
          </Row>
        )}
        {contact.phone && (
          <Row icon={<Phone className="size-4" />}>
            <span className="text-sm">{contact.phone}</span>
          </Row>
        )}
        {contact.directPhone && (
          <Row icon={<PhoneCall className="size-4" />}>
            <span className="text-sm">{contact.directPhone} <span className="text-xs text-muted-foreground">(direct)</span></span>
          </Row>
        )}
        {contact.mobilePhone && (
          <Row icon={<Smartphone className="size-4" />}>
            <span className="text-sm">{contact.mobilePhone} <span className="text-xs text-muted-foreground">(mobile)</span></span>
          </Row>
        )}
        {contact.company && (
          <Row icon={<Building2 className="size-4" />}>
            <span className="text-sm">{contact.company}</span>
          </Row>
        )}
        {contact.title && (
          <Row icon={<Briefcase className="size-4" />}>
            <span className="text-sm">{contact.title}</span>
          </Row>
        )}
        {contact.businessType && (
          <Row icon={<Briefcase className="size-4" />}>
            <span className="text-sm text-muted-foreground">
              Industry: {contact.businessType}
            </span>
          </Row>
        )}
        {location && (
          <Row icon={<MapPin className="size-4" />}>
            <span className="text-sm">{location}</span>
          </Row>
        )}
        {contact.source && (
          <Row icon={<Calendar className="size-4" />}>
            <span className="text-sm text-muted-foreground">
              Source: {contact.source}
            </span>
          </Row>
        )}

        <Separator />

        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">
            Created {formatDate(contact.createdAt)}
          </p>
          {contact.updatedAt && contact.updatedAt !== contact.createdAt && (
            <p className="text-xs text-muted-foreground">
              Updated {formatDate(contact.updatedAt)}
            </p>
          )}
        </div>

        {contact.notes && (
          <>
            <Separator />
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Notes</p>
              <NotesWithLinks text={contact.notes} />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1 block">
        {label}
      </label>
      {children}
    </div>
  );
}

function Row({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-muted-foreground shrink-0">{icon}</span>
      {children}
    </div>
  );
}

// Render notes with URLs (esp. LinkedIn) as clickable links. Splits the text
// on URLs and rebuilds with anchor tags. Anchors open in a new tab.
const URL_RE = /(https?:\/\/[^\s)<>"]+)/g;
function NotesWithLinks({ text }: { text: string }) {
  const parts = text.split(URL_RE);
  return (
    <p className="text-sm whitespace-pre-wrap break-words">
      {parts.map((part, i) => {
        if (URL_RE.test(part)) {
          // Reset regex state since /g sticky stuff
          URL_RE.lastIndex = 0;
          const isLinkedIn = /linkedin\.com/i.test(part);
          return (
            <a
              key={i}
              href={part}
              target="_blank"
              rel="noopener noreferrer"
              className={`underline ${
                isLinkedIn ? "text-[#0A66C2] hover:text-[#0A66C2]/80" : "text-blue-600 hover:text-blue-500"
              }`}
            >
              {isLinkedIn ? "LinkedIn profile" : part}
            </a>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </p>
  );
}
