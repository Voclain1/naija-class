"use client";

import { useRef, useState, type ReactNode } from "react";
import type { MessagingRateCatalogState, MessagingReviewRevision, MessagingTemplateReviewWrite } from "@school-kit/types";
import { Button } from "@/components/ui/button";
import { usePlatformLoad } from "@/components/super-admin/platform-load";
import { ApiError, proxyFetch } from "@/lib/api-client";
import { formatKobo } from "@/lib/finance/format";
import { BODY_FIELDS, RATE_KEYS, TEMPLATE_NAMES, catalogIssue, emptyRate, unitKobo, validTemplateReview, type Rate } from "@/lib/messaging/platform-review";

const panel="space-y-4 rounded-2xl border bg-card p-4 shadow-sm sm:p-6";
const input="w-full min-w-0 rounded-xl border bg-background px-3 py-2 text-sm";
const cash=(n:bigint)=>formatKobo(n);
const nice=(s:string)=>s.replaceAll("_"," ");
const evidencePattern=/^[A-Za-z0-9._/-]{1,120}$/;
const message=(e:unknown)=>e instanceof ApiError ? e.message : "Outcome not confirmed. Refresh the record before repeating a write.";

function Field({label,children}:{label:string;children:ReactNode}) {
  return <label className="block min-w-0 space-y-1 text-sm"><span className="font-medium">{label}</span>{children}</label>;
}
function ReviewWrite({path,body,label,confirm,onDone,disabled=false}:{path:string;body:Record<string,unknown>;label:string;confirm:string;onDone:(revision:string)=>void;disabled?:boolean}) {
  const [evidence,setEvidence]=useState("");
  const [busy,setBusy]=useState(false);
  const [result,setResult]=useState("");
  const [failed,setFailed]=useState(false);
  const lock=useRef(false);
  async function write(){
    if(disabled||lock.current||!evidencePattern.test(evidence)||!window.confirm(confirm))return;
    lock.current=true;setBusy(true);setResult("");setFailed(false);
    try{
      const r=await proxyFetch<MessagingReviewRevision>(path,{method:"POST",body:JSON.stringify({...body,evidenceRef:evidence})});
      setResult("Recorded revision "+r.revision+". Dispatch eligibility is checked separately.");setEvidence("");onDone(r.revision);
    }catch(e){setFailed(true);setResult(message(e));}
    finally{lock.current=false;setBusy(false);}
  }
  return <div className="space-y-2 rounded-xl border p-3"><Field label="Review evidence reference"><input className={input} value={evidence} maxLength={120} placeholder="case-1234" disabled={busy||disabled} onChange={e=>setEvidence(e.target.value)} /></Field><p className="text-xs text-muted-foreground">Use a verified document or case reference, not credentials or personal details.</p><Button disabled={busy||disabled||!evidencePattern.test(evidence)} onClick={()=>void write()}>{busy?"Recording…":label}</Button>{result&&<p role={failed?"alert":"status"} className={failed?"text-sm text-destructive":"text-sm text-muted-foreground"}>{result}</p>}</div>;
}
const RATE_FIELDS: {key:Exclude<keyof Rate,"key">;label:string;hint?:string}[]=[
  {key:"version",label:"Rate version"},
  {key:"evidence",label:"Provider quote or rate-card reference"},
  {key:"effectiveFrom",label:"Effective from (ISO with offset)",hint:"YYYY-MM-DDTHH:mm:ss+01:00"},
  {key:"effectiveUntil",label:"Effective until (ISO with offset)",hint:"YYYY-MM-DDTHH:mm:ss+01:00"},
  {key:"verifiedAt",label:"Verified at (ISO with offset)",hint:"YYYY-MM-DDTHH:mm:ss+01:00"},
  {key:"providerAmount",label:"Provider amount (integer quoted units)"},
  {key:"rateNumerator",label:"NGN kobo conversion numerator"},
  {key:"rateDenominator",label:"Conversion denominator"},
  {key:"taxBasisPoints",label:"Tax (basis points)"},
  {key:"marginBasisPoints",label:"Margin (basis points)"},
];

export function RateCatalog({path,scope}:{path:string;scope:"platform"|"school"}) {
  const [current,,error,reload]=usePlatformLoad<MessagingRateCatalogState>(path,"Could not load rate catalogue.");
  const [draft,setDraft]=useState<Rate[]|null>(null);
  const [original,setOriginal]=useState<string|null>(null);
  const [ack,setAck]=useState(false);
  const keys=scope==="platform"?RATE_KEYS.slice(0,1):RATE_KEYS;
  const issue=draft?catalogIssue(draft,scope):null;
  const stale=draft!==null&&current?.revision!==original;
  function edit(index:number,key:keyof Rate,value:string){
    setDraft(rows=>rows?.map((r,i)=>i===index?{...r,[key]:value}:r)??null);setAck(false);
  }
  function start(){if(!current||error)return;setOriginal(current.revision);setDraft(current.rates?.map(r=>({...r}))??[]);setAck(false);}
  return <details className={panel}>
    <summary className="cursor-pointer text-lg font-semibold">{scope==="platform"?"Platform SMS":"School"} rate catalogue</summary>
    <p className="text-sm text-muted-foreground">Publish a complete effective-dated override only from verified provider evidence. School-owned Meta billing remains direct. An override replaces the previous catalogue; it is not an incremental edit.</p>
    <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={reload}>Refresh catalogue</Button><Button size="sm" variant="outline" disabled={!current||!!error||draft!==null} onClick={start}>Edit verified catalogue</Button></div>
    {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
    {!current&&!error&&<p role="status" className="text-sm">Loading catalogue…</p>}
    {current&&<div className="space-y-2 text-sm"><p>Revision: {current.revision??"No recorded override"}</p>{current.rates===null?<p className="text-muted-foreground">Deployment-profile defaults may apply; they are not returned by this endpoint. Obtain the complete verified rate set before publishing.</p>:current.rates.map((r,i)=><div className="rounded-xl border p-3" key={r.key+":"+r.version+":"+i}><p className="font-medium">{nice(r.key)} · {r.version}</p><p className="break-words text-xs text-muted-foreground">{r.effectiveFrom} – {r.effectiveUntil}</p><p>{unitKobo(r)===null?"Invalid recorded rate":cash(unitKobo(r)!)} per unit (calculated)</p></div>)}</div>}
    {draft&&<div className="space-y-4 border-t pt-4">
      {stale&&<p role="alert" className="text-sm text-destructive">Recorded revision changed. Discard and reload the draft.</p>}
      {draft.map((r,i)=><fieldset key={i} className="min-w-0 space-y-3 rounded-xl border p-3"><legend className="px-2 text-sm font-medium">Rate {i+1}</legend><div className="grid gap-3 sm:grid-cols-2"><Field label="Price key"><select className={input} value={r.key} onChange={e=>edit(i,"key",e.target.value)}>{keys.map(k=><option key={k} value={k}>{nice(k)}</option>)}</select></Field>{RATE_FIELDS.map(f=><Field key={f.key} label={f.label}><input className={input} value={r[f.key]} placeholder={f.hint} onChange={e=>edit(i,f.key,e.target.value)} /></Field>)}</div><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-semibold">Calculated unit cost: {unitKobo(r)===null?"Incomplete":cash(unitKobo(r)!)}</p><Button variant="outline" size="sm" onClick={()=>{setDraft(rows=>rows?.filter((_,index)=>i!==index)??null);setAck(false);}}>Remove rate</Button></div></fieldset>)}
      <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={draft.length>=100} onClick={()=>{setDraft([...draft,emptyRate("TERMII_SMS")]);setAck(false);}}>Add rate</Button><Button variant="ghost" onClick={()=>{setDraft(null);setAck(false);}}>Discard draft</Button></div>
      {issue&&<p className="text-sm text-muted-foreground">{issue}</p>}
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={ack} onChange={e=>setAck(e.target.checked)} /><span>I checked all rates, evidence, currency conversion, validity dates and the complete replacement scope.</span></label>
      <ReviewWrite path={path} body={{rates:draft}} label="Publish reviewed catalogue" confirm="Publish this complete replacement catalogue? Changed prices may pause existing campaigns. No provider activation is performed." disabled={!!issue||!ack||stale||!!error} onDone={()=>{setDraft(null);setAck(false);reload();}} />
    </div>}
  </details>;
}

type Review=NonNullable<MessagingTemplateReviewWrite["review"]>;
const blank=():Review=>({wabaId:"",providerTemplateId:"",language:"",category:"UTILITY",approvedBody:"",bodyFields:[]});
export function TemplateReview({schoolPath}:{schoolPath:string}) {
  const [name,setName]=useState("");
  const [review,setReview]=useState<Review>(blank);
  const [button,setButton]=useState("");
  const [ack,setAck]=useState(false);
  const [last,setLast]=useState("");
  const vars=[...review.approvedBody.matchAll(/\{\{(\d+)\}\}/g)];
  const result={...review,...(button!==""?{paymentButtonIndex:Number(button)}:{})};
  const valid=!!name&&validTemplateReview(result)&&(!button||/^[0-9]$/.test(button));
  const path=schoolPath+"/messaging/templates/"+encodeURIComponent(name)+"/review";
  function patch<K extends keyof Review>(key:K,value:Review[K]){setReview(r=>({...r,[key]:value}));setAck(false);}
  return <details className={panel}>
    <summary className="cursor-pointer text-lg font-semibold">School template review</summary>
    <p className="text-sm text-muted-foreground">Record the exact Meta-approved body, category, language and ordered variable mapping for this connected school account. The server still checks the live provider catalogue before dispatch. This endpoint does not expose existing review details, so no prior approval is inferred.</p>
    <Field label="Template"><select className={input} value={name} onChange={e=>{setName(e.target.value);setReview(blank());setButton("");setAck(false);setLast("");}}><option value="">Select template</option>{TEMPLATE_NAMES.map(n=><option key={n} value={n}>{nice(n)}</option>)}</select></Field>
    {name&&<><div className="grid gap-3 sm:grid-cols-2"><Field label="WhatsApp business account ID"><input className={input} value={review.wabaId} inputMode="numeric" onChange={e=>patch("wabaId",e.target.value)} /></Field><Field label="Provider template ID"><input className={input} value={review.providerTemplateId} inputMode="numeric" onChange={e=>patch("providerTemplateId",e.target.value)} /></Field><Field label="Approved language"><input className={input} value={review.language} placeholder="en" onChange={e=>patch("language",e.target.value)} /></Field><Field label="Approved billing category"><select className={input} value={review.category} onChange={e=>patch("category",e.target.value as Review["category"])}>{["UTILITY","MARKETING","AUTHENTICATION"].map(c=><option key={c}>{c}</option>)}</select></Field></div>
    <Field label="Exact approved body"><textarea className={input} rows={4} maxLength={1024} value={review.approvedBody} onChange={e=>{setReview(r=>({...r,approvedBody:e.target.value,bodyFields:[]}));setAck(false);}} /></Field>
    {vars.slice(0,20).map((_,i)=><Field key={i} label={"Variable {{"+(i+1)+"}} — data field"}><select className={input} value={review.bodyFields[i]??""} onChange={e=>{const values=Array.from({length:Math.min(vars.length,20)},(_,j)=>review.bodyFields[j]??"");values[i]=BODY_FIELDS.find(field=>field===e.target.value)??"";patch("bodyFields",values as Review["bodyFields"]);}}><option value="">Select exact field</option>{BODY_FIELDS.map(f=><option key={f}>{f}</option>)}</select></Field>)}
    <Field label="Payment URL button index (optional; zero-based)"><input className={input} inputMode="numeric" value={button} onChange={e=>{setButton(e.target.value);setAck(false);}} /></Field>
    <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={ack} onChange={e=>setAck(e.target.checked)} /><span>I verified this exact provider approval and field mapping for this school. No credentials or personal examples are included.</span></label>
    <ReviewWrite key={name+":approve"} path={path} body={{review:result}} label="Record template review" confirm="Record this exact template review? It does not activate the provider or guarantee that the template remains approved." disabled={!valid||!ack} onDone={r=>{setLast(r);setAck(false);}} />
    <ReviewWrite key={name+":revoke"} path={path} body={{review:null}} label="Withdraw template review" confirm="Withdraw this template review for the selected school? Future dispatches requiring it will be blocked." onDone={r=>{setLast(r);setAck(false);}} /></>}
    {last&&<p role="status" className="text-sm text-muted-foreground">Last recorded review revision: {last}</p>}
  </details>;
}
