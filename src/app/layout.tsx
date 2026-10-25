import type { Metadata } from "next";
import Script from "next/script";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import { Providers } from "@/components/providers/Providers";
import { SiteProvider } from "@/components/providers/SiteProvider";
import { getSiteSeo, parseFavicon } from "@/lib/seo";
import { getPaletteCss } from "@/lib/palette";

/**
 * Geist (Vercel) — the single global font family, used for both sans and mono.
 * GeistSans.variable defines --font-geist-sans; GeistMono.variable defines
 * --font-geist-mono. The @theme block in globals.css maps --font-sans and
 * --font-mono to them, so the entire UI (including HeroUI components) renders
 * in Geist. Both are variable fonts (multiple weights, true bold).
 */

/**
 * SEO + branding are editable from /admin → SEO. They are read per request and
 * cached as ISR; saving in the admin calls revalidatePath("/", "layout") so the
 * new <title>, meta tags, wordmark and GA tag appear immediately.
 */
export const revalidate = 300;

export async function generateMetadata(): Promise<Metadata> {
  const seo = await getSiteSeo();

  let metadataBase: URL | undefined;
  if (seo.siteUrl) {
    try {
      metadataBase = new URL(seo.siteUrl);
    } catch {
      metadataBase = undefined;
    }
  }

  const images = seo.ogImage
    ? [{ url: seo.ogImage, width: 1200, height: 630, alt: seo.siteTitle }]
    : undefined;
  const handle = seo.twitterHandle ? `@${seo.twitterHandle}` : undefined;
  const favicon = parseFavicon(seo.favicon);
  const icons = favicon
    ? {
        icon: [{ url: "/api/favicon", type: favicon.mime }],
        shortcut: [{ url: "/api/favicon", type: favicon.mime }],
      }
    : undefined;

  return {
    metadataBase,
    title: {
      default: seo.siteTitle,
      template: `%s · ${seo.brandName}`,
    },
    description: seo.description,
    keywords: seo.keywords
      ? seo.keywords.split(",").map((k) => k.trim()).filter(Boolean)
      : undefined,
    applicationName: seo.brandName,
    icons,
    authors: [{ name: seo.brandName }],
    creator: seo.brandName,
    publisher: seo.brandName,
    alternates: metadataBase ? { canonical: "/" } : undefined,
    robots: seo.allowIndexing
      ? { index: true, follow: true }
      : { index: false, follow: false },
    verification: seo.googleSiteVerification
      ? { google: seo.googleSiteVerification }
      : undefined,
    openGraph: {
      type: "website",
      siteName: seo.brandName,
      title: seo.siteTitle,
      description: seo.description,
      url: metadataBase ? "/" : undefined,
      images,
      locale: "en_US",
    },
    twitter: {
      card: images ? "summary_large_image" : "summary",
      title: seo.siteTitle,
      description: seo.description,
      site: handle,
      creator: handle,
      images: images?.map((img) => img.url),
    },
  };
}

/**
 * Applied synchronously, before first paint, to set the `data-theme` attribute
 * on <html> from the stored preference (defaulting to dark). Prevents a flash
 * of the wrong theme. HeroUI v3 drives dark mode via `[data-theme="dark"]` CSS.
 */
const themeInitScript = `(function(){try{var t=localStorage.getItem('theme');var d=t?t==='dark':true;document.documentElement.setAttribute('data-theme',d?'dark':'light');}catch(e){document.documentElement.setAttribute('data-theme','dark');}})();`;

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const seo = await getSiteSeo();
  // Admin → Palette overrides, injected after globals.css. Empty when nothing
  // has been overridden, in which case no <style> tag is rendered at all.
  const paletteCss = await getPaletteCss();
  // Re-validate before injecting: a stale malformed value must never end up in
  // an inline <script>.
  const gaId = /^G-[A-Z0-9]{4,20}$/i.test(seo.gaMeasurementId)
    ? seo.gaMeasurementId
    : "";

  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${GeistSans.variable} ${GeistMono.variable}`}
    >
      <body className="font-sans">
        {paletteCss ? (
          <style
            id="theme-palette"
            dangerouslySetInnerHTML={{ __html: paletteCss }}
          />
        ) : null}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        {gaId ? (
          <>
            <Script
              src={`https://www.googletagmanager.com/gtag/js?id=${gaId}`}
              strategy="afterInteractive"
            />
            <Script id="ga-init" strategy="afterInteractive">
              {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${gaId}');`}
            </Script>
          </>
        ) : null}
        <Providers>
          <SiteProvider
            value={{
              brandName: seo.brandName,
              siteTitle: seo.siteTitle,
              description: seo.description,
            }}
          >
            {children}
          </SiteProvider>
        </Providers>
      </body>
    </html>
  );
}

