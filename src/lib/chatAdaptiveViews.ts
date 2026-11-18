// Created by NMKato Solutions
// Human-facing view contract. Model/agent JSON is untrusted data, not HTML or commands.
// Strictly validate optional visual payloads; never infer numerical facts from prose.

export type HumanView =
  | {kind:"table";title:string;columns:string[];rows:string[][]}
  | {kind:"bars";title:string;unit:string;points:{label:string;value:number}[];sources:number[]};

function bounded(value:unknown,max=90):string {
  return typeof value==="string" ? value.trim().slice(0,max) : "";
}
const obj=(v:unknown):v is Record<string,unknown> =>
  typeof v==="object" && v!==null && !Array.isArray(v);

/**
 * Optional structured human display, separate from machine-to-machine agent
 * contracts. A bar chart requires independently verified source indices.
 * Rejected visuals are never rendered as authoritative graphics.
 */
export function parseHumanView(raw:string,verifiedCitations:number[]):HumanView|null {
  if(raw.length>14000)return null;
  const cleaned=raw.trim().replace(/^\`\`\`(?:json)?\s*\n([\s\S]*?)\n\`\`\`\s*$/i,"$1");
  if(!cleaned.startsWith("{"))return null;
  let data:unknown;
  try {data=JSON.parse(cleaned);}catch{return null;}
  if(!obj(data))return null;
  const view=obj(data.view) ? data.view : (obj(data.presentation) ? data.presentation : null);
  if(!view)return null;
  const kind=view.kind??view.type;
  const title=bounded(view.title,100);
  if(kind==="table"){
    if(!Array.isArray(view.columns)||!Array.isArray(view.rows))return null;
    if(view.columns.length<2 || view.columns.length>5 || view.rows.length<1 || view.rows.length>12)return null;
    const columns=view.columns.map(c=>bounded(c,65));
    if(columns.some(c=>!c))return null;
    const rows:string[][]=[];
    for(const item of view.rows){
      if(!Array.isArray(item)||item.length!==columns.length)return null;
      if(item.some(c=>typeof c!=="string" && typeof c!=="number"))return null;
      rows.push(item.map(cell=>bounded(typeof cell==="number"?String(cell):cell,240)));
    }
    return {kind:"table",title,columns,rows};
  }
  if(kind==="bars"){
    if(!Array.isArray(view.sources)||!Array.isArray(view.points))return null;
    const verified=new Set(verifiedCitations);
    const sources=view.sources.filter((index:unknown):index is number=>Number.isInteger(index));
    if(sources.length===0||sources.length>8||sources.some(index=>!verified.has(index)))return null;
    if(view.points.length<2||view.points.length>8)return null;
    const points:{label:string;value:number}[]=[];
    for(const point of view.points){
      if(!obj(point))return null;
      const label=bounded(point.label,52);
      const value=point.value;
      if(!label||typeof value!=="number"||!Number.isFinite(value)||value<0||value>1_000_000_000)return null;
      points.push({label,value});
    }
    if(points.every(p=>p.value===0))return null;
    return {kind:"bars",title,unit:bounded(view.unit,20),points,sources};
  }
  return null;
}
