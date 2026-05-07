export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import { contacts, deals, activities } from "@/lib/db/schema";
import { count, sql, desc, eq } from "drizzle-orm";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Users, Building2, Activity, TrendingUp, Plus, Phone, Mail, Calendar, FileText } from "lucide-react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { HomeImportCard } from "@/components/home-import-card";

const activityIcons: Record<string, typeof Phone> = {
  call: Phone,
  email: Mail,
  meeting: Calendar,
  note: FileText,
};

export default async function DashboardPage() {
  const [totalContacts] = await db.select({ value: count() }).from(contacts);
  const [activeDeals] = await db
    .select({ value: count() })
    .from(deals)
    .where(eq(deals.status, "active"));
  const [activitiesThisWeek] = await db
    .select({ value: count() })
    .from(activities)
    .where(sql`${activities.date} >= datetime('now', '-7 days')`);
  const [dealsThisMonth] = await db
    .select({ value: count() })
    .from(deals)
    .where(sql`${deals.createdAt} >= datetime('now', '-30 days')`);

  const recentActivities = await db
    .select({
      id: activities.id,
      type: activities.type,
      subject: activities.subject,
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
    .limit(10);

  const stats = [
    {
      label: "Total Contacts",
      value: totalContacts.value,
      icon: Users,
      color: "text-blue-600",
      bg: "bg-blue-100",
    },
    {
      label: "Active Deals",
      value: activeDeals.value,
      icon: Building2,
      color: "text-emerald-600",
      bg: "bg-emerald-100",
    },
    {
      label: "Activities This Week",
      value: activitiesThisWeek.value,
      icon: Activity,
      color: "text-amber-600",
      bg: "bg-amber-100",
    },
    {
      label: "Deals This Month",
      value: dealsThisMonth.value,
      icon: TrendingUp,
      color: "text-violet-600",
      bg: "bg-violet-100",
    },
  ];

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Business development overview
          </p>
        </div>
        <Link
          href="/contacts?add=true"
          className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500"
        >
          <Plus className="h-4 w-4" />
          Quick Add Contact
        </Link>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <Card key={stat.label} className="border-0 bg-card">
              <CardHeader className="flex-row items-center justify-between pb-2">
                <CardDescription className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {stat.label}
                </CardDescription>
                <div className={`rounded-md p-2 ${stat.bg}`}>
                  <Icon className={`h-4 w-4 ${stat.color}`} />
                </div>
              </CardHeader>
              <CardContent>
                <div className={`text-3xl font-bold tabular-nums ${stat.color}`}>
                  {stat.value.toLocaleString()}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Import Excel */}
      <HomeImportCard />

      {/* Recent Activity */}
      <Card className="border-0 bg-card">
        <CardHeader>
          <CardTitle className="text-base font-medium">Recent Activity</CardTitle>
          <CardDescription>Last 10 activities across all contacts and deals</CardDescription>
        </CardHeader>
        <CardContent>
          {recentActivities.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No activities yet. Start by adding a contact or logging an activity.
            </p>
          ) : (
            <div className="space-y-1">
              {recentActivities.map((a) => {
                const Icon = activityIcons[a.type] ?? Activity;
                const typeColors: Record<string, string> = {
                  call: "text-blue-600 bg-blue-100",
                  email: "text-amber-600 bg-amber-100",
                  meeting: "text-emerald-600 bg-emerald-100",
                  note: "text-violet-600 bg-violet-100",
                };
                const colorClass = typeColors[a.type] ?? "text-muted-foreground bg-muted";
                const [iconColor, iconBg] = colorClass.split(" ");

                return (
                  <div
                    key={a.id}
                    className="flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-slate-100/50"
                  >
                    <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${iconBg}`}>
                      <Icon className={`h-4 w-4 ${iconColor}`} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-900">
                        {a.subject || `${a.type.charAt(0).toUpperCase() + a.type.slice(1)} logged`}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {[a.contactName, a.dealName].filter(Boolean).join(" / ") || "No linked record"}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <span className="inline-block rounded bg-slate-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-slate-600">
                        {a.type}
                      </span>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {a.date
                          ? formatDistanceToNow(new Date(a.date), { addSuffix: true })
                          : ""}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
