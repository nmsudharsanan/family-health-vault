'use strict';
/**
 * Sudhars Family Health Vault — IndexedDB data layer (Phase 2)
 * ------------------------------------------------------------
 * Three stores:
 *   members      one row per family member
 *   entries      every dated health item (vitals, allergies, visits, bills,
 *                reminders, ...) distinguished by `type`
 *   attachments  photos / PDFs stored as real Blobs, referenced by id
 *
 * Nothing is ever hard-deleted: deleting sets `deleted: true` and bumps
 * `updatedAt`. That "tombstone" is what lets a delete made on the phone
 * travel to the laptop when backups are merged (see backup.js).
 */
const VaultDB = (() => {
  const DB_NAME = 'SudharsFamilyHealthVault2';
  const DB_VERSION = 1;
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('members')) {
          db.createObjectStore('members', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('entries')) {
          const s = db.createObjectStore('entries', { keyPath: 'id' });
          s.createIndex('memberId', 'memberId');
          s.createIndex('type', 'type');
        }
        if (!db.objectStoreNames.contains('attachments')) {
          const s = db.createObjectStore('attachments', { keyPath: 'id' });
          s.createIndex('ownerId', 'ownerId');
        }
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta', { keyPath: 'key' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => console.warn('VaultDB: close other tabs of this app to finish upgrading.');
    });
    return dbPromise;
  }

  function wrap(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function store(name, mode = 'readonly') {
    const db = await open();
    return db.transaction(name, mode).objectStore(name);
  }

  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  }

  const now = () => new Date().toISOString();

  // Save (insert or update) — always stamps updatedAt.
  async function save(storeName, record) {
    const rec = Object.assign({}, record);
    rec.id = rec.id || uid();
    rec.createdAt = rec.createdAt || now();
    rec.updatedAt = now();
    rec.deleted = !!rec.deleted;
    await wrap((await store(storeName, 'readwrite')).put(rec));
    return rec;
  }

  // Write exactly as given (used by backup merge so timestamps are preserved).
  async function putRaw(storeName, record) {
    await wrap((await store(storeName, 'readwrite')).put(record));
    return record;
  }

  async function get(storeName, id) {
    return (await wrap((await store(storeName)).get(id))) || null;
  }

  async function all(storeName, { includeDeleted = false } = {}) {
    const rows = (await wrap((await store(storeName)).getAll())) || [];
    return includeDeleted ? rows : rows.filter(r => !r.deleted);
  }

  async function byIndex(storeName, index, value) {
    const rows = (await wrap((await store(storeName)).index(index).getAll(value))) || [];
    return rows.filter(r => !r.deleted);
  }

  async function softDelete(storeName, id) {
    const rec = await get(storeName, id);
    if (!rec) return;
    rec.deleted = true;
    if (storeName === 'attachments') rec.blob = null;
    await save(storeName, rec);
    // Deleting a member or entry also deletes what hangs off it.
    if (storeName === 'members') {
      for (const e of await byIndex('entries', 'memberId', id)) await softDelete('entries', e.id);
    }
    if (storeName === 'members' || storeName === 'entries') {
      for (const a of await byIndex('attachments', 'ownerId', id)) await softDelete('attachments', a.id);
    }
  }

  // ---- Members / entries shortcuts ------------------------------------
  const members = () => all('members').then(r => r.sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || a.name.localeCompare(b.name)));
  const entriesFor = (memberId, type) =>
    byIndex('entries', 'memberId', memberId).then(r => type ? r.filter(e => e.type === type) : r);
  const entriesOfType = type => byIndex('entries', 'type', type);

  // ---- Attachments ----------------------------------------------------
  async function addAttachment(file, ownerId) {
    const blob = await shrinkImage(file);
    return save('attachments', {
      ownerId,
      name: file.name || 'file',
      mime: blob.type || file.type || 'application/octet-stream',
      size: blob.size,
      blob
    });
  }

  // Phone photos are 3–8 MB; scale to max 1600px JPEG so backups stay small
  // enough to send over WhatsApp. PDFs and small images pass through.
  function shrinkImage(file) {
    if (!/^image\/(jpeg|png|webp|heic)/.test(file.type) || file.size < 400 * 1024) return Promise.resolve(file);
    return new Promise(resolve => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const max = 1600, scale = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        c.toBlob(b => resolve(b && b.size < file.size ? b : file), 'image/jpeg', 0.85);
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
      img.src = url;
    });
  }

  const attachmentsFor = ownerId => byIndex('attachments', 'ownerId', ownerId);

  // ---- Meta (settings, device id) -------------------------------------
  async function getMeta(key, fallback = null) {
    const r = await get('meta', key);
    return r ? r.value : fallback;
  }
  async function setMeta(key, value) {
    await putRaw('meta', { key, value });
  }

  return {
    open, uid, save, putRaw, get, all, byIndex, softDelete,
    members, entriesFor, entriesOfType,
    addAttachment, attachmentsFor,
    getMeta, setMeta
  };
})();

// Ask the browser not to evict our data when storage runs low.
if (navigator.storage && navigator.storage.persist) {
  navigator.storage.persisted().then(p => { if (!p) navigator.storage.persist(); });
}
