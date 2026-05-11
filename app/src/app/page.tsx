"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Navbar } from "@/components/Navbar";

// ── Scroll-reveal hook ────────────────────────────────────────────────────────
//
// Returns a ref and a boolean. Attach the ref to a container element.
// When the element scrolls into the viewport (10% visible), isVisible
// flips to true and stays true — each section only animates in once.
//
// The IntersectionObserver is disconnected after triggering so there is
// no ongoing observer overhead for already-visible sections.

function useScrollReveal(threshold = 0.1): [React.RefObject<HTMLElement | null>, boolean] {
  const ref   = useRef<HTMLElement | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || isVisible) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { threshold },
    );

    observer.observe(el);
    return () => observer.disconnect();
  // isVisible intentionally omitted — once true we never re-attach.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threshold]);

  return [ref, isVisible];
}

// ── Feature cards data ────────────────────────────────────────────────────────

const FEATURES = [
  { icon: "🔐", title: "Non-custodial",         desc: "Funds live in a program PDA. No private key controls them — only the program's own instructions can move them." },
  { icon: "🛡",  title: "Guardian council",      desc: "M-of-N guardians approve emergency sweeps and beneficiary changes. One compromised key can't steal your funds." },
  { icon: "⏳", title: "Configurable threshold", desc: "Set your inactivity window from 2 days to 2.5 years. The protocol alerts your guardians before triggering." },
  { icon: "🔑", title: "Shamir distribution",   desc: "Split recovery secrets into guardian shares. Any M-of-N shares reconstruct the original — all in your browser." },
  { icon: "⚡", title: "Blink-compatible",       desc: "Check in, trigger, or claim via a single URL — from any Blink-compatible wallet, no dApp required." },
  { icon: "📱", title: "Install as app",         desc: "Add Legacy Protocol to your home screen for instant access. Works offline for read-only views." },
];

// ── Page ──────────────────────────────────────────────────────────────────────

export default function HomePage() {
  // Each major below-the-fold content section gets its own scroll-reveal ref.
  const [heroRef,     heroVisible]     = useScrollReveal(0.05);
  const [featureRef,  featureVisible]  = useScrollReveal(0.08);

  return (
    <main className="min-h-dvh flex flex-col">
      <Navbar />

      {/* ── Hero section ─────────────────────────────────────────────────────── */}
      <section
        ref={heroRef as React.RefObject<HTMLElement>}
        className={`flex-1 flex flex-col items-center justify-center px-6 py-20 text-center scroll-reveal${heroVisible ? " scroll-reveal-visible" : ""}`}
        style={{ backgroundImage: "radial-gradient(ellipse 60% 40% at 50% 60%, rgba(245,158,11,0.06) 0%, transparent 70%)" }}
        aria-labelledby="hero-heading"
      >
        <p className="label text-amber-500 mb-4 tracking-widest">On-Chain Inheritance</p>
        <h1
          id="hero-heading"
          className="font-display text-5xl md:text-7xl text-cream mb-6"
          style={{ maxWidth: "800px", lineHeight: 1.05 }}
        >
          Your legacy,<br /><span style={{ color: "var(--accent)" }}>on your terms.</span>
        </h1>
        <p
          className="text-stone-400 text-lg mb-10"
          style={{ maxWidth: "520px", lineHeight: 1.7 }}
        >
          A Solana dead-man&apos;s switch. Your assets sit in a program-controlled vault.
          If you stop checking in, your designated beneficiary automatically receives them.
          No intermediaries. No lawyers. No trust required.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3 mb-16">
          <Link href="/vaults" className="btn-primary" aria-label="View your vault portfolio">
            View My Vaults
          </Link>
          <a
            href="https://github.com/myreltheviii-lgtm/legacy-protocol"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-secondary"
            aria-label="View Legacy Protocol on GitHub"
          >
            View source →
          </a>
        </div>

        {/* ── Feature cards — scroll-triggered entrance animation ────────────── */}
        {/*                                                                       */}
        {/* The container ref triggers the animation when the card grid enters   */}
        {/* the viewport. Cards stagger via CSS animation-delay so they cascade  */}
        {/* in from left to right rather than all appearing simultaneously.       */}
        <div
          ref={featureRef as React.RefObject<HTMLDivElement>}
          className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full"
          style={{ maxWidth: "800px" }}
          aria-label="Protocol features"
        >
          {FEATURES.map((f, i) => (
            <article
              key={f.title}
              className={`card text-left scroll-reveal${featureVisible ? " scroll-reveal-visible" : ""}`}
              style={{
                // Stagger each card by 80 ms so they animate in sequentially.
                animationDelay: featureVisible ? `${i * 80}ms` : undefined,
              }}
              aria-label={f.title}
            >
              <div className="text-2xl mb-3" aria-hidden="true">{f.icon}</div>
              <h2 className="text-cream font-medium mb-1">{f.title}</h2>
              <p className="text-stone-400 text-sm leading-relaxed">{f.desc}</p>
            </article>
          ))}
        </div>
      </section>

      <footer
        className="px-6 py-4 border-t text-center text-stone-600 text-xs"
        style={{ borderColor: "var(--border)" }}
      >
        Legacy Protocol · Open source · Permissionless
      </footer>
    </main>
  );
}
