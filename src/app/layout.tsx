import type { Metadata, Viewport } from "next";
import { Fraunces, Geist, Geist_Mono } from "next/font/google";
import "maplibre-gl/dist/maplibre-gl.css";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  axes: ["opsz", "SOFT"],
});

export const metadata: Metadata = {
  title: "Harharetki – navigaattori, joka eksyttää sinut",
  description:
    "Harharetki ei etsi nopeinta reittiä vaan kiinnostavimman. Valitse maisema-, historia- tai yllätysretki ja löydä tutusta kaupungista jotain uutta. Rakennettu OpenStreetMapin avulla.",
};

export const viewport: Viewport = {
  themeColor: "#f6f2ea",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // Browser extensions (e.g. ones adding data-* attributes to <html>) would otherwise trigger a
    // hydration warning; this only ignores attribute differences on this one element.
    <html
      suppressHydrationWarning
      lang="fi"
      className={`${geistSans.variable} ${geistMono.variable} ${fraunces.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
