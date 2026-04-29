"use client";

import "maplibre-gl/dist/maplibre-gl.css";

import { useRef, useEffect, useState, useCallback, useMemo } from "react";
import maplibregl, { type StyleSpecification } from "maplibre-gl";
import { Layers, Filter, X, RotateCcw, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

const DARK_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    "carto-base": {
      type: "raster",
      tiles: [
        "https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png",
        "https://b.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png",
        "https://c.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png",
        "https://d.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png",
      ],
      tileSize: 256,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    },
  },
  layers: [
    {
      id: "carto-base",
      type: "raster",
      source: "carto-base",
      // Voyager is designed to be readable — leave it alone. Earlier
      // brightness/saturation tweaks washed out the street and place labels.
    },
  ],
};

// Same urgency palette used on /leases and /buildings tables.
const URGENCY: Record<string, { color: string; glow: string }> = {
  red:   { color: "#EF4444", glow: "#EF444480" },
  amber: { color: "#F59E0B", glow: "#F59E0B80" },
  blue:  { color: "#3B82F6", glow: "#3B82F680" },
  gray:  { color: "#6B7280", glow: "#6B728080" },
};

function urgencyKey(months: number | null): "red" | "amber" | "blue" | "gray" {
  if (months == null || months < 0) return "gray";
  if (months <= 6) return "red";
  if (months <= 12) return "amber";
  if (months <= 24) return "blue";
  return "gray";
}

function formatDate(d: string | null): string {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return d;
  }
}

// === Types ===

export type BuildingPin = {
  id: number;
  name: string | null;
  address: string;
  city: string | null;
  state: string | null;
  propertyClass: string | null;
  landlord: string | null; // landlord_name OR landlord_contact name
  lat: number;
  lng: number;
  tenants: BuildingTenant[];
  totalSf: number;
  // Soonest *future* expiration across the building's leases.
  soonestMonths: number | null;
  soonestEndDate: string | null;
};

export type BuildingTenant = {
  tenantName: string;
  squareFeet: number | null;
  leaseEndDate: string | null;
  monthsRemaining: number | null;
};

interface Filters {
  city: string;
  rolloverWindow: string; // "all" | "6" | "12" | "24"
  minTenants: string;
  search: string;
}

const ROLLOVER_OPTIONS = [
  { v: "all", l: "Any" },
  { v: "6",   l: "≤ 6 mo" },
  { v: "12",  l: "≤ 12 mo" },
  { v: "24",  l: "≤ 24 mo" },
];

// === Component ===

export function BuildingsMap({ buildings }: { buildings: BuildingPin[] }) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const popupRef = useRef<maplibregl.Popup | null>(null);

  const [heatmapOn, setHeatmapOn] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [filters, setFilters] = useState<Filters>({
    city: "",
    rolloverWindow: "all",
    minTenants: "",
    search: "",
  });

  const cities = useMemo(() => {
    const s = new Set<string>();
    for (const b of buildings) if (b.city) s.add(b.city);
    return Array.from(s).sort();
  }, [buildings]);

  const filtered = useMemo(() => {
    const q = filters.search.trim().toLowerCase();
    const minT = filters.minTenants ? parseInt(filters.minTenants, 10) : 0;
    const window = filters.rolloverWindow === "all" ? null : parseInt(filters.rolloverWindow, 10);
    return buildings.filter((b) => {
      if (filters.city && b.city !== filters.city) return false;
      if (b.tenants.length < minT) return false;
      if (window != null) {
        if (b.soonestMonths == null || b.soonestMonths > window) return false;
      }
      if (q) {
        const hay = [b.name, b.address, b.city, b.landlord, ...b.tenants.map((t) => t.tenantName)]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [buildings, filters]);

  const resetFilters = useCallback(() => {
    setFilters({ city: "", rolloverWindow: "all", minTenants: "", search: "" });
  }, []);

  const syncMarkers = useCallback(() => {
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];
    if (!map.current || heatmapOn) return;

    for (const b of filtered) {
      const u = URGENCY[urgencyKey(b.soonestMonths)];
      const size = Math.min(22, 10 + Math.round(Math.sqrt(b.tenants.length) * 3));

      const el = document.createElement("div");
      el.style.width = `${size}px`;
      el.style.height = `${size}px`;
      el.style.borderRadius = "50%";
      el.style.backgroundColor = u.color;
      el.style.border = "2px solid rgba(255,255,255,0.85)";
      el.style.cursor = "pointer";
      el.style.boxShadow = `0 0 ${Math.round(size / 2)}px ${u.glow}`;

      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([b.lng, b.lat])
        .addTo(map.current!);

      el.addEventListener("click", (e) => {
        e.stopPropagation();
        if (popupRef.current) popupRef.current.remove();

        const sortedTenants = [...b.tenants].sort((x, y) => {
          const xm = x.monthsRemaining ?? 9999;
          const ym = y.monthsRemaining ?? 9999;
          return xm - ym;
        });

        const tenantRows = sortedTenants
          .slice(0, 8)
          .map((t) => {
            const tu = URGENCY[urgencyKey(t.monthsRemaining)];
            const moLabel =
              t.monthsRemaining == null
                ? "—"
                : t.monthsRemaining < 0
                  ? "expired"
                  : `${t.monthsRemaining} mo`;
            return `
              <div style="display:flex; justify-content:space-between; gap:8px; align-items:center; font-size:11px; padding:3px 0; border-top:1px solid #27272a;">
                <span style="color:#e4e4e7; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(t.tenantName)}</span>
                <span style="color:${tu.color}; font-variant-numeric: tabular-nums; font-weight:600; white-space:nowrap;">${moLabel}</span>
              </div>`;
          })
          .join("");
        const moreLabel =
          sortedTenants.length > 8
            ? `<div style="font-size:10px; color:#71717a; padding-top:4px;">+ ${sortedTenants.length - 8} more</div>`
            : "";

        const headerColor = URGENCY[urgencyKey(b.soonestMonths)].color;
        const headerBadge =
          b.soonestMonths != null
            ? `<span style="font-size:10px; padding:2px 6px; border-radius:9999px; background:${headerColor}22; color:${headerColor}; font-weight:600;">Next: ${b.soonestMonths} mo · ${formatDate(b.soonestEndDate)}</span>`
            : `<span style="font-size:10px; color:#71717a;">No future rollover tracked</span>`;

        const html = `
          <div style="font-family: system-ui, sans-serif; color:#e4e4e7; padding:6px; min-width:240px;">
            <div style="font-weight:700; font-size:13px;">${escapeHtml(b.name || b.address)}</div>
            ${b.name ? `<div style="font-size:11px; color:#a1a1aa; margin-bottom:4px;">${escapeHtml(b.address)}</div>` : ""}
            <div style="font-size:11px; color:#a1a1aa; margin-bottom:6px;">
              ${escapeHtml([b.city, b.state].filter(Boolean).join(", "))}${b.propertyClass ? ` · Class ${escapeHtml(b.propertyClass)}` : ""}
            </div>
            ${b.landlord ? `<div style="font-size:11px; margin-bottom:6px;"><span style="color:#a1a1aa;">Owner:</span> <span style="color:#e4e4e7;">${escapeHtml(b.landlord)}</span></div>` : ""}
            <div style="margin-bottom:6px;">${headerBadge}</div>
            <div style="font-size:10px; text-transform:uppercase; letter-spacing:0.05em; color:#71717a; margin-top:4px;">
              ${b.tenants.length} ${b.tenants.length === 1 ? "tenant" : "tenants"}
            </div>
            ${tenantRows}
            ${moreLabel}
            <a href="/buildings?id=${b.id}" style="display:inline-block; margin-top:8px; font-size:11px; color:#3B82F6; text-decoration:none; font-weight:500;">Open in Buildings &rarr;</a>
          </div>`;

        const popup = new maplibregl.Popup({ offset: 12, closeButton: true, maxWidth: "320px" })
          .setLngLat([b.lng, b.lat])
          .setHTML(html)
          .addTo(map.current!);
        popupRef.current = popup;
      });

      markersRef.current.push(marker);
    }
  }, [filtered, heatmapOn]);

  const syncHeatmap = useCallback(() => {
    if (!map.current) return;
    const m = map.current;
    const geojson: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: filtered.map((b) => ({
        type: "Feature" as const,
        properties: { weight: Math.max(1, b.tenants.length) },
        geometry: { type: "Point" as const, coordinates: [b.lng, b.lat] },
      })),
    };
    const src = m.getSource("buildings-heat") as maplibregl.GeoJSONSource | undefined;
    if (src) src.setData(geojson);
    else m.addSource("buildings-heat", { type: "geojson", data: geojson });

    if (!m.getLayer("buildings-heatmap")) {
      m.addLayer({
        id: "buildings-heatmap",
        type: "heatmap",
        source: "buildings-heat",
        paint: {
          "heatmap-weight": ["get", "weight"],
          "heatmap-intensity": 1.4,
          "heatmap-radius": 28,
          "heatmap-opacity": 0.75,
          "heatmap-color": [
            "interpolate", ["linear"], ["heatmap-density"],
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
    m.setLayoutProperty("buildings-heatmap", "visibility", heatmapOn ? "visible" : "none");
  }, [filtered, heatmapOn]);

  // Initialize map. Center over North County SD (Carlsbad-ish), zoom 9.
  useEffect(() => {
    if (!mapContainer.current || map.current) return;
    const container = mapContainer.current;
    const m = new maplibregl.Map({
      container,
      style: DARK_STYLE,
      center: [-117.25, 33.15],
      zoom: 9,
    });
    m.addControl(new maplibregl.NavigationControl(), "bottom-right");
    m.on("load", () => {
      map.current = m;
      // Auto-fit to data if there's any.
      if (buildings.length > 0) {
        const bounds = new maplibregl.LngLatBounds();
        for (const b of buildings) bounds.extend([b.lng, b.lat]);
        m.fitBounds(bounds, { padding: 60, maxZoom: 12, duration: 0 });
      }
      syncMarkers();
      syncHeatmap();
    });
    // The map's <div> often measures 0×0 the moment MapLibre initializes
    // (between hydration and final layout). MapLibre creates a 0-sized
    // canvas in that case and never recovers without an explicit resize.
    // ResizeObserver re-fires every time the layout shifts — calling
    // resize() is cheap and idempotent.
    const ro = new ResizeObserver(() => m.resize());
    ro.observe(container);
    return () => {
      ro.disconnect();
      m.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!map.current) return;
    syncMarkers();
    syncHeatmap();
  }, [syncMarkers, syncHeatmap]);

  return (
    // `fixed inset-0 left-64` pins the map to the viewport directly,
    // sidestepping any parent `height: 100vh` quirks and guaranteeing the
    // canvas has real dimensions before MapLibre measures it. The 64=16rem
    // left offset matches the sidebar width.
    <div className="fixed inset-0 left-64">
      {/*
        MapLibre adds inline `position: relative` to its container, which
        nullifies any `position: absolute; inset: 0` we'd put here. Use
        explicit width/height so the size doesn't depend on positioning.
      */}
      <div ref={mapContainer} className="w-full h-full" />

      {buildings.length === 0 && (
        <div className="pointer-events-none absolute inset-x-0 top-4 z-10 flex justify-center">
          <div className="pointer-events-auto rounded-lg border border-zinc-700 bg-zinc-900/90 px-5 py-3 text-sm text-zinc-300 shadow-lg backdrop-blur">
            <MapPin className="mr-2 inline-block h-4 w-4 text-zinc-500" />
            No buildings have been geocoded yet. Run /api/admin/geocode-buildings.
          </div>
        </div>
      )}

      {/* Heatmap toggle */}
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

      {/* Filter toggle */}
      <div className="absolute left-4 top-4 z-10">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setSidebarOpen((v) => !v)}
          className="border-zinc-700 bg-zinc-900/80 text-zinc-300 hover:bg-zinc-800 backdrop-blur"
        >
          {sidebarOpen ? <X className="mr-2 h-4 w-4" /> : <Filter className="mr-2 h-4 w-4" />}
          Filters
          {filtered.length !== buildings.length && (
            <Badge variant="secondary" className="ml-2 bg-blue-600/20 text-blue-400 text-[10px] px-1.5">
              {filtered.length}
            </Badge>
          )}
        </Button>
      </div>

      {/* Filter sidebar */}
      {sidebarOpen && (
        <div className="absolute left-4 top-14 z-10 w-64 rounded-lg border border-zinc-700 bg-zinc-900/90 shadow-xl backdrop-blur">
          <div className="p-4 space-y-4">
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">
                Search
              </p>
              <Input
                value={filters.search}
                onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
                placeholder="Name, address, tenant, owner..."
                className="h-8 border-zinc-700 bg-zinc-800 text-xs text-zinc-300 placeholder:text-zinc-600"
              />
            </div>

            <Separator className="bg-zinc-700" />

            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">
                City
              </p>
              <select
                value={filters.city}
                onChange={(e) => setFilters((f) => ({ ...f, city: e.target.value }))}
                className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-300 outline-none focus:border-blue-500"
              >
                <option value="">All Cities</option>
                {cities.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>

            <Separator className="bg-zinc-700" />

            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">
                Soonest Rollover Within
              </p>
              <div className="grid grid-cols-2 gap-1">
                {ROLLOVER_OPTIONS.map((opt) => (
                  <button
                    key={opt.v}
                    type="button"
                    onClick={() => setFilters((f) => ({ ...f, rolloverWindow: opt.v }))}
                    className={`px-2 py-1 text-xs rounded border transition-colors ${
                      filters.rolloverWindow === opt.v
                        ? "border-blue-500 bg-blue-500/20 text-blue-300"
                        : "border-zinc-700 bg-zinc-800 text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    {opt.l}
                  </button>
                ))}
              </div>
            </div>

            <Separator className="bg-zinc-700" />

            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">
                Min Tenants
              </p>
              <Input
                type="number"
                placeholder="0"
                value={filters.minTenants}
                onChange={(e) => setFilters((f) => ({ ...f, minTenants: e.target.value }))}
                className="h-8 border-zinc-700 bg-zinc-800 text-xs text-zinc-300 placeholder:text-zinc-600"
              />
            </div>

            <Separator className="bg-zinc-700" />

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

      {/* Legend */}
      <div className="absolute bottom-4 left-4 z-10 rounded-lg border border-zinc-700 bg-zinc-900/90 px-3 py-2 text-[11px] text-zinc-300 shadow backdrop-blur">
        <div className="font-semibold uppercase tracking-wider text-zinc-500 mb-1.5 text-[10px]">
          Next Rollover
        </div>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: URGENCY.red.color }} />≤6mo</span>
          <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: URGENCY.amber.color }} />≤12mo</span>
          <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: URGENCY.blue.color }} />≤24mo</span>
          <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: URGENCY.gray.color }} />other</span>
        </div>
      </div>
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
