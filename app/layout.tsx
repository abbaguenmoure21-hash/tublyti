import type { Metadata } from "next";
import { Geist, Geist_Mono, Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  display: "swap",
});

const SITE_TITLE = 'TubLyTI · Les sujets de vidéos que ton public attend';
const SITE_DESCRIPTION = 'TubLyTI te montre les sujets que ton public réclame, avant que d’autres chaînes ne les traitent.';
const siteUrl = process.env.NEXT_PUBLIC_APP_URL;

export const metadata: Metadata = {
  title: {
    default: 'TubLyTI',
    template: '%s · TubLyTI',
  },
  description: SITE_DESCRIPTION,
  ...(siteUrl ? { metadataBase: new URL(siteUrl) } : {}),
  openGraph: {
    siteName: 'TubLyTI',
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    locale: 'fr_FR',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
  icons: {
    icon: '/favicon.svg',
  },
};

import { ThemeProvider } from 'next-themes';

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="fr"
      className={`${geistSans.variable} ${geistMono.variable} ${inter.variable} ${jetbrainsMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
