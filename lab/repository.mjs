import {openStore,readStore,encodeAssets,writeRecords} from './storage.mjs?v=146';
import {validateList,cleanEntry} from './transfer.mjs?v=146';
export async function writeLibrary(db,library,assets=[]){
 if(library.schemaVersion!==2||!Array.isArray(library.lists))throw Error('保存形式が不正です');
 const ids=new Set();for(const list of library.lists){validateList(list);if(ids.has(list.id))throw Error('セットリストIDが重複しています');ids.add(list.id);}
 if(library.activeId!==null&&!ids.has(library.activeId))throw Error('選択中のセットリストがありません');
 const encoded=await encodeAssets(assets);
 await writeRecords(db,'library',library,encoded);
}
export async function loadLibrary(){
 const db=await openStore();let library=await readStore(db,'state','library');let migrated=false;
 if(!library){const old=await readStore(db,'state','current');const list={id:crypto.randomUUID(),name:old?.length?'以前のセットリスト':'セットリスト 1',revision:1,updatedAt:new Date().toISOString(),entries:(old||[]).map(cleanEntry)};library={schemaVersion:2,activeId:list.id,lists:[list]};await writeLibrary(db,library);migrated=!!old?.length;}
 // Validate restored data before rendering any content or overwriting it.
 if(library.schemaVersion!==2||!Array.isArray(library.lists))throw Error('未対応の保存データです');
 for(const list of library.lists)validateList(list);
 if(library.lists.length&&!library.lists.some(x=>x.id===library.activeId))throw Error('保存データのセットリスト対応が不正です');
 return {db,library,migrated};
}
export {readStore};
