const DATABASE = 'perler-local-drafts';
const STORE = 'drafts';

// One atomic record keeps the image, settings and edited grid together.
async function transaction(mode, action) {
  if (!globalThis.indexedDB) throw new Error('此浏览器不支持本机草稿，请保存工程文件');
  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('请关闭其他旧版页面后重试草稿保存'));
  });
  try {
    return await new Promise((resolve, reject) => {
      const tx = database.transaction(STORE, mode);
      const request = action(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error || request.error);
      tx.onabort = () => reject(tx.error || new Error('草稿保存中断'));
    });
  } finally {
    database.close();
  }
}

export const readLatestDraft = () => transaction('readonly', (store) => store.get('latest'));
export const writeLatestDraft = (draft) => transaction('readwrite', (store) => store.put(draft, 'latest'));
