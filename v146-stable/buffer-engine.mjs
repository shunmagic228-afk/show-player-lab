// Decoded-audio transport for iPhone. Cache only the active asset.
export class BufferedTrack {
 constructor({context,destination,asset,ended=()=>{},beforeStart=()=>{},log=()=>{},changed=()=>{},budgetBytes=2.4e9,store=null,offlineContext=null,keepPlayed=false}){Object.assign(this,{context,destination,asset,endedCallback:ended,beforeStart,log,changed,budgetBytes,store,offlineContext,keepPlayed});this.storeChain=Promise.resolve();this.stored=new Set();this.convertJobs=new Map();this.storedLoaded=false;this.converting=null;this.convertQueue=[];this.track=null;this.buffer=null;this.key=null;this.pending=null;this.cache=new Map();this.inflight=new Map();this.wanted=[];this.warming=false;this.node=null;this.offset=0;this.startedAt=0;this.attempt=0;this.ended=false;}
 get duration(){return this.buffer?.duration??this.track?.duration??NaN;}
 get paused(){return !this.node;}
 get position(){return Math.min(this.duration||Infinity,this.offset+(this.node?Math.max(0,this.context().currentTime-this.startedAt):0));}
 pause(){const position=this.position;this.attempt++;const node=this.node;this.node=null;this.offset=Number.isFinite(position)?position:0;if(node){node.onended=null;try{node.stop();}catch{}node.disconnect();}this.log('buffer pause',{position:this.offset});}
 clear(){this.pause();this.track=null;this.buffer=null;this.pending=null;this.key=null;this.cache.clear();this.wanted=[];this.offset=0;this.ended=false;}
 load(track){this.pause();if(this.key!==track.assetId){if(this.keepPlayed&&this.buffer&&this.key)this.cache.set(this.key,this.buffer);this.buffer=null;this.pending=null;this.key=track.assetId;if(this.cache.has(track.assetId)){this.buffer=this.cache.get(track.assetId);this.cache.delete(track.assetId);this.log('buffer warm hit',{key:track.assetId});}}this.track=track;this.offset=0;this.ended=false;this.changed();}
 seek(position){this.pause();this.offset=Math.max(0,Math.min(position,Number.isFinite(this.duration)?Math.max(0,this.duration-.001):position));this.ended=false;}
 // One shared decode per asset (a warm-up in progress is reused, never repeated).
 decodeKey(key){
  if(this.inflight.has(key))return this.inflight.get(key);
  const ctx=this.context();
  const job=(async()=>{const t0=Date.now();
   if(this.store){try{const cj=this.convertJobs.get(key);if(cj){try{await cj;}catch{}}const rec=await this.store.get(key);const cached=bufferFromRecord(ctx,rec);if(cached){this.stored.add(key);this.log('buffer from cache',{ms:Date.now()-t0,key,duration:cached.duration,fileRate:rec.sampleRate,ctxRate:ctx.sampleRate});return cached;}}catch(e){this.log('buffer cache read failed',{message:e.message});}}
   const blob=await this.asset(key);const tAsset=Date.now()-t0;if(!blob)throw Error('保存音源が見つかりません');const bytes=await blob.arrayBuffer();const tRead=Date.now()-t0-tAsset;const buffer=await ctx.decodeAudioData(bytes);this.log('buffer timing',{key,assetMs:tAsset,readMs:tRead,decodeMs:Date.now()-t0-tAsset-tRead,fileBytes:bytes.byteLength});
   if(this.store&&!this.storeOff){const store=this.store;this.storeChain=this.storeChain.then(()=>store.put(key,pcmRecord(buffer))).then(()=>{this.stored.add(key);this.log('buffer cache saved',{key});},e=>{this.storeOff=true;this.log('buffer cache save failed',{message:e.message});});}
   this.log('buffer decoded',{ms:Date.now()-t0,key,duration:buffer.duration,sampleRate:buffer.sampleRate,channels:buffer.numberOfChannels,decodedBytes:buffer.length*buffer.numberOfChannels*4});return buffer;})();
  this.inflight.set(key,job);const done=()=>{if(this.inflight.get(key)===job)this.inflight.delete(key);};job.then(done,done);return job;
 }
 async prepare(){
  if(!this.track)throw Error('音源を選択してください');if(this.buffer)return this.buffer;if(this.pending)return this.pending;
  const key=this.key;
  if(this.cache.has(key)){this.buffer=this.cache.get(key);this.cache.delete(key);return this.buffer;}
  const pending=this.decodeKey(key).then(buffer=>{if(this.key!==key)throw Error('音源が変更されました');this.buffer=buffer;this.changed();return buffer;});
  this.pending=pending;const clear=()=>{if(this.pending===pending)this.pending=null;};pending.then(clear,clear);return pending;
 }
 // Decode the songs that will probably play next (in order, one at a time) so switching never waits for decoding. Keeps only these in memory besides the active one.
 // A play() still waiting for decoding/loading gives up at once (the decoding itself continues and is reused later).
 cancelPending(){const f=this.abortPlay;this.abortPlay=null;if(f)f();}
 bytesOf(b){return b?b.length*b.numberOfChannels*4:0;}
 usedBytes(){let n=this.bytesOf(this.buffer);for(const b of this.cache.values())n+=this.bytesOf(b);return n;}
 isStored(key){return this.stored.has(key);}
 isConverting(key){return this.converting===key;}
 async loadStoredKeys(){if(this.storedLoaded||!this.store)return;this.storedLoaded=true;try{for(const k of await this.store.keys())this.stored.add(k);}catch(e){this.log('buffer cache list failed',{message:e.message});}this.changed();}
 // Convert songs into the on-disk decoded cache ahead of the show (one at a time, not kept in memory). Uses its own offline audio context so it never touches the playback graph.
 convertMany(keys){
  this.convertQueue=keys.filter(Boolean);if(this.convertRunning||!this.store||!this.offlineContext)return;this.convertRunning=true;
  (async()=>{try{await this.loadStoredKeys();for(;;){const key=this.convertQueue.find(k=>!this.stored.has(k)&&!this.convertFailed?.has(k));if(!key)break;this.converting=key;this.changed();
   try{const job=(async()=>{const t0=Date.now();const blob=await this.asset(key);if(!blob)throw Error('保存音源が見つかりません');const bytes=await blob.arrayBuffer();const tRead=Date.now()-t0;const off=this.offlineContext();const buffer=await off.decodeAudioData(bytes);const tDec=Date.now()-t0-tRead;await this.store.put(key,pcmRecord(buffer));this.stored.add(key);this.log('buffer converted',{key,readMs:tRead,decodeMs:tDec,saveMs:Date.now()-t0-tRead-tDec,duration:buffer.duration});if(this.wantedAll)this.warmMany(this.wantedAll);})();this.convertJobs.set(key,job);try{await job;}finally{this.convertJobs.delete(key);}}
   catch(e){(this.convertFailed||(this.convertFailed=new Set())).add(key);this.log('buffer convert failed',{key,message:e.message});}
   this.converting=null;this.changed();}}finally{this.converting=null;this.convertRunning=false;this.changed();}})();
 }
 isReady(key){return (key===this.key&&!!this.buffer)||this.cache.has(key);}
 isLoading(key){return this.inflight.has(key);}
 // Decode songs ahead, in the given priority order, one at a time, within a memory budget. Decoded songs stay available (also songs already played) so any jump is instant.
 warmMany(keys){
  this.wantedAll=keys;this.wanted=keys.filter(k=>k&&k!==this.key);
  let used=this.bytesOf(this.buffer);
  for(const k of [...this.cache.keys()]){if(!this.wanted.includes(k))this.cache.delete(k);}
  for(const k of this.wanted){if(!this.cache.has(k))continue;used+=this.bytesOf(this.cache.get(k));if(used>this.budgetBytes)this.cache.delete(k);}
  if(this.warming)return;this.warming=true;const done=new Set();
  (async()=>{try{await this.loadStoredKeys();for(;;){const ck=this.key;if(this.track&&ck&&!this.buffer&&!this.pending&&!done.has('cur:'+ck)&&(this.stored.has(ck)||!this.store||this.convertFailed?.has(ck))){done.add('cur:'+ck);try{await this.prepare();this.changed();}catch{}}
   const key=this.wanted.find(k=>!this.cache.has(k)&&!done.has(k)&&(this.stored.has(k)||!this.store||this.convertFailed?.has(k)));if(!key||this.usedBytes()>=this.budgetBytes)break;done.add(key);
   try{const buffer=await this.decodeKey(key);if(this.wanted.includes(key)&&this.key!==key&&this.usedBytes()<this.budgetBytes*1.2)this.cache.set(key,buffer);}catch(e){this.log('buffer warm failed',{message:e.message});}
   this.changed();}}finally{this.warming=false;this.changed();}})();
 }
 async play(){
  if(this.node)return this.startedAt;
  const attempt=++this.attempt,ctx=this.context(),t0=Date.now();await ctx.resume();const t1=Date.now();const buffer=await Promise.race([this.prepare(),new Promise((_,rej)=>{this.abortPlay=()=>{const e=Error('再生準備が中止されました');e.cancelled=true;rej(e);};})]);this.abortPlay=null;this.log('buffer play timing',{resumeMs:t1-t0,prepareMs:Date.now()-t1,ctx:ctx.state,baseLatency:ctx.baseLatency,outputLatency:ctx.outputLatency,sampleRate:ctx.sampleRate});if(attempt!==this.attempt)throw Error('再生準備が中止されました');if(ctx.state!=='running')throw Error('音声処理を開始できません');
  const node=ctx.createBufferSource();node.buffer=buffer;node.connect(this.destination());this.node=node;this.ended=false;this.startedAt=ctx.currentTime+.020;
  node.onended=()=>{if(this.node!==node)return;this.node=null;node.disconnect();this.offset=buffer.duration;this.ended=true;this.endedCallback();};
  try{this.beforeStart(this.startedAt);node.start(this.startedAt,this.offset);}catch(e){this.node=null;node.disconnect();throw e;}
  this.log('buffer start',{position:this.offset,scheduledAt:this.startedAt});return this.startedAt;
 }
}

// Mac (non-iPhone): remember each song's decoded audio in a separate database so the slow decode happens once, not at show time.
// Separate DB ('show-player-decoded'); the songs/settings database is never touched. Any failure falls back to normal decoding.
export function createDecodedStore(){
 let opening=null;
 const open=()=>opening||(opening=new Promise((resolve,reject)=>{const r=indexedDB.open('show-player-decoded',1);r.onupgradeneeded=()=>r.result.createObjectStore('pcm');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.onblocked=()=>reject(Error('blocked'));}));
 const run=(mode,fn)=>open().then(db=>new Promise((resolve,reject)=>{const tx=db.transaction('pcm',mode);let out;const req=fn(tx.objectStore('pcm'));if(req)req.onsuccess=()=>{out=req.result;};tx.oncomplete=()=>resolve(out);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('aborted'));}));
 return {
  get:key=>run('readonly',st=>st.get(key)),
  put:(key,record)=>run('readwrite',st=>st.put(record,key)),
  remove:key=>run('readwrite',st=>st.delete(key)),
  keys:()=>run('readonly',st=>st.getAllKeys()),
 };
}
export const PCM_FORMAT='show-player-pcm-f32-v1';
export function pcmRecord(buffer){return {format:PCM_FORMAT,sampleRate:buffer.sampleRate,length:buffer.length,channels:Array.from({length:buffer.numberOfChannels},(_,i)=>buffer.getChannelData(i))};}
export function bufferFromRecord(ctx,rec){
 if(!rec||rec.format!==PCM_FORMAT||!Array.isArray(rec.channels)||!rec.channels.length||!(rec.length>0))return null;
 for(const c of rec.channels)if(!(c instanceof Float32Array)||c.length!==rec.length)return null;
 const b=ctx.createBuffer(rec.channels.length,rec.length,rec.sampleRate);rec.channels.forEach((c,i)=>b.copyToChannel(c,i));return b;
}
