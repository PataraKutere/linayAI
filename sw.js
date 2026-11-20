// Linay Service Worker — ağ öncelikli, çevrimdışı geri dönüşlü önbellek.
// Sürüm değişince yeni Worker beklemeye alınır; açık sekmeler/oturumlar kapatılmadan
// eski Worker zorla değiştirilmez. Yenileme mevcut sohbeti otomatik kesmez.
const V='linay-v40';

self.addEventListener('activate',event=>event.waitUntil((async()=>{
  // Yalnızca Linay'a ait eski cache'leri temizle; aynı origin'deki diğer uygulamalara dokunma.
  const stale=(await caches.keys()).filter(key=>key.startsWith('linay-')&&key!==V);
  await Promise.all(stale.map(key=>caches.delete(key)));
  // clients.claim() intentionally omitted: mevcut sekmeler kendi oturumlarını tamamlar.
})()));

const clean=async response=>{
  if(!response.redirected)return response;
  return new Response(await response.blob(),{
    status:response.status,statusText:response.statusText,headers:response.headers
  });
};

const store=(request,response)=>{
  if(!response.ok||response.type==='opaque')return;
  caches.open(V).then(cache=>cache.put(request,response.clone())).catch(()=>{});
};

self.addEventListener('fetch',event=>{
  const request=event.request;
  if(request.method!=='GET')return;
  const url=new URL(request.url);

  // CDN assets: cache-first after the first successful network response.
  if(url.hostname==='cdnjs.cloudflare.com'){
    event.respondWith((async()=>{
      const cached=await caches.match(request);
      if(cached)return cached;
      const response=await fetch(request);
      store(request,response);
      return response;
    })());
    return;
  }

  if(url.origin!==self.location.origin)return;
  event.respondWith((async()=>{
    const cached=await caches.match(request);
    try{
      // Network-first keeps GitHub Pages updates visible; cached content is fallback only.
      const response=await Promise.race([
        fetch(request,{cache:'no-cache'}).then(async result=>{
          store(request,result);
          return clean(result);
        }),
        new Promise((_,reject)=>setTimeout(()=>reject(new Error('network-timeout')),cached?5000:60000))
      ]);
      return response;
    }catch(error){
      if(cached)return cached;
      if(request.mode==='navigate'){
        const fallback=await caches.match(new URL('./',self.registration.scope).href);
        if(fallback)return fallback;
      }
      throw error;
    }
  })());
});
