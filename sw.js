// Linay service worker: önce internet, olmazsa önbellek.
// Eski önbelleği zorla temizlemek istersen V değerini değiştir (linay-v4 gibi).
const V='linay-v16';
let upgrade=false;
self.addEventListener('install',e=>{upgrade=!!self.registration.active;e.waitUntil(self.skipWaiting())});
self.addEventListener('activate',e=>e.waitUntil((async()=>{
 const stale=(await caches.keys()).filter(k=>k!==V);
 for(const k of stale)await caches.delete(k);
 await self.clients.claim();
 if(upgrade||stale.length)for(const c of await self.clients.matchAll({type:'window'}))try{await c.navigate(c.url)}catch(_){}
})()));
const clean=async r=>r.redirected?new Response(await r.blob(),{status:r.status,statusText:r.statusText,headers:r.headers}):r;
const store=(q,r)=>{if(!r.ok)return;const c=r.clone();caches.open(V).then(x=>x.put(q,c))};
self.addEventListener('fetch',e=>{
 const q=e.request,u=new URL(q.url);
 if(q.method!=='GET')return;
 if(u.hostname==='cdnjs.cloudflare.com'){
  e.respondWith(caches.match(q).then(h=>h||fetch(q).then(r=>{store(q,r);return r})));
  return;
 }
 if(u.origin!==location.origin)return;
 e.respondWith((async()=>{
  const hit=await caches.match(q);
  try{
   return await Promise.race([
    fetch(q,{cache:'no-cache'}).then(async r=>{store(q,r);return clean(r)}),
    new Promise((_,j)=>setTimeout(()=>j(new Error('yavaş')),hit?5000:60000))
   ]);
  }catch(err){
   if(hit)return hit;
   if(q.mode==='navigate'){const f=await caches.match(new URL('./',self.registration.scope).href);if(f)return f}
   throw err;
  }
 })());
});
