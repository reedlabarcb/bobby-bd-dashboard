export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import { activities, contacts, deals } from "@/lib/db/schema";
import { desc, eq } from "drizzle-orm";
import { ActivitiesFeed } from "@/components/activities-feed";

export default async function ActivitiesPage() {
  const allActivities = await db
    .select({
      id: activities.id,
      type: activities.type,
      subject: activities.subject,
      body: activities.body,
      date: activities.date,
      contactId: activities.contactId,
      dealId: activities.dealId,
      contactName: contacts.name,
      dealName: deals.name,
    })
    .from(activities)
    .leftJoin(contacts, eq(activities.contactId, contacts.id))
    .leftJoin(deals, eq(activities.dealId, deals.id))
    .orderBy(desc(activities.date))
    .limit(100);

  const allContacts = await db
    .select({ id: contacts.id, name: contacts.name })
    .from(contacts)
    .orderBy(contacts.name);

  const allDeals = await db
    .select({ id: deals.id, name: deals.name })
    .from(deals)
    .orderBy(deals.name);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Activities</h1>
        <p className="text-sm text-muted-foreground mt-1">
          All logged calls, emails, meetings, and notes
        </p>
      </div>
      <ActivitiesFeed
        activities={allActivities}
        contacts={allContacts}
        deals={allDeals}
      />
    </div>
  );
}
