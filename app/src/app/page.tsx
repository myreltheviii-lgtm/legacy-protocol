"use client";
import React from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
const WalletMultiButton = dynamic(() => import("@solana/wallet-adapter-react-ui").then(m => m.WalletMultiButton), { ssr: false });

/**
 * Landing page. Explains the protocol and links to vault creation / search.
 * Wallet connect is in the header — once connected, the user navigates to
 * their vault portfolio, the guardian page, or the claim page.
 */
export default function HomePage() {
  return (
    <main className="min-h-dvh flex flex-col">
      {/* Navigation */}
      <nav
        className="flex items-center justify-between px-6 py-4 border-b"
        style={{ borderColor: "var(--border)" }}
        aria-label="Main navigation"
      >
        <span className="font-display text-lg text-cream tracking-tight">
          Legacy Protocol
        </span>
        <div className="flex items-center gap-4">
          <Link
            href="/vaults"
            className="text-stone-400 text-sm hover:text-cream transition-colors"
            aria-label="Open your vault portfolio"
          >
            My Vaults
          </Link>
          <Link
            href="/guardian"
            className="text-stone-400 text-sm hover:text-cream transition-colors"
            aria-label="Open guardian dashboard"
          >
            Guardian
          </Link>
          <Link
            href="/claim"
            className="text-stone-400 text-sm hover:text-cream transition-colors"
            aria-label="Open beneficiary claim page"
          >
            Claim
          </Link>
          <Link
            href="/recovery"
            className="text-stone-400 text-sm hover:text-cream transition-colors"
            aria-label="Open vault recovery assistant"
          >
            Recovery
          </Link>
          <WalletMultiButton />
        </div>
      </nav>

      {/* Hero */}
      <section
        className="flex-1 flex flex-col items-center justify-center px-6 py-20 text-center"
        style={{
          backgroundImage:
            "radial-gradient(ellipse 60% 40% at 50% 60%, rgba(245,158,11,0.06) 0%, transparent 70%)",
        }}
        aria-labelledby="hero-heading"
      >
        <p className="label text-amber-500 mb-4 tracking-widest">On-Chain Inheritance</p>

        <h1
          id="hero-heading"
          className="font-display text-5xl md:text-7xl text-cream mb-6"
          style={{ maxWidth: "800px", lineHeight: 1.05 }}
        >
          Your legacy,
          <br />
          <span style={{ color: "var(--accent)" }}>on your terms.</span>
        </h1>

        <p
          className="text-stone-400 text-lg mb-10"
          style={{ maxWidth: "520px", lineHeight: 1.7 }}
        >
          A Solana dead-man's switch. Your assets sit in a program-controlled vault.
          If you stop checking in, your designated beneficiary automatically receives them.
          No intermediaries. No lawyers. No trust required.
        </p>

        <div className="flex flex-wrap items-center justify-center gap-3 mb-16">
          <Link href="/vaults" className="btn-primary" aria-label="View your vault portfolio">
            View My Vaults
          </Link>
          <a
            href="https://github.com/legacy-protocol"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-secondary"
            aria-label="View Legacy Protocol on GitHub"
          >
            View source →
          </a>
        </div>

        {/* Feature grid */}
        <div
          className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full"
          style={{ maxWidth: "800px" }}
          aria-label="Protocol features"
        >
          {[
            {
              icon: "🔐",
              title: "Non-custodial",
              desc: "Funds live in a program PDA. No private key controls them — only the program's own instructions can move them.",
            },
            {
              icon: "🛡",
              title: "Guardian council",
              desc: "M-of-N guardians approve emergency sweeps and beneficiary changes. One compromised key can't steal your funds.",
            },
            {
              icon: "⏳",
              title: "Configurable threshold",
              desc: "Set your inactivity window from 2 days to 2.5 years. The protocol alerts your guardians before triggering.",
            },
            {
              icon: "🔑",
              title: "Shamir distribution",
              desc: "Split recovery secrets into guardian shares. Any M-of-N shares reconstruct the original — all in your browser.",
            },
            {
              icon: "⚡",
              title: "Blink-compatible",
              desc: "Check in, trigger, or claim via a single URL — from any Blink-compatible wallet, no dApp required.",
            },
            {
              icon: "📱",
              title: "Install as app",
              desc: "Add Legacy Protocol to your home screen for instant access. Works offline for read-only views.",
            },
          ].map((f) => (
            <article
              key={f.title}
              className="card text-left"
              aria-label={f.title}
            >
              <div className="text-2xl mb-3" aria-hidden="true">{f.icon}</div>
              <h2 className="text-cream font-medium mb-1">{f.title}</h2>
              <p className="text-stone-400 text-sm leading-relaxed">{f.desc}</p>
            </article>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer
        className="px-6 py-4 border-t text-center text-stone-600 text-xs"
        style={{ borderColor: "var(--border)" }}
      >
        Legacy Protocol · Open source · Permissionless
      </footer>
    </main>
  );
}