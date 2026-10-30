import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

// Geist only (DESIGN.md / design-system font stacks). Inter and JetBrains Mono were preloaded on
// every page for a few headings and numbers; they are no longer referenced by globals.css.
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

// Mono is only used for secondary figures: not worth a preload competing with critical CSS/JS.
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
  preload: false,
});

export const metadata: Metadata = {
  title: {
    default: 'TubLyTI',
    template: '%s · TubLyTI',
  },
  description: "Moteur de détection d'opportunités YouTube par analyse du déséquilibre demande/offre.",
  icons: {
    icon: '/favicon.svg',
  },
};

import { ThemeProvider } from 'next-themes';

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="fr"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
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
