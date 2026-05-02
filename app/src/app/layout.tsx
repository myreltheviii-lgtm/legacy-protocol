import type { Metadata, Viewport } from "next";
import "@solana/wallet-adapter-react-ui/styles.css";
import "./globals.css";
import { WalletProvider } from "@/providers/WalletProvider";

export const metadata: Metadata = {
  title:       "Legacy Protocol — On-Chain Inheritance",
  description: "A Solana dead-man's switch for automated inheritance. Your assets, your rules.",
  manifest:    "/manifest.json",
  openGraph: {
    title:       "Legacy Protocol",
    description: "Automated on-chain inheritance on Solana.",
    type:        "website",
  },
  // PWA meta tags so iOS and Android home-screen installs get the correct
  // icon, theme colour, and standalone display mode.
  appleWebApp: {
    capable:    true,
    title:      "Legacy Protocol",
    statusBarStyle: "black-translucent",
  },
  icons: {
    apple: "/icon-192.png",
    icon:  "/icon-192.png",
  },
};

export const viewport: Viewport = {
  themeColor:        "#F59E0B",
  width:             "device-width",
  initialScale:      1,
  minimumScale:      1,
  viewportFit:       "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <WalletProvider>
          {children}
        </WalletProvider>
      </body>
    </html>
  );
}