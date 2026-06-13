import type { Metadata } from "next";
import { Space_Grotesk } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { DailyBonusToast } from "@/components/daily-bonus-toast";
import { ThemeProvider, themeScript } from "@/components/theme-provider";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Friendly Bets",
  description: "World Cup 2026 prediction game for family & friends.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${spaceGrotesk.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/* Sets the .dark class before first paint so there's no flash of
            the wrong theme — see ThemeProvider. */}
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-full flex flex-col">
        <ThemeProvider>
          {children}
          <DailyBonusToast />
        </ThemeProvider>
        <Analytics />
      </body>
    </html>
  );
}
