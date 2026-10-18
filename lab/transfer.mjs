const MAGIC=new TextEncoder().encode('SHOWPLAYER_WEB1\n');
const uuid=()=>crypto.randomUUID();
export async function digest(blob){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(x=>x.toString(16).padStart(2,'0')).join('');}
export function cleanEntry(entry){return {id:entry.id,assetId:entry.assetId,name:entry.name,inMode:entry.inMode,inSeconds:entry.inSeconds??null,outMode:entry.outMode,outSeconds:entry.outSeconds??null,switchMode:entry.switchMode??'manualTwoStep',fullPlay:entry.fullPlay===true,repeat:entry.repeat===true,duration:entry.duration??null,preflight:entry.preflight??'unverified'};}
export function validateList(list){
 if(!list||typeof list.id!=='string'||!list.id||typeof list.name!=='string'||!list.name.trim()||!Array.isArray(list.entries))throw Error('セットリスト情報が不正です');
 if(!Number.isSafeInteger(list.revision)||list.revision<0||(typeof list.updatedAt!=='string'||!Number.isFinite(Date.parse(list.updatedAt))))throw Error('セットリストの版情報が不正です');
 const ids=new Set();
 for(const t of list.entries){
  if(!t||typeof t.id!=='string'||!t.id||ids.has(t.id)||typeof t.name!=='string'||!t.name.trim()||typeof t.assetId!=='string'||!t.assetId)throw Error('曲情報が不正、またはIDが重複しています');ids.add(t.id);
  for(const d of ['in','out']){if(!['cut','fade'].includes(t[d+'Mode']))throw Error('未対応のフェード方法です');const sec=t[d+'Seconds'];if(sec!==null&&(!Number.isFinite(sec)||sec<0))throw Error('秒数が不正です');if(t[d+'Mode']==='fade'&&!(Number.isFinite(sec)&&sec>0))throw Error('フェード秒数を設定してください');}
  if(!['manualTwoStep','autoAfterFade'].includes(t.switchMode))throw Error('未対応の曲送り方法です');
  if(t.fullPlay!==undefined&&typeof t.fullPlay!=='boolean')throw Error('完パケの設定が不正です');
  if(t.repeat!==undefined&&typeof t.repeat!=='boolean')throw Error('繰り返しの設定が不正です');
  if(t.duration!==null&&(!Number.isFinite(t.duration)||t.duration<=0))throw Error('音源の長さが不正です');
 }
 return list;
}
export function cloneLibrary(library){return structuredClone(library);}
export function resolveImport(library,incoming,mode){
 validateList(incoming);const next=cloneLibrary(library),list=structuredClone(incoming);const i=next.lists.findIndex(x=>x.id===list.id);
 if(i>=0&&mode==='replace'){list.revision=Math.max(list.revision,next.lists[i].revision)+1;list.updatedAt=new Date().toISOString();next.lists[i]=list;}
 else{if(i>=0){list.id=uuid();list.name+='（コピー）';list.revision=1;list.updatedAt=new Date().toISOString();}next.lists.push(list);}
 next.activeId=list.id;return next;
}
export async function packTransfer(setlist,getAsset){
 validateList(setlist);const mapping=new Map(),records=[],parts=[];
 for(const id of new Set(setlist.entries.map(x=>x.assetId))){
  const blob=await getAsset(id);if(!(blob instanceof Blob)||blob.size<=0)throw Error('音源が見つかりません。再取り込みしてください');
  const hash=await digest(blob);mapping.set(id,hash);
  if(!records.some(a=>a.id===hash)){records.push({id:hash,bytes:blob.size,mime:blob.type||'application/octet-stream'});parts.push(blob);}
 }
 const list=structuredClone(setlist);list.entries=list.entries.map(t=>({...cleanEntry(t),assetId:mapping.get(t.assetId)}));
 const manifest={signature:'SHOW_PLAYER_WEB_BUNDLE',version:1,setlist:list,assets:records};
 const header=new TextEncoder().encode(JSON.stringify(manifest));if(header.byteLength>0xFFFFFFFF)throw Error('設定ファイルが大きすぎます');
 const length=new Uint8Array(4);new DataView(length.buffer).setUint32(0,header.byteLength,true);
 return new Blob([MAGIC,length,header,...parts],{type:'application/octet-stream'});
}
export async function unpackTransfer(blob){
 if(!(blob instanceof Blob)||blob.size<MAGIC.length+4)throw Error('SHOW PLAYERの転送ファイルではありません');
 const prefix=new Uint8Array(await blob.slice(0,MAGIC.length+4).arrayBuffer());
 if(!MAGIC.every((v,i)=>v===prefix[i]))throw Error('ブラウザ版SHOW PLAYERの転送ファイルではありません');
 const length=new DataView(prefix.buffer).getUint32(MAGIC.length,true);let offset=MAGIC.length+4+length;
 if(offset>blob.size)throw Error('転送ファイルの設定が欠けています');
 let manifest;try{manifest=JSON.parse(await blob.slice(MAGIC.length+4,offset).text());}catch{throw Error('転送ファイルの設定を読み込めません');}
 if(manifest.signature!=='SHOW_PLAYER_WEB_BUNDLE'||manifest.version!==1||!Array.isArray(manifest.assets))throw Error('未対応の転送形式です');
 validateList(manifest.setlist);const needed=new Set(manifest.setlist.entries.map(x=>x.assetId)),received=new Set(),assets=[];
 for(const a of manifest.assets){
  if(!a||typeof a.id!=='string'||!/^[a-f0-9]{64}$/.test(a.id)||received.has(a.id)||!Number.isSafeInteger(a.bytes)||a.bytes<=0||typeof a.mime!=='string')throw Error('音源情報が不正です');
  const end=offset+a.bytes;if(!Number.isSafeInteger(end)||end>blob.size)throw Error('転送ファイルの音源が途中で切れています');
  const bytes=blob.slice(offset,end,a.mime);if(await digest(bytes)!==a.id)throw Error('転送音源の内容が一致しません');
  received.add(a.id);assets.push([a.id,bytes]);offset=end;
 }
 if(offset!==blob.size||needed.size!==received.size||[...needed].some(x=>!received.has(x)))throw Error('曲に対応する音源がそろっていません');
 return {setlist:manifest.setlist,assets};
}
