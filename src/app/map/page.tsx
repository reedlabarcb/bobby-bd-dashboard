export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import { deals } from "@/lib/db/schema";
import { isNotNull, and } from "drizzle-orm";
import { DealsMap } from "@/components/deals-map";

export default async function MapPage() {
  const dealsWithLocation = await db
    .select()
    .from(deals)
    .where(and(isNotNull(deals.lat), isNotNull(deals.lng)));

  return <DealsMap deals={dealsWithLocation} />;
}
