// Font loading via next/font eliminates the render-blocking CSS @import that
// globals.css previously used. next/font self-hosts font files and sets the
// CSS variable names declared in tailwind.config.ts / globals.css so the rest
// of the app continues to work with var(--font-display) etc. unchanged.
import { Crimson_Pro, IBM_Plex_Mono, DM_Sans } from "next/font/google";
import "@solana/wallet-adapter-react-ui/styles.css";
import "./globals.css";
import { WalletProvider }    from "@/providers/WalletProvider";
import { ToastProvider }     from "@/components/ToastProvider";
import { PWAInstallBanner }  from "@/components/PWAInstallBanner";
import type { Metadata, Viewport } from "next";

// ── Google Fonts loaded through next/font (no render-blocking @import) ────────

const crimsonPro = Crimson_Pro({
  subsets:  ["latin"],
  weight:   ["300", "400", "600"],
  style:    ["normal", "italic"],
  variable: "--font-display",
  display:  "swap",
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets:  ["latin"],
  weight:   ["400", "500"],
  variable: "--font-mono",
  display:  "swap",
});

const dmSans = DM_Sans({
  subsets:  ["latin"],
  weight:   ["300", "400", "500"],
  variable: "--font-body",
  display:  "swap",
});

// ── Metadata ──────────────────────────────────────────────────────────────────

export const metadata: Metadata = {
  title:       "Legacy Protocol — On-Chain Inheritance",
  description: "A Solana dead-man's switch for automated inheritance. Your assets, your rules.",
  manifest:    "/manifest.json",
  openGraph: {
    title:       "Legacy Protocol",
    description: "Automated on-chain inheritance on Solana.",
    type:        "website",
  },
  appleWebApp: {
    capable:        true,
    title:          "Legacy Protocol",
    statusBarStyle: "black-translucent",
  },
  icons: {
    apple: "/icon-192.png",
    icon:  "/icon-192.png",
  },
};

export const viewport: Viewport = {
  themeColor:   "#F59E0B",
  width:        "device-width",
  initialScale: 1,
  minimumScale: 1,
  viewportFit:  "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Applying all three font variable classes to <html> sets the CSS custom
  // properties (--font-display, --font-mono, --font-body) on the root element
  // so every descendant can resolve var(--font-display) etc. correctly.
  return (
    <html
      lang="en"
      className={`${crimsonPro.variable} ${ibmPlexMono.variable} ${dmSans.variable}`}
    >
      <body>
        <WalletProvider>
          <ToastProvider>
            {children}
            <PWAInstallBanner />
          </ToastProvider>
        </WalletProvider>
      </body>
    </html>
  );
}
