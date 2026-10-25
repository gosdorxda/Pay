"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Breadcrumbs } from "@heroui/react";
import { Icon, ThemeToggle } from "@/components/ui";
import { INFORMATION, NAV } from "@/components/nav";
import { useSite } from "@/components/providers/SiteProvider";

export function AppShell({
  title = "Home",
  children,
}: {
  title?: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { brandName } = useSite();
  const brandInitial = brandName.trim().charAt(0).toUpperCase() || "P";
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const isActive = (href: string) => {
    if (href.startsWith("#")) return false;
    if (href === "/") return pathname === "/";
    return pathname === href || pathname.startsWith(href + "/");
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r border-(--border) bg-surface transition-[width,transform] duration-200 lg:translate-x-0 ${collapsed ? "lg:w-[68px]" : ""} ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`}
      >
        <div className={`flex h-14 shrink-0 items-center gap-2 border-b border-(--border) px-4 ${collapsed ? "lg:justify-center" : ""}`}>
          <Link href="/" className="flex items-center gap-2" aria-label={`${brandName} home`}>
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent/15 text-sm font-bold text-accent">{brandInitial}</span>
            {!collapsed && <span className="font-bold tracking-tight">{brandName}</span>}
          </Link>
        </div>
        <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-3">
          {NAV.map((item) => {
            const active = isActive(item.href);
            const cls = `flex items-center gap-3 rounded-md px-3 py-2 text-sm transition w-full text-left ${collapsed ? "lg:justify-center lg:px-0" : ""} ${active ? "bg-default font-medium text-foreground" : "font-medium text-muted hover:bg-default/40 hover:text-foreground"}`;
            const inner = (
              <>
                <Icon name={item.icon} className="shrink-0 text-(--nav-icon)" />
                <span className={collapsed ? "lg:hidden" : ""}>{item.label}</span>
              </>
            );
            if (item.href.startsWith("#")) {
              return (
                <a
                  key={item.label}
                  href={"/" + item.href}
                  onClick={() => setMobileOpen(false)}
                  title={collapsed ? item.label : undefined}
                  aria-current={active ? "page" : undefined}
                  className={cls}
                >
                  {inner}
                </a>
              );
            }
            return (
              <Link
                key={item.label}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                title={collapsed ? item.label : undefined}
                aria-current={active ? "page" : undefined}
                className={cls}
              >
                {inner}
              </Link>
            );
          })}
          {/* Information — external community links pinned to the bottom of the
              nav (the grouping otcdesks.cash uses for Docs / Terms / X, minus
              the docs and terms pages this project doesn't have). */}
          <div className="mt-auto flex flex-col gap-1 pt-2">
            <span
              className={`px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted ${collapsed ? "lg:hidden" : ""}`}
            >
              Information
            </span>
            {INFORMATION.map((item) => (
              <a
                key={item.label}
                href={item.href}
                target="_blank"
                rel="noreferrer noopener"
                onClick={() => setMobileOpen(false)}
                title={collapsed ? item.label : undefined}
                className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted transition hover:bg-default/40 hover:text-foreground ${collapsed ? "lg:justify-center lg:px-0" : ""}`}
              >
                <Icon name={item.icon} className="shrink-0 text-(--nav-icon)" />
                <span className={collapsed ? "lg:hidden" : ""}>{item.label}</span>
                <Icon
                  name="arrow-up-right"
                  className={`ml-auto h-3.5 w-3.5 opacity-50 ${collapsed ? "lg:hidden" : ""}`}
                />
              </a>
            ))}
          </div>
        </nav>
        <div className="hidden shrink-0 border-t border-(--border) p-3 lg:block">
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            className="flex items-center gap-2 text-xs text-muted transition hover:text-foreground"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <Icon name={collapsed ? "expand" : "collapse"} />
            {!collapsed && <span>Collapse</span>}
          </button>
        </div>
      </aside>

      <div className={`transition-[padding] duration-200 ${collapsed ? "lg:pl-[68px]" : "lg:pl-60"}`}>
        <header className="sticky top-0 z-20 border-b border-(--border) bg-surface/80 backdrop-blur">
          <div className="flex h-14 items-center gap-3 px-6">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="flex h-9 w-9 items-center justify-center rounded-md text-muted transition hover:bg-default/40 hover:text-foreground lg:hidden"
              aria-label="Open menu"
            >
              <Icon name="menu" />
            </button>
            <Breadcrumbs isDisabled>
              <Breadcrumbs.Item href="/">{brandName}</Breadcrumbs.Item>
              <Breadcrumbs.Item>{title}</Breadcrumbs.Item>
            </Breadcrumbs>
            <div className="ml-auto flex items-center gap-4">
              <ThemeToggle />
            </div>
          </div>
        </header>

        {children}
      </div>
    </div>
  );
}
