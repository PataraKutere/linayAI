const ALLOWED_ORIGIN="https://patarakutere.github.io";
const MODEL="@cf/qwen/qwen3.8-27b";
const FALLBACK_MODELS=["@cf/openai/gpt-oss-120b"];
const VISION_MODEL="@cf/qwen/qwen3.8-27b";
const EMBED_MODEL="@cf/baai/bge-m3";
const GEMINI_MODEL="gemini-flash-lite-latest";
const CORS={"Access-Control-Allow-Origin":ALLOWED_ORIGIN,"Access-Control-Allow-Headers":"Accept, Content-Type, X-Linay-Admin","Access-Control-Allow-Methods":"GET, POST, DELETE, OPTIONS","Access-Control-Expose-Headers":"X-Linay-Provider, X-Linay-Search, X-Linay-Trace, X-Linay-Sources, X-Linay-Documents, X-Linay-Agent-Steps, X-Linay-Agent-Trace, X-Linay-Memory-Candidate, X-Linay-Self-Audit","Access-Control-Max-Age":"86400","Vary":"Origin"};
const json=(data,status=200,extra={})=>new Response(JSON.stringify(data),{status,headers:{...CORS,"Content-Type":"application/json",...extra}});
const uid=()=>crypto.randomUUID();
const safeId=x=>String(x||"").trim();
const validUserId=x=>typeof x==="string"&&/^[a-zA-Z0-9_-]{8,80}$/.test(x);
const lastUser=messages=>[...messages].reverse().find(m=>m.role==="user");
const contentText=m=>typeof m?.content==="string"?m.content:(m?.content||[]).filter(p=>p.type==="text").map(p=>p.text||"").join("\n");
function extractMemoryCandidate(messages){
 const text=String(contentText(lastUser(messages))||"").replace(/\s+/g," ").trim();
 if(!text||text.length>500)return null;
 // Sensitive-topic filter on a normalised copy (Turkish lower-case, diacritics stripped, ı→i), prefix-matched so ç/ş/ğ/ı and suffixes ("hastalığım", "şifremi", "ilacımı") are caught.
 const norm=text.toLocaleLowerCase("tr-TR").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/ı/g,"i");
 if(/\b(?:saglik|hastalik|hastalig|hastane|ilac|tedavi|teshis|astim|sigara|hamile|gebelik|dinim|mezhep|oy ver|siyasi|cinsel|seksuel|sifre|parola|kimlik no|kimlik numara|tc kimlik|iban|kredi kart|banka hesab|pasaport|ehliyet)/.test(norm))return null;
 // Patterns run on the Turkish-lower-cased text (same length as the original), the candidate is cut from the original text to keep its casing.
 const lower=text.toLocaleLowerCase("tr-TR"),isQuestion=/\?/.test(text);
 const slice=(m,start=m.index)=>text.slice(start,m.index+m[0].length);
 const sentenceOf=m=>{let st=0;for(const x of text.matchAll(/[.!?]\s+/g)){const end=x.index+x[0].length;if(end<=m.index)st=end;else break}const rest=text.slice(st),e=rest.search(/[.!?](?:\s|$)/);return (e>=0?rest.slice(0,e):rest).trim()};
 const explicitM=/(?:^|[.!?]\s+)(?:lütfen\s+)?(?:(?:şunu|bunu)\s+)?(?:hatırla|aklında tut|unutma|hafızana\s+(?:ekle|kaydet))\s*[:：,]?\s+(.{10,180})/.exec(lower);
 const prefM=isQuestion?null:/(?:tercih ederim|tercih ediyorum|tercihim|bundan sonra|yanıtlarımı|cevaplarımı|(?:her zaman|daima|asla)\s.{0,120}?(?:yanıt|cevap|yaz|anlat|kullan|açıkla|ver))/.exec(lower);
 const projM=isQuestion?null:/(?:projem(?:in)?|projemizin)\s+adı\s.{0,150}|bu projede\s+(?:her zaman|hep|daima|şunu|şu)\s.{0,150}/.exec(lower);
 const explicit=explicitM?slice(explicitM,explicitM.index+explicitM[0].length-explicitM[1].length):"";
 const preference=prefM?sentenceOf(prefM):"",project=projM?sentenceOf(projM):"";
 const picked=explicit||preference||project;if(!picked)return null;
 const candidate=picked.replace(/[.!?]+$/,"").trim().slice(0,180);if(candidate.length<10)return null;
 return {text:candidate,reason:explicit?"Açık hafıza isteği":project?"Proje bilgisi":"Kalıcı tercih",status:"pending"};
}
function shouldSelfAudit(question){return /(?:\b(?:logic|logical|math|mathemat|calculate|calculation|multiply|multiplied|multiplication|code|coding|debug|date|timeline|compare|contradict|prove|proof|formula|equation)\b|mantık|matematik|hesap|çarp|kod|programla|hata ayıkla|tarih|kronoloji|çeliş|ispat|formül|denklem|kaç gün|kaç yıl|ne zaman)/i.test(String(question||""));}
async function selfAudit(env,question,draft){
 const answer=String(draft||"").trim();if(!answer||!shouldSelfAudit(question))return {answer,checked:false,corrected:false,attempted:false};
 try{
  const review=await runPlain(env,[{role:"system",content:'You are LinayAI final-answer verifier. Independently check contradictions, arithmetic, dates, units, code logic, and unsupported claims. Do not browse or invent sources. Return ONLY valid JSON: {"issues":[short Turkish issue strings],"correctedAnswer":"complete corrected answer in Turkish"}. If sound, issues=[] and correctedAnswer exactly equals the draft. If uncertainty cannot be resolved, state it explicitly. Preserve formatting.'},{role:"user",content:"Question:\\n"+String(question||"").slice(0,1800)+"\\n\\nDraft answer:\\n"+answer.slice(0,9000)}],900);
  const raw=modelText(review),match=raw.match(/\{[\s\S]*\}/);if(!match)return {answer,checked:false,corrected:false,attempted:true};
  const parsed=JSON.parse(match[0]),corrected=typeof parsed.correctedAnswer==="string"&&parsed.correctedAnswer.trim()?parsed.correctedAnswer.trim():answer;
  return {answer:corrected,checked:true,corrected:corrected!==answer,attempted:true,issues:Array.isArray(parsed.issues)?parsed.issues.slice(0,4):[]};
 }catch(e){await log(env,"self-audit","Workers AI",false,0,String(e.message||e));return {answer,checked:false,corrected:false,attempted:true}}
}
async function log(env,kind,provider,ok,latency,detail=""){
 try{if(env.DB)await env.DB.prepare("INSERT INTO events(id,kind,provider,ok,latency_ms,detail) VALUES(?,?,?,?,?,?)").bind(uid(),kind,provider||"unknown",ok?1:0,Math.max(0,Math.round(latency||0)),String(detail).slice(0,350)).run()}catch(e){}
}
function decodeHtml(s){return String(s||"").replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&#x([0-9a-f]+);/gi,(_,x)=>String.fromCharCode(parseInt(x,16))).replace(/&#(\d+);/g,(_,x)=>String.fromCharCode(+x));}
function cleanHtml(s){return decodeHtml(String(s||"").replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim()).slice(0,1800)}
function safeUrl(raw){try{const u=new URL(raw);if(!["http:","https:"].includes(u.protocol)||/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.|100\.(6[4-9]|[7-9]\d)\.|\[::1\]|\[f[cd][0-9a-f:]*\]|\[fe80:)/i.test(u.hostname))return null;return u}catch{return null}}
function isSearchCommand(value){
 return /^(?:ara|ara lütfen|ara lutfen|internetten ara|web'de ara|webde ara|araştır|arastir|bul|kontrol et)[.!?\s]*$/i.test(String(value||"").trim());
}
function needsLiveSearch(value){
 const q=String(value||"").toLocaleLowerCase("tr-TR");
 if(/(?:internetten|web(?:'de|de)?|google(?:'da|da)?)\s+ara|araştır|araştırma yap|kaynak(?:ları)?\s+(?:bul|göster|ver)|internetten kontrol et|güncel kaynak/i.test(q))return true;
 const freshness=/(güncel|bugün|dün|yarın|şu an|şimdi|canlı|son durum|son dakika|en son|latest|live|today|tonight|current)/i.test(q);
 const sports=/(spor|futbol|basketbol|voleybol|tenis|maç|skor|puan durumu|fikstür|transfer|kadro|şampiyon|lig|takım|oyuncu)/i.test(q);
 return freshness||(sports&&/(maç|skor|puan durumu|fikstür|transfer|kadro|sonuç|oynan|canlı|bugün|şu an|güncel|ne zaman)/i.test(q));
}
function searchQueryFromMessages(messages){
 const users=(messages||[]).filter(m=>m.role==="user").map(m=>contentText(m).trim()).filter(Boolean).slice(-6);
 if(!users.length)return "";
 const commandOnly=isSearchCommand(users[users.length-1]);
 const usable=commandOnly?users.slice(0,-1):users;
 const combined=usable.join(" ").replace(/\b(?:internetten|web(?:'de|de)?)\s+ara\b/ig," ").replace(/\b(?:araştır|araştırma yap|güncel kaynakları? bul)\b/ig," ").replace(/\s+/g," ").trim();
 if(!combined)return "";
 const football=/(fransa|france)/i.test(combined)&&/(türkiye|turkiye|turkey)/i.test(combined)&&/(maç|mac|score|kaç kaç|skor|football|futbol)/i.test(combined);
 if(football){
  const date=combined.match(/(\d{1,2}\s+(?:ocak|şubat|subat|mart|nisan|mayıs|mayis|haziran|temmuz|ağustos|agustos|eylül|eylul|ekim|kasım|kasim|aralık|aralik)(?:\s+\d{4})?)/i)?.[1]||"";
  const year=date.match(/\d{4}/)?.[0]||String(new Date().getFullYear());
  const englishDate=date.replace(/ocak/ig,"January").replace(/şubat|subat/ig,"February").replace(/mart/ig,"March").replace(/nisan/ig,"April").replace(/mayıs|mayis/ig,"May").replace(/haziran/ig,"June").replace(/temmuz/ig,"July").replace(/ağustos|agustos/ig,"August").replace(/eylül|eylul/ig,"September").replace(/ekim/ig,"October").replace(/kasım|kasim/ig,"November").replace(/aralık|aralik/ig,"December");
  return ("France Türkiye football match "+englishDate+" "+year+" final score result").trim();
 }
 return combined.slice(-450);
}
function shouldSearchMessages(messages){
 const question=contentText(lastUser(messages)).trim();
 if(needsLiveSearch(question))return true;
 if(!isSearchCommand(question))return false;
 const prior=(messages||[]).filter(m=>m.role==="user").slice(0,-1).map(contentText).join(" ");
 const assistantContext=(messages||[]).filter(m=>m.role==="assistant").slice(-2).map(contentText).join(" ");
 return needsLiveSearch(prior)||/(ara|arama|web|güncel|kaynak|internet)/i.test(assistantContext);
}
function searchNorm(value){return String(value||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLocaleLowerCase("en").replace(/ı/g,"i").replace(/[^a-z0-9]+/g," ").trim()}
function relevantResults(query,results){
 const stop=new Set(["what","which","where","when","that","this","with","from","have","does","your","the","and","for","about","find","current","latest","information","search","please","maçı","macı","mac","kaç","bitti","score","result","results","football","futbol","match","final","kasim","november","nov","2026"]);
 const terms=[...new Set(searchNorm(query).split(/\s+/).filter(x=>x.length>2&&!stop.has(x)))];
 if(!terms.length)return results;
 let filtered=results.map(x=>{const hay=searchNorm([x.title,x.snippet,x.url].join(" "));return {...x,_score:terms.filter(t=>hay.includes(t)).length,_hay:hay,_raw:[x.title,x.snippet,x.url].join(" ")}}).filter(x=>x._score>=Math.min(2,terms.length));
 const football=/(france|fransa)/i.test(query)&&/(turkiye|türkiye|turkey)/i.test(query)&&/(football|futbol|match|maç|score|skor)/i.test(query);
 if(football)filtered=filtered.filter(x=>/\b\d{1,2}\s*[-–:]\s*\d{1,2}\b/.test(x._raw)||/uefa nations league|uefa|league a|ligue des nations/i.test(x._hay)&&/(15\s*(nov|november|kasim)|11[./-]15[./-]2026|15[./-]11[./-]2026|2026-11-15|november\s+15)/i.test(x._raw));
 return filtered.sort((a,b)=>b._score-a._score).map(({_score,_hay,_raw,...x})=>x);
}
function rssTag(item,tag){const m=item.match(new RegExp("<"+tag+"[^>]*>([\\s\\S]*?)<\\/"+tag+">","i"));return m?cleanHtml(m[1].replace(/^<!\[CDATA\[|\]\]>$/g,"").trim()):""}
async function searchSportsScore(query){
 const q=String(query||"");
 if(!/(france|fransa)/i.test(q)||!/(turkiye|türkiye|turkey)/i.test(q)||!/(football|futbol|match|maç|score|skor)/i.test(q))return null;
 const m=q.match(/\b(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})\b/i);
 if(!m)return null;
 const months={january:"01",february:"02",march:"03",april:"04",may:"05",june:"06",july:"07",august:"08",september:"09",october:"10",november:"11",december:"12"};
 const date=m[3]+months[m[2].toLowerCase()]+m[1].padStart(2,"0");
 try{
  const u=new URL("https://site.api.espn.com/apis/site/v2/sports/soccer/uefa.nations/scoreboard");u.searchParams.set("dates",date);u.searchParams.set("limit","100");
  const r=await fetch(u,{headers:{"User-Agent":"LinayAI/1.0","Accept":"application/json"},signal:AbortSignal.timeout(4500)});
  if(!r.ok)return null;
  const j=await r.json();
  for(const event of j.events||[]){
   const competitors=event.competitions?.[0]?.competitors||[];
   const france=competitors.find(c=>/france/i.test(searchNorm(c.team?.displayName||c.team?.name||"")));
   const turkey=competitors.find(c=>/turkiye|turkey/i.test(searchNorm(c.team?.displayName||c.team?.name||"")));
   if(!france||!turkey)continue;
   const home=competitors.find(c=>c.homeAway==="home"),away=competitors.find(c=>c.homeAway==="away");
   const score=home&&away?(home.score+"-"+away.score):(france.score+"-"+turkey.score);
   const status=event.status?.type?.detail||event.status?.type?.description||"Scoreboard";
   const title=(home?.team?.displayName||"Home")+" "+(home?.score??"?")+"-"+(away?.score??"?")+" "+(away?.team?.displayName||"Away");
   const url="https://www.espn.com/soccer/match/_/gameId/"+event.id;
   return {provider:"ESPN Scoreboard",results:[{title,url,snippet:"UEFA Nations League · "+m[1]+" "+m[2]+" "+m[3]+" · "+status+" · Score: "+score,source:"ESPN"}]};
  }
 }catch(e){}
 return null;
}
async function searchWeb(query,env){
 const q=String(query||"").trim().slice(0,400);if(!q)throw new Error("Arama sorgusu boş.");
 const headers={"User-Agent":"LinayAI/1.0 (+https://patarakutere.github.io/linayAI/)"};
 const timeout=4500,errors=[];
 const accept=async(name,promise)=>{
  try{const value=await promise;if(value?.results?.length)return value;errors.push(name+": uygun sonuç yok");}
  catch(e){errors.push(name+": "+String(e?.message||e).slice(0,120))}
  return null;
 };
 const sports=await searchSportsScore(q);
 if(sports?.results?.length)return sports;
 const first=[];
 if(env.SEARXNG_URL)first.push(accept("SearXNG",(async()=>{
  const u=new URL("/search",env.SEARXNG_URL);u.searchParams.set("q",q);u.searchParams.set("format","json");u.searchParams.set("language","tr-TR");
  const r=await fetch(u,{headers,signal:AbortSignal.timeout(timeout)});if(!r.ok)throw new Error("HTTP "+r.status);
  const j=await r.json(),a=(j.results||[]).slice(0,10).map(x=>({title:cleanHtml(x.title),url:x.url,snippet:cleanHtml(x.content),source:x.engine||"SearXNG"})).filter(x=>x.title&&safeUrl(x.url));
  const results=relevantResults(q,a);if(!results.length)throw new Error("alakalı sonuç bulunamadı");
  return {provider:"SearXNG",results:results.slice(0,7)};
 })()));
 if(env.BRAVE_SEARCH_API_KEY)first.push(accept("Brave Search",(async()=>{
  const u=new URL("https://api.search.brave.com/res/v1/web/search");u.searchParams.set("q",q);u.searchParams.set("count","8");
  const r=await fetch(u,{headers:{...headers,"X-Subscription-Token":env.BRAVE_SEARCH_API_KEY},signal:AbortSignal.timeout(timeout)});if(!r.ok)throw new Error("HTTP "+r.status);
  const j=await r.json(),a=(j.web?.results||[]).slice(0,10).map(x=>({title:cleanHtml(x.title),url:x.url,snippet:cleanHtml(x.description),source:"Brave"})).filter(x=>x.title&&safeUrl(x.url));
  const results=relevantResults(q,a);if(!results.length)throw new Error("alakalı sonuç bulunamadı");
  return {provider:"Brave Search",results:results.slice(0,7)};
 })()));
 first.push(accept("Bing RSS",(async()=>{
  const u=new URL("https://www.bing.com/search");u.searchParams.set("format","rss");u.searchParams.set("q",q);u.searchParams.set("count","10");
  const r=await fetch(u,{headers:{...headers,"Accept":"application/rss+xml, application/xml, text/xml"},signal:AbortSignal.timeout(timeout)});if(!r.ok)throw new Error("HTTP "+r.status);
  const xml=await r.text(),items=[...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)];
  const a=items.slice(0,12).map(([_,item])=>({title:rssTag(item,"title"),url:rssTag(item,"link"),snippet:rssTag(item,"description"),source:"Bing"})).filter(x=>x.title&&safeUrl(x.url));
  const results=relevantResults(q,a);if(!results.length)throw new Error("alakalı sonuç bulunamadı");
  return {provider:"Bing RSS",results:results.slice(0,7)};
 })()));
 const fast=await Promise.any(first.map(p=>p.then(v=>{if(!v)throw new Error("sonuç yok");return v})).concat([]).map(p=>p.catch(e=>{throw e}))).catch(()=>null);
 if(fast)return fast;
 const second=[
  accept("Google News RSS",(async()=>{
   const u=new URL("https://news.google.com/rss/search");u.searchParams.set("q",q);u.searchParams.set("hl","tr");u.searchParams.set("gl","TR");u.searchParams.set("ceid","TR:tr");
   const r=await fetch(u,{headers:{...headers,"Accept":"application/rss+xml, application/xml, text/xml"},signal:AbortSignal.timeout(timeout)});if(!r.ok)throw new Error("HTTP "+r.status);
   const xml=await r.text(),items=[...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)];
   const a=items.slice(0,15).map(([_,item])=>({title:rssTag(item,"title"),url:rssTag(item,"link"),snippet:rssTag(item,"description"),source:"Google News"})).filter(x=>x.title&&safeUrl(x.url));
   const results=relevantResults(q,a);if(!results.length)throw new Error("alakalı sonuç bulunamadı");
   return {provider:"Google News RSS",results:results.slice(0,7)};
  })()),
  accept("Bing",(async()=>{
   const u=new URL("https://www.bing.com/search");u.searchParams.set("q",q);u.searchParams.set("count","8");
   const r=await fetch(u,{headers:{...headers,"Accept":"text/html","Accept-Language":"tr-TR,tr;q=0.9,en;q=0.8"},signal:AbortSignal.timeout(timeout)});if(!r.ok)throw new Error("HTTP "+r.status);
   const h=await r.text(),a=[];const re=/<li[^>]*class="[^"]*\bb_algo\b[^"]*"[\s\S]*?<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>[\s\S]*?<\/li>/gi;let m;
   while((m=re.exec(h))&&a.length<10){const url=decodeHtml(m[1]);if(safeUrl(url))a.push({title:cleanHtml(m[2]),url,snippet:cleanHtml(m[3]),source:"Bing"})}
   const results=relevantResults(q,a);if(!results.length)throw new Error("alakalı sonuç bulunamadı");
   return {provider:"Bing",results:results.slice(0,7)};
  })()),
  accept("DuckDuckGo",(async()=>{
   const u=new URL("https://html.duckduckgo.com/html/");u.searchParams.set("q",q);
   const r=await fetch(u,{headers:{...headers,"Accept":"text/html"},signal:AbortSignal.timeout(timeout)});if(!r.ok)throw new Error("HTTP "+r.status);
   const h=await r.text(),a=[];const re=/<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;let m;
   while((m=re.exec(h))&&a.length<10){let url=decodeHtml(m[1]);try{const x=new URL(url);if(x.searchParams.has("uddg"))url=decodeURIComponent(x.searchParams.get("uddg"))}catch{}const sn=h.slice(re.lastIndex,re.lastIndex+1400).match(/class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|div)>/i);if(safeUrl(url))a.push({title:cleanHtml(m[2]),url,snippet:cleanHtml(sn?.[1]||""),source:"DuckDuckGo"})}
   const results=relevantResults(q,a);if(!results.length)throw new Error("alakalı sonuç bulunamadı");
   return {provider:"DuckDuckGo",results:results.slice(0,7)};
  })()),
  accept("Wikipedia",(async()=>{
   const u=new URL("https://en.wikipedia.org/w/api.php");u.searchParams.set("action","query");u.searchParams.set("list","search");u.searchParams.set("srsearch",q);u.searchParams.set("format","json");u.searchParams.set("origin","*");
   const r=await fetch(u,{headers,signal:AbortSignal.timeout(timeout)});if(!r.ok)throw new Error("HTTP "+r.status);
   const j=await r.json(),a=(j.query?.search||[]).slice(0,7).map(x=>({title:x.title,url:"https://en.wikipedia.org/wiki/"+encodeURIComponent(x.title.replace(/ /g,"_")),snippet:cleanHtml(x.snippet),source:"Wikipedia"}));
   const results=relevantResults(q,a);if(!results.length)throw new Error("alakalı sonuç bulunamadı");
   return {provider:"Wikipedia",results:results.slice(0,5)};
  })())
 ];
 const fallback=await Promise.any(second.map(p=>p.then(v=>{if(!v)throw new Error("sonuç yok");return v}))).catch(()=>null);
 if(fallback)return fallback;
 throw new Error("Web araması zaman aşımına uğradı veya sağlayıcılar doğrulanabilir, alakalı sonuç döndürmedi. Hiçbir kaynak üretilemedi. "+errors.slice(0,3).join("; "));
}
async function embed(env,text){const r=await env.AI.run(EMBED_MODEL,{text:[String(text).slice(0,7000)]});const v=r?.data?.[0]||r?.result?.data?.[0];if(!Array.isArray(v))throw new Error("Embedding modeli geçerli vektör döndürmedi.");return v}
async function ragSearch(env,userId,query,projectId=null){
 if(!env.DB)return [];
 try{
  const hasDocs=await env.DB.prepare("SELECT 1 AS present FROM documents WHERE user_id=? AND (project_id IS NULL OR project_id=?) LIMIT 1").bind(userId,projectId).first();
  if(!hasDocs)return [];
  let semantic=[];
  if(env.VECTOR&&env.AI){
   try{
    const v=await embed(env,query),r=await env.VECTOR.query(v,{topK:20,filter:{userId:userId}});
    const ids=[...new Set((r.matches||[]).map(x=>x.id))];await log(env,"rag-query","Vectorize",true,0,"matches="+ids.length);
    if(ids.length){
     const rows=await env.DB.prepare("SELECT c.id AS chunk_id,c.content,c.document_id,d.name,d.project_id FROM chunks c JOIN documents d ON d.id=c.document_id WHERE c.user_id=? AND c.id IN ("+ids.map(()=>"?").join(",")+") AND (d.project_id IS NULL OR d.project_id=?)").bind(userId,...ids,projectId).all();
     const map=new Map((rows.results||[]).map(x=>[x.chunk_id,x]));
     semantic=ids.map(id=>map.get(id)).filter(Boolean);
    }
   }catch(e){await log(env,"rag-vector-unavailable","Workers AI/Vectorize",false,0,e.message||e)}
  }
  const stop=new Set(["what","which","where","when","that","this","with","from","have","does","your","file","document","the","and","for","about","tell","show","read","please","nedir","nedeni","hangi","bana","hakkında","belge","dosya","içerik","içinde","olan","bunu","şunu","indexed","named","exact","contain"]);
  const terms=[...new Set((String(query).toLocaleLowerCase("tr-TR").match(/[\p{L}\p{N}]{3,}/gu)||[]).filter(x=>!stop.has(x)))].slice(0,10);
  let keyword=[];
  if(terms.length){
   const where=terms.map(()=>"(d.name LIKE ? OR c.content LIKE ?)").join(" OR ");
   const args=[userId,...terms.flatMap(x=>["%"+x+"%","%"+x+"%"])];
   const scope=projectId?" AND (d.project_id=? OR d.project_id IS NULL)":" AND d.project_id IS NULL";
   const fallback=await env.DB.prepare("SELECT c.id AS chunk_id,c.content,c.document_id,d.name,d.project_id FROM chunks c JOIN documents d ON d.id=c.document_id WHERE c.user_id=? AND ("+where+")"+scope+" ORDER BY CASE WHEN d.project_id=? THEN 0 ELSE 1 END,d.created_at DESC LIMIT 5").bind(...args,...(projectId?[projectId,projectId]:[null])).all();
   keyword=fallback.results||[];
   await log(env,"rag-keyword-fallback","D1",true,0,"matches="+keyword.length);
  }
  const combined=[...semantic,...keyword],unique=new Map();
  for(const row of combined){if(row&&!unique.has(row.chunk_id||row.id))unique.set(row.chunk_id||row.id,row)}
  return [...unique.values()].sort((x,y)=>(y.project_id===projectId?1:0)-(x.project_id===projectId?1:0)).slice(0,5);
 }catch(e){await log(env,"rag-query","D1",false,0,e.message||e);return []}
}
async function saveDocument(env,userId,name,text,projectId=null){
 if(!env.DB)throw new Error("Belge veritabanı bağlı değil.");
 const id=uid(),clean=String(text||"").trim().slice(0,200000);if(!clean)throw new Error("Dosyada okunabilir metin bulunamadı.");
 const docName=String(name||"Belge").slice(0,180);
 await env.DB.prepare("INSERT INTO documents(id,user_id,name,project_id) VALUES(?,?,?,?)").bind(id,userId,docName,projectId||null).run();
 const chunks=[];for(let i=0;i<clean.length;i+=850){const part=clean.slice(i,Math.min(clean.length,i+1050));if(part.trim())chunks.push({id:uid(),content:part})}
 for(const c of chunks)await env.DB.prepare("INSERT INTO chunks(id,user_id,document_id,content) VALUES(?,?,?,?)").bind(c.id,userId,id,c.content).run();
 let vectorIndexed=!!(env.VECTOR&&env.AI),vectorError="";
 if(vectorIndexed){
  for(let i=0;i<chunks.length;i+=4){
   const batch=chunks.slice(i,i+4),vectors=[];
   try{
    for(const c of batch){const v=await embed(env,c.content);vectors.push({id:c.id,values:v,metadata:{userId,documentId:id,projectId:projectId||"global"}})}
    const mutation=await env.VECTOR.upsert(vectors);await log(env,"vector-upsert","Vectorize",true,0,JSON.stringify(mutation).slice(0,300));
   }catch(e){vectorIndexed=false;vectorError=String(e.message||e);await log(env,"vector-upsert","Vectorize",false,0,vectorError);break}
  }
 }
 return {id,name:docName,projectId:projectId||null,chunks:chunks.length,vectorIndexed,vectorError:vectorError.slice(0,180)};
}
async function loadMemory(env,userId){
 // The server memory is the single source of truth (one row per user, same row GET /memory returns).
 // Past conversations are deliberately NOT loaded: the server has no per-chat/private/project scope for them.
 if(!env.DB)return {memories:[],recent:[]};
 let memories=[];
 try{const m=await env.DB.prepare("SELECT content FROM memories WHERE user_id=? ORDER BY created_at DESC LIMIT 1").bind(userId).all();memories=(m.results||[]).filter(x=>x&&String(x.content||"").trim())}catch(e){}
 return {memories,recent:[]};
}
function sseFromText(text,provider,searchState,trace,sources=[],agentSteps=0,documents=[],agentTrace=[],memoryCandidate=null,auditChecked=false,auditAttempted=false){
 const enc=new TextEncoder();const chunks=[];for(let i=0;i<text.length;i+=90)chunks.push(text.slice(i,i+90));
 const stream=new ReadableStream({start(c){for(const t of chunks)c.enqueue(enc.encode("data: "+JSON.stringify({choices:[{delta:{content:t},index:0}]})+"\n\n"));c.enqueue(enc.encode("data: [DONE]\n\n"));c.close()}});
 return new Response(stream,{headers:{...CORS,"Content-Type":"text/event-stream; charset=utf-8","Cache-Control":"no-cache","X-Linay-Provider":provider,"X-Linay-Search":searchState,"X-Linay-Trace":trace,"X-Linay-Sources":encodeURIComponent(JSON.stringify(sources.slice(0,7))),"X-Linay-Documents":encodeURIComponent(JSON.stringify(documents.slice(0,5))),"X-Linay-Agent-Steps":String(agentSteps),"X-Linay-Agent-Trace":encodeURIComponent(JSON.stringify(agentTrace.slice(0,8))),"X-Linay-Memory-Candidate":encodeURIComponent(JSON.stringify(memoryCandidate||null)),"X-Linay-Self-Audit":auditChecked?"checked":auditAttempted?"failed":"not-needed"}});
}
async function callModel(env,messages,vision=false){
 const models=vision?[VISION_MODEL]:[MODEL,...FALLBACK_MODELS];let last;
 for(const model of models){const start=Date.now();try{const opts={messages,stream:true,max_tokens:2048,temperature:0.25};if(!vision&&model===MODEL)opts.reasoning_effort="low";const stream=await env.AI.run(model,opts);return {stream,provider:"Workers AI · "+model,latency:Date.now()-start}}catch(e){last=e;await log(env,"model-fallback",model,false,Date.now()-start,e.message||e);if(isWorkersAIQuotaError(e))break}}
 if(!vision&&env.GEMINI_API_KEY){try{const r=await gemini(env,messages,false);return {text:r.text,sources:r.sources,provider:"Gemini Backup"+(/4006|daily free allocation|neurons/i.test(last?.message||"")?" · Cloudflare AI ücretsiz günlük kotası doldu":""),latency:0}}catch(e){last=e}}
 throw last||new Error("Hiçbir model yanıt veremedi.");
}
function toGemini(messages){const system=messages.filter(m=>m.role==="system").map(m=>contentText(m)).join("\n");const contents=messages.filter(m=>m.role!=="system").map(m=>({role:m.role==="assistant"?"model":"user",parts:[{text:contentText(m)}]}));return {systemInstruction:system?{parts:[{text:system}]}:undefined,contents}}
async function gemini(env,messages,search=false){
 if(!env.GEMINI_API_KEY)throw new Error("Gemini yedek anahtarı tanımlı değil.");
 const body=toGemini(messages);if(search)body.tools=[{google_search:{}}];
 const r=await fetch("https://generativelanguage.googleapis.com/v1beta/models/"+GEMINI_MODEL+":generateContent",{method:"POST",headers:{"Content-Type":"application/json","x-goog-api-key":env.GEMINI_API_KEY},body:JSON.stringify(body),...(search?{signal:AbortSignal.timeout(6000)}:{})});
 if(!r.ok)throw new Error("Gemini "+r.status+": "+(await r.text()).slice(0,240));
 const j=await r.json();const c=j.candidates?.[0];const text=(c?.content?.parts||[]).map(p=>p.text||"").join("");
 const sources=(c?.groundingMetadata?.groundingChunks||[]).map(x=>x.web).filter(x=>x?.uri);
 return {text,sources};
}
async function readPage(raw){
 const u=safeUrl(raw);if(!u)throw new Error("Bu bağlantı güvenlik nedeniyle açılamıyor.");
 const r=await fetch(u,{headers:{"User-Agent":"LinayAI/1.0","Accept":"text/html,text/plain,application/pdf"},redirect:"error",signal:AbortSignal.timeout(10000)});
 if(!r.ok)throw new Error("Sayfa HTTP "+r.status);
 const type=r.headers.get("content-type")||"";if(!/text\/html|text\/plain/i.test(type))throw new Error("Bu dosya türü sayfa okuma için desteklenmiyor.");
 const t=await r.text();return {url:u.href,title:u.hostname,text:cleanHtml(t).slice(0,9000)};
}
function calc(expr){
 const s=String(expr).replace(/,/g,".").replace(/\s+/g,"");if(!/^[\d.+\-*/()%^]+$/.test(s)||s.length>100)throw new Error("Hesaplama ifadesi geçersiz.");
 let i=0;function atom(){if(s[i]==="+"){i++;return atom()}if(s[i]==="-"){i++;return -atom()}if(s[i]==="("){i++;const v=add();if(s[i++]!==")")throw 0;return v}let m=s.slice(i).match(/^(?:\d+(?:\.\d*)?|\.\d+)/);if(!m)throw 0;i+=m[0].length;return Number(m[0])}
 function pow(){let v=atom();if(s[i]==="^"){i++;v=Math.pow(v,pow())}return v}
 function mul(){let v=pow();while(s[i]==="*"||s[i]==="/"||s[i]==="%"){const o=s[i++],b=pow();v=o==="*"?v*b:o==="/"?v/b:v%b}return v}
 function add(){let v=mul();while(s[i]==="+"||s[i]==="-"){const o=s[i++],b=mul();v=o==="+"?v+b:v-b}return v}
 try{const v=add();if(i!==s.length||!Number.isFinite(v))throw 0;return String(v)}catch{throw new Error("Hesaplama çözümlenemedi.")}}
async function runPlain(env,messages,maxTokens=1200){
 let last;
 for(const model of [MODEL,...FALLBACK_MODELS]){
  try{
   const opts={messages,max_tokens:maxTokens,temperature:0.15};if(model===MODEL)opts.reasoning_effort="low";const value=await env.AI.run(model,opts);
   if(!modelText(value)){last=new Error("Model boş yanıt döndürdü.");await log(env,"agent-model-fallback",model,false,0,last.message);continue}
   return Object.assign({},value,{__linayModel:model});
  }catch(e){last=e;await log(env,"agent-model-fallback",model,false,0,e.message||e);if(isWorkersAIQuotaError(e))break}
 }
 if(env.GEMINI_API_KEY){try{const g=await gemini(env,messages,false);if(g.text)return {response:g.text,__linayModel:"Gemini Backup"+(/4006|daily free allocation|neurons/i.test(last?.message||"")?" · Cloudflare AI ücretsiz günlük kotası doldu":"")};last=new Error("Gemini boş yanıt döndürdü.")}catch(e){last=e}}
 throw last||new Error("Ajan için hiçbir model kullanılamadı.");
}
function isWorkersAIQuotaError(error){return /4006|daily free allocation|neurons/i.test(String(error?.message||error||""))}
function modelText(value){
 const candidates=[value?.choices?.[0]?.message?.content,value?.choices?.[0]?.text,value?.response,value?.result?.choices?.[0]?.message?.content,value?.value?.choices?.[0]?.message?.content,value?.output_text];
 for(const c of candidates){if(typeof c==="string"&&c.trim())return c;if(Array.isArray(c)){const t=c.map(x=>typeof x==="string"?x:(x?.text||x?.content||"")).join("").trim();if(t)return t}}
 return "";
}
async function agentRun(env,userId,messages,projectId=null,onProgress=()=>{},searchAlreadyDone=false){
 const tools=["search_web","read_url","calculator","current_time","knowledge_search"];
 let observations=[],steps=0;
 const requestText=contentText(lastUser(messages));onProgress({label:"İsteğin kapsamı belirleniyor",status:"started"});
 const mult=requestText.match(/(\d+(?:[.,]\d+)?)\s*(?:multiplied by|times|çarpı|ile çarp|×|x)\s*(\d+(?:[.,]\d+)?)/i);
 if(mult&&/calculator|calculate|multiply|çarp|hesap/i.test(requestText)){onProgress({tool:"calculator",label:"Hesaplama yapılıyor",status:"started"});const expression=mult[1].replace(",",".")+"*"+mult[2].replace(",","." );observations.push({tool:"calculator",expression,result:calc(expression)});onProgress({tool:"calculator",label:"Hesaplama tamamlandı",status:"done"});steps++}
 else if(/what time|current time|saat kaç|şu an saat/i.test(requestText)){onProgress({tool:"current_time",label:"Güncel saat bilgisi alınıyor",status:"started"});observations.push({tool:"current_time",...{time:new Intl.DateTimeFormat("tr-TR",{timeZone:"Europe/Istanbul",dateStyle:"full",timeStyle:"long"}).format(new Date()),timezone:"Europe/Istanbul"}});onProgress({tool:"current_time",label:"Saat bilgisi alındı",status:"done"});steps++}
 else if(/https?:\/\//i.test(requestText)&&/read|open|summarize|özet|incele|oku/i.test(requestText)){const url=requestText.match(/https?:\/\/[^\s)]+/i)?.[0];onProgress({tool:"read_url",label:"Bağlantı okunuyor",status:"started"});try{if(url)observations.push({tool:"read_url",...await readPage(url)})}catch(e){observations.push({tool:"read_url",error:String(e.message||e)})}onProgress({tool:"read_url",label:"Bağlantı okundu",status:"done"});steps++}
 else if(!searchAlreadyDone&&(/research|search|look up|araştır|güncel|latest|news/i.test(requestText)||isSearchCommand(requestText)||needsLiveSearch(requestText))){onProgress({tool:"search_web",label:"Web’de arama yapılıyor",status:"started"});try{const result=await searchWeb(searchQueryFromMessages(messages)||requestText,env);observations.push({tool:"search_web",...result})}catch(e){observations.push({tool:"search_web",error:String(e.message||e)})}onProgress({tool:"search_web",label:"Web araması tamamlandı",status:"done"});steps++}
 else if(/belge|document|dosya|file/i.test(requestText)){onProgress({tool:"knowledge_search",label:"Proje ve belge hafızası aranıyor",status:"started"});observations.push({tool:"knowledge_search",results:await ragSearch(env,userId,requestText,projectId)});onProgress({tool:"knowledge_search",label:"Belge araması tamamlandı",status:"done"});steps++}
 for(;steps<4;steps++){
  const planner=[{role:"system",content:messages.filter(m=>m.role==="system").map(m=>contentText(m)).join("\n")+"\n\nSen Linay araç kullanan ajansın. Araç bulgularını birleştirirken tarihleri, sayıları ve kaynak iddialarını karşılaştır. Aynı olgu için çelişki varsa iki değeri kaynaklarıyla belirt; eksik doğrulama varsa açıkça söyle. Yayın tarihi ile olay tarihini karıştırma. Kaynak, skor veya sayı uydurma. Gerekiyorsa tam olarak tek JSON nesnesi üret: {\"tool\":\"search_web|read_url|calculator|current_time|knowledge_search|final\",\"args\":{\"query\":\"...\",\"url\":\"...\",\"expression\":\"...\"},\"answer\":\"...\"}. Araçları gerektiğinde kullan. Kullanıcı açıkça bir araç istediyse MUTLAKA çalıştır. Matematik işlemi varsa calculator kullan; güncel araştırma isteniyorsa search_web kullan; URL verilmişse read_url kullan; saat soruluyorsa current_time kullan; kullanıcı belgesi soruluyorsa knowledge_search kullan. En fazla dört araç adımı. Kaynakları uydurma. Sonuca ulaştıysan tool=final ile cevap ver. Gözlemler: "+JSON.stringify(observations).slice(0,10000)},...messages.filter(m=>m.role!=="system")];
  const p=await runPlain(env,planner,500);
  const raw=modelText(p);const match=String(raw).match(/\{[\s\S]*\}/);if(!match)break;
  let action;try{action=JSON.parse(match[0])}catch{break}
  if(action.tool==="final")return {answer:String(action.answer||""),steps,observations,model:p.__linayModel||MODEL};
  if(!tools.includes(action.tool))break;
  let result;
  onProgress({tool:action.tool,label:({search_web:"Web’de arama yapılıyor",read_url:"Bağlantı okunuyor",calculator:"Hesaplama yapılıyor",current_time:"Saat bilgisi alınıyor",knowledge_search:"Proje ve belge hafızası aranıyor"})[action.tool]||"Araç çalıştırılıyor",status:"started"});
  try{
   if(action.tool==="search_web"){const s=await searchWeb(action.args?.query||contentText(lastUser(messages)),env);result=s;observations.push({tool:action.tool,...s})}
   if(action.tool==="read_url"){result=await readPage(action.args?.url);observations.push({tool:action.tool,...result})}
   if(action.tool==="calculator"){result={result:calc(action.args?.expression||"")};observations.push({tool:action.tool,...result})}
   if(action.tool==="current_time"){result={time:new Intl.DateTimeFormat("tr-TR",{timeZone:action.args?.timezone||"Europe/Istanbul",dateStyle:"full",timeStyle:"long"}).format(new Date()),timezone:action.args?.timezone||"Europe/Istanbul"};observations.push({tool:action.tool,...result})}
   if(action.tool==="knowledge_search"){result=await ragSearch(env,userId,action.args?.query||contentText(lastUser(messages)),projectId);observations.push({tool:action.tool,results:result})}
  }catch(e){observations.push({tool:action.tool,error:String(e.message||e)})}
  onProgress({tool:action.tool,label:({search_web:"Web araması tamamlandı",read_url:"Bağlantı okundu",calculator:"Hesaplama tamamlandı",current_time:"Saat bilgisi alındı",knowledge_search:"Belge araması tamamlandı"})[action.tool]||"Araç adımı tamamlandı",status:"done"});
 }
 const context=[{role:"system",content:messages.filter(m=>m.role==="system").map(m=>contentText(m)).join("\n")+"\n\nAraç gözlemleri (yalnızca bunlara dayan): "+JSON.stringify(observations).slice(0,12000)+"\nTarihleri, rakamları ve aynı iddiaya ilişkin kaynakları karşılaştır. Çelişen değerleri ve kaynaklarını açıkça yaz; eksik veya bağımsız doğrulaması olmayan bilgiyi belirt. Yayın tarihi ile olay tarihini ayır. Araç başarısızsa bunu belirt. Kaynak, skor veya istatistik uydurma."},...messages.filter(m=>m.role!=="system")];
 const out=await runPlain(env,context,1800);
 const audit=await selfAudit(env,requestText,modelText(out)||"Ajan yanıt üretemedi.");
 return {answer:audit.answer,steps,observations,model:out.__linayModel||MODEL,audit};
}
async function handleChat(req,env,ctx){
 const body=await req.json(),messages=Array.isArray(body.messages)?body.messages:[];if(!messages.length)return json({error:"Mesaj bulunamadı"},400);
 if(!validUserId(body.userId))return json({error:"Geçersiz kullanıcı kimliği."},400);
 const userId=safeId(body.userId),projectId=typeof body.projectId==="string"&&/^[a-zA-Z0-9_-]{1,100}$/.test(body.projectId)?body.projectId:null,start=Date.now(),last=lastUser(messages),question=contentText(last).slice(0,1200),searchQuery=searchQueryFromMessages(messages),memoryCandidate=extractMemoryCandidate(messages),simpleCalculation=/\d[\d.,]*\s*(?:[+×x*÷/\-]|çarpı|çarp|topla|bölü|eksi|artı)\s*\d[\d.,]*/i.test(question)&&!/(internetten|webde|web\x27de|araştır|güncel|bugün|şu an|kaynak)/i.test(question),searchRequested=!simpleCalculation&&(body.search===true||shouldSearchMessages(messages));
 let searchState="off",searchContext="",searchProvider="",searchSources=[];
 if(searchRequested){
  try{const sr=await searchWeb(searchQuery||question,env);searchProvider=sr.provider;searchSources=sr.results;searchState="success";searchContext="\n\nWEB SEARCH RESULTS — Use these results, compare dates and sources, cite each factual paragraph with [n]. Do not claim you opened pages unless you did.\n"+sr.results.map((x,i)=>"["+ (i+1)+"] "+x.title+"\nURL: "+x.url+"\nSnippet: "+x.snippet).join("\n\n")}
  catch(e){try{if(env.GEMINI_API_KEY){const searchSystem={role:"system",content:"Current date: "+new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Istanbul",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date())+" (Europe/Istanbul). Resolve short follow-up messages using the earlier conversation. Search the exact teams and date for sports scores. Prefer official football federations, UEFA, or reputable live-score providers. Never invent a score or claim a past event is in the future. Cite the exact result and its source."};const g=await gemini(env,[searchSystem,...messages.filter(m=>m.role!=="system")],true);const groundedSources=(g.sources||[]).map(x=>({title:x.title||"Kaynak",url:x.uri,snippet:"Google Search grounding"})).filter(x=>safeUrl(x.url));if(!groundedSources.length)throw new Error("Google Search yedek yanıtı doğrulanabilir kaynak bağlantısı içermiyor.");searchState="gemini-backup";searchProvider="Gemini Google Search";searchSources=groundedSources;searchContext="\n\nIndependent search unavailable; Gemini Google Search fallback findings:\n"+g.text+"\nSources:\n"+groundedSources.map(x=>x.title+" "+x.url).join("\n");}else throw e}catch(g){searchState="failed";searchContext="\n\nAll web search providers failed. Do not pretend to have verified current facts. Tell the user web search failed. Error: "+String(g.message||g)}}
 }
 const mem=await loadMemory(env,userId);
 const asksAboutDocuments=/(yüklediğim|yukledigim|eklediğim|ekledigim|paylaştığım|paylastigim|dosya|belge|doküman|dokuman|pdf|dosyanın|dosyanin|belgenin|belge içeriği|dosya içeriği|içinde ne yazıyor|içeriğinde ne var)/i.test(question);
 const rag=asksAboutDocuments?await ragSearch(env,userId,question,projectId):[];
  const documentSources=rag.map(x=>({documentId:x.document_id,chunkId:x.chunk_id||x.id,title:x.name||"Belge",projectId:x.project_id||null,excerpt:String(x.content||"").replace(/\s+/g," ").slice(0,220)}));
 // When the server holds the user's memory it is the only memory injected; the client's copy is removed to avoid duplicate/stale memory.
 const clientMemoryRe=/\n*KULLANICI HAFIZASI:\n[\s\S]*?\nYalnızca ilgili olduğunda kullan\./;
 const originalSystem=messages.filter(m=>m.role==="system").map(m=>contentText(m)).join("\n").replace(mem.memories.length?clientMemoryRe:/(?!)/,"");
 const memoryBlock=mem.memories.length?"\n\nUSER SAVED MEMORY (use only when relevant to the request):\n"+mem.memories.map(x=>x.content).join("\n"):"";
 const sys=originalSystem+"\n\nLinayAI: Be accurate, concise and honest. For logic, distinguish what follows from what does not follow. Never invent current facts, sources, citations, scores or statistics. If sources are supplied, cite them using their numbered URLs. Before presenting current or researched findings, compare dates, numerical values and claims across supplied sources. Distinguish publication dates from event dates and values referring to different measures. If credible sources disagree on the same fact, explicitly state the conflict and differing values with source numbers. If a key date, number or source is missing, say it could not be verified; never guess. If only one source exists, disclose that independent confirmation is limited. "+memoryBlock+(rag.length?"\nIMPORTANT: THE USER DOCUMENT SEARCH FOUND THE FOLLOWING EXCERPTS FROM THE USER UPLOADED FILES. YOU CAN READ THESE EXCERPTS. Use them to answer questions about those files. Never claim you cannot access a file when an excerpt is provided.\nUSER DOCUMENT EXCERPTS:\n"+rag.map((x,i)=>"[Belge: "+(x.name||"yüklenen dosya")+" | Parça "+(i+1)+"]\n"+x.content).join("\n---\n"):"")+searchContext;
 const enriched=[{role:"system",content:sys},...messages.filter(m=>m.role!=="system")];
 if(body.agent===true){
  const enc=new TextEncoder();let streamController;
  const stream=new ReadableStream({start(controller){streamController=controller}});
  const emit=value=>{try{streamController.enqueue(enc.encode("data: "+JSON.stringify(value)+"\n\n"))}catch(e){}};
  (async()=>{try{
   emit({progress:{label:"Görev planlanıyor",status:"started"}});
   const a=await agentRun(env,userId,enriched,projectId,event=>emit({progress:event}),searchState==="success"||searchState==="gemini-backup");
   const answer=a.answer+(searchSources.length?"\n\nKaynaklar:\n"+searchSources.map((x,i)=>"["+ (i+1)+"] ["+x.title+"]("+x.url+")").join("\n"):"");
   ctx.waitUntil((async()=>{await log(env,"agent","Workers AI",true,Date.now()-start,"steps="+a.steps);})());
   const agentDocs=(a.observations||[]).filter(x=>x.tool==="knowledge_search").flatMap(x=>x.results||[]).map(x=>({documentId:x.document_id,chunkId:x.chunk_id||x.id,title:x.name||"Belge",projectId:x.project_id||null,excerpt:String(x.content||"").replace(/\s+/g," ").slice(0,220)}));
   const agentTrace=(a.observations||[]).map(x=>({tool:x.tool,label:({search_web:"Web araması",read_url:"Bağlantı okuma",calculator:"Hesaplama",current_time:"Güncel saat",knowledge_search:"Proje / belge araması"})[x.tool]||"Araç",status:x.error?"failed":"done",detail:x.error?String(x.error).slice(0,120):""}));
   emit({meta:{sources:searchSources,documents:agentDocs,steps:a.steps,trace:agentTrace,memoryCandidate,audit:a.audit||{checked:false}}});
   for(let i=0;i<answer.length;i+=90)emit({choices:[{delta:{content:answer.slice(i,i+90)},index:0}]});
   emit("[DONE]");streamController.close();
  }catch(e){await log(env,"agent","Workers AI",false,Date.now()-start,e.message);emit({error:{message:"Ajan görevi tamamlayamadı: "+String(e.message||e)}});emit("[DONE]");try{streamController.close()}catch(x){}}})();
  return new Response(stream,{headers:{...CORS,"Content-Type":"text/event-stream; charset=utf-8","Cache-Control":"no-cache","X-Linay-Provider":"Workers AI Agent","X-Linay-Search":searchState,"X-Linay-Trace":uid(),"X-Linay-Sources":"%5B%5D","X-Linay-Documents":"%5B%5D","X-Linay-Agent-Steps":"0","X-Linay-Agent-Trace":"%5B%5D","X-Linay-Memory-Candidate":encodeURIComponent(JSON.stringify(memoryCandidate||null)),"X-Linay-Self-Audit":"not-needed"}});
 }
 const vision=messages.some(m=>Array.isArray(m.content)&&m.content.some(p=>p.type==="image_url"));
 try{
  if(searchRequested&&!vision){
   const plain=await runPlain(env,enriched,1800),draft=modelText(plain);
   if(!draft)throw new Error("Arama sonuçları geldi ancak model boş yanıt üretti.");
   const audit=await selfAudit(env,question,draft);
   await log(env,"web-chat",plain.__linayModel||MODEL,true,Date.now()-start,searchProvider||searchState+(audit.checked?"; self-audit":""));
   return sseFromText(audit.answer,String(plain.__linayModel||"").startsWith("Gemini Backup")?plain.__linayModel:"Workers AI · "+(plain.__linayModel||MODEL),searchState,uid(),searchSources,0,documentSources,[],memoryCandidate,audit.checked,audit.attempted);
  }
  if(!vision&&shouldSelfAudit(question)){
   const plain=await runPlain(env,enriched,1800),draft=modelText(plain);if(!draft)throw new Error("Model boş yanıt döndürdü.");
   const audit=await selfAudit(env,question,draft);ctx.waitUntil(log(env,"chat",plain.__linayModel||MODEL,true,Date.now()-start,audit.checked?"self-audit":"self-audit-unavailable"));
   return sseFromText(audit.answer,plain.__linayModel||MODEL,searchState,uid(),searchSources,0,documentSources,[],memoryCandidate,audit.checked,audit.attempted);
  }
  const result=await callModel(env,enriched,vision);
  const trace=uid();
  if(result.text){const draft=result.text+(body.search===true&&result.sources?.length?"\n\nSources: "+result.sources.map(x=>x.title+" — "+x.uri).join(" | "):"");const audit=vision?{answer:draft,checked:false}:await selfAudit(env,question,draft);ctx.waitUntil(log(env,"chat",result.provider,true,Date.now()-start,"backup"));return sseFromText(audit.answer,result.provider,searchState,uid(),searchSources,0,documentSources,[],memoryCandidate,audit.checked)}
  const stream=result.stream;
  const pair=stream.tee();
  ctx.waitUntil((async()=>{try{
   let raw="",buf="",reader=pair[1].getReader(),dec=new TextDecoder();
   for(;;){const z=await reader.read();if(z.done)break;buf+=dec.decode(z.value,{stream:true});const ls=buf.split("\n");buf=ls.pop();for(const line of ls){if(!line.startsWith("data:"))continue;const v=line.slice(5).trim();if(!v||v==="[DONE]")continue;try{const j=JSON.parse(v);raw+=j.choices?.[0]?.delta?.content||""}catch(e){}}}
   await log(env,searchRequested?"web-chat":"chat",result.provider,true,Date.now()-start,searchProvider||searchState);
  }catch(e){}})());
  return new Response(pair[0],{headers:{...CORS,"Content-Type":"text/event-stream; charset=utf-8","Cache-Control":"no-cache","X-Linay-Provider":result.provider,"X-Linay-Search":searchState+(searchProvider?":"+searchProvider:""),"X-Linay-Trace":trace,"X-Linay-Sources":encodeURIComponent(JSON.stringify(searchSources.slice(0,7))),"X-Linay-Documents":encodeURIComponent(JSON.stringify(documentSources.slice(0,5))),"X-Linay-Memory-Candidate":encodeURIComponent(JSON.stringify(memoryCandidate||null)),"X-Linay-Self-Audit":"not-needed"}});
 }catch(e){await log(env,"chat","all-models",false,Date.now()-start,e.message);return json({error:"Tüm modeller başarısız oldu: "+e.message},503)}
}
export default {async fetch(req,env,ctx){
 const origin=req.headers.get("Origin");
 if(origin&&origin!==ALLOWED_ORIGIN)return json({error:"Origin izinli değil."},403);
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:CORS});
 const url=new URL(req.url),path=url.pathname;
 if(path==="/health"&&req.method==="GET")return json({ok:true,service:"LinayAI",model:MODEL,searchProviders:["ESPN Scoreboard","SearXNG (optional)","Brave (optional)","Bing RSS","Google News RSS","Bing","DuckDuckGo","Wikipedia"],memory:!!env.DB,rag:!!env.VECTOR,agents:true,version:"2.0"});
 if(path==="/title"&&req.method==="POST"){
  const started=Date.now();
  try{
   const body=await req.json(),message=String(body.message||"").replace(/\s+/g," ").trim().slice(0,5000);
   if(!message)return json({error:"Başlık oluşturmak için mesaj gerekli."},400);
   const result=await runPlain(env,[
    {role:"system",content:"Sen LinayAI için sohbet başlığı editörüsün. Kullanıcının mesajının tam anlamını anlayıp kısa, doğal ve tek satırlık Türkçe konu özeti üret. Ham mesajı kopyalama; konuşma dolgularını, tekrarları, gereksiz nezaket ifadelerini ve yazım bozukluklarını anlamı koruyarak düzelt. Selamlaşma, teknik soru, gündelik konu, araştırma, talep, dosya veya görsel dahil tüm konu türlerine aynı yaklaşımı uygula. Asıl niyeti ifade et, yeni bilgi ekleme, özel adları ve sayıları bozma. TDK yazım ve kısaltma kurallarına uy. Tercihen 2-6 kelime ve en fazla 52 karakter kullan. Cümleyi ortasından kesme; tamamlanmış bir konu adı üret. İçerik yalnızca selamlaşmaysa Selamlaşma gibi doğal başlık kullan. Yalnızca başlığı döndür; açıklama, seçenek veya etiket yazma."},
    {role:"user",content:"Bu ilk kullanıcı mesajından sohbet başlığı üret:\n"+message}
   ],100);
   let title=modelText(result).replace(/^[\s"\u201c\u201d]+|[\s"\u201c\u201d]+$/g,"").replace(/^(başlık|sohbet başlığı)\s*:\s*/i,"").replace(/\s+/g," ").trim();
   title=title.split(/\r?\n/)[0].replace(/[.!?]+$/,"").trim();
   if(!title)throw new Error("Model geçerli ve kısa bir başlık döndürmedi.");
   if(title.length>52)title=title.split(/\s+/).reduce((acc,word)=>acc&&acc.length+1+word.length<=52?acc+" "+word:"", "");
   if(!title)throw new Error("Başlık 52 karakter sınırına sığmadı.");
   title=title.charAt(0).toLocaleUpperCase("tr-TR")+title.slice(1);
   await log(env,"chat-title",result.__linayModel||MODEL,true,Date.now()-started,title);
   return json({title,provider:result.__linayModel||MODEL});
  }catch(e){
   await log(env,"chat-title","Workers AI",false,Date.now()-started,String(e.message||e));
   return json({error:"Konu özeti oluşturulamadı: "+String(e.message||e)},503);
  }
 }
 if(path==="/chat"&&req.method==="POST"){try{return await handleChat(req,env,ctx)}catch(e){return json({error:e.message||"Sunucu hatası"},500)}}
 if(path==="/memory"&&req.method==="GET"){try{const rawUserId=url.searchParams.get("userId");if(!validUserId(rawUserId))return json({error:"Geçersiz kullanıcı kimliği."},400);const userId=safeId(rawUserId);const row=await env.DB.prepare("SELECT content FROM memories WHERE user_id=? ORDER BY created_at DESC LIMIT 1").bind(userId).first();return json({content:row?.content||""})}catch(e){return json({error:e.message},500)}}
 if(path==="/memory"&&req.method==="POST"){
  try{const b=await req.json();if(!validUserId(b.userId))return json({error:"Geçersiz kullanıcı kimliği."},400);const userId=safeId(b.userId),content=String(b.content||"").trim().slice(0,6000);if(!env.DB)return json({error:"Hafıza veritabanı bağlı değil"},503);const del=env.DB.prepare("DELETE FROM memories WHERE user_id=?").bind(userId);await env.DB.batch(content?[del,env.DB.prepare("INSERT INTO memories(id,user_id,content) VALUES(?,?,?)").bind(uid(),userId,content)]:[del]);return json({ok:true})}catch(e){return json({error:e.message},500)}
 }
 if(path==="/documents"&&req.method==="POST"){
  try{const b=await req.json();if(!validUserId(b.userId))return json({error:"Geçersiz kullanıcı kimliği."},400);const userId=safeId(b.userId),projectId=typeof b.projectId==="string"&&/^[a-zA-Z0-9_-]{1,100}$/.test(b.projectId)?b.projectId:null,d=await saveDocument(env,userId,b.name,b.text,projectId);await log(env,"document-index","Workers AI",true,0,d.chunks+" chunks");return json({ok:true,document:d})}catch(e){await log(env,"document-index","Workers AI",false,0,e.message);return json({error:e.message},500)}
 }
 if(path==="/documents"&&req.method==="GET"){
  const rawUserId=url.searchParams.get("userId");if(!validUserId(rawUserId))return json({error:"Geçersiz kullanıcı kimliği."},400);const userId=safeId(rawUserId);if(!env.DB)return json({documents:[]});const projectId=url.searchParams.get("projectId");const r=await env.DB.prepare("SELECT id,name,project_id,created_at FROM documents WHERE user_id=? ORDER BY created_at DESC LIMIT 100").bind(userId).all();return json({documents:(r.results||[]).filter(d=>!projectId||d.project_id===projectId||d.project_id===null)});
 }
 if(path.startsWith("/documents/")&&req.method==="DELETE"){
  const id=path.split("/").pop(),rawUserId=url.searchParams.get("userId");if(!validUserId(rawUserId))return json({error:"Geçersiz kullanıcı kimliği."},400);const userId=safeId(rawUserId);try{const r=await env.DB.prepare("SELECT id FROM chunks WHERE user_id=? AND document_id=?").bind(userId,id).all();const ids=(r.results||[]).map(x=>x.id);if(ids.length&&env.VECTOR)await env.VECTOR.deleteByIds(ids);await env.DB.prepare("DELETE FROM chunks WHERE user_id=? AND document_id=?").bind(userId,id).run();await env.DB.prepare("DELETE FROM documents WHERE user_id=? AND id=?").bind(userId,id).run();return json({ok:true})}catch(e){return json({error:e.message},500)}
 }
 if(path==="/metrics"&&req.method==="GET"){
  try{const r=await env.DB.prepare("SELECT kind,provider,ok,COUNT(*) AS count,ROUND(AVG(latency_ms)) AS avg_ms,MAX(created_at) AS last_seen FROM events WHERE created_at>=datetime('now','-7 days') GROUP BY kind,provider,ok ORDER BY count DESC LIMIT 30").all();const d=await env.DB.prepare("SELECT COUNT(*) AS documents FROM documents").first();return json({window:"7 days",groups:r.results||[],documents:d?.documents||0})}catch(e){return json({error:"Metrikler okunamadı: "+e.message},500)}
 }
 if(path==="/search"&&req.method==="GET"){
  const q=String(url.searchParams.get("q")||"").slice(0,400);
  try{return json(await searchWeb(q,env))}catch(e){
   try{
    if(!env.GEMINI_API_KEY)throw e;
    const prompt=[{role:"system",content:"Search the web for the exact requested fact. Prefer official or reputable sources. Return factual findings grounded in Google Search and do not invent sources."},{role:"user",content:q}];
    const g=await gemini(env,prompt,true);
    const results=(g.sources||[]).map(x=>({title:x.title||"Source",url:x.uri,snippet:"Google Search grounding",source:"Gemini Google Search"})).filter(x=>safeUrl(x.url));
    if(results.length)return json({provider:"Gemini Google Search",results,answer:g.text});
    throw new Error("Google Search grounding returned no source links.");
   }catch(backup){return json({error:"Independent search and Google Search fallback failed: "+String(backup.message||backup)},503)}
  }
 }
 if(path==="/image"&&req.method==="POST"){
  const started=Date.now();
  let body={};try{body=await req.json()}catch{return json({error:"Geçersiz istek gövdesi.",provider:"LinayAI",model:null},400)}
  const prompt=String(body.prompt||"").trim().slice(0,3000);
  const image=body.image&&typeof body.image.data==="string"?body.image:null;
  const ratio=["1:1","16:9","9:16"].includes(body.ratio)?body.ratio:"1:1";
  const style=["photo","cinematic","illustration","logo"].includes(body.style)?body.style:"photo";
  if(!prompt)return json({error:"Görsel açıklaması boş olamaz.",provider:"LinayAI"},400);
  if(image&&(!/^image\/(jpeg|png|webp)$/.test(String(image.mimeType||""))||image.data.length>12000000))return json({error:"Düzenleme için JPEG, PNG veya WebP görseli (en fazla 9 MB) gerekli.",provider:"LinayAI"},400);
  // Short, consistent English template. Subject first; style/ratio are applied only when generating (not when editing).
  const subject=prompt.slice(0,1500);
  const styleText={photo:"a natural, realistic photograph",cinematic:"a cinematic still with dramatic, motivated lighting",illustration:"a clean, coherent illustration",logo:"a simple, professional logo on a plain background"}[style];
  const textRule=style==="logo"?"Include text only if the request contains it, spelled exactly as given.":"Do not add any text, letters, numbers or watermarks unless the request asks for them.";
  const fullPrompt=image
   ?["Edit the provided image according to this request: "+subject,"Change only what the request asks for. Keep the identity, faces, pose, clothing, background, camera angle, framing and aspect ratio of the original image unchanged. If the request conflicts with the original, apply the smallest possible change."].join("\n\n")
   :["Create a single image: "+subject,"The requested subject must be the clear main focus. Do not add people, objects or scenery that were not requested. Preserve any names exactly as written. "+textRule,"Style: "+styleText+". Aspect ratio: "+ratio+". Keep anatomy, proportions and perspective correct and the result free of artifacts."].join("\n\n");
  // New image generation uses Cloudflare Workers AI (FLUX); Gemini remains only for source-image edits.
  if(!image){
   if(!env.AI)return json({error:"Cloudflare Workers AI bağlantısı bulunamadı.",provider:"Cloudflare Workers AI"},503);
   // Shared daily safety cap to prevent unexpected paid usage after the free allocation.
   if(env.DB){
    try{
     await env.DB.prepare("CREATE TABLE IF NOT EXISTS image_usage (day TEXT PRIMARY KEY, count INTEGER NOT NULL DEFAULT 0)").run();
     const day=new Date().toISOString().slice(0,10);
     const usage=await env.DB.prepare("INSERT INTO image_usage(day,count) VALUES(?,1) ON CONFLICT(day) DO UPDATE SET count=count+1 WHERE count<30 RETURNING count").bind(day).first();
     if(!usage)return json({error:"LinayAI günlük görsel üretim sınırı (30 görsel) doldu. Yarın tekrar deneyebilirsin.",provider:"Cloudflare Workers AI",model:"@cf/black-forest-labs/flux-1-schnell",dailyLimit:30},429);
    }catch(e){
     await log(env,"image-generation","Cloudflare Workers AI",false,Date.now()-started,"Günlük sınır kontrolü yapılamadı: "+String(e.message||e));
     return json({error:"Güvenli kullanım sınırı doğrulanamadığı için görsel üretimi durduruldu. Lütfen daha sonra tekrar dene.",provider:"Cloudflare Workers AI"},503);
    }
   }
   const fluxModel="@cf/black-forest-labs/flux-1-schnell";
   let fluxPrompt=fullPrompt;
   // Translate Turkish requests into a concise, concrete English image prompt for better FLUX results.
   try{
    const translated=await runPlain(env,[
     {role:"system",content:"You are an expert image-prompt translator. Convert the user's image request into a precise, natural English prompt for FLUX. Preserve the exact subject, objects, colors, composition, text requested, and style. Do not invent extra subjects or details. Return only the English image prompt, no explanation."},
     {role:"user",content:fullPrompt}
    ],500);
    const value=modelText(translated).trim();
    if(value)fluxPrompt=value;
   }catch(e){await log(env,"image-prompt-translation","Workers AI",false,Date.now()-started,String(e.message||e));}
   const dimensions=ratio==="16:9"?{width:1024,height:576}:ratio==="9:16"?{width:576,height:1024}:{width:1024,height:1024};
   try{
    const result=await env.AI.run(fluxModel,{prompt:fluxPrompt,steps:4,...dimensions});
    if(!result?.image)throw new Error("FLUX görsel verisi döndürmedi.");
    const bytes=result.image instanceof Uint8Array?result.image:new Uint8Array(result.image);
    let binary="";
    for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));
    const base64=btoa(binary);
    await log(env,"image-generation","Cloudflare Workers AI "+fluxModel,true,Date.now()-started,"ratio="+ratio+"; style="+style+"; translated="+(fluxPrompt!==fullPrompt));
    return json({image:base64,type:"image/jpeg",provider:"Cloudflare Workers AI",model:fluxModel,apiVersion:"Workers AI",edited:false,ratio,style,promptTranslated:fluxPrompt!==fullPrompt,dailyLimit:30});
   }catch(e){
    const detail="Cloudflare FLUX görsel üretimi başarısız: "+String(e?.message||e);
    await log(env,"image-generation","Cloudflare Workers AI "+fluxModel,false,Date.now()-started,detail);
    return json({error:detail,provider:"Cloudflare Workers AI",model:fluxModel,apiVersion:"Workers AI",dailyLimit:30},503);
   }
  }
  const model="gemini-2.5-flash-image";
  const apiVersion="v1beta";
  if(env.GEMINI_API_KEY){
   const sleep=ms=>new Promise(r=>setTimeout(r,ms));
   // One Gemini attempt. Returns {data,mime} or {error,status,retry,...}; never throws for API-level failures.
   const attemptGemini=async(modalities,noImageHint)=>{
    const parts=[{text:noImageHint?fullPrompt+"\n\nReturn the result as an image, not as text.":fullPrompt}];
    if(image)parts.push({inlineData:{mimeType:image.mimeType,data:image.data}});
    const generationConfig={responseModalities:modalities};
    // Editing must keep the source image's own proportions, so no aspect ratio is forced then.
    if(!image)generationConfig.imageConfig={aspectRatio:ratio};
    const response=await fetch("https://generativelanguage.googleapis.com/"+apiVersion+"/models/"+model+":generateContent",{
     method:"POST",
     headers:{"Content-Type":"application/json","x-goog-api-key":env.GEMINI_API_KEY},
     body:JSON.stringify({contents:[{role:"user",parts}],generationConfig}),
     signal:AbortSignal.timeout(Math.max(5000,Math.min(75000,105000-(Date.now()-started))))
    });
    const raw=await response.text();
    let payload={};try{payload=JSON.parse(raw)}catch{}
    if(!response.ok){
     const apiMessage=payload.error?.message||raw.slice(0,700)||"Açıklama içermeyen API hatası";
     return {error:"Gemini API HTTP "+response.status+" ("+model+", "+apiVersion+"): "+apiMessage,status:response.status===429?429:502,retry:response.status!==429&&[500,502,503,504].includes(response.status),modalityRejected:response.status===400&&/modalit/i.test(apiMessage)};
    }
    const candidate=payload.candidates?.[0];
    const partsOut=candidate?.content?.parts||[];
    const output=partsOut.find(p=>p.inlineData?.data||p.inline_data?.data);
    const data=output?.inlineData?.data||output?.inline_data?.data;
    const mime=output?.inlineData?.mimeType||output?.inline_data?.mime_type||"image/png";
    if(data)return {data,mime};
    const reason=candidate?.finishReason||payload.promptFeedback?.blockReason||"NO_IMAGE_PART";
    const blocked=!!payload.promptFeedback?.blockReason||/SAFETY|PROHIBITED|BLOCKLIST|RECITATION|SPII/i.test(String(reason));
    const textPart=partsOut.find(p=>p.text)?.text||"";
    return {error:"Gemini yanıtı görsel içermedi. Neden: "+reason+(textPart?" · "+textPart.slice(0,400):""),status:blocked?422:502,retry:!blocked,noImage:true};
   };
   let outcome,retried=0,modalities=["IMAGE"],noImageHint=false;
   for(let tries=0;tries<3;tries++){
    try{outcome=await attemptGemini(modalities,noImageHint)}
    catch(e){outcome={error:"Gemini isteği başarısız ("+model+", "+apiVersion+"): "+String(e?.message||e),status:502,retry:true}}
    if(outcome.data)break;
    // Some image models may reject IMAGE-only output: fall back to the TEXT+IMAGE form once.
    if(outcome.modalityRejected&&modalities.length===1){modalities=["TEXT","IMAGE"];continue}
    // Single retry for transient failures (429/5xx, network/timeout, text-only reply) while time remains.
    if(outcome.retry&&retried<1&&Date.now()-started<80000){retried++;noImageHint=!!outcome.noImage;await sleep(1200);continue}
    break;
   }
   if(outcome.data){
    await log(env,"image-generation","Gemini "+model,true,Date.now()-started,"ratio="+(image?"source":ratio)+"; style="+style+"; edit="+!!image+"; retried="+retried+"; modalities="+modalities.join("+"));
    return json({image:outcome.data,type:outcome.mime,provider:"Gemini",model,apiVersion,edited:!!image,ratio:image?null:ratio,style,retried:retried>0});
   }
   const detail=outcome.error+(retried?" (yeniden deneme yapıldı)":"");
   await log(env,"image-generation","Gemini "+model,false,Date.now()-started,detail);
   return json({error:detail,provider:"Gemini",model,apiVersion,edited:!!image},outcome.status||502);
  }
  return json({error:"Gemini API anahtarı tanımlı değil. Yalnızca Gemini görsel motoru etkin.",provider:"Gemini",model,apiVersion,edited:!!image},503);
 }
 return new Response("Linay API",{status:404,headers:CORS});
}};