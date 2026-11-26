/**
 * Retrato local (IndexedDB, por usuário) dos dados de um dashboard: a página abre na hora com o último
 * retrato e as consultas atualizam por trás. IndexedDB guarda Map/Set sem conversão.
 */
const DB = "ab5-dash", STORE = "snap";
function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function uid() {
  const { supabase } = await import("@/integrations/supabase/client");
  return (await supabase.auth.getSession()).data.session?.user.id ?? null;
}
export async function readSnapshot<T>(name: string): Promise<T | null> {
  try {
    const u = await uid(); if (!u) return null;
    const db = await open();
    return await new Promise((res) => {
      const q = db.transaction(STORE).objectStore(STORE).get(`${u}:${name}`);
      q.onsuccess = () => res((q.result as T) ?? null);
      q.onerror = () => res(null);
    });
  } catch { return null; }
}
export async function writeSnapshot(name: string, value: unknown) {
  try {
    const u = await uid(); if (!u) return;
    const db = await open();
    db.transaction(STORE, "readwrite").objectStore(STORE).put(value, `${u}:${name}`);
  } catch { /* retrato é só atalho */ }
}
