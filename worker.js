const ALLOWED_ORIGIN="https://patarakutere.github.io";
const MODEL="@cf/qwen/qwen3.8-27b";
const FALLBACK_MODELS=["@cf/openai/gpt-oss-120b"];
const VISION_MODEL="@cf/qwen/qwen3.8-27b";
const EMBED_MODEL="@cf/baai/bge-m3";
const GEMINI_MODEL="gemini-flash-lite-latest";
const CORS={"Access-Control-Allow-Origin":ALLOWED_ORIGIN,"Access-Control-Allow-Headers":"Accept, Content-Type, X-Linay-Admin","Access-Control-Allow-Methods":"GET, POST, DELETE, OPTIONS","Access-Control-Expose-Headers":"X-Linay-Provider, X-Linay-Search, X-Linay-Trace, X-Linay-Sources, X-Linay-Agent-Steps","Access-Control-Max-Age":"86400","Vary":"Origin"};
const json=(data,status=200,extra={})=>new Response(JSON.stringify(data),{status,headers:{...CORS,"Content-Type":"application/json",...extra}});
const uid=()=>crypto.randomUUID();
const safeId=x=>String(x||"").trim();
const validUserId=x=>typeof x==="string"&&/^[a-zA-Z0-9_-]{8,80}$/.test(x);
const lastUser=messages=>[...messages].reverse().find(m=>m.role==="user");
const contentText=m=>typeof m?.content==="string"?m.content:(m?.content||[]).filter(p=>p.type==="text").map(p=>p.text||"").join("\n");
async function log(env,kind,provider,ok,latency,detail=""){
 try{if(env.DB)await env.DB.prepare("INSERT INTO events(id,kind,provider,ok,latency_ms,detail) VALUES(?,?,?,?,?,?)").bind(uid(),kind,provider||"unknown",ok?1:0,Math.max(0,Math.round(latency||0)),String(detail).slice(0,350)).run()}catch(e){}
}
function decodeHtml(s){return String(s||"").replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&#x([0-9a-f]+);/gi,(_,x)=>String.fromCharCode(parseInt(x,16))).replace(/&#(\d+);/g,(_,x)=>String.fromCharCode(+x));}
function cleanHtml(s){return decodeHtml(String(s||"").replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim()).slice(0,1800)}
function safeUrl(raw){try{const u=new URL(raw);if(!["http:","https:"].includes(u.protocol)||/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.|100\.(6[4-9]|[7-9]\d)\.|\[::1\]|\[f[cd][0-9a-f:]*\]|\[fe80:)/i.test(u.hostname))return null;return u}catch{return null}}
function searchQueryFromMessages(messages){
 const users=(messages||[]).filter(m=>m.role==="user").map(m=>contentText(m).trim()).filter(Boolean).slice(-5);
 if(!users.length)return "";
 const combined=users.join(" ");
 const football=/(fransa|france)/i.test(combined)&&/(türkiye|turkiye|turkey)/i.test(combined)&&/(maç|mac|score|kaç kaç|skor|football|futbol)/i.test(combined);
 if(football){
  const date=combined.match(/(\d{1,2}\s+(?:ocak|şubat|subat|mart|nisan|mayıs|mayis|haziran|temmuz|ağustos|agustos|eylül|eylul|ekim|kasım|kasim|aralık|aralik)(?:\s+\d{4})?)/i)?.[1]||"";
  const year=date.match(/\d{4}/)?.[0]||String(new Date().getFullYear());
  const englishDate=date.replace(/ocak/ig,"January").replace(/şubat|subat/ig,"February").replace(/mart/ig,"March").replace(/nisan/ig,"April").replace(/mayıs|mayis/ig,"May").replace(/haziran/ig,"June").replace(/temmuz/ig,"July").replace(/ağustos|agustos/ig,"August").replace(/eylül|eylul/ig,"September").replace(/ekim/ig,"October").replace(/kasım|kasim/ig,"November").replace(/aralık|aralik/ig,"December");
  return ("France Türkiye football match "+englishDate+" "+year+" final score result").trim();
 }
 const last=users[users.length-1];
 return users.length>1&&last.length<90?users.slice(-3).join(" "):combined.slice(-450);
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
  const r=await fetch(u,{headers:{"User-Agent":"LinayAI/1.0","Accept":"application/json"},signal:AbortSignal.timeout(8000)});
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
 const sports=await searchSportsScore(q);if(sports)return sports;
 const headers={"User-Agent":"LinayAI/1.0 (+https://patarakutere.github.io/linayAI/)"};
 if(env.SEARXNG_URL){
  try{const u=new URL("/search",env.SEARXNG_URL);u.searchParams.set("q",q);u.searchParams.set("format","json");u.searchParams.set("language","tr-TR");const r=await fetch(u,{headers,signal:AbortSignal.timeout(9000)});if(r.ok){const j=await r.json();const a=(j.results||[]).slice(0,7).map(x=>({title:cleanHtml(x.title),url:x.url,snippet:cleanHtml(x.content),source:x.engine||"SearXNG"})).filter(x=>safeUrl(x.url));const good=relevantResults(q,a);if(good.length)return {provider:"SearXNG",results:good.slice(0,7)}}}catch(e){}
 }
 if(env.BRAVE_SEARCH_API_KEY){
  try{const u=new URL("https://api.search.brave.com/res/v1/web/search");u.searchParams.set("q",q);u.searchParams.set("count","7");const r=await fetch(u,{headers:{...headers,"X-Subscription-Token":env.BRAVE_SEARCH_API_KEY},signal:AbortSignal.timeout(9000)});if(r.ok){const j=await r.json();const a=(j.web?.results||[]).slice(0,7).map(x=>({title:cleanHtml(x.title),url:x.url,snippet:cleanHtml(x.description),source:"Brave"})).filter(x=>safeUrl(x.url));const good=relevantResults(q,a);if(good.length)return {provider:"Brave Search",results:good.slice(0,7)}}}catch(e){}
 }
 try{
 try{
  const u=new URL("https://www.bing.com/search");u.searchParams.set("format","rss");u.searchParams.set("q",q);u.searchParams.set("count","10");
  const r=await fetch(u,{headers:{...headers,"Accept":"application/rss+xml, application/xml, text/xml"},signal:AbortSignal.timeout(9000)});
  if(r.ok){const xml=await r.text(),items=[...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)];const rss=items.slice(0,12).map(([_,item])=>({title:rssTag(item,"title"),url:rssTag(item,"link"),snippet:rssTag(item,"description"),source:"Bing"})).filter(x=>x.title&&safeUrl(x.url));const good=relevantResults(q,rss);if(good.length)return {provider:"Bing RSS",results:good.slice(0,7)}}
 }catch(e){}
  const isFootball=/(france|fransa)/i.test(q)&&/(turkiye|türkiye|turkey)/i.test(q)&&/(football|futbol|match|maç|score|skor)/i.test(q);
  const variants=isFootball?[q,q+" UEFA Nations League result",q+" final score","site:tff.org "+q]:[q];
  const collected=[];
  for(const query of variants){
   const u=new URL("https://news.google.com/rss/search");u.searchParams.set("q",query);u.searchParams.set("hl","en-US");u.searchParams.set("gl","US");u.searchParams.set("ceid","US:en");
   const r=await fetch(u,{headers:{...headers,"Accept":"application/rss+xml, application/xml, text/xml"},signal:AbortSignal.timeout(9000)});
   if(!r.ok)continue;
   const xml=await r.text(),items=[...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)];
   const found=items.slice(0,10).map(([_,item])=>({title:rssTag(item,"title"),url:rssTag(item,"link"),snippet:rssTag(item,"description"),source:"Google News"})).filter(x=>x.title&&safeUrl(x.url));
   collected.push(...found);
   const good=relevantResults(q,collected);if(good.length)return {provider:"Google News RSS",results:good.slice(0,7)};
  }
  const u=new URL("https://www.bing.com/search");u.searchParams.set("q",q);u.searchParams.set("count","8");
  const r=await fetch(u,{headers:{...headers,"Accept":"text/html","Accept-Language":"tr-TR,tr;q=0.9,en;q=0.8"},signal:AbortSignal.timeout(9000)});
  if(r.ok){const h=await r.text(),a=[];const re=/<li[^>]*class="[^"]*\bb_algo\b[^"]*"[\s\S]*?<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>[\s\S]*?<\/li>/gi;let m;
   while((m=re.exec(h))&&a.length<8){const href=decodeHtml(m[1]);if(safeUrl(href))a.push({title:cleanHtml(m[2]),url:href,snippet:cleanHtml(m[3]),source:"Bing"})}
   const good=relevantResults(q,a);if(good.length)return {provider:"Bing",results:good.slice(0,7)}
  }
 }catch(e){}
 try{
  const u=new URL("https://html.duckduckgo.com/html/");u.searchParams.set("q",q);
  const r=await fetch(u,{headers:{...headers,"Accept":"text/html"},signal:AbortSignal.timeout(10000)});
  if(r.ok){const h=await r.text(),a=[];const re=/<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;let m;
   while((m=re.exec(h))&&a.length<7){let href=decodeHtml(m[1]);try{const x=new URL(href);if(x.searchParams.has("uddg"))href=decodeURIComponent(x.searchParams.get("uddg"))}catch{}const sn=h.slice(re.lastIndex,re.lastIndex+1400).match(/class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|div)>/i);if(safeUrl(href))a.push({title:cleanHtml(m[2]),url:href,snippet:cleanHtml(sn?.[1]||""),source:"DuckDuckGo"})}
   const good=relevantResults(q,a);if(good.length)return {provider:"DuckDuckGo",results:good.slice(0,7)}
  }
 }catch(e){}
 try{
  if(/(france|fransa)/i.test(q)&&/(turkiye|türkiye|turkey)/i.test(q)&&/(football|futbol|match|maç|score|skor)/i.test(q))throw new Error("Maç sonucu için doğrulanabilir skor kaynağı bulunamadı.");
  const u=new URL("https://en.wikipedia.org/w/api.php");u.searchParams.set("action","query");u.searchParams.set("list","search");u.searchParams.set("srsearch",q);u.searchParams.set("format","json");u.searchParams.set("origin","*");
  const r=await fetch(u,{headers,signal:AbortSignal.timeout(7000)});if(r.ok){const j=await r.json();const a=(j.query?.search||[]).slice(0,5).map(x=>({title:x.title,url:"https://en.wikipedia.org/wiki/"+encodeURIComponent(x.title.replace(/ /g,"_")),snippet:cleanHtml(x.snippet),source:"Wikipedia"}));const good=relevantResults(q,a);if(good.length)return {provider:"Wikipedia",results:good.slice(0,5)}}
 }catch(e){}
 throw new Error("Bağımsız arama sağlayıcıları yanıt vermedi. SearXNG/Brave yapılandırması yok veya DuckDuckGo erişimi başarısız.");
}
async function embed(env,text){const r=await env.AI.run(EMBED_MODEL,{text:[String(text).slice(0,7000)]});const v=r?.data?.[0]||r?.result?.data?.[0];if(!Array.isArray(v))throw new Error("Embedding modeli geçerli vektör döndürmedi.");return v}
async function ragSearch(env,userId,query){
 if(!env.DB)return [];
 try{
  const hasDocs=await env.DB.prepare("SELECT 1 AS present FROM documents WHERE user_id=? LIMIT 1").bind(userId).first();
  if(!hasDocs)return [];
  if(env.VECTOR&&env.AI){
   try{
    const v=await embed(env,query),r=await env.VECTOR.query(v,{topK:5,filter:{userId:userId}});
    const ids=(r.matches||[]).map(x=>x.id);await log(env,"rag-query","Vectorize",true,0,"matches="+ids.length);
    if(ids.length){
     const rows=await env.DB.prepare("SELECT c.id,c.content,c.document_id,d.name FROM chunks c JOIN documents d ON d.id=c.document_id WHERE c.user_id=? AND c.id IN ("+ids.map(()=>"?").join(",")+")").bind(userId,...ids).all();
     const map=new Map((rows.results||[]).map(x=>[x.id,x]));const found=ids.map(id=>map.get(id)).filter(Boolean).slice(0,5);
     if(found.length)return found;
    }
   }catch(e){await log(env,"rag-vector-unavailable","Workers AI/Vectorize",false,0,e.message||e)}
  }
  const stop=new Set(["what","which","where","when","that","this","with","from","have","does","your","file","document","the","and","for","about","tell","show","read","please","nedir","nedeni","hangi","bana","hakkında","belge","dosya","içerik","içinde","olan","bunu","şunu","nedir","indexed","named","exact","contain"]);
  const terms=[...new Set((String(query).toLocaleLowerCase("tr-TR").match(/[\p{L}\p{N}]{3,}/gu)||[]).filter(x=>!stop.has(x)))].slice(0,10);
  if(!terms.length)return [];
  const where=terms.map(()=>"(d.name LIKE ? OR c.content LIKE ?)").join(" OR ");
  const args=[userId,...terms.flatMap(x=>["%"+x+"%","%"+x+"%"])];
  const fallback=await env.DB.prepare("SELECT c.id,c.content,c.document_id,d.name FROM chunks c JOIN documents d ON d.id=c.document_id WHERE c.user_id=? AND ("+where+") ORDER BY d.created_at DESC LIMIT 5").bind(...args).all();
  await log(env,"rag-keyword-fallback","D1",true,0,"matches="+(fallback.results||[]).length);
  return fallback.results||[];
 }catch(e){await log(env,"rag-query","D1",false,0,e.message||e);return []}
}
async function saveDocument(env,userId,name,text){
 if(!env.DB)throw new Error("Belge veritabanı bağlı değil.");
 const id=uid(),clean=String(text||"").trim().slice(0,200000);if(!clean)throw new Error("Dosyada okunabilir metin bulunamadı.");
 const docName=String(name||"Belge").slice(0,180);
 await env.DB.prepare("INSERT INTO documents(id,user_id,name) VALUES(?,?,?)").bind(id,userId,docName).run();
 const chunks=[];for(let i=0;i<clean.length;i+=850){const part=clean.slice(i,Math.min(clean.length,i+1050));if(part.trim())chunks.push({id:uid(),content:part})}
 for(const c of chunks)await env.DB.prepare("INSERT INTO chunks(id,user_id,document_id,content) VALUES(?,?,?,?)").bind(c.id,userId,id,c.content).run();
 let vectorIndexed=!!(env.VECTOR&&env.AI),vectorError="";
 if(vectorIndexed){
  for(let i=0;i<chunks.length;i+=4){
   const batch=chunks.slice(i,i+4),vectors=[];
   try{
    for(const c of batch){const v=await embed(env,c.content);vectors.push({id:c.id,values:v,metadata:{userId,documentId:id}})}
    const mutation=await env.VECTOR.upsert(vectors);await log(env,"vector-upsert","Vectorize",true,0,JSON.stringify(mutation).slice(0,300));
   }catch(e){vectorIndexed=false;vectorError=String(e.message||e);await log(env,"vector-upsert","Vectorize",false,0,vectorError);break}
  }
 }
 return {id,name:docName,chunks:chunks.length,vectorIndexed,vectorError:vectorError.slice(0,180)};
}
async function loadMemory(env,userId){
 if(!env.DB)return {memories:[],recent:[]};
 let memories=[],recent=[];
 try{const m=await env.DB.prepare("SELECT content FROM memories WHERE user_id=? ORDER BY created_at DESC LIMIT 8").bind(userId).all();memories=m.results||[]}catch(e){}
 try{
  const r=await env.DB.prepare("SELECT role,content FROM conversations WHERE user_id=? ORDER BY rowid DESC LIMIT 6").bind(userId).all();
  recent=(r.results||[]).reverse().filter(x=>x&&["user","assistant"].includes(x.role)&&typeof x.content==="string").map(x=>({role:x.role,content:x.content.slice(0,3000)}));
 }catch(e){}
 return {memories,recent};
}
function sseFromText(text,provider,searchState,trace,sources=[],agentSteps=0){
 const enc=new TextEncoder();const chunks=[];for(let i=0;i<text.length;i+=90)chunks.push(text.slice(i,i+90));
 const stream=new ReadableStream({start(c){for(const t of chunks)c.enqueue(enc.encode("data: "+JSON.stringify({choices:[{delta:{content:t},index:0}]})+"\n\n"));c.enqueue(enc.encode("data: [DONE]\n\n"));c.close()}});
 return new Response(stream,{headers:{...CORS,"Content-Type":"text/event-stream; charset=utf-8","Cache-Control":"no-cache","X-Linay-Provider":provider,"X-Linay-Search":searchState,"X-Linay-Trace":trace,"X-Linay-Sources":encodeURIComponent(JSON.stringify(sources.slice(0,7))),"X-Linay-Agent-Steps":String(agentSteps)}});
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
 const r=await fetch("https://generativelanguage.googleapis.com/v1beta/models/"+GEMINI_MODEL+":generateContent",{method:"POST",headers:{"Content-Type":"application/json","x-goog-api-key":env.GEMINI_API_KEY},body:JSON.stringify(body)});
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
async function agentRun(env,userId,messages){
 const tools=["search_web","read_url","calculator","current_time","knowledge_search"];
 let observations=[],steps=0;
 const requestText=contentText(lastUser(messages));
 const mult=requestText.match(/(\d+(?:[.,]\d+)?)\s*(?:multiplied by|times|çarpı|ile çarp|×|x)\s*(\d+(?:[.,]\d+)?)/i);
 if(mult&&/calculator|calculate|multiply|çarp|hesap/i.test(requestText)){const expression=mult[1].replace(",",".")+"*"+mult[2].replace(",","." );observations.push({tool:"calculator",expression,result:calc(expression)});steps++}
 else if(/what time|current time|saat kaç|şu an saat/i.test(requestText)){observations.push({tool:"current_time",...{time:new Intl.DateTimeFormat("tr-TR",{timeZone:"Europe/Istanbul",dateStyle:"full",timeStyle:"long"}).format(new Date()),timezone:"Europe/Istanbul"}});steps++}
 else if(/https?:\/\//i.test(requestText)&&/read|open|summarize|özet|incele|oku/i.test(requestText)){const url=requestText.match(/https?:\/\/[^\s)]+/i)?.[0];try{if(url)observations.push({tool:"read_url",...await readPage(url)})}catch(e){observations.push({tool:"read_url",error:String(e.message||e)})}steps++}
 else if(/research|search|look up|araştır|güncel|latest|news/i.test(requestText)){try{const result=await searchWeb(requestText,env);observations.push({tool:"search_web",...result})}catch(e){observations.push({tool:"search_web",error:String(e.message||e)})}steps++}
 else if(/belge|document|dosya|file/i.test(requestText)){observations.push({tool:"knowledge_search",results:await ragSearch(env,userId,requestText)});steps++}
 for(;steps<4;steps++){
  const planner=[{role:"system",content:messages.filter(m=>m.role==="system").map(m=>contentText(m)).join("\n")+"\n\nSen Linay araç kullanan ajansın. Gerekiyorsa tam olarak tek JSON nesnesi üret: {\"tool\":\"search_web|read_url|calculator|current_time|knowledge_search|final\",\"args\":{\"query\":\"...\",\"url\":\"...\",\"expression\":\"...\"},\"answer\":\"...\"}. Araçları gerektiğinde kullan. Kullanıcı açıkça bir araç istediyse MUTLAKA çalıştır. Matematik işlemi varsa calculator kullan; güncel araştırma isteniyorsa search_web kullan; URL verilmişse read_url kullan; saat soruluyorsa current_time kullan; kullanıcı belgesi soruluyorsa knowledge_search kullan. En fazla dört araç adımı. Kaynakları uydurma. Sonuca ulaştıysan tool=final ile cevap ver. Gözlemler: "+JSON.stringify(observations).slice(0,10000)},...messages.filter(m=>m.role!=="system")];
  const p=await runPlain(env,planner,500);
  const raw=modelText(p);const match=String(raw).match(/\{[\s\S]*\}/);if(!match)break;
  let action;try{action=JSON.parse(match[0])}catch{break}
  if(action.tool==="final")return {answer:String(action.answer||""),steps,observations,model:p.__linayModel||MODEL};
  if(!tools.includes(action.tool))break;
  let result;
  try{
   if(action.tool==="search_web"){const s=await searchWeb(action.args?.query||contentText(lastUser(messages)),env);result=s;observations.push({tool:action.tool,...s})}
   if(action.tool==="read_url"){result=await readPage(action.args?.url);observations.push({tool:action.tool,...result})}
   if(action.tool==="calculator"){result={result:calc(action.args?.expression||"")};observations.push({tool:action.tool,...result})}
   if(action.tool==="current_time"){result={time:new Intl.DateTimeFormat("tr-TR",{timeZone:action.args?.timezone||"Europe/Istanbul",dateStyle:"full",timeStyle:"long"}).format(new Date()),timezone:action.args?.timezone||"Europe/Istanbul"};observations.push({tool:action.tool,...result})}
   if(action.tool==="knowledge_search"){result=await ragSearch(env,userId,action.args?.query||contentText(lastUser(messages)));observations.push({tool:action.tool,results:result})}
  }catch(e){observations.push({tool:action.tool,error:String(e.message||e)})}
 }
 const context=[{role:"system",content:messages.filter(m=>m.role==="system").map(m=>contentText(m)).join("\n")+"\n\nAraç gözlemleri (yalnızca bunlara dayan): "+JSON.stringify(observations).slice(0,12000)+"\nKullanıcıya sonuçları açıkla. Araç başarısızsa bunu belirt."},...messages.filter(m=>m.role!=="system")];
 const out=await runPlain(env,context,1800);
 return {answer:modelText(out)||"Ajan yanıt üretemedi.",steps,observations,model:out.__linayModel||MODEL};
}
async function handleChat(req,env,ctx){
 const body=await req.json(),messages=Array.isArray(body.messages)?body.messages:[];if(!messages.length)return json({error:"Mesaj bulunamadı"},400);
 if(!validUserId(body.userId))return json({error:"Geçersiz kullanıcı kimliği."},400);
 const userId=safeId(body.userId),start=Date.now(),last=lastUser(messages),question=contentText(last).slice(0,1200),searchQuery=searchQueryFromMessages(messages);
 let searchState="off",searchContext="",searchProvider="",searchSources=[];
 if(body.search===true){
  try{const sr=await searchWeb(searchQuery||question,env);searchProvider=sr.provider;searchSources=sr.results;searchState="success";searchContext="\n\nWEB SEARCH RESULTS — Use these results, compare dates and sources, cite each factual paragraph with [n]. Do not claim you opened pages unless you did.\n"+sr.results.map((x,i)=>"["+ (i+1)+"] "+x.title+"\nURL: "+x.url+"\nSnippet: "+x.snippet).join("\n\n")}
  catch(e){try{if(env.GEMINI_API_KEY){const searchSystem={role:"system",content:"Current date: "+new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Istanbul",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date())+" (Europe/Istanbul). Resolve short follow-up messages using the earlier conversation. Search the exact teams and date for sports scores. Prefer official football federations, UEFA, or reputable live-score providers. Never invent a score or claim a past event is in the future. Cite the exact result and its source."};const g=await gemini(env,[searchSystem,...messages.filter(m=>m.role!=="system")],true);searchState="gemini-backup";searchProvider="Gemini Google Search";searchContext="\n\nIndependent search unavailable; Gemini Google Search fallback findings:\n"+g.text+"\nSources:\n"+(g.sources||[]).map(x=>x.title+" "+x.uri).join("\n");searchSources=(g.sources||[]).map(x=>({title:x.title||"Source",url:x.uri,snippet:"Google Search grounding"})).filter(x=>safeUrl(x.url));}else throw e}catch(g){searchState="failed";searchContext="\n\nAll web search providers failed. Do not pretend to have verified current facts. Tell the user web search failed. Error: "+String(g.message||g)}}
 }
 const mem=await loadMemory(env,userId);
 const asksAboutDocuments=/(yüklediğim|yukledigim|eklediğim|ekledigim|paylaştığım|paylastigim|dosya|belge|doküman|dokuman|pdf|dosyanın|dosyanin|belgenin|belge içeriği|dosya içeriği|içinde ne yazıyor|içeriğinde ne var)/i.test(question);
 const rag=asksAboutDocuments?await ragSearch(env,userId,question):[];
 const originalSystem=messages.filter(m=>m.role==="system").map(m=>contentText(m)).join("\n");
 const requestContext=new Set(messages.filter(m=>m&&["user","assistant"].includes(m.role)).map(m=>m.role+"\n"+contentText(m)));
 const recentContext=mem.recent.filter(m=>!requestContext.has(m.role+"\n"+m.content));
 const sys=originalSystem+"\n\nLinayAI: Be accurate, concise and honest. For logic, distinguish what follows from what does not follow. Never invent current facts or sources. If sources are supplied, cite them using their numbered URLs. "+(mem.memories.length?"\nUSER SAVED MEMORY:\n"+mem.memories.map(x=>x.content).join("\n"):"")+(recentContext.length?"\nRECENT SERVER CONTEXT (older messages not already present in this request):\n"+recentContext.map(x=>x.role+": "+x.content).join("\n"):"")+(rag.length?"\nIMPORTANT: THE USER DOCUMENT SEARCH FOUND THE FOLLOWING EXCERPTS FROM THE USER UPLOADED FILES. YOU CAN READ THESE EXCERPTS. Use them to answer questions about those files. Never claim you cannot access a file when an excerpt is provided.\nUSER DOCUMENT EXCERPTS:\n"+rag.map(x=>"[Document: "+(x.name||"uploaded file")+"]\n"+x.content).join("\n---\n"):"")+searchContext;
 const enriched=[{role:"system",content:sys},...messages.filter(m=>m.role!=="system")];
 if(body.agent===true){
  try{const a=await agentRun(env,userId,enriched);const answer=a.answer+(searchSources.length?"\n\nKaynaklar:\n"+searchSources.map((x,i)=>"["+ (i+1)+"] ["+x.title+"]("+x.url+")").join("\n"):"");ctx.waitUntil((async()=>{await log(env,"agent", "Workers AI",true,Date.now()-start,"steps="+a.steps);if(question)await env.DB?.prepare("INSERT INTO conversations(id,user_id,role,content) VALUES(?,?,?,?)").bind(uid(),userId,"user",question).run();if(answer)await env.DB?.prepare("INSERT INTO conversations(id,user_id,role,content) VALUES(?,?,?,?)").bind(uid(),userId,"assistant",answer.slice(0,6000)).run()})());return sseFromText(answer,"Workers AI Agent · "+(a.model||MODEL),searchState,uid(),searchSources,a.steps)}
  catch(e){await log(env,"agent","Workers AI",false,Date.now()-start,e.message);return json({error:"Ajan görevi tamamlayamadı: "+e.message},503)}
 }
 const vision=messages.some(m=>Array.isArray(m.content)&&m.content.some(p=>p.type==="image_url"));
 try{
  if(body.search===true&&!vision){
   const plain=await runPlain(env,enriched,1800),answer=modelText(plain);
   if(!answer)throw new Error("Arama sonuçları geldi ancak model boş yanıt üretti.");
   await log(env,"web-chat",plain.__linayModel||MODEL,true,Date.now()-start,searchProvider||searchState);
   return sseFromText(answer,String(plain.__linayModel||"").startsWith("Gemini Backup")?plain.__linayModel:"Workers AI · "+(plain.__linayModel||MODEL),searchState,uid(),searchSources);
  }
  const result=await callModel(env,enriched,vision);
  const trace=uid();
  if(result.text){const answer=result.text+(body.search===true&&result.sources?.length?"\n\nSources: "+result.sources.map(x=>x.title+" — "+x.uri).join(" | "):"");ctx.waitUntil(log(env,"chat",result.provider,true,Date.now()-start,"backup"));return sseFromText(answer,result.provider,searchState,uid(),searchSources)}
  const stream=result.stream;
  const pair=stream.tee();
  ctx.waitUntil((async()=>{try{
   let raw="",buf="",reader=pair[1].getReader(),dec=new TextDecoder();
   for(;;){const z=await reader.read();if(z.done)break;buf+=dec.decode(z.value,{stream:true});const ls=buf.split("\n");buf=ls.pop();for(const line of ls){if(!line.startsWith("data:"))continue;const v=line.slice(5).trim();if(!v||v==="[DONE]")continue;try{const j=JSON.parse(v);raw+=j.choices?.[0]?.delta?.content||""}catch(e){}}}
   await log(env,body.search?"web-chat":"chat",result.provider,true,Date.now()-start,searchProvider||searchState);
   if(question)await env.DB?.prepare("INSERT INTO conversations(id,user_id,role,content) VALUES(?,?,?,?)").bind(uid(),userId,"user",question).run();
   if(raw)await env.DB?.prepare("INSERT INTO conversations(id,user_id,role,content) VALUES(?,?,?,?)").bind(uid(),userId,"assistant",raw.slice(0,6000)).run();
  }catch(e){}})());
  return new Response(pair[0],{headers:{...CORS,"Content-Type":"text/event-stream; charset=utf-8","Cache-Control":"no-cache","X-Linay-Provider":result.provider,"X-Linay-Search":searchState+(searchProvider?":"+searchProvider:""),"X-Linay-Trace":trace,"X-Linay-Sources":encodeURIComponent(JSON.stringify(searchSources.slice(0,7)))}});
 }catch(e){await log(env,"chat","all-models",false,Date.now()-start,e.message);return json({error:"Tüm modeller başarısız oldu: "+e.message},503)}
}
export default {async fetch(req,env,ctx){
 const origin=req.headers.get("Origin");
 if(origin&&origin!==ALLOWED_ORIGIN)return json({error:"Origin izinli değil."},403);
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:CORS});
 const url=new URL(req.url),path=url.pathname;
 if(path==="/health"&&req.method==="GET")return json({ok:true,service:"LinayAI",model:MODEL,searchProviders:["ESPN Scoreboard","SearXNG (optional)","Brave (optional)","Bing RSS","Google News RSS","Bing","DuckDuckGo","Wikipedia"],memory:!!env.DB,rag:!!env.VECTOR,agents:true,version:"2.0"});
 if(path==="/chat"&&req.method==="POST"){try{return await handleChat(req,env,ctx)}catch(e){return json({error:e.message||"Sunucu hatası"},500)}}
 if(path==="/memory"&&req.method==="GET"){try{const rawUserId=url.searchParams.get("userId");if(!validUserId(rawUserId))return json({error:"Geçersiz kullanıcı kimliği."},400);const userId=safeId(rawUserId);const row=await env.DB.prepare("SELECT content FROM memories WHERE user_id=? ORDER BY created_at DESC LIMIT 1").bind(userId).first();return json({content:row?.content||""})}catch(e){return json({error:e.message},500)}}
 if(path==="/memory"&&req.method==="POST"){
  try{const b=await req.json();if(!validUserId(b.userId))return json({error:"Geçersiz kullanıcı kimliği."},400);const userId=safeId(b.userId),content=String(b.content||"").trim().slice(0,6000);if(!env.DB)return json({error:"Hafıza veritabanı bağlı değil"},503);await env.DB.prepare("DELETE FROM memories WHERE user_id=?").bind(userId).run();if(content)await env.DB.prepare("INSERT INTO memories(id,user_id,content) VALUES(?,?,?)").bind(uid(),userId,content).run();return json({ok:true})}catch(e){return json({error:e.message},500)}
 }
 if(path==="/documents"&&req.method==="POST"){
  try{const b=await req.json();if(!validUserId(b.userId))return json({error:"Geçersiz kullanıcı kimliği."},400);const userId=safeId(b.userId),d=await saveDocument(env,userId,b.name,b.text);await log(env,"document-index","Workers AI",true,0,d.chunks+" chunks");return json({ok:true,document:d})}catch(e){await log(env,"document-index","Workers AI",false,0,e.message);return json({error:e.message},500)}
 }
 if(path==="/documents"&&req.method==="GET"){
  const rawUserId=url.searchParams.get("userId");if(!validUserId(rawUserId))return json({error:"Geçersiz kullanıcı kimliği."},400);const userId=safeId(rawUserId);if(!env.DB)return json({documents:[]});const r=await env.DB.prepare("SELECT id,name,created_at FROM documents WHERE user_id=? ORDER BY created_at DESC LIMIT 50").bind(userId).all();return json({documents:r.results||[]});
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
  if(!env.AI)return json({error:"Workers AI bağlantısı yok"},500);let prompt="";try{prompt=String((await req.json()).prompt||"").slice(0,1800)}catch{}if(!prompt)prompt="A beautiful landscape";const errs=[];
  try{const r=await env.AI.run("@cf/black-forest-labs/flux-1-schnell",{prompt,steps:4});if(r?.image)return json({image:r.image});errs.push("flux: görsel dönmedi")}catch(e){errs.push("flux: "+(e.message||e))}
  try{const r=await env.AI.run("@cf/bytedance/stable-diffusion-xl-lightning",{prompt});const buf=await new Response(r).arrayBuffer();if(buf.byteLength>1000){let s="";const a=new Uint8Array(buf);for(let i=0;i<a.length;i+=0x8000)s+=String.fromCharCode(...a.subarray(i,i+0x8000));return json({image:btoa(s),type:"image/png"})}errs.push("sdxl: boş yanıt")}catch(e){errs.push("sdxl: "+(e.message||e))}
  return json({error:errs.join(" | ")},500);
 }
 return new Response("Linay API",{status:404,headers:CORS});
}};