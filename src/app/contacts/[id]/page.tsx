export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import { contacts, activities } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import { notFound } from "next/navigation";
import Link from "next/link";
import { format } from "date-fns";
import {
  ArrowLeft,
  PhoneCall,
  MessageSquare,
  Users,
  StickyNote,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DeepSearchPersonButton } from "@/components/deep-search-person-button";
import { AddActivityDialog } from "@/components/add-activity-dialog";
import { EditContactCard } from "@/components/edit-contact-card";

const TYPE_COLORS: Record<string, string> = {
  buyer: "bg-emerald-500/20 text-emerald-600 border-emerald-500/30",
  seller: "bg-blue-500/20 text-blue-600 border-blue-500/30",
  broker: "bg-amber-500/20 text-amber-600 border-amber-500/30",
  lender: "bg-purple-500/20 text-purple-600 border-purple-500/30",
  landlord: "bg-cyan-500/20 text-cyan-600 border-cyan-500/30",
  other: "bg-zinc-500/20 text-slate-600 border-zinc-500/30",
};

const ACTIVITY_ICONS: Record<string, React.ReactNode> = {
  call: <PhoneCall className="size-4" />,
  email: <MessageSquare className="size-4" />,
  meeting: <Users className="size-4" />,
  note: <StickyNote className="size-4" />,
};

const ACTIVITY_COLORS: Record<string, string> = {
  call: "bg-blue-500/20 text-blue-600",
  email: "bg-emerald-500/20 text-emerald-600",
  meeting: "bg-amber-500/20 text-amber-600",
  note: "bg-zinc-500/20 text-slate-600",
};

function formatDateTime(d: string | null) {
  if (!d) return "-";
  try {
    return format(new Date(d), "MMM d, yyyy 'at' h:mm a");
  } catch {
    return d;
  }
}

export default async function ContactDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const contact = db
    .select()
    .from(contacts)
    .where(eq(contacts.id, Number(id)))
    .get();

  if (!contact) notFound();

  const contactActivities = db
    .select()
    .from(activities)
    .where(eq(activities.contactId, contact.id))
    .orderBy(desc(activities.date))
    .all();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/contacts">
          <Button variant="ghost" size="icon-sm">
            <ArrowLeft className="size-4" />
          </Button>
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">{contact.name}</h1>
            <Badge
              className={TYPE_COLORS[contact.type || "other"] || TYPE_COLORS.other}
            >
              {contact.type || "other"}
            </Badge>
          </div>
          {contact.title && contact.company && (
            <p className="text-sm text-muted-foreground">
              {contact.title} at {contact.company}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <DeepSearchPersonButton contactId={contact.id} />
          <AddActivityDialog contactId={contact.id} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <EditContactCard contact={contact} />

        {/* Activity Timeline */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>
                Activity Timeline ({contactActivities.length})
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            {contactActivities.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <StickyNote className="size-8 mx-auto mb-3 opacity-50" />
                <p className="text-sm">No activities yet</p>
                <p className="text-xs mt-1">
                  Log a call, email, or meeting to get started.
                </p>
              </div>
            ) : (
              <div className="space-y-0">
                {contactActivities.map((activity, idx) => (
                  <div key={activity.id} className="flex gap-4">
                    <div className="flex flex-col items-center">
                      <div
                        className={`flex items-center justify-center size-8 rounded-full shrink-0 ${
                          ACTIVITY_COLORS[activity.type] || ACTIVITY_COLORS.note
                        }`}
                      >
                        {ACTIVITY_ICONS[activity.type] || ACTIVITY_ICONS.note}
                      </div>
                      {idx < contactActivities.length - 1 && (
                        <div className="w-px flex-1 bg-border/50 my-1" />
                      )}
                    </div>
                    <div className="pb-6 pt-1 flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium capitalize">
                          {activity.type}
                        </span>
                        {activity.subject && (
                          <>
                            <span className="text-muted-foreground">&middot;</span>
                            <span className="text-sm truncate">{activity.subject}</span>
                          </>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {formatDateTime(activity.date)}
                      </p>
                      {activity.body && (
                        <p className="text-sm text-muted-foreground mt-2 whitespace-pre-wrap">
                          {activity.body}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
