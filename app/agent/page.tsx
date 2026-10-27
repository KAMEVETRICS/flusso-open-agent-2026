import type { Metadata } from "next";
import { Instrument_Serif, JetBrains_Mono } from "next/font/google";
import { EvidenceConsole } from "@/components/evidence-console";

const display = Instrument_Serif({ subsets: ["latin"], weight: "400", variable: "--font-display" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "Flusso Evidence Console",
  description: "Watch Flusso's evidence agent turn Zetaris data, world-model facts, and H-MEM memory into verified campaign decisions."
};

export default function AgentPage() {
  return (
    <div className={display.variable + " " + mono.variable}>
      <EvidenceConsole />
    </div>
  );
}
