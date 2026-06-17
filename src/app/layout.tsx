import type { Metadata } from "next";
import { Michroma, Chakra_Petch, JetBrains_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { ThemeProvider } from "@/lib/usePalette";
import DemoBanner from "@/components/DemoBanner";
import "./globals.css";

const michroma = Michroma({
  variable: "--font-michroma",
  weight: "400",
  subsets: ["latin"],
});

const chakra = Chakra_Petch({
  variable: "--font-chakra",
  weight: ["300", "400", "500", "600"],
  subsets: ["latin"],
});

const jbMono = JetBrains_Mono({
  variable: "--font-jbmono",
  subsets: ["latin"],
});

const siteUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "Warpchart",
  description:
    "Live growth telemetry for an open source repository: star velocity, worldwide rank and the route to the galactic core.",
  openGraph: {
    title: "Warpchart",
    description:
      "Live growth telemetry: star velocity, worldwide rank and the route to the galactic core.",
    images: ["/api/og"],
  },
};

// Applies the resolved scheme before first paint (no flash). Mirrors the
// logic in ThemeProvider; localStorage "mc_theme" overrides the OS scheme.
const themeInit = `(function(){try{var m=localStorage.getItem("mc_theme");var l=m==="light"||(m!=="dark"&&window.matchMedia("(prefers-color-scheme: light)").matches);if(l)document.documentElement.classList.add("scheme-light");}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${michroma.variable} ${chakra.variable} ${jbMono.variable} antialiased`}
      suppressHydrationWarning
    >
      <body>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
        <ThemeProvider>
          <div className="space-backdrop" aria-hidden />
          <div className="space-grid" aria-hidden />
          <div className="starfield" aria-hidden />
          <DemoBanner />
          {children}
        </ThemeProvider>
        <Analytics />
      </body>
    </html>
  );
}
