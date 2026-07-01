// Created by Nikolas Kato on 2026-06-28
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Bars,
  Callout,
  Donut,
  KpiTiles,
  StatusList,
  Timeline,
  type BarItem,
  type KpiItem,
  type Segment,
  type StatusItem,
  type TimelineItem,
  type Tone
} from "./DiagramComponents";

// Format-Contract: Mistral/KAI-Personas betten strukturierte Daten als Markdown-Codebloecke ein:
//   ```katosync:kpi ```      -> { title?, items:[{ label, value, delta?, tone? }] }
//   ```katosync:donut ```    -> { title?, segments:[{ label, value, tone? }] }
//   ```katosync:bar ```      -> { title?, max?, bars:[{ label, value, tone? }] }
//   ```katosync:status ```   -> { title?, items:[{ label, state, note? }] }   state: ok|warn|danger|info
//   ```katosync:timeline ``` -> { title?, items:[{ time?, label, state? }] }
//   ```katosync:callout ```  -> { tone?, title?, text }
// tone: brand|ok|warn|danger|info. Unbekannt/ungueltiges JSON -> faellt auf Rohtext zurueck.
// Die Diagramm-Komponenten liegen in DiagramComponents.tsx und werden auch vom Dashboard-Cockpit genutzt.

// Toleranz: manche Personas (z. B. Bewerbungs-Skill) betten die Bloecke inline als
// (katosync:typ { ... }) oder katosync:typ { ... } auf EINER Zeile ein statt als ```-Codeblock.
// Vor dem Rendern in einen echten ```katosync:typ```-Fence normalisieren — klammer-genau, damit
// verschachteltes JSON und Strings mit Klammern korrekt umschlossen werden. Bereits korrekte
// Codebloecke (Typ + Zeilenumbruch vor `{`) werden dank der Same-Line-Bedingung nicht angefasst.
function normalizeKatosyncBlocks(src: string): string {
  if (!src || !src.includes("katosync:")) return src;
  const re = /(\()?katosync:(\w+)[ \t]*\{/g;
  let out = "";
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const hasParen = Boolean(m[1]);
    const type = m[2];
    const braceStart = m.index + m[0].length - 1;
    let depth = 0;
    let inStr = false;
    let esc = false;
    let j = braceStart;
    for (; j < src.length; j++) {
      const c = src[j];
      if (inStr) {
        if (esc) esc = false;
        else if (c === "\\") esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) {
          j++;
          break;
        }
      }
    }
    if (depth !== 0) break; // unbalanciertes JSON -> Rest unveraendert lassen
    const json = src.slice(braceStart, j);
    let after = j;
    if (hasParen) {
      let k = j;
      while (k < src.length && (src[k] === " " || src[k] === "\t")) k++;
      if (src[k] === ")") after = k + 1;
    }
    out += src.slice(last, m.index) + `\n\n\`\`\`katosync:${type}\n${json}\n\`\`\`\n\n`;
    last = after;
    re.lastIndex = after;
  }
  return out + src.slice(last);
}

function KatosyncBlock({ type, raw }: { type: string; raw: string }) {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return <pre className="katosync-block katosync-raw">{raw}</pre>;
  }
  switch (type) {
    case "kpi":
      return <KpiTiles {...(data as { title?: string; items?: KpiItem[] })} />;
    case "donut":
      return <Donut {...(data as { title?: string; segments?: Segment[] })} />;
    case "bar":
      return <Bars {...(data as { title?: string; max?: number; bars?: BarItem[] })} />;
    case "status":
      return <StatusList {...(data as { title?: string; items?: StatusItem[] })} />;
    case "timeline":
      return <Timeline {...(data as { title?: string; items?: TimelineItem[] })} />;
    case "callout":
      return <Callout {...(data as { tone?: Tone; title?: string; text?: string })} />;
    default:
      return <pre className="katosync-block katosync-raw">{raw}</pre>;
  }
}

// Markdown mit eingebetteten KatoSync-Komponenten (```katosync:<typ>```).
export function RichMarkdown({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        code(props) {
          const { className, children: codeChildren } = props as {
            className?: string;
            children?: unknown;
          };
          const match = /language-katosync:(\w+)/.exec(className || "");
          if (match) {
            return <KatosyncBlock type={match[1]} raw={String(codeChildren ?? "").trim()} />;
          }
          return <code className={className}>{codeChildren as never}</code>;
        }
      }}
    >
      {normalizeKatosyncBlocks(children)}
    </ReactMarkdown>
  );
}
