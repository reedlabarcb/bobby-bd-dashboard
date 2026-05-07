"use client";

/**
 * Generic edit-and-delete dialog driven by a field schema. Used to
 * inline-edit any row from any table without writing a bespoke dialog
 * per resource. Handles text, number, textarea, date, and select inputs;
 * delete is gated behind a confirm sub-dialog.
 *
 * Usage:
 *   <GenericEditDialog
 *     open={open} onOpenChange={setOpen}
 *     resource="lease"           // human label, used in titles
 *     endpoint={`/api/leases/${row.id}`}  // PUT and DELETE go here
 *     row={row}
 *     fields={[
 *       { key: "tenantName", label: "Tenant", type: "text" },
 *       { key: "squareFeet", label: "Square Feet", type: "number" },
 *       { key: "leaseEndDate", label: "Lease End", type: "date" },
 *       ...
 *     ]}
 *   />
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type FieldDef = {
  key: string;
  label: string;
  type: "text" | "number" | "textarea" | "date" | "select";
  options?: string[]; // for select
  placeholder?: string;
  full?: boolean; // span both columns
};

export function GenericEditDialog({
  open,
  onOpenChange,
  resource,
  endpoint,
  row,
  fields,
  onSaved,
  preview,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  resource: string;
  endpoint: string;
  row: Record<string, unknown>;
  fields: FieldDef[];
  onSaved?: () => void;
  /** Optional small label rendered in the dialog header so you can identify
   *  which row you're editing without re-printing every field. */
  preview?: string;
}) {
  const router = useRouter();
  const [form, setForm] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const f of fields) {
      const v = row[f.key];
      init[f.key] =
        v === null || v === undefined
          ? ""
          : typeof v === "string"
          ? v
          : String(v);
    }
    return init;
  });
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  function buildPayload(): Record<string, string | number | null> {
    const out: Record<string, string | number | null> = {};
    for (const f of fields) {
      const raw = form[f.key]?.trim() ?? "";
      if (raw === "") {
        out[f.key] = null;
        continue;
      }
      if (f.type === "number") {
        const n = Number(raw);
        out[f.key] = Number.isFinite(n) ? n : null;
      } else {
        out[f.key] = raw;
      }
    }
    return out;
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(endpoint, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload()),
      });
      if (!res.ok) throw new Error(`Update failed (${res.status})`);
      toast.success(`${resource} updated`);
      onOpenChange(false);
      onSaved?.();
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function deleteRow() {
    setDeleting(true);
    try {
      const res = await fetch(endpoint, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      toast.success(`${resource} deleted`);
      onOpenChange(false);
      onSaved?.();
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete");
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => !saving && !deleting && onOpenChange(v)}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit {resource}</DialogTitle>
            <DialogDescription>
              {preview || "Update any field. Leave blanks to clear."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-3">
            {fields.map((f) => (
              <div key={f.key} className={`space-y-1 ${f.full ? "col-span-2" : ""}`}>
                <Label className="text-xs text-muted-foreground">{f.label}</Label>
                {f.type === "textarea" ? (
                  <Textarea
                    rows={4}
                    placeholder={f.placeholder}
                    value={form[f.key] ?? ""}
                    onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                  />
                ) : f.type === "select" && f.options ? (
                  <Select
                    value={form[f.key] || ""}
                    onValueChange={(v) => setForm({ ...form, [f.key]: (v as string) ?? "" })}
                  >
                    <SelectTrigger><SelectValue placeholder={f.placeholder} /></SelectTrigger>
                    <SelectContent>
                      {f.options.map((o) => (
                        <SelectItem key={o} value={o}>{o}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"}
                    placeholder={f.placeholder}
                    value={form[f.key] ?? ""}
                    onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                  />
                )}
              </div>
            ))}
          </div>

          <DialogFooter className="flex sm:justify-between">
            <Button
              variant="outline"
              onClick={() => setConfirmDelete(true)}
              disabled={saving || deleting}
              className="text-red-700 border-red-200 hover:bg-red-50 hover:text-red-800"
            >
              <Trash2 className="size-4 mr-1" />
              Delete
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
                Cancel
              </Button>
              <Button onClick={save} disabled={saving}>
                {saving ? <Loader2 className="size-4 mr-1 animate-spin" /> : <Save className="size-4 mr-1" />}
                Save
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmDelete} onOpenChange={(v) => !deleting && setConfirmDelete(v)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete this {resource.toLowerCase()}?</DialogTitle>
            <DialogDescription>
              {preview && <strong>{preview}</strong>} will be permanently removed.
              This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)} disabled={deleting}>
              Cancel
            </Button>
            <Button
              className="bg-red-600 text-white border-red-700 hover:bg-red-700"
              onClick={deleteRow}
              disabled={deleting}
            >
              {deleting ? <Loader2 className="size-4 mr-1 animate-spin" /> : <Trash2 className="size-4 mr-1" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
