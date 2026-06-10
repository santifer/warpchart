import type { Metadata } from "next";
import { Michroma, Chakra_Petch, JetBrains_Mono } from "next/font/google";
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

export const metadata: Metadata = {
  title: "Mission Control",
  description:
    "Live growth telemetry for an open source repository: star velocity, worldwide rank and the route to the galactic core.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${michroma.variable} ${chakra.variable} ${jbMono.variable} antialiased`}
    >
      <body>
        <div className="space-backdrop" aria-hidden />
        <div className="space-grid" aria-hidden />
        <div className="starfield" aria-hidden />
        {children}
      </body>
    </html>
  );
}
