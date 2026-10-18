const BASE=new URL('./',self.location).pathname;
const CACHE='show-player-archive-v146';
const FILES=['./releases/v146/index.html','./','./index.html','./app.html','./player.css?v=146','./player.mjs?v=146','./audio-mode.mjs?v=146','./buffer-engine.mjs?v=146','./transport.mjs?v=146','./storage.mjs?v=146','./repository.mjs?v=146','./transfer.mjs?v=146','./manifest.webmanifest','./manual.html','./share.mjs?v=146','./share-ui.mjs?v=146','./manual.css?v=146','./manual/status.png','./manual/player.png','./manual/card1.png','./manual/card2.png','./manual/setlist.png','./manual/list.png','./manual/import.png','./manual/order.png','./manual/save.png','./manual/share.png','./icon.svg','./icon-192.png','./icon-180.png','./icon-maskable-512.png','./icon-512.png','./receiver-silence.wav','./demo-a.wav','./demo-b.wav'];
// Safari rejects redirected cached responses for navigation. Reconstruct every
// response served by this worker, including caches created by older versions.
function cleanResponse(response){if(!response||response.status===0)throw Error('Unreadable response');const headers=new Headers(response.headers);headers.delete('Content-Encoding');headers.delete('Content-Length');return new Response(response.clone().body,{status:response.status,statusText:response.statusText,headers});}
self.addEventListener('install',e=>e.waitUntil((async()=>{const cache=await caches.open(CACHE);await cache.addAll(FILES);await self.skipWaiting();})()));
self.addEventListener('activate',e=>e.waitUntil((async()=>{await self.clients.claim();/* Retain prior cache for already-open playback windows. No forced reload mid-show. */})()));
self.addEventListener('fetch',e=>{
 if(e.request.method!=='GET'||new URL(e.request.url).origin!==self.location.origin)return;
 const url=new URL(e.request.url);
 const rel=url.pathname.startsWith(BASE)?url.pathname.slice(BASE.length):url.pathname.replace(/^\//,'');
 if(e.request.mode==='navigate'&&rel.startsWith('releases/')){e.respondWith((async()=>{const cache=await caches.open(CACHE);const cached=await cache.match(url.pathname)||await caches.match(url.pathname);return cleanResponse(cached||await fetch(e.request));})());return;}
 if(e.request.mode==='navigate'&&(rel===''||rel==='index.html'||rel==='app.html')){
  e.respondWith((async()=>{
   let cache;try{cache=await caches.open(CACHE);const cached=await cache.match(rel==='app.html'?'./app.html':'./index.html');if(cached)return cleanResponse(cached);}catch{}
   // A cache can be evicted independently of an active worker. Returning
   // undefined here caused a possible navigation failure instead of recovery.
   try{const online=await fetch(e.request);if(online.ok&&cache){try{await cache.put(rel==='app.html'?'./app.html':'./index.html',online.clone());}catch{}}return cleanResponse(online);}
   catch{return new Response('<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SHOW PLAYER</title><body style="background:#f3f0e8;color:#202e3a;font-family:sans-serif;padding:32px"><h1>画面の保存を読み込めません</h1><p>ネット接続をオンにして、下の入口から開き直してください。音源や設定を消す必要はありません。</p><p><a style="color:#167b86" href="'+BASE+'start.html">SHOW PLAYERを開き直す</a></p></body></html>',{status:503,headers:{'Content-Type':'text/html; charset=utf-8'}});}
  })());return;
 }
 e.respondWith((async()=>{const cache=await caches.open(CACHE);let cached=await cache.match(e.request);if(!cached)cached=await caches.match(e.request);if(!cached)return cleanResponse(await fetch(e.request));
 const range=e.request.headers?.get('Range');if(range){const match=/^bytes=(\d+)-(\d*)$/.exec(range);if(match){const blob=await cached.blob(),start=Number(match[1]),end=match[2]?Math.min(Number(match[2]),blob.size-1):blob.size-1;if(start> end||start>=blob.size)return new Response(null,{status:416,headers:{'Content-Range':'bytes */'+blob.size}});const part=blob.slice(start,end+1);return new Response(part,{status:206,headers:{'Content-Type':cached.headers.get('Content-Type')||'application/octet-stream','Content-Length':String(part.size),'Content-Range':`bytes ${start}-${end}/${blob.size}`,'Accept-Ranges':'bytes'}});}}
 return cleanResponse(cached);
 })());
});
self.addEventListener('message',e=>{if(e.data==='OFFLINE_STATUS')e.waitUntil((async()=>{const cache=await caches.open(CACHE);const checks=await Promise.all(FILES.map(f=>cache.match(f)));e.ports[0]?.postMessage({ready:checks.every(Boolean),version:CACHE});})());});
