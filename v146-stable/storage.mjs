export function openStore(){return new Promise((resolve,reject)=>{const r=indexedDB.open('show-player-local',1);r.onupgradeneeded=()=>{r.result.createObjectStore('assets');r.result.createObjectStore('state');};r.onerror=()=>reject(r.error);r.onsuccess=()=>resolve(r.result);r.onblocked=()=>reject(Error('別のタブを閉じて再試行してください'));});}
export function readStore(db,store,key){return new Promise((resolve,reject)=>{const r=db.transaction(store).objectStore(store).get(key);r.onsuccess=()=>{try{resolve(store==='assets'?decodeAsset(r.result):r.result);}catch(e){reject(e);}};r.onerror=()=>reject(r.error);});}
// Store raw bytes, not Blob objects: some Safari storage modes reject Blob
// backing URLs. Rebuild a Blob only when reading an asset for playback/export.
export async function encodeAssets(assets){return Promise.all(assets.map(async([id,blob])=>{
 if(!(blob instanceof Blob))throw Error('保存する音源データが不正です');
 return [id,{format:'show-player-audio-bytes-v1',bytes:await blob.arrayBuffer(),mime:blob.type||'application/octet-stream'}];
}));}
export function decodeAsset(value){
 if(value===undefined||value===null||value instanceof Blob)return value;
 if(value.format==='show-player-audio-bytes-v1'&&value.bytes instanceof ArrayBuffer)return new Blob([value.bytes],{type:value.mime||'application/octet-stream'});
 throw Error('保存音源の形式を読み込めません');
}
export function writeRecords(db,stateKey,state,assets){return new Promise((resolve,reject)=>{
 const tx=db.transaction(['assets','state'],'readwrite');
 tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('保存が中断しました'));
 try{for(const [id,data]of assets)tx.objectStore('assets').put(data,id);tx.objectStore('state').put(state,stateKey);}
 catch(e){try{tx.abort();}catch{}reject(e);}
});}
export async function saveList(db,entries,assets=[]){const encoded=await encodeAssets(assets);await writeRecords(db,'current',entries,encoded);}
