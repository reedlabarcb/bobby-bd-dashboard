"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const statuses = [
  { value: "prospect", label: "Prospect" },
  { value: "active", label: "Active" },
  { value: "closed", label: "Closed" },
  { value: "dead", label: "Dead" },
] as const;

export function DealStatusSelect({
  dealId,
  currentStatus,
}: {
  dealId: number;
  currentStatus: string;
}) {
  const router = useRouter();

  async function handleChange(value: string | null) {
    if (!value || value === currentStatus) return;
    try {
      const res = await fetch(`/api/deals/${dealId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: value }),
      });
      if (!res.ok) throw new Error("Failed to update status");
      toast.success(`Status updated to ${value}`);
      router.refresh();
    } catch {
      toast.error("Failed to update deal status");
    }
  }

  return (
    <Select value={currentStatus} onValueChange={handleChange}>
      <SelectTrigger className="w-[160px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {statuses.map((s) => (
          <SelectItem key={s.value} value={s.value}>
            {s.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
