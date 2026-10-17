'use strict';
/**
 * Backup & sync between devices.
 *
 * Laptop and phone each keep their own full copy of the vault. To sync,
 * export a backup on one device, send the file to the other (OneDrive,
 * WhatsApp, Bluetooth, USB...) and import it there. Import MERGES: for every
 * record the newer `updatedAt` wins, and tombstones (deleted: true) carry
 * deletions across. So "export on phone → import on laptop → export on
 * laptop → import on phone" leaves both devices identical, and nothing
 * entered on either side is lost.
 *
 * A backup can optionally be locked with a password (AES-GCM, key derived
 * with PBKDF2) — recommended before sending it through chat apps.
 */
const VaultBackup = (() => {
  const FORMAT = 'sudhars-family-health-vault';
  const VERSION = 2;

  // ---- base64 helpers -------------------------------------------------
  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(',')[1] || '');
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
  }
  function base64ToBlob(b64, mime) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime || 'application/octet-stream' });
  }
  const bytesToB64 = bytes => {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  };
  const b64ToBytes = b64 => Uint8Array.from(atob(b64), c => c.charCodeAt(0));

  // ---- encryption -----------------------------------------------------
  async function deriveKey(password, salt) {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: 250000, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function encrypt(text, password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(password, salt);
    const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text)));
    return { format: FORMAT, version: VERSION, encrypted: true, salt: bytesToB64(salt), iv: bytesToB64(iv), data: bytesToB64(data) };
  }
  async function decrypt(obj, password) {
    const key = await deriveKey(password, b64ToBytes(obj.salt));
    try {
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(obj.iv) }, key, b64ToBytes(obj.data));
      return new TextDecoder().decode(plain);
    } catch (e) {
      throw new Error('Wrong password, or the file is damaged.');
    }
  }

  // ---- export ---------------------------------------------------------
  async function deviceName() {
    let name = await VaultDB.getMeta('deviceName');
    if (!name) {
      name = /Android|iPhone|iPad/i.test(navigator.userAgent) ? 'Mobile' : 'Laptop';
      await VaultDB.setMeta('deviceName', name);
    }
    return name;
  }

  async function buildBackup() {
    const attachments = [];
    for (const a of await VaultDB.all('attachments', { includeDeleted: true })) {
      const copy = Object.assign({}, a);
      delete copy.blob;
      if (a.blob && !a.deleted) copy.data = await blobToBase64(a.blob);
      attachments.push(copy);
    }
    return {
      format: FORMAT,
      version: VERSION,
      exportedAt: new Date().toISOString(),
      exportedFrom: await deviceName(),
      members: await VaultDB.all('members', { includeDeleted: true }),
      entries: await VaultDB.all('entries', { includeDeleted: true }),
      attachments
    };
  }

  // Returns a File ready to download or share.
  async function exportFile(password) {
    const backup = await buildBackup();
    let text = JSON.stringify(backup);
    if (password) text = JSON.stringify(await encrypt(text, password));
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
    const name = `family-health-vault-${backup.exportedFrom.toLowerCase()}-${stamp}${password ? '-locked' : ''}.json`;
    await VaultDB.setMeta('lastExport', backup.exportedAt);
    return new File([text], name, { type: 'application/json' });
  }

  // ---- import ---------------------------------------------------------
  async function readFile(file, askPassword) {
    let obj;
    try { obj = JSON.parse(await file.text()); }
    catch (e) { throw new Error('This is not a valid backup file.'); }

    if (obj && obj.encrypted) {
      const pw = await askPassword();
      if (!pw) throw new Error('Import cancelled.');
      obj = JSON.parse(await decrypt(obj, pw));
    }
    return obj;
  }

  // Newer updatedAt wins. Returns counts for the summary message.
  async function mergeStore(storeName, incoming, transform) {
    let added = 0, updated = 0, skipped = 0;
    for (const rec of incoming || []) {
      if (!rec || !rec.id) continue;
      const local = await VaultDB.get(storeName, rec.id);
      if (local && (local.updatedAt || '') >= (rec.updatedAt || '')) { skipped++; continue; }
      await VaultDB.putRaw(storeName, transform ? transform(rec) : rec);
      local ? updated++ : added++;
    }
    return { added, updated, skipped };
  }

  async function importBackup(file, askPassword) {
    const obj = await readFile(file, askPassword);

    if (obj.format === FORMAT) {
      const m = await mergeStore('members', obj.members);
      const e = await mergeStore('entries', obj.entries);
      const a = await mergeStore('attachments', obj.attachments, rec => {
        const copy = Object.assign({}, rec);
        copy.blob = rec.data ? base64ToBlob(rec.data, rec.mime) : null;
        delete copy.data;
        return copy;
      });
      await VaultDB.setMeta('lastImport', { at: new Date().toISOString(), from: obj.exportedFrom || 'unknown' });
      return {
        added: m.added + e.added + a.added,
        updated: m.updated + e.updated + a.updated,
        unchanged: m.skipped + e.skipped + a.skipped
      };
    }

    // Phase 1 backups: { members, records, vitals } from localStorage.
    if (Array.isArray(obj.members) && Array.isArray(obj.records)) return importLegacy(obj);

    throw new Error('This file is not a Family Health Vault backup.');
  }

  // Phase 1 used numeric ids (Date.now()). Prefix them so re-importing the
  // same old backup twice updates instead of duplicating.
  async function importLegacy(old) {
    let added = 0;
    const idMap = {};
    const dataUrlToBlob = url => {
      const m = /^data:([^;]+);base64,(.*)$/.exec(url || '');
      return m ? base64ToBlob(m[2], m[1]) : null;
    };
    const stamp = new Date().toISOString();

    for (const m of old.members) {
      const id = 'p1-member-' + m.id;
      idMap[String(m.id)] = id;
      if (await VaultDB.get('members', id)) continue;
      let photoId = null;
      const blob = dataUrlToBlob(m.photo);
      if (blob) {
        photoId = 'p1-photo-' + m.id;
        await VaultDB.putRaw('attachments', { id: photoId, ownerId: id, name: 'photo.jpg', mime: blob.type, size: blob.size, blob, createdAt: stamp, updatedAt: stamp, deleted: false });
      }
      await VaultDB.putRaw('members', {
        id, name: m.name || 'Unnamed', relation: '', dob: m.dob || '', gender: m.gender || '',
        bloodGroup: m.bloodGroup || '', phone: m.mobile || '', photoId,
        createdAt: stamp, updatedAt: stamp, deleted: false
      });
      added++;
    }

    for (const r of old.records) {
      const memberId = idMap[String(r.memberId)];
      const id = 'p1-record-' + r.id;
      if (!memberId || await VaultDB.get('entries', id)) continue;
      const attachmentIds = [];
      const blob = dataUrlToBlob(r.prescriptionPhoto);
      if (blob) {
        const aid = 'p1-rx-' + r.id;
        await VaultDB.putRaw('attachments', { id: aid, ownerId: id, name: 'prescription.jpg', mime: blob.type, size: blob.size, blob, createdAt: stamp, updatedAt: stamp, deleted: false });
        attachmentIds.push(aid);
      }
      await VaultDB.putRaw('entries', {
        id, memberId, type: 'visit', date: r.visitDate || '', doctor: r.doctor || '',
        diagnosis: r.sickness || '', medicines: r.medicines || '', amount: r.billAmount || '',
        attachmentIds, createdAt: stamp, updatedAt: stamp, deleted: false
      });
      added++;
    }

    for (const v of old.vitals || []) {
      const memberId = idMap[String(v.memberId)];
      const id = 'p1-vital-' + v.id;
      if (!memberId || await VaultDB.get('entries', id)) continue;
      const [sys, dia] = String(v.bp || '').split('/').map(s => s.trim());
      await VaultDB.putRaw('entries', {
        id, memberId, type: 'vital', date: v.date || '', height: v.height || '', weight: v.weight || '',
        bpSys: sys || '', bpDia: dia || '', pulse: v.pulse || '', spo2: v.spo2 || '',
        temperature: v.temperature || '', notes: v.notes || '',
        createdAt: stamp, updatedAt: stamp, deleted: false
      });
      added++;
    }
    return { added, updated: 0, unchanged: 0, legacy: true };
  }

  return { exportFile, importBackup, deviceName };
})();
