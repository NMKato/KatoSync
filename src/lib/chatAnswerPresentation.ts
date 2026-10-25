// Created by NMKato Solutions
// Pure, offline presentation adapter. Never executes JSON/HTML or invents information.
// Raw model text remains the only persisted answer; these are UI-only display repairs.

type Structured = {
  summary?: unknown;
  observations?: unknown;
  nextSteps?: unknown;
  next_steps?: unknown;
  uncertainty?: unknown;
  projectContext?: unknown;
  project_context?: unknown;
};
function safeString(value:unknown):string {
  return typeof value==="string" ? value.slice(0,3500).trim() : "";
}
function safeItems(value:unknown):string[] {
  return Array.isArray(value) ? value.slice(0,8).filter((v):v is string=>
    typeof v==="string" && v.trim().length>0).map(x=>x.trim().slice(0,700)) : [];
}
function renderStructuredObject(data:unknown):string|null {
  if(!data || typeof data!=="object" || Array.isArray(data))return null;
  const x=data as Structured;
  const summary=safeString(x.summary);
  const observations=safeItems(x.observations);
  const steps=safeItems(x.nextSteps??x.next_steps);
  const context=safeString(x.projectContext??x.project_context);
  const uncertainty=safeString(x.uncertainty);
  if(!summary && !observations.length && !steps.length && !context && !uncertainty)return null;
  const pieces:string[]=[];
  if(summary)pieces.push("### Kurzantwort\n\n"+summary);
  if(observations.length)pieces.push("### Was erkennbar ist\n\n"+observations.map(i=>"- "+i).join("\n"));
  if(context)pieces.push("### Projektkontext\n\n"+context);
  if(steps.length)pieces.push("### Nächste Schritte\n\n"+steps.map(i=>"- "+i).join("\n"));
  if(uncertainty)pieces.push("### Einordnung\n\n"+uncertainty);
  return pieces.join("\n\n");
}
function repairProse(raw:string):string {
  // Only apply text repairs outside fenced code blocks.
  const chunks=raw.replace(/\r\n?/g,"\n").split(/(\`\`\`[\s\S]*?\`\`\`)/g);
  return chunks.map(chunk=>{
    if(chunk.startsWith("\`\`\`"))return chunk;
    let value=chunk.trim();
    if(!value)return value;
    // Older Gemma replies sometimes place the ENTIRE answer on an ATX heading:
    // "### Kurzantwort The answer ... ### Das ist wichtig - Fact ...".
    // Turn named headings into separate, SHORT lines before ReactMarkdown sees them.
    const headings="Kurzantwort|Das ist wichtig|Nächste Schritte|Im Bild erkennbar|Empfehlung|Was erkennbar ist|Einordnung|Zusammenfassung|Beobachtungen|Hypothesen|Fazit";
    const titled=new RegExp("(?:^|\\s)(?:#{2,4}\\s*)?("+headings+")(?:\\s*([-:])\\s*|\\s+(?=[A-ZÄÖÜ]))","giu");
    // Preserve an initial bullet when Gemma writes "Das ist wichtig - Fact".
    value=value.replace(titled,(_match,label:string,separator:string|undefined)=>
      "\n\n### "+label+"\n\n"+(separator==="-"?"- ":""));
    value=value.replace(/(###\s+(?:Kurzantwort|Das ist wichtig|Nächste Schritte|Im Bild erkennbar|Empfehlung|Was erkennbar ist|Einordnung|Zusammenfassung|Beobachtungen|Hypothesen|Fazit))\s+(-\s+)?/gu,
      (_full,title:string,bullet:string|undefined)=>title+"\n\n"+(bullet?"- ":""));
    // Heading-adjacent inline hyphen lists are bullets, not one bold sentence.
    // Avoid changing normal hyphenated terms and prose without a heading.
    if(/###\s/.test(value)){
      value=value.replace(/\s+-\s+(?=[A-ZÄÖÜ][a-zäöüß])/gu,"\n- ");
      value=value.replace(/\s+-\s+(?=[A-ZÄÖÜ][a-zäöüß]*\s)/gu,"\n- ");
    }
    // Gemma small models sometimes put every heading and bullet on one line.
    value=value.replace(/[ \t]+(?=#{2,3}[ \t]+\S)/g,"\n\n");
    value=value.replace(/(?:^|\s)\*\s+(?=[A-ZÄÖÜ][^\n:]{2,58}:)/gu,"\n- ");
    value=value.replace(/(?:^|\s)(#{2,3})[ \t]*([A-ZÄÖÜ])/gu,"\n\n$1 $2");
    value=value.replace(/^(?:\*\*)?(Beobachtungen|Hypothesen|Einschätzung|Zusammenfassung|Nächste Schritte|Projektstatus|Fazit|Wichtige Punkte)\s*(?=\n|\*|:)/gim,
      (_match,label:string)=>"### "+label+"\n");
    // Make label: content legible inside bullets without making whole passages bold.
    value=value.replace(/(^|\n)-\s+([\p{Lu}][^\n:]{2,65}):\s*/gu,"$1- **$2:** ");
    value=value.replace(/\*\*([\s\S]*?)\*\*/g,(whole,body:string)=>
      body.length>72 || body.includes("\n") ? body : whole);
    const paragraphs=value.split(/\n{2,}/).map(part=>{
      // Unpaired model asterisks turn paragraphs into giant strong text. Prefer
      // ordinary readable text over visually lying about intended emphasis.
      const bold=(part.match(/\*\*/g)||[]).length;
      if(bold%2===1)part=part.replace(/\*\*/g,"");
      return part.trim();
    });
    return paragraphs.filter(Boolean).join("\n\n");
  }).filter(Boolean).join("\n\n").replace(/\n{3,}/g,"\n\n").trim();
}
/** JSON is supported if explicitly produced, never required from small local models. */
export function presentChatAnswer(raw:string, validCitations:number[]=[]):string {
  const answer=raw.slice(0,12000).trim();
  if(!answer)return "";
  const cleaned=answer.replace(/^\`\`\`(?:json)?\s*\n([\s\S]*?)\n\`\`\`\s*$/i,"$1");
  if(cleaned.startsWith("{") && cleaned.endsWith("}")) {
    try{
      const normalized=renderStructuredObject(JSON.parse(cleaned));
      if(normalized)return normalized;
    }catch{/* malformed JSON is displayed as text, never interpreted as markup */}
  }
  // Model-generated [1]/[2] are not verified citations. The independently
  // retrieved store citations decide whether the marker may be rendered.
  const allowed=new Set(validCitations);
  const withoutUnverified=answer.replace(/\s*\[(\d{1,2})\]/g,(original,n:string)=>
    allowed.has(Number(n))?original:"");
  return repairProse(withoutUnverified).replace(/(#{2,3}[^\n]+)\n(?=- )/g,"$1\n\n");
}
