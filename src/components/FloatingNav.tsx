"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button, Tooltip } from "@heroui/react";
import { Icon, ThemeToggle } from "@/components/ui";
import { BrandMark } from "@/components/BrandMark";
import { INFORMATION, NAV, isNavActive } from "@/components/nav";
import { useSite } from "@/components/providers/SiteProvider";

/**
 * UI v2 navigation — a floating pill instead of the left sidebar.
 *
 * The nav is a rounded, bordered surface that hovers over the page (sticky +
 * inset), so content below runs edge to edge. On large screens it is one row:
 * brand → links → actions. Below `lg` the links collapse into a sheet that
 * drops from the pill.
 *
 * Theme tokens only (`bg-surface`, `border-(--border)`, `text-muted`,
 * `bg-default/40`) — no raw Tailwind colours, so light/dark both work.
 *
 * The active row uses the same `isNavActive()` helper as the sidebar, so
 * `/rounds/37` still lights up "Draws" and v1/v2 can never disagree.
 */
export function FloatingNav() {
  const pathname = usePathname();
  const { brandName, social } = useSite();
  const [open, setOpen] = useState(false);
  // Scroll direction: the bar pages away going down and comes back going up.
  // `hidden` starts false so the nav is present on first paint (no flash).
  const [hidden, setHidden] = useState(false);

  // Hide on scroll down, reveal on scroll up. A small threshold keeps trackpad
  // jitter from flickering it, and the bar never hides near the very top so the
  // brand/nav is always there when the page is at rest.
  useEffect(() => {
    let lastY = window.scrollY;
    let ticking = false;
    const THRESHOLD = 8; // px of travel before flipping state
    const TOP_ZONE = 72; // always visible above this scroll offset

    const update = () => {
      const y = window.scrollY;
      const delta = y - lastY;
      if (Math.abs(delta) > THRESHOLD) {
        if (y < TOP_ZONE) setHidden(false);
        else setHidden(delta > 0);
        lastY = y;
      }
      ticking = false;
    };

    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(update);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // An open sheet must never be scrolled out of reach.
  useEffect(() => {
    if (open) setHidden(false);
  }, [open]);

  // Same Admin → SEO contract as the sidebar: an empty URL hides the entry.
  const socialLinks = INFORMATION.map((item) => ({
    ...item,
    href:
      item.icon === "x"
        ? social.x
        : item.icon === "telegram"
          ? social.telegram
          : "",
  })).filter((item) => item.href.trim().length > 0);

  // Close the sheet on navigation and on Escape; lock the page behind it.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const desktop = window.matchMedia("(min-width: 1024px)");
    const onResize = () => {
      if (desktop.matches) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    desktop.addEventListener("change", onResize);
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      desktop.removeEventListener("change", onResize);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      {/* Simple dim behind the mobile sheet — no blur, instant on/off. */}
      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/55 lg:hidden"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Fixed (not sticky) so it can slide away entirely: `translate` is the
          animated property (Tailwind v4 compiles translate-* to the CSS
          `translate` property, so transitioning `transform` would do nothing).
          Wrapper still mirrors the page container (`max-w-7xl` + matching
          padding) so the pill's edges line up with the content below.
          The pill and the sheet share ONE bordered box, which is what keeps
          them the same width. */}
      <div
        className={`pointer-events-none fixed inset-x-0 top-0 z-40 transition-[translate] duration-300 ease-out motion-reduce:transition-none ${
          hidden ? "-translate-y-[130%]" : "translate-y-0"
        }`}
        aria-hidden={hidden}
      >
        {/* Blur backdrop behind the whole nav strip (not just the pill). Without
            it, page content slid past in the gaps around the pill and looked
            like it was colliding with the bar. The mask fades the blur out at
            the bottom edge so there is no hard seam, and it travels with the
            nav (it lives inside this translated wrapper). */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-background/70 backdrop-blur-md [mask-image:linear-gradient(to_bottom,black_55%,transparent)] [-webkit-mask-image:linear-gradient(to_bottom,black_55%,transparent)]"
        />
        <div className="pointer-events-auto relative mx-auto w-full max-w-7xl px-4 pt-2 sm:px-6 sm:pt-3 lg:px-10">
          <div className="relative overflow-hidden rounded-2xl border border-(--border) bg-surface/85 backdrop-blur-2xl">
            <nav
              aria-label="Site navigation"
              className="relative flex h-14 items-center gap-2 px-3 sm:px-4"
            >
            <Link
              href="/"
              className="flex shrink-0 items-center gap-2"
              aria-label={`${brandName} home`}
            >
              <BrandMark brandName={brandName} />
              <span className="truncate font-bold tracking-tight">
                {brandName}
              </span>
            </Link>

            {/* Desktop links — absolutely centred on the pill, so the row sits
                in the middle of the navbar no matter how wide the brand (left)
                or the actions (right) are. `left-1/2 -translate-x-1/2` is used
                instead of auto margins because the two side groups have
                different widths and would push the row off-centre. No
                pill/background in any state: the active item is full-contrast
                text, hover lifts the muted grey to the same foreground. */}
            <div className="pointer-events-none absolute left-1/2 hidden -translate-x-1/2 items-center gap-0.5 lg:flex">
              {NAV.map((item) => {
                const active = isNavActive(pathname, item.href);
                return (
                  <Link
                    key={item.label}
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={`nav-link pointer-events-auto flex items-center rounded-lg px-2.5 py-1.5 text-[13px] transition-colors duration-150 motion-reduce:transition-none ${
                      active
                        ? "font-medium text-foreground"
                        : "font-normal text-muted hover:text-foreground"
                    }`}
                  >
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </div>

            <div className="ml-auto flex items-center gap-1.5">
              <SocialLinks links={socialLinks} className="hidden items-center gap-0.5 lg:flex" />
              <ThemeToggle />
              <Button
                isIconOnly
                size="sm"
                variant="ghost"
                aria-label={open ? "Close menu" : "Open menu"}
                aria-expanded={open}
                onPress={() => setOpen((o) => !o)}
                className="lg:hidden"
              >
                <Icon name={open ? "close" : "menu"} className="h-4 w-4" />
              </Button>
            </div>
            </nav>

            {/* Sheet lives inside the pill's box → identical width. Rounded
                bottom corners are re-applied on the panel itself because the
                shared box is `overflow-hidden`. */}
            <MobileSheet open={open} socialLinks={socialLinks} />
          </div>
        </div>
      </div>
    </>
  );
}

/** Social icon row (desktop pill). Empty list renders nothing. */
function SocialLinks({
  links,
  className = "",
}: {
  links: { label: string; href: string; icon: string }[];
  className?: string;
}) {
  if (links.length === 0) return null;
  return (
    <div className={className}>
      {links.map((item) => (
        <Tooltip key={item.label} delay={150}>
          <Tooltip.Trigger>
            <a
              href={item.href}
              target="_blank"
              rel="noreferrer noopener"
              aria-label={item.label}
              className="flex h-9 w-9 items-center justify-center rounded-xl text-muted transition-colors duration-150 hover:bg-default/40 hover:text-foreground motion-reduce:transition-none"
            >
              <Icon name={item.icon} className="h-4 w-4" />
            </a>
          </Tooltip.Trigger>
          <Tooltip.Content className="max-w-[16rem] text-xs leading-snug">
            {item.label}
          </Tooltip.Content>
        </Tooltip>
      ))}
    </div>
  );
}

/**
 * Phone menu — drops from the pill. Deliberately simple: no per-row stagger,
 * no scale, just a short opacity fade, and it is unmounted when closed so the
 * page below can never pick up phantom spacing.
 */
function MobileSheet({
  open,
  socialLinks,
}: {
  open: boolean;
  socialLinks: { label: string; href: string; icon: string }[];
}) {
  const pathname = usePathname();
  if (!open) return null;
  return (
    <div className="mobile-sheet-in border-t border-(--border) lg:hidden">
      <div className="flex flex-col gap-0.5 p-2">
        {NAV.map((item) => {
          const active = isNavActive(pathname, item.href);
          return (
            <Link
              key={item.label}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`nav-link flex items-center px-3 py-2 text-[13px] transition-colors duration-150 motion-reduce:transition-none ${
                active
                  ? "font-medium text-foreground"
                  : "font-normal text-muted hover:text-foreground"
              }`}
            >
              <span>{item.label}</span>
            </Link>
          );
        })}
        {socialLinks.length > 0 && (
          <div className="mt-1 border-t border-(--border) pt-1">
            {socialLinks.map((item) => (
              <a
                key={item.label}
                href={item.href}
                target="_blank"
                rel="noreferrer noopener"
                className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-muted transition-colors duration-150 hover:bg-default/40 hover:text-foreground motion-reduce:transition-none"
              >
                <Icon name={item.icon} className="shrink-0 text-(--nav-icon)" />
                <span>{item.label}</span>
                <Icon
                  name="arrow-up-right"
                  className="ml-auto h-3.5 w-3.5 opacity-50"
                />
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
