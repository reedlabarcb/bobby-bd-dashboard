"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Pencil, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GenericEditDialog } from "@/components/generic-edit-dialog";

/**
 * Inline pencil button that fetches a tenant record on click, then
 * opens GenericEditDialog. Used in the buildings drilldown panel
 * where we only have a tenantId (not the full row).
 */
export function TenantEditButton({
  tenantId,
  tenantName,
}: {
  tenantId: number;
  tenantName: string;
}) {
  const [open, setOpen] = useState(false);
  const [row, setRow] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/tenants/${tenantId}`);
      if (!res.ok) throw new Error("Failed to load tenant");
      const data = await res.json();
      setRow(data);
      setOpen(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load tenant");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="h-6 w-6 p-0"
        onClick={(e) => { e.stopPropagation(); void load(); }}
        title="Edit tenant"
        disabled={loading}
      >
        {loading ? <Loader2 className="size-3 animate-spin" /> : <Pencil className="size-3" />}
      </Button>
      {open && row && (
        <GenericEditDialog
          open={open}
          onOpenChange={setOpen}
          resource="Tenant"
          endpoint={`/api/tenants/${tenantId}`}
          row={row}
          preview={tenantName}
          fields={[
            { key: "name", label: "Tenant name", type: "text", full: true },
            { key: "industry", label: "Industry", type: "text" },
            { key: "creditRating", label: "Credit rating", type: "select", options: ["investment-grade", "national", "regional", "local"] },
            { key: "parentCompany", label: "Parent company", type: "text" },
            { key: "contactEmail", label: "Contact email", type: "text" },
            { key: "contactPhone", label: "Contact phone", type: "text" },
            { key: "contactName", label: "Contact name", type: "text" },
            { key: "notes", label: "Notes", type: "textarea", full: true },
          ]}
        />
      )}
    </>
  );
}
