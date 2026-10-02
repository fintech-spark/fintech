import type { Metadata } from "next";

import { Geist, Geist_Mono } from "next/font/google";

import { AppProviders } from "@/components/layout/app-providers";
import { cn } from "@/lib/utils";

import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });
// A restrained monospace for ids, references and money in tables. The token
// `--font-mono` previously pointed at a variable that was never loaded, so any
// `font-mono` usage silently fell back to the sans face.
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

export const metadata: Metadata = {
  title: {
    default: "Merchant Brain",
    template: "%s · Merchant Brain",
  },
  description:
    "Merchant Brain understands a small merchant's business data, explains what changed and why, and prepares safe actions for the merchant to approve.",
  applicationName: "Merchant Brain",
  robots: { index: false, follow: false },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  // Zoom is never disabled — see the web interface guidelines.
  themeColor: "#fbfbfc",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // `data-scroll-behavior` tells Next that smooth scrolling is deliberate, so
    // it does not disable it during route transitions and warn on every
    // navigation.
    <html
      lang="en"
      data-scroll-behavior="smooth"
      className={cn(geist.variable, geistMono.variable)}
    >
      <body className="font-sans antialiased">
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}