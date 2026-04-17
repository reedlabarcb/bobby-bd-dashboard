import { db } from "@/lib/db";
import { deals } from "@/lib/db/schema";
import { desc } from "drizzle-orm";
import { DealsBoard } from "@/components/deals-board";

export default function DealsPage() {
  const allDeals = db
    .select()
    .from(deals)
    .orderBy(desc(deals.createdAt))
    .all();

  return <DealsBoard deals={allDeals} />;
}
