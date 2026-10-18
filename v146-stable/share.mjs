// Playlist sharing: ZIP export / import. Self-contained (no dependencies, no network).
// The ZIP holds one manifest (showplayer-playlist.json) and the audio files (audio/NN_name.ext).
// Writing uses STORE (audio is already compressed); reading also accepts DEFLATE (ZIPs re-packed by other tools).
import {validateList,cleanEntry} from './transfer.mjs?v=146';

export const FORMAT='show-player-playlist';
export const FORMAT_VERSION=1;
export const MANIFEST_NAME='showplayer-playlist.json';
const MAX_ENTRIES=4000,MAX_MANIFEST_BYTES=8*1024*1024,CHUNK=4*1024*1024,U32=0xFFFFFFFF;
const enc=new TextEncoder(),dec=new TextDecoder('utf-8',{fatal:true});

// ---------- helpers ----------
export function safeFileName(name,fallback='playlist',max=80){
 let s=String(name??'').normalize('NFC').replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g,'_').replace(/^[.\s]+|[.\s]+$/g,'');
 if(!s)s=fallback;if([...s].length>max)s=[...s].slice(0,max).join('').replace(/[.\s]+$/g,'')||fallback;
 if(/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(s))s='_'+s;
 return s;
}
const EXT_BY_MIME={'audio/mpeg':'mp3','audio/mp3':'mp3','audio/wav':'wav','audio/x-wav':'wav','audio/wave':'wav','audio/vnd.wave':'wav','audio/mp4':'m4a','audio/x-m4a':'m4a','audio/m4a':'m4a','audio/aac':'aac','audio/x-aac':'aac','audio/aiff':'aif','audio/x-aiff':'aif','audio/flac':'flac','audio/x-flac':'flac','audio/ogg':'ogg','audio/opus':'opus','audio/webm':'webm'};
export function extForMime(mime){return EXT_BY_MIME[String(mime||'').toLowerCase()]||'bin';}
export function sha256Hex(bytes){return crypto.subtle.digest('SHA-256',bytes).then(b=>[...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join(''));}
export async function blobSha256(blob){return sha256Hex(await blob.arrayBuffer());}

// ---------- CRC32 ----------
const TABLE=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c>>>0;}return t;})();
export function crc32Update(crc,bytes){let c=crc^U32;for(let i=0;i<bytes.length;i++)c=TABLE[(c^bytes[i])&0xFF]^(c>>>8);return (c^U32)>>>0;}
export async function crc32Blob(blob){let crc=0;for(let o=0;o<blob.size;o+=CHUNK)crc=crc32Update(crc,new Uint8Array(await blob.slice(o,Math.min(blob.size,o+CHUNK)).arrayBuffer()));return crc>>>0;}

// ---------- ZIP writer (STORE) ----------
function dosDateTime(date){const y=Math.max(1980,date.getFullYear());return {time:(date.getHours()<<11)|(date.getMinutes()<<5)|(date.getSeconds()>>1),date:((y-1980)<<9)|((date.getMonth()+1)<<5)|date.getDate()};}
export async function buildZip(files,{onProgress=()=>{},now=new Date()}={}){
 // files: [{name:string, data:Blob|Uint8Array}]
 const parts=[],central=[],seen=new Set();let offset=0;const stamp=dosDateTime(now);
 for(let i=0;i<files.length;i++){
  const f=files[i];if(!f.name||f.name.includes('\\')||f.name.startsWith('/')||f.name.split('/').includes('..'))throw Error('ZIP内のファイル名が不正です：'+f.name);
  if(seen.has(f.name))throw Error('ZIP内のファイル名が重複しています：'+f.name);seen.add(f.name);
  const data=f.data instanceof Blob?f.data:new Blob([f.data]);const size=data.size;
  if(size>=U32||offset>=U32)throw Error('ZIPが4GBを超えるため書き出せません。曲を分けて書き出してください。');
  const crc=await crc32Blob(data);const nameBytes=enc.encode(f.name);
  const local=new Uint8Array(30+nameBytes.length),lv=new DataView(local.buffer);
  lv.setUint32(0,0x04034b50,true);lv.setUint16(4,20,true);lv.setUint16(6,0x0800,true);lv.setUint16(8,0,true);lv.setUint16(10,stamp.time,true);lv.setUint16(12,stamp.date,true);lv.setUint32(14,crc,true);lv.setUint32(18,size,true);lv.setUint32(22,size,true);lv.setUint16(26,nameBytes.length,true);lv.setUint16(28,0,true);local.set(nameBytes,30);
  central.push({nameBytes,crc,size,offset});
  parts.push(local,data);offset+=local.length+size;
  onProgress((i+1)/files.length,f.name);
 }
 const cdStart=offset;let cdSize=0;
 for(const c of central){const h=new Uint8Array(46+c.nameBytes.length),v=new DataView(h.buffer);
  v.setUint32(0,0x02014b50,true);v.setUint16(4,20,true);v.setUint16(6,20,true);v.setUint16(8,0x0800,true);v.setUint16(10,0,true);v.setUint16(12,stamp.time,true);v.setUint16(14,stamp.date,true);v.setUint32(16,c.crc,true);v.setUint32(20,c.size,true);v.setUint32(24,c.size,true);v.setUint16(28,c.nameBytes.length,true);v.setUint16(30,0,true);v.setUint16(32,0,true);v.setUint16(34,0,true);v.setUint16(36,0,true);v.setUint32(38,0,true);v.setUint32(42,c.offset,true);h.set(c.nameBytes,46);
  parts.push(h);cdSize+=h.length;}
 if(cdStart+cdSize>=U32||central.length>0xFFFF)throw Error('ZIPが大きすぎて書き出せません。');
 const end=new Uint8Array(22),ev=new DataView(end.buffer);ev.setUint32(0,0x06054b50,true);ev.setUint16(4,0,true);ev.setUint16(6,0,true);ev.setUint16(8,central.length,true);ev.setUint16(10,central.length,true);ev.setUint32(12,cdSize,true);ev.setUint32(16,cdStart,true);ev.setUint16(20,0,true);parts.push(end);
 return new Blob(parts,{type:'application/zip'});
}

// ---------- ZIP reader ----------
export async function openZip(file){
 if(!(file instanceof Blob))throw Error('ファイルを選択してください');
 if(file.size<22)throw Error('ZIPファイルではありません（小さすぎます）');
 const tailLen=Math.min(file.size,65557),tailStart=file.size-tailLen;
 const tail=new Uint8Array(await file.slice(tailStart).arrayBuffer());let p=-1;
 for(let i=tail.length-22;i>=0;i--){if(tail[i]===0x50&&tail[i+1]===0x4b&&tail[i+2]===0x05&&tail[i+3]===0x06){p=i;break;}}
 if(p<0)throw Error('ZIPファイルではありません、または壊れています');
 const v=new DataView(tail.buffer,tail.byteOffset+p),count=v.getUint16(10,true),cdSize=v.getUint32(12,true),cdOffset=v.getUint32(16,true);
 if(count===0xFFFF||cdSize===U32||cdOffset===U32)throw Error('4GBを超えるZIP（ZIP64）には未対応です');
 if(count>MAX_ENTRIES)throw Error('ZIP内のファイル数が多すぎます');
 if(cdOffset+cdSize>file.size)throw Error('ZIPの目次が壊れています');
 const cd=new DataView(await file.slice(cdOffset,cdOffset+cdSize).arrayBuffer()),entries=[];let o=0;
 for(let i=0;i<count;i++){
  if(o+46>cd.byteLength||cd.getUint32(o,true)!==0x02014b50)throw Error('ZIPの目次が壊れています');
  const flags=cd.getUint16(o+8,true),method=cd.getUint16(o+10,true),crc=cd.getUint32(o+16,true),csize=cd.getUint32(o+20,true),size=cd.getUint32(o+24,true),nl=cd.getUint16(o+28,true),el=cd.getUint16(o+30,true),cl=cd.getUint16(o+32,true),off=cd.getUint32(o+42,true);
  if(o+46+nl>cd.byteLength)throw Error('ZIPの目次が壊れています');
  const raw=new Uint8Array(cd.buffer,cd.byteOffset+o+46,nl);let name;
  try{name=(flags&0x0800)?dec.decode(raw):new TextDecoder('utf-8').decode(raw);}catch{throw Error('ZIP内のファイル名を読み取れません');}
  if(flags&1)throw Error('パスワード付きZIPには対応していません');
  entries.push({name,method,crc,csize,size,offset:off,dir:name.endsWith('/')});
  o+=46+nl+el+cl;
 }
 return {file,entries};
}
function isJunk(name){return name.startsWith('__MACOSX/')||/(^|\/)\.DS_Store$/.test(name)||/(^|\/)\._/.test(name)||name.endsWith('/');}
export function findManifest(zip){
 // accept the manifest at the root, or inside a single top folder (when a folder was re-zipped)
 const cands=zip.entries.filter(e=>!e.dir&&!isJunk(e.name)&&(e.name===MANIFEST_NAME||(e.name.endsWith('/'+MANIFEST_NAME)&&e.name.split('/').length===2)));
 if(cands.length!==1)throw Error('SHOW PLAYERのプレイリストZIPではありません（設定ファイルが見つかりません）');
 const m=cands[0];return {entry:m,prefix:m.name.slice(0,m.name.length-MANIFEST_NAME.length)};
}
export function safeZipPath(path){return typeof path==='string'&&path.length>0&&path.length<400&&!path.startsWith('/')&&!path.includes('\\')&&!path.split('/').some(s=>s===''||s==='.'||s==='..')&&!/[\u0000-\u001f]/.test(path);}
export async function readEntry(zip,entry){
 if(entry.dir)throw Error('不正なZIPエントリです');
 const lh=new DataView(await zip.file.slice(entry.offset,entry.offset+30).arrayBuffer());
 if(lh.byteLength<30||lh.getUint32(0,true)!==0x04034b50)throw Error('ZIP内のファイルが壊れています：'+entry.name);
 const start=entry.offset+30+lh.getUint16(26,true)+lh.getUint16(28,true),end=start+entry.csize;
 if(end>zip.file.size)throw Error('ZIPが途中で切れています：'+entry.name);
 let blob;
 if(entry.method===0)blob=zip.file.slice(start,end);
 else if(entry.method===8){
  if(typeof DecompressionStream!=='function')throw Error('このブラウザは圧縮ZIPの展開に未対応です（Safariを最新にしてください）');
  try{blob=await new Response(zip.file.slice(start,end).stream().pipeThrough(new DecompressionStream('deflate-raw'))).blob();}catch{throw Error('ZIP内のファイルを展開できません：'+entry.name);}
 }else throw Error('未対応の圧縮方式です：'+entry.name);
 if(blob.size!==entry.size)throw Error('ZIP内のファイルのサイズが一致しません：'+entry.name);
 if(await crc32Blob(blob)!==entry.crc)throw Error('ZIP内のファイルが壊れています（CRC不一致）：'+entry.name);
 return blob;
}

// ---------- bundle: export ----------
export async function buildBundle(list,getAsset,{appVersion='',onProgress=()=>{},now=new Date()}={}){
 validateList(list);
 const total=new Set(list.entries.map(t=>t.assetId)).size||1;let done=0;
 const byHash=new Map(),idToHash=new Map(),files=[];
 const used=new Set([MANIFEST_NAME,'README.txt']);
 const entryNameFor=assetId=>list.entries.find(t=>t.assetId===assetId)?.name||'audio';
 let n=0;
 for(const assetId of new Set(list.entries.map(t=>t.assetId))){
  onProgress(done/total*0.8,'音源を確認しています（'+(done+1)+'/'+total+'）');
  const blob=await getAsset(assetId);
  if(!(blob instanceof Blob)||blob.size<=0)throw Error('「'+entryNameFor(assetId)+'」の音源が見つかりません。再取り込みしてください。');
  const hash=await blobSha256(blob);idToHash.set(assetId,hash);
  if(!byHash.has(hash)){
   n++;const mime=blob.type||'application/octet-stream',ext=extForMime(mime);
   let path='audio/'+String(n).padStart(2,'0')+'_'+safeFileName(entryNameFor(assetId),'audio',60)+'.'+ext;
   while(used.has(path))path=path.replace(/(\.[^.]+)$/,'_'+n+'$1');
   used.add(path);byHash.set(hash,{id:hash,path,mime,bytes:blob.size,blob});
  }
  done++;
 }
 const out=structuredClone(list);
 out.entries=out.entries.map(t=>({...t,...cleanEntry(t),assetId:idToHash.get(t.assetId)}));
 for(const t of out.entries){delete t.url;delete t.missing;}
 const assets=[...byHash.values()].map(a=>({id:a.id,path:a.path,mime:a.mime,bytes:a.bytes}));
 const manifest={format:FORMAT,formatVersion:FORMAT_VERSION,app:'SHOW PLAYER',appVersion,exportedAt:now.toISOString(),playlist:{name:list.name,entries:out.entries},assets};
 const json=JSON.stringify(manifest,null,1);
 files.push({name:MANIFEST_NAME,data:enc.encode(json)});
 files.push({name:'README.txt',data:enc.encode('SHOW PLAYER プレイリスト（'+list.name+'）\nこのZIPはSHOW PLAYERの「プレイリスト共有」で読み込めます。ZIPを展開・編集せず、そのまま読み込んでください。\n')});
 for(const a of byHash.values())files.push({name:a.path,data:a.blob});
 const blob=await buildZip(files,{now,onProgress:(f)=>onProgress(0.8+f*0.2,'ZIPを作成しています')});
 return {blob,fileName:safeFileName(list.name,'playlist')+'.zip',trackCount:out.entries.length,assetCount:assets.length,manifest};
}

// ---------- bundle: import ----------
// io: {hasAsset(id)->bool, putAsset(id,blob)->void, deleteAsset(id)->void, commit(list)->void (writes the new list atomically)}
export async function importBundle(file,io,{onProgress=()=>{},newId=()=>crypto.randomUUID(),now=new Date()}={}){
 const zip=await openZip(file),{entry:mEntry,prefix}=findManifest(zip);
 if(mEntry.size>MAX_MANIFEST_BYTES)throw Error('設定ファイルが大きすぎます');
 let manifest;try{manifest=JSON.parse(await (await readEntry(zip,mEntry)).text());}catch(e){if(/CRC|壊れ|切れ|展開|サイズ/.test(e.message))throw e;throw Error('設定ファイルを読み取れません');}
 if(!manifest||manifest.format!==FORMAT)throw Error('SHOW PLAYERのプレイリストZIPではありません');
 if(!Number.isInteger(manifest.formatVersion)||manifest.formatVersion<1)throw Error('ZIPの形式バージョンが不正です');
 if(manifest.formatVersion>FORMAT_VERSION)throw Error('新しい版のSHOW PLAYERで書き出されたZIPです。アプリを更新してから読み込んでください。');
 const pl=manifest.playlist;
 if(!pl||typeof pl.name!=='string'||!pl.name.trim()||!Array.isArray(pl.entries)||!Array.isArray(manifest.assets))throw Error('プレイリスト情報が不正です');
 // validate asset table
 const assetMap=new Map();
 for(const a of manifest.assets){
  if(!a||typeof a.id!=='string'||!/^[a-f0-9]{64}$/.test(a.id)||assetMap.has(a.id)||!safeZipPath(a.path)||!a.path.startsWith('audio/')||!Number.isSafeInteger(a.bytes)||a.bytes<=0||typeof a.mime!=='string')throw Error('音源の情報が不正です');
  const ze=zip.entries.find(e=>e.name===prefix+a.path&&!e.dir);if(!ze)throw Error('音源ファイルがZIPに入っていません：'+a.path);
  if(ze.size!==a.bytes)throw Error('音源ファイルのサイズが設定と一致しません：'+a.path);
  assetMap.set(a.id,{...a,ze});
 }
 // validate list (with a temporary list identity) and that every track has its audio
 const draft={id:newId(),name:pl.name.trim(),revision:1,updatedAt:now.toISOString(),entries:pl.entries.map(t=>({...t,...cleanEntry(t),id:newId()}))};
 validateList(draft);
 for(const t of draft.entries)if(!assetMap.has(t.assetId))throw Error('「'+t.name+'」の音源がZIPに入っていません');
 const needed=[...new Set(draft.entries.map(t=>t.assetId))],added=[];
 try{
  for(let i=0;i<needed.length;i++){
   const a=assetMap.get(needed[i]);onProgress(i/needed.length*0.95,'音源を確認・保存しています（'+(i+1)+'/'+needed.length+'）');
   const blob=await readEntry(zip,a.ze);
   if(await blobSha256(blob)!==a.id)throw Error('音源の内容が書き出し時と一致しません（破損の可能性）：'+a.path);
   if(!(await io.hasAsset(a.id))){await io.putAsset(a.id,new Blob([blob],{type:a.mime||'application/octet-stream'}));added.push(a.id);}
  }
  onProgress(0.97,'プレイリストを登録しています');
  await io.commit(draft);
 }catch(e){
  for(const id of added){try{await io.deleteAsset(id);}catch{}}
  const quota=e&&(e.name==='QuotaExceededError'||/quota/i.test(e.message||''));
  throw quota?Error('端末の保存容量が足りません。不要なデータを減らしてから読み込んでください。'):e;
 }
 onProgress(1,'完了');
 return {list:draft,trackCount:draft.entries.length,assetCount:needed.length,addedAssets:added.length};
}
