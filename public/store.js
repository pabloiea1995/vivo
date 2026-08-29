// Lo que sobrevive a cerrar la pestaña.
//
// Un clip cuesta 0,18 €, tarda diez segundos y no se puede volver a pedir igual
// —el modelo no es determinista—, así que perderlo al recargar es tirar dinero
// y una idea que no vuelve. Aquí se guardan.
//
// IndexedDB y no localStorage, por una razón dura: localStorage solo admite
// texto y ronda los 5 MB. Un mp4 de cinco segundos pesa uno o dos, y aquí puede
// haber cinco a la vez. Meterlos como base64 en localStorage reventaría la
// cuota a la segunda foto.
//
// Dos almacenes en vez de uno:
//
//  - `session` guarda la foto y los modos SIN los vídeos: unos pocos KB que se
//    reescriben en cada cambio.
//  - `clips` guarda cada mp4 por separado, con su clave.
//
// Con un solo registro, guardar el cuarto clip reescribiría los tres anteriores
// —ocho megas por cada generación— y a la que el disco va lento se nota.

const DB = 'vivo';
const VERSION = 1;

let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    // Puede no haber IndexedDB: navegación privada de Safari en algunas
    // versiones, o el usuario la ha desactivado. Todo lo de abajo lo trata como
    // "no se guarda nada" y la app sigue funcionando en memoria.
    if (!globalThis.indexedDB) return reject(new Error('no_indexeddb'));
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('session')) db.createObjectStore('session');
      if (!db.objectStoreNames.contains('clips')) db.createObjectStore('clips');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).catch((err) => {
    dbPromise = null;
    throw err;
  });
  return dbPromise;
}

function tx(store, mode, run) {
  return open().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(store, mode);
        const out = run(t.objectStore(store));
        t.oncomplete = () => resolve(out?.result ?? null);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      })
  );
}

/** Ni un fallo de almacenamiento debe romper la app: se registra y se sigue. */
const quiet = (promise, fallback = null) =>
  promise.catch((err) => {
    console.warn('[store]', err?.message || err);
    return fallback;
  });

export const clipKey = (photoId, modeKey) => `${photoId}:${modeKey}`;

/**
 * La foto y los modos, sin los vídeos. `modes` va tal cual llega del servidor
 * (con su ticket): al restaurar hay que poder generar los que falten, y el
 * ticket es lo único que autoriza a hacerlo.
 */
export const saveSession = (photo, modes) =>
  quiet(
    tx('session', 'readwrite', (s) =>
      s.put({ photo, modes, savedAt: Date.now() }, 'last')
    )
  );

export const loadSession = () => quiet(tx('session', 'readonly', (s) => s.get('last')));

export const clearSession = () =>
  Promise.all([
    quiet(tx('session', 'readwrite', (s) => s.clear())),
    quiet(tx('clips', 'readwrite', (s) => s.clear())),
  ]);

/** Un mp4, con lo que hizo falta para generarlo. */
export const saveClip = (key, record) =>
  quiet(tx('clips', 'readwrite', (s) => s.put(record, key)));

export const loadClip = (key) => quiet(tx('clips', 'readonly', (s) => s.get(key)));

/**
 * Se llama al volver a tirar los dados: los modos viejos ya no existen, así que
 * sus mp4 son basura que ocupa megas. Sin esto, cada tirada deja cuatro
 * huérfanos y la cuota del navegador se llena sola.
 */
export const deleteClip = (key) => quiet(tx('clips', 'readwrite', (s) => s.delete(key)));

/** Cuánto ocupa todo esto, para poder enseñarlo y para saber cuándo purgar. */
export async function usage() {
  const est = await quiet(navigator.storage?.estimate?.() ?? Promise.resolve(null));
  return est ? { used: est.usage || 0, quota: est.quota || 0 } : null;
}
