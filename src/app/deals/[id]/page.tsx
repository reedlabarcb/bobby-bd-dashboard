export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import { deals } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Building2,
  MapPin,
  DollarSign,
  FileText,
  Calendar,
  LinkIcon,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { DealStatusSelect } from "@/components/deal-status-select";
import { RawTextCollapsible } from "@/components/deal-raw-text";

function formatCurrency(value: number | null): string {
  if (value == null) return "N/A";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

const STATUS_COLORS: Record<string, string> = {
  prospect: "bg-amber-500/20 text-amber-600",
  active: "bg-blue-500/20 text-blue-600",
  closed: "bg-green-500/20 text-green-400",
  dead: "bg-zinc-500/20 text-slate-500",
};

export default async function DealDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const deal = db
    .select()
    .from(deals)
    .where(eq(deals.id, parseInt(id)))
    .get();

  if (!deal) notFound();

  // Try parsing raw text for highlights/broker info
  let rawParsed: { highlights?: string[]; brokerInfo?: string } | null = null;
  try {
    if (deal.rawText) rawParsed = JSON.parse(deal.rawText);
  } catch {
    // raw text is plain text, not JSON
  }

  return (
    <div className="space-y-6">
      {/* Back + Header */}
      <div className="flex items-center gap-4">
        <Link href="/deals">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="mr-1 h-4 w-4" />
            Back
          </Button>
        </Link>
      </div>

      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">{deal.name}</h1>
          <div className="flex items-center gap-2">
            {deal.propertyType && (
              <Badge variant="secondary">
                <Building2 className="mr-1 h-3 w-3" />
                {deal.propertyType}
              </Badge>
            )}
            <Badge
              className={STATUS_COLORS[deal.status ?? "prospect"]}
              variant="outline"
            >
              {deal.status ?? "prospect"}
            </Badge>
            {deal.sourceFile && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <FileText className="h-3 w-3" />
                {deal.sourceFile}
              </span>
            )}
          </div>
        </div>
        <DealStatusSelect
          dealId={deal.id}
          currentStatus={deal.status ?? "prospect"}
        />
      </div>

      <Separator />

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column: Details */}
        <div className="lg:col-span-2 space-y-6">
          {/* AI Summary */}
          {deal.aiSummary && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                  AI Summary
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm leading-relaxed whitespace-pre-wrap">
                  {deal.aiSummary}
                </p>
              </CardContent>
            </Card>
          )}

          {/* Highlights */}
          {rawParsed?.highlights && rawParsed.highlights.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                  Key Highlights
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1.5">
                  {rawParsed.highlights.map((h, i) => (
                    <li
                      key={i}
                      className="text-sm text-muted-foreground flex items-start gap-2"
                    >
                      <span className="text-primary mt-0.5">&#8226;</span>
                      {h}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {/* Raw Text (Collapsible) */}
          {deal.rawText && (
            <RawTextCollapsible rawText={deal.rawText} />
          )}
        </div>

        {/* Right column: Sidebar cards */}
        <div className="space-y-6">
          {/* Property Details */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Property Details
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {(deal.address || deal.city || deal.state) && (
                <div className="flex items-start gap-2 text-sm">
                  <MapPin className="h-4 w-4 shrink-0 text-muted-foreground mt-0.5" />
                  <span>
                    {[deal.address, deal.city, deal.state]
                      .filter(Boolean)
                      .join(", ")}
                  </span>
                </div>
              )}
              <div className="flex items-center gap-2 text-sm">
                <DollarSign className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="font-medium text-emerald-600">
                  {formatCurrency(deal.askingPrice)}
                </span>
              </div>
              {deal.propertyType && (
                <div className="flex items-center gap-2 text-sm">
                  <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span>{deal.propertyType}</span>
                </div>
              )}
              {deal.createdAt && (
                <div className="flex items-center gap-2 text-sm">
                  <Calendar className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="text-muted-foreground">
                    Added{" "}
                    {new Date(deal.createdAt).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Map placeholder */}
          {deal.lat != null && deal.lng != null && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                  Location
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="aspect-video rounded-lg bg-muted flex items-center justify-center border border-border">
                  <div className="text-center text-muted-foreground text-xs space-y-1">
                    <MapPin className="h-6 w-6 mx-auto" />
                    <p>
                      {deal.lat.toFixed(4)}, {deal.lng.toFixed(4)}
                    </p>
                    <a
                      href={`https://www.google.com/maps?q=${deal.lat},${deal.lng}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline text-xs"
                    >
                      Open in Google Maps
                    </a>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Broker info */}
          {rawParsed?.brokerInfo && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                  Broker Info
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                  {rawParsed.brokerInfo}
                </p>
              </CardContent>
            </Card>
          )}

          {/* Link Contact */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Linked Contact
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <LinkIcon className="h-4 w-4" />
                <span>Contact linking coming soon</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
