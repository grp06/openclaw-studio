"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Users, Activity, Calendar, Search, ClipboardList, Clock } from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
}

const navItems: NavItem[] = [
  { href: "/", label: "Agents", icon: <Users size={18} /> },
  { href: "/activity", label: "Activity", icon: <Activity size={18} /> },
  { href: "/calendar", label: "Calendar", icon: <Calendar size={18} /> },
  { href: "/search", label: "Search", icon: <Search size={18} /> },
  { href: "/tasks", label: "Tasks", icon: <ClipboardList size={18} /> },
  { href: "/cron", label: "Cron", icon: <Clock size={18} /> },
];

export function AppNav() {
  const pathname = usePathname();

  return (
    <nav
      className="flex flex-col gap-1 p-2 border-r border-zinc-800 bg-zinc-950 w-14 hover:w-44 transition-all duration-200 group overflow-hidden shrink-0"
      aria-label="Main navigation"
    >
      {navItems.map((item) => {
        const isActive =
          item.href === "/"
            ? pathname === "/"
            : pathname.startsWith(item.href);

        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium whitespace-nowrap transition-colors ${
              isActive
                ? "bg-zinc-800 text-white"
                : "text-zinc-400 hover:text-white hover:bg-zinc-800/50"
            }`}
            aria-current={isActive ? "page" : undefined}
          >
            <span className="shrink-0">{item.icon}</span>
            <span className="opacity-0 group-hover:opacity-100 transition-opacity duration-200">
              {item.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
