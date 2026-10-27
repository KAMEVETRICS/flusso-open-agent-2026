"use client";

import Link from "next/link";
import { ArrowRight, ArrowUpRight, Brain, Cpu, Database, Globe, SealCheck } from "@phosphor-icons/react";

// The studio's landing band: a gradient hero, then a dark strip of the engines behind the
// evidence agent, each linking to the Evidence Console where they can be watched at work.

const ENGINES = [
  { name: "Zetaris", role: "Data layer", stat: "3 sources", detail: "brand_evidence USL + live REST", Icon: Database, tone: "teal" },
  { name: "World Model", role: "Meterless engine", stat: "Facts", detail: "Verified fact sheet with provenance", Icon: Globe, tone: "violet" },
  { name: "H-MEM", role: "Meterless engine", stat: "Memory", detail: "Lessons from past campaigns", Icon: Brain, tone: "rose" },
  { name: "Nightshift", role: "NVIDIA Nemotron", stat: "Reasoning", detail: "Nemotron 3 Ultra via Meterless", Icon: Cpu, tone: "lime" },
  { name: "Verifier", role: "Code, not a model", stat: "Checks", detail: "Every citation, every number", Icon: SealCheck, tone: "amber" }
] as const;

export function HomeHero() {
  return (
    <>
      <section className="hero-band" aria-labelledby="hero-title">
        <div className="hero-glow" aria-hidden="true" />
        <div className="hero-inner">
          <p className="hero-kicker">— Evidence-first campaigns</p>
          <h1 id="hero-title" className="hero-title">
            <span className="hero-mark" aria-hidden="true" />
            Campaigns That Check
            <br />
            Their Own <em>Claims</em>
          </h1>
          <p className="hero-lede">
            Give Flusso a website and a goal. An evidence agent reads the brand&apos;s history through Zetaris, its facts and memory
            through Meterless, reasons with NVIDIA Nemotron, and code verifies every decision before a word is written.
          </p>
          <div className="hero-actions">
            <button
              type="button"
              className="pill-btn pill-dark"
              onClick={() => document.getElementById("workbench")?.scrollIntoView({ behavior: "smooth" })}
            >
              Start a campaign <ArrowRight size={18} weight="bold" />
            </button>
            <Link className="hero-link" href="/agent">Watch the agent reason — Console</Link>
          </div>
        </div>
        <div className="hero-art" aria-hidden="true">
          <span className="hero-rain r1" /><span className="hero-rain r2" /><span className="hero-rain r3" />
          <span className="hero-rain r4" /><span className="hero-rain r5" /><span className="hero-rain r6" />
          <span className="hero-tag">Verified</span>
          <div className="hero-seal"><SealCheck size={64} weight="fill" /></div>
        </div>
      </section>

      <section className="engine-band" aria-labelledby="engine-title">
        <div className="engine-band-head">
          <h2 id="engine-title">The Reasoning Stack</h2>
          <Link className="pill-btn pill-ghost" href="/agent">
            Open console <ArrowUpRight size={16} weight="bold" />
          </Link>
        </div>
        <div className="engine-row">
          {ENGINES.map(({ name, role, stat, detail, Icon, tone }, index) => (
            <Link key={name} href="/agent" className={"engine-tile tone-" + tone + (index === 3 ? " featured" : "")}>
              <div className="engine-tile-top">
                <span className="engine-icon"><Icon size={20} weight="fill" /></span>
                <span className="engine-stat">{stat}</span>
              </div>
              <strong>{name}</strong>
              <span className="engine-role">{role}</span>
              <span className="engine-detail">{detail}</span>
              <span className="engine-cta">See it work <ArrowRight size={16} weight="bold" /></span>
            </Link>
          ))}
        </div>
      </section>
    </>
  );
}
