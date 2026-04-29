"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  Building2,
  Building,
  Activity,
  Map,
  FolderSearch,
  CalendarClock,
  LogOut,
  Sparkles,
} from "lucide-react";

const nav = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/contacts", label: "Contacts", icon: Users },
  { href: "/deals", label: "Deals", icon: Building2 },
  { href: "/buildings", label: "Buildings", icon: Building },
  { href: "/library", label: "Library", icon: FolderSearch },
  { href: "/leases", label: "Expiring Leases", icon: CalendarClock },
  { href: "/activities", label: "Activities", icon: Activity },
  { href: "/map", label: "Map", icon: Map },
  { href: "/enrich", label: "Bulk Enrich", icon: Sparkles },
];

export function Sidebar() {
  const pathname = usePathname();

  // Login screen shouldn't show the nav (and clicks on it would just bounce
  // back through the auth proxy).
  if (pathname === "/login") return null;

  return (
    <aside className="fixed left-0 top-0 z-40 h-screen w-64 border-r border-border bg-card flex flex-col">
      <div className="p-6 border-b border-border">
        <h1 className="text-xl font-bold tracking-tight">
          <span className="text-primary">Bobby</span>
          <span className="text-muted-foreground ml-1 font-normal text-sm">BD Dashboard</span>
        </h1>
      </div>

      <nav className="flex-1 p-4 space-y-1">
        {nav.map(({ href, label, icon: Icon }) => {
          const isActive = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors ${
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="p-4 border-t border-border space-y-2">
        <button
          type="button"
          onClick={async () => {
            await fetch("/api/logout", { method: "POST" });
            window.location.assign("/login");
          }}
          className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <LogOut className="h-3.5 w-3.5" />
          Sign out
        </button>
        <div className="text-xs text-muted-foreground">
          Bobby BD Dashboard v0.1
        </div>
      </div>
    </aside>
  );
}
