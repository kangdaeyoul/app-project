/* Preview PWA: never cache authenticated pages, API responses, photos or reports. */
const STATIC_CACHE='field-preview-static-v1';
const STATIC_FILES=['/offline.html','/icons/app-192.png','/icons/app-512.png','/icons/app-180.png'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(STATIC_CACHE).then(cache=>cache.addAll(STATIC_FILES)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('field-preview-static-')&&key!==STATIC_CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',event=>{
 const req=event.request,url=new URL(req.url);
 if(url.origin!==self.location.origin||req.method!=='GET'||url.pathname.startsWith('/api/'))return;
 if(req.mode==='navigate'){event.respondWith(fetch(req).catch(()=>caches.match('/offline.html')));return;}
 if(STATIC_FILES.includes(url.pathname))event.respondWith(caches.match(url.pathname).then(cached=>cached||fetch(req)));
});
