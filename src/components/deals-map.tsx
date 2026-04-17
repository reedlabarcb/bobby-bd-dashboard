"use client";

import "mapbox-gl/dist/mapbox-gl.css";

import { useRef, useEffect, useState, useCallback, useMemo } from "react";
import mapboxgl from "mapbox-gl";
import {
  Layers,
  Filter,
  X,
  RotateCcw,
  MapPin,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import type { Deal } from "@/lib/db/schema";

const STATUS_COLORS: Record<string, string> = {
  prospect: "#EAB308",
  active: "#3B82F6",
  closed: "#22C55E",
  dead: "#6B7280",
};

function formatUSD(value: number | null): string {
  if (value == null) return "N/A";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

interface Filters {
  statuses: Set<string>;
  propertyType: string;
  priceMin: string;
  priceMax: string;
}

const ALL_STATUSES = ["prospect", "active", "closed", "dead"];

export function DealsMap({ deals }: { deals: Deal[] }) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const popupRef = useRef<mapboxgl.Popup | null>(null);

  const [heatmapOn, setHeatmapOn] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [filters, setFilters] = useState<Filters>({
    statuses: new Set(ALL_STATUSES),
    propertyType: "",
    priceMin: "",
    priceMax: "",
  });

  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

  // Derive unique property types from deals
  const propertyTypes = useMemo(() => {
    const types = new Set<string>();
    deals.forEach((d) => {
      if (d.propertyType) types.add(d.propertyType);
    });
    return Array.from(types).sort();
  }, [deals]);

  // Filter deals
  const filteredDeals = useMemo(() => {
    return deals.filter((d) => {
      if (!filters.statuses.has(d.status ?? "prospect")) return false;
      if (
        filters.propertyType &&
        d.propertyType !== filters.propertyType
      )
        return false;
      if (filters.priceMin && d.askingPrice != null) {
        if (d.askingPrice < Number(filters.priceMin)) return false;
      }
      if (filters.priceMax && d.askingPrice != null) {
        if (d.askingPrice > Number(filters.priceMax)) return false;
      }
      return true;
    });
  }, [deals, filters]);

  // Toggle a status filter
  const toggleStatus = useCallback((status: string) => {
    setFilters((prev) => {
      const next = new Set(prev.statuses);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return { ...prev, statuses: next };
    });
  }, []);

  // Reset filters
  const resetFilters = useCallback(() => {
    setFilters({
      statuses: new Set(ALL_STATUSES),
      propertyType: "",
      priceMin: "",
      priceMax: "",
    });
  }, []);

  // Clear and re-add markers
  const syncMarkers = useCallback(() => {
    // Remove old markers
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    if (!map.current || heatmapOn) return;

    filteredDeals.forEach((deal) => {
      if (deal.lat == null || deal.lng == null) return;

      const color = STATUS_COLORS[deal.status ?? "prospect"] ?? "#6B7280";

      const el = document.createElement("div");
      el.style.width = "14px";
      el.style.height = "14px";
      el.style.borderRadius = "50%";
      el.style.backgroundColor = color;
      el.style.border = "2px solid rgba(255,255,255,0.8)";
      el.style.cursor = "pointer";
      el.style.boxShadow = `0 0 6px ${color}80`;

      const marker = new mapboxgl.Marker({ element: el })
        .setLngLat([deal.lng, deal.lat])
        .addTo(map.current!);

      el.addEventListener("click", (e) => {
        e.stopPropagation();
        if (popupRef.current) popupRef.current.remove();

        const summarySnippet = deal.aiSummary
          ? deal.aiSummary.slice(0, 100) + (deal.aiSummary.length > 100 ? "..." : "")
          : "No AI summary available.";

        const popup = new mapboxgl.Popup({
          offset: 12,
          closeButton: true,
          maxWidth: "300px",
        })
          .setLngLat([deal.lng!, deal.lat!])
          .setHTML(
            `<div style="font-family: system-ui, sans-serif; color: #e4e4e7; padding: 4px;">
              <div style="font-weight: 700; font-size: 14px; margin-bottom: 6px;">${escapeHtml(deal.name)}</div>
              ${deal.propertyType ? `<div style="font-size: 12px; color: #a1a1aa; margin-bottom: 4px;">${escapeHtml(deal.propertyType)}</div>` : ""}
              <div style="font-size: 13px; font-weight: 600; margin-bottom: 4px;">${formatUSD(deal.askingPrice)}</div>
              <div style="display: inline-block; font-size: 11px; padding: 2px 8px; border-radius: 9999px; background: ${color}22; color: ${color}; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 6px;">
                ${deal.status ?? "prospect"}
              </div>
              <div style="font-size: 12px; color: #a1a1aa; margin-bottom: 8px; line-height: 1.4;">${escapeHtml(summarySnippet)}</div>
              <a href="/deals/${deal.id}" style="font-size: 12px; color: #3B82F6; text-decoration: none; font-weight: 500;">View Deal &rarr;</a>
            </div>`
          )
          .addTo(map.current!);

        popupRef.current = popup;
      });

      markersRef.current.push(marker);
    });
  }, [filteredDeals, heatmapOn]);

  // Sync heatmap layer
  const syncHeatmap = useCallback(() => {
    if (!map.current) return;
    const m = map.current;

    // Build geojson from filtered deals
    const geojson: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: filteredDeals
        .filter((d) => d.lat != null && d.lng != null)
        .map((d) => ({
          type: "Feature" as const,
          properties: {},
          geometry: {
            type: "Point" as const,
            coordinates: [d.lng!, d.lat!],
          },
        })),
    };

    // Update or create source
    const src = m.getSource("deals-heat") as mapboxgl.GeoJSONSource | undefined;
    if (src) {
      src.setData(geojson);
    } else {
      m.addSource("deals-heat", { type: "geojson", data: geojson });
    }

    // Add layer if missing
    if (!m.getLayer("deals-heatmap")) {
      m.addLayer({
        id: "deals-heatmap",
        type: "heatmap",
        source: "deals-heat",
        paint: {
          "heatmap-weight": 1,
          "heatmap-intensity": 1.5,
          "heatmap-radius": 30,
          "heatmap-opacity": 0.75,
          "heatmap-color": [
            "interpolate",
            ["linear"],
            ["heatmap-density"],
            0, "rgba(0,0,0,0)",
            0.2, "#3B82F6",
            0.4, "#22D3EE",
            0.6, "#22C55E",
            0.8, "#EAB308",
            1, "#EF4444",
          ],
        },
      });
    }

    // Toggle visibility
    m.setLayoutProperty(
      "deals-heatmap",
      "visibility",
      heatmapOn ? "visible" : "none"
    );
  }, [filteredDeals, heatmapOn]);

  // Initialize map
  useEffect(() => {
    if (!token || !mapContainer.current || map.current) return;

    mapboxgl.accessToken = token;

    const m = new mapboxgl.Map({
      container: mapContainer.current,
      style: "mapbox://styles/mapbox/dark-v11",
      center: [-98.5, 39.8],
      zoom: 4,
    });

    m.addControl(new mapboxgl.NavigationControl(), "bottom-right");

    m.on("load", () => {
      map.current = m;
      syncMarkers();
      syncHeatmap();
    });

    return () => {
      m.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Sync markers & heatmap on filter / toggle changes
  useEffect(() => {
    if (!map.current) return;
    syncMarkers();
    syncHeatmap();
  }, [syncMarkers, syncHeatmap]);

  // --- No token ---
  if (!token) {
    return (
      <div className="flex items-center justify-center" style={{ height: "calc(100vh - 3rem)" }}>
        <Card className="border-0 bg-zinc-900/60 max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-amber-400">
              <AlertTriangle className="h-5 w-5" />
              Mapbox Token Not Configured
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Add <code className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-300">NEXT_PUBLIC_MAPBOX_TOKEN</code> to your{" "}
              <code className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-300">.env.local</code> file to enable the map.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="relative -m-6" style={{ height: "calc(100vh - 0rem)" }}>
      {/* Map container */}
      <div ref={mapContainer} className="absolute inset-0" />

      {/* No deals overlay */}
      {deals.length === 0 && (
        <div className="pointer-events-none absolute inset-x-0 top-4 z-10 flex justify-center">
          <div className="pointer-events-auto rounded-lg border border-zinc-700 bg-zinc-900/90 px-5 py-3 text-sm text-zinc-300 shadow-lg backdrop-blur">
            <MapPin className="mr-2 inline-block h-4 w-4 text-zinc-500" />
            No deals with locations yet. Upload an OM to get started.
          </div>
        </div>
      )}

      {/* Heatmap toggle (top-right) */}
      <div className="absolute right-4 top-4 z-10">
        <Button
          variant={heatmapOn ? "default" : "outline"}
          size="sm"
          onClick={() => setHeatmapOn((v) => !v)}
          className={
            heatmapOn
              ? "bg-blue-600 text-white hover:bg-blue-500 border-0"
              : "border-zinc-700 bg-zinc-900/80 text-zinc-300 hover:bg-zinc-800 backdrop-blur"
          }
        >
          <Layers className="mr-2 h-4 w-4" />
          Heatmap
        </Button>
      </div>

      {/* Filter toggle button (top-left) */}
      <div className="absolute left-4 top-4 z-10">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setSidebarOpen((v) => !v)}
          className="border-zinc-700 bg-zinc-900/80 text-zinc-300 hover:bg-zinc-800 backdrop-blur"
        >
          {sidebarOpen ? (
            <X className="mr-2 h-4 w-4" />
          ) : (
            <Filter className="mr-2 h-4 w-4" />
          )}
          Filters
          {filteredDeals.length !== deals.length && (
            <Badge variant="secondary" className="ml-2 bg-blue-600/20 text-blue-400 text-[10px] px-1.5">
              {filteredDeals.length}
            </Badge>
          )}
        </Button>
      </div>

      {/* Filter sidebar */}
      {sidebarOpen && (
        <div className="absolute left-4 top-14 z-10 w-64 rounded-lg border border-zinc-700 bg-zinc-900/90 shadow-xl backdrop-blur">
          <div className="p-4 space-y-4">
            {/* Status checkboxes */}
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">
                Status
              </p>
              <div className="space-y-1.5">
                {ALL_STATUSES.map((s) => (
                  <label
                    key={s}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm text-zinc-300 hover:bg-zinc-800/50"
                  >
                    <input
                      type="checkbox"
                      checked={filters.statuses.has(s)}
                      onChange={() => toggleStatus(s)}
                      className="h-3.5 w-3.5 rounded border-zinc-600 bg-zinc-800 accent-blue-500"
                    />
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: STATUS_COLORS[s] }}
                    />
                    <span className="capitalize">{s}</span>
                  </label>
                ))}
              </div>
            </div>

            <Separator className="bg-zinc-700" />

            {/* Property type */}
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">
                Property Type
              </p>
              <select
                value={filters.propertyType}
                onChange={(e) =>
                  setFilters((f) => ({ ...f, propertyType: e.target.value }))
                }
                className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-300 outline-none focus:border-blue-500"
              >
                <option value="">All Types</option>
                {propertyTypes.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>

            <Separator className="bg-zinc-700" />

            {/* Price range */}
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">
                Price Range
              </p>
              <div className="flex gap-2">
                <Input
                  type="number"
                  placeholder="Min"
                  value={filters.priceMin}
                  onChange={(e) =>
                    setFilters((f) => ({ ...f, priceMin: e.target.value }))
                  }
                  className="h-8 border-zinc-700 bg-zinc-800 text-xs text-zinc-300 placeholder:text-zinc-600"
                />
                <Input
                  type="number"
                  placeholder="Max"
                  value={filters.priceMax}
                  onChange={(e) =>
                    setFilters((f) => ({ ...f, priceMax: e.target.value }))
                  }
                  className="h-8 border-zinc-700 bg-zinc-800 text-xs text-zinc-300 placeholder:text-zinc-600"
                />
              </div>
            </div>

            <Separator className="bg-zinc-700" />

            {/* Reset */}
            <Button
              variant="ghost"
              size="sm"
              onClick={resetFilters}
              className="w-full text-zinc-400 hover:text-zinc-200"
            >
              <RotateCcw className="mr-2 h-3.5 w-3.5" />
              Reset Filters
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
