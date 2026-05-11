"use client";

// app/src/components/Navbar.tsx
//
// Shared navigation bar used on every page.
// Fixes:
//   — Logo is a <Link href="/"> so it is clickable on every page (was a
//     non-interactive <span> on the home page).
//   — usePathname() highlights the active route so the user can see which
//     page they are on (previously every link was identically styled).
//   — Single source of truth for nav links — no more 5 different inline navs
//     that could drift out of sync.

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import dynamic from "next/dynamic";

const WalletMultiButton = dynamic(
  () => import("@solana/wallet-adapter-react-ui").then((m) => m.WalletMultiButton),
  { ssr: false },
);

const NAV_LINKS: ReadonlyArray<{
  href:  string;
  label: string;
  aria:  string;
  /** Additional pathname prefixes that should also activate this link. */
  alsoActiveFor?: string[];
}> = [
  { href: "/vaults",   label: "My Vaults",  aria: "Open your vault portfolio",       alsoActiveFor: ["/vault/"] },
  { href: "/guardian", label: "Guardian",    aria: "Open guardian dashboard" },
  { href: "/claim",    label: "Claim",       aria: "Open beneficiary claim page" },
  { href: "/recovery", label: "Recovery",    aria: "Open vault recovery assistant" },
];

export function Navbar() {
  const pathname = usePathname();

  function isActive(href: string, alsoActiveFor?: string[]): boolean {
    if (pathname === href) return true;
    if (pathname.startsWith(href + "/")) return true;
    if (alsoActiveFor) {
      return alsoActiveFor.some((prefix) => pathname.startsWith(prefix));
    }
    return false;
  }

  return (
    <nav
      className="flex items-center justify-between px-6 py-4 border-b"
      style={{ borderColor: "var(--border)" }}
      aria-label="Main navigation"
    >
      {/* Logo — Link on every page so it is always clickable */}
      <Link
        href="/"
        className="font-display text-lg text-cream tracking-tight flex-shrink-0"
        aria-label="Back to home"
      >
        Legacy Protocol
      </Link>

      {/* Nav links + wallet button — horizontally scrollable on narrow screens */}
      <div
        className="flex items-center gap-4"
        style={{ overflowX: "auto", WebkitOverflowScrolling: "touch", flexWrap: "nowrap" }}
      >
        {NAV_LINKS.map(({ href, label, aria, alsoActiveFor }) => {
          const active = isActive(href, alsoActiveFor);
          return (
            <Link
              key={href}
              href={href}
              className="text-sm transition-colors whitespace-nowrap"
              style={{
                color:       active ? "var(--text-primary)" : "var(--text-muted)",
                fontWeight:  active ? 500 : 400,
                borderBottom: active ? "1px solid var(--accent)" : "1px solid transparent",
                paddingBottom: "2px",
              }}
              aria-label={aria}
              aria-current={active ? "page" : undefined}
            >
              {label}
            </Link>
          );
        })}
        <WalletMultiButton />
      </div>
    </nav>
  );
}
