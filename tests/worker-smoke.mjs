import assert from "node:assert/strict";

const BASE=(process.env.LINAY_WORKER_URL||"https://snowy-meadow-02d9.28berat28.workers.dev").replace(/\/+$/,"");
const ORIGIN="https://patarakutere.github.io";
const USER="linay-ci-tests-"+(process.env.GITHUB_RUN_ID||"local");

async function get(path){
  const r=await fetch(BASE+path,{headers:{Origin:ORIGIN}});
  const body=await r.json().catch(()=>({}));
  assert.equal(r.ok,true,"GET "+path+" failed: "+JSON.stringify(body));
  return {r,body};
}
async function chatMessages(messages,{search=false,agent=false}={}){
  const r=await fetch(BASE+"/chat",{
    method:"POST",
    headers:{Origin:ORIGIN,"Content-Type":"application/json"},
    body:JSON.stringify({userId:USER,messages:[{role:"system",content:"Answer in English, briefly and directly."},...messages],search,agent})
  });
  if(!r.ok){const e=await r.json().catch(()=>({}));throw new Error("Chat failed "+r.status+": "+(e.error||""))}
  const reader=r.body.getReader(),decoder=new TextDecoder();let buffer="",answer="";
  for(;;){const {done,value}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});const lines=buffer.split("\n");buffer=lines.pop();for(const line of lines){if(!line.startsWith("data:"))continue;const raw=line.slice(5).trim();if(!raw||raw==="[DONE]")continue;const j=JSON.parse(raw);answer+=j.choices?.[0]?.delta?.content||""}}
  return {answer,provider:r.headers.get("X-Linay-Provider")||"",search:r.headers.get("X-Linay-Search")||"",sources:r.headers.get("X-Linay-Sources")||"[]",agentSteps:Number(r.headers.get("X-Linay-Agent-Steps")||0)};
}
async function chat(question,options={}){return chatMessages([{role:"user",content:question}],options)}

const health=await get("/health");
assert.equal(health.body.ok,true);
assert.equal(health.body.memory,true,"D1 memory binding missing");
assert.equal(health.body.rag,true,"Vectorize binding missing");
assert.equal(health.body.agents,true,"Agent route missing");
console.log("PASS health + bindings");

const sportsSearchResponse=await fetch(BASE+"/search?q="+encodeURIComponent("France Türkiye football match 15 November 2026 final score result"),{headers:{Origin:ORIGIN}});
assert.equal(sportsSearchResponse.ok,true,"Sports search endpoint failed: "+sportsSearchResponse.status);
const sportsSearch=await sportsSearchResponse.json();
assert.ok((sportsSearch.results||[]).length>0,"Sports search returned no relevant results: "+JSON.stringify(sportsSearch));
assert.ok(sportsSearch.results.some(x=>/\\b\\d{1,2}\\s*[-–:]\\s*\\d{1,2}\\b/.test(x.title+" "+x.snippet)||/tff.org|sofascore|flashscore/i.test(x.url)),"Sports results do not contain a match score: "+JSON.stringify(sportsSearch.results));
console.log("PASS independent sports search relevance");



const cats=await chat("All cats are animals. Some animals can swim. Does it follow that all cats can swim?");
assert.match(cats.answer,/not follow|does not follow|cannot conclude|not necessarily|does not imply|not enough information|no\b/i,"Logic test failed: "+cats.answer);
console.log("PASS logical entailment");

const place=await chat("If you overtake the person in second place in a race, what place are you in?");
assert.match(place.answer,/second|2nd/i,"Overtaking test failed: "+place.answer);
console.log("PASS position reasoning");

const math=await chat("What is 125 multiplied by 48? Reply with the result.");
assert.match(math.answer,/6[\s,.]?000/,"Arithmetic test failed: "+math.answer);
console.log("PASS arithmetic");

const memoryText="Linay CI memory marker: amber-owl-2020";
let r=await fetch(BASE+"/memory",{method:"POST",headers:{Origin:ORIGIN,"Content-Type":"application/json"},body:JSON.stringify({userId:USER,content:memoryText})});
assert.equal(r.ok,true,"Memory save failed");
const saved=await get("/memory?userId="+encodeURIComponent(USER));
assert.equal(saved.body.content,memoryText,"Persistent memory round-trip failed");
console.log("PASS persistent memory");

const doc=await fetch(BASE+"/documents",{method:"POST",headers:{Origin:ORIGIN,"Content-Type":"application/json"},body:JSON.stringify({userId:USER,name:"Linay CI RAG test",text:"Linay knowledge marker: violet-cedar-7319. This file verifies private document indexing and retrieval."})});
const docBody=await doc.json();
assert.equal(doc.ok,true,"RAG indexing failed: "+JSON.stringify(docBody));
const listed=await get("/documents?userId="+encodeURIComponent(USER));
assert.ok((listed.body.documents||[]).some(x=>x.id===docBody.document.id),"Indexed document not listed");
await new Promise(resolve=>setTimeout(resolve,5000));
const retrieved=await chat("Read the indexed file named Linay CI RAG test. What exact marker does that file contain? Do not use saved memory; reply with the file marker only.");
assert.match(retrieved.answer,/violet-cedar-7319/i,"Semantic RAG retrieval failed: "+retrieved.answer);
await fetch(BASE+"/documents/"+encodeURIComponent(docBody.document.id)+"?userId="+encodeURIComponent(USER),{method:"DELETE",headers:{Origin:ORIGIN}});
console.log("PASS document RAG indexing + retrieval");

const agent=await chat("Use the calculator tool explicitly to calculate 125 multiplied by 48. Then explain the result briefly.",{agent:true});
assert.ok(agent.answer.length>0,"Agent returned an empty answer");
assert.match(agent.provider,/Agent/i,"Agent mode header missing");
assert.ok(agent.agentSteps>=1,"Agent did not execute a tool: "+agent.agentSteps);
console.log("PASS agent mode");

const web=await chat("Find current information about the latest major technology news and cite sources.",{search:true});
assert.notEqual(web.search,"failed","Independent web search and its fallback both failed");
assert.ok(web.answer.length>0,"Web search response empty");
const sourceList=JSON.parse(decodeURIComponent(web.sources));
assert.ok(sourceList.length>0,"Search response did not expose source links");
console.log("PASS web search + citations: "+web.search);

const football=await chatMessages([
  {role:"user",content:"Fransa Türkiye maçı kaç kaç bitti?"},
  {role:"assistant",content:"Hangi tarihi kastediyorsunuz?"},
  {role:"user",content:"15 kasım 2026 da oynandı"}
],{search:true});
assert.match(football.answer,/2\s*[-–:]\s*1/,"Contextual sports score search failed: "+football.answer);
const footballSources=JSON.parse(decodeURIComponent(football.sources));
assert.ok(footballSources.length>0,"Sports search returned no source links");
assert.ok(footballSources.some(x=>/tff\.org|sofascore|flashscore|uefa|ouest-france/i.test(x.url)),"Sports search sources are not authoritative/relevant: "+JSON.stringify(footballSources));
console.log("PASS contextual football score + source relevance");

const metrics=await get("/metrics");
assert.ok(metrics.body.groups,"Metrics groups missing");
console.log("PASS diagnostics");
console.log("All LinayAI smoke tests passed.");
