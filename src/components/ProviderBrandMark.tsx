// Created by NMKato Solutions
// Bundled brand marks for display only. No remote assets or changes to provider auth.
import { Cpu, ShieldCheck } from "lucide-react";
import type { ProviderId } from "../types";

type BrandProvider = ProviderId | "github";

const marks: Partial<Record<BrandProvider, string>> = {
  codex: "/agent-openai.png",
  claude: "/agent-claude.png",
  github: "/github-mark-white.svg",
};

export function ProviderBrandMark({
  provider,
  size = "card",
}: {
  provider: BrandProvider;
  size?: "card" | "route";
}) {
  const mark = marks[provider];
  const className = `provider-brand-mark provider-brand-mark-${provider} provider-brand-mark-${size}`;
  if (mark) {
    return (
      <span className={className} aria-hidden="true">
        <img src={mark} alt="" draggable={false} />
      </span>
    );
  }
  const FallbackIcon = provider === "local_control" ? ShieldCheck : Cpu;
  return (
    <span className={className} aria-hidden="true">
      <FallbackIcon size={size === "route" ? 16 : 24} />
    </span>
  );
}
