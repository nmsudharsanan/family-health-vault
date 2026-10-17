'use strict';
/**
 * Sudhars Family Health Vault — screens.
 * Hash routes:
 *   #/                     home (family + due reminders)
 *   #/m/<memberId>/<tab>   member (overview|vitals|history|visits|documents|reminders|emergency)
 *   #/reminders            all reminders
 *   #/sync                 backup / sync between laptop and phone
 */
const $ = (sel, root = document) => root.querySelector(sel);
const view = $('#view');
let routeToken = 0;

// ---------------------------------------------------------------- utils
const urlCache = new Map();
async function attUrl(id) {
  if (!id) return null;
  if (urlCache.has(id)) return urlCache.get(id);
  const a = await VaultDB.get('attachments', id);
  const url = a && a.blob && !a.deleted ? URL.createObjectURL(a.blob) : null;
  urlCache.set(id, url);
  return url;
}

function toast(msg, ms = 2600) {
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

function setHeader(title, backHref) {
  $('#title').textContent = title;
  const back = $('#back');
  back.hidden = !backHref;
  $('#logo').hidden = !!backHref;
  if (backHref) back.href = backHref;
  document.title = title === 'Family Health Vault' ? 'Sudhars Family Health Vault' : `${title} · Health Vault`;
}

function setNav(name) {
  document.querySelectorAll('.bottomnav a').forEach(a => a.classList.toggle('active', a.dataset.nav === name));
}

function initials(name) { return (name || '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase(); }

async function avatarHtml(m, cls = '') {
  const url = await attUrl(m.photoId);
  return `<div class="avatar ${cls}">${url ? `<img src="${url}" alt="">` : esc(initials(m.name))}</div>`;
}

function sortByDateDesc(list) {
  return list.slice().sort((a, b) => (entryDate(b) || b.createdAt).localeCompare(entryDate(a) || a.createdAt));
}

function itemHtml(e, opts = {}) {
  const t = TYPES[e.type];
  const s = t.summary(e);
  const d = entryDate(e);
  const clip = e._files ? `<div class="clip">📎 ${e._files} file${e._files > 1 ? 's' : ''}</div>` : '';
  return `<div class="item ${opts.done ? 'done' : ''}" data-act="open" data-id="${e.id}">
    <div class="ic">${t.icon}</div>
    <div class="body"><div class="t">${esc(s.title)}</div>${s.sub ? `<div class="s">${esc(s.sub)}</div>` : ''}${opts.extra || ''}${clip}</div>
    <div class="d">${d ? esc(fmtDate(d)) : ''}${s.badge ? `<div style="margin-top:4px"><span class="badge ${s.badgeKind || ''}">${esc(s.badge)}</span></div>` : ''}</div>
  </div>`;
}

async function withFileCounts(entries) {
  for (const e of entries) {
    if (TYPES[e.type].attachments) e._files = (await VaultDB.attachmentsFor(e.id)).length;
  }
  return entries;
}

// ---------------------------------------------------------------- dialogs
function openDialog(html, { onOpen } = {}) {
  return new Promise(resolve => {
    const dlg = document.createElement('dialog');
    dlg.innerHTML = `<div class="dlg">${html}</div>`;
    document.body.appendChild(dlg);
    let result = null;
    dlg.done = v => { result = v; dlg.close(); };
    dlg.addEventListener('click', ev => {
      if (ev.target === dlg) dlg.close(); // backdrop tap
      if (ev.target.closest('[data-close]')) dlg.close();
    });
    dlg.addEventListener('close', () => { dlg.remove(); resolve(result); });
    dlg.showModal();
    if (onOpen) onOpen(dlg);
  });
}

function confirmBox(message, okLabel = 'Delete') {
  return openDialog(`
    <header><h3>Are you sure?</h3></header>
    <div class="content">${esc(message)}</div>
    <footer><button class="btn secondary" data-close>Cancel</button><button class="btn danger" data-ok>${esc(okLabel)}</button></footer>`,
    { onOpen: dlg => $('[data-ok]', dlg).onclick = () => dlg.done(true) });
}

function askPassword(title = 'Backup password', hint = 'Enter the password used when this backup was exported.') {
  return openDialog(`
    <header><h3>${esc(title)}</h3><button class="close" data-close>×</button></header>
    <form class="content form" id="pwf">
      <div class="f"><span class="muted small">${esc(hint)}</span>
      <div class="input-wrap"><input type="password" id="pw" autocomplete="off" required></div></div>
    </form>
    <footer><button class="btn secondary" data-close>Cancel</button><button class="btn" form="pwf">OK</button></footer>`,
    { onOpen: dlg => { $('#pw', dlg).focus(); $('#pwf', dlg).onsubmit = ev => { ev.preventDefault(); dlg.done($('#pw', dlg).value); }; } });
}

function fieldHtml(f, value) {
  const v = value ?? '';
  const id = 'f_' + f.key;
  let input;
  if (f.type === 'select') {
    input = `<select id="${id}" name="${f.key}"><option value="">—</option>${f.options.map(o => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
  } else if (f.type === 'textarea') {
    input = `<textarea id="${id}" name="${f.key}" rows="2" placeholder="${esc(f.placeholder || '')}">${esc(v)}</textarea>`;
  } else {
    const extra = f.type === 'number' ? `inputmode="decimal" step="${f.step || 'any'}" min="0"` : '';
    input = `<input id="${id}" name="${f.key}" type="${f.type}" value="${esc(v)}" placeholder="${esc(f.placeholder || '')}" ${extra}>`;
  }
  return `<div class="f ${f.half ? 'half' : ''}" data-key="${f.key}">
    <label for="${id}">${esc(f.label)}${f.required ? ' <span class="req">*</span>' : ''}</label>
    <div class="input-wrap">${input}${f.unit ? `<span class="unit">${esc(f.unit)}</span>` : ''}</div></div>`;
}

function readForm(form, fields) {
  const out = {}; let ok = true;
  for (const f of fields) {
    const el = form.elements[f.key];
    const val = el ? el.value.trim() : '';
    out[f.key] = val;
    const wrap = form.querySelector(`[data-key="${f.key}"]`);
    const bad = f.required && !val;
    if (wrap) wrap.classList.toggle('invalid', bad);
    if (bad) ok = false;
  }
  return ok ? out : null;
}

// File picker + thumbnails shared by entry and member forms.
function filesWidget(dlg, existing, { single = false, label = '+ Add photo / PDF' } = {}) {
  const state = { keep: existing.slice(), removed: [], added: [] };
  const box = $('.files', dlg);
  const input = document.createElement('input');
  input.type = 'file'; input.hidden = true;
  input.accept = single ? 'image/*' : 'image/*,application/pdf';
  input.multiple = !single;
  box.after(input);

  async function draw() {
    let html = '';
    for (const a of state.keep) {
      const url = await attUrl(a.id);
      html += `<div class="thumb" data-keep="${a.id}">${a.mime.startsWith('image/') && url ? `<img src="${url}">` : '📄<br>' + esc(a.name.slice(0, 18))}<button type="button" class="x" data-rm-keep="${a.id}">×</button></div>`;
    }
    state.added.forEach((f, i) => {
      const url = f.type.startsWith('image/') ? URL.createObjectURL(f) : null;
      html += `<div class="thumb">${url ? `<img src="${url}">` : '📄<br>' + esc(f.name.slice(0, 18))}<button type="button" class="x" data-rm-new="${i}">×</button></div>`;
    });
    if (!single || (state.keep.length + state.added.length) === 0) html += `<button type="button" class="thumb add" data-pick>${label}</button>`;
    box.innerHTML = html;
  }
  box.addEventListener('click', ev => {
    const t = ev.target;
    if (t.closest('[data-pick]')) input.click();
    else if (t.dataset.rmKeep) { state.removed.push(t.dataset.rmKeep); state.keep = state.keep.filter(a => a.id !== t.dataset.rmKeep); draw(); }
    else if (t.dataset.rmNew) { state.added.splice(Number(t.dataset.rmNew), 1); draw(); }
  });
  input.onchange = () => {
    const picked = [...input.files];
    if (single) { state.removed.push(...state.keep.map(a => a.id)); state.keep = []; state.added = picked.slice(0, 1); }
    else state.added.push(...picked);
    input.value = ''; draw();
  };
  draw();
  return state;
}

async function applyFiles(state, ownerId) {
  for (const id of state.removed) await VaultDB.softDelete('attachments', id);
  const saved = [];
  for (const f of state.added) saved.push(await VaultDB.addAttachment(f, ownerId));
  return saved;
}

// ---------------------------------------------------------------- entry form
async function openEntryForm(type, memberId, entry = null) {
  const t = TYPES[type];
  const members = await VaultDB.members();
  if (!members.length) { toast('Add a family member first'); return openMemberForm(); }
  const values = entry ? Object.assign({}, entry) : {};
  if (!entry && t.dateKey && t.fields.some(f => f.key === t.dateKey && f.required)) values[t.dateKey] = today();
  if (!entry && type === 'reminder') values.repeat = 'Never';
  const existingFiles = entry && t.attachments ? await VaultDB.attachmentsFor(entry.id) : [];
  const chooseMember = !memberId || type === 'reminder';

  let fileState = null;
  const saved = await openDialog(`
    <header><h3>${t.icon} ${entry ? 'Edit' : 'Add'} ${esc(t.label.toLowerCase())}</h3><button class="close" data-close>×</button></header>
    <form class="content form" id="ef" novalidate>
      ${chooseMember ? `<div class="f"><label>Family member <span class="req">*</span></label><div class="input-wrap"><select name="memberId">${members.map(m => `<option value="${m.id}" ${m.id === (entry ? entry.memberId : memberId) ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select></div></div>` : ''}
      ${t.fields.map(f => fieldHtml(f, values[f.key])).join('')}
      ${type === 'vital' ? `<div class="f"><div class="muted small" id="bmiOut"></div></div>` : ''}
      ${t.attachments ? `<div class="f"><label>Photos / PDFs (prescription, report, bill…)</label><div class="files"></div></div>` : ''}
    </form>
    <footer><button class="btn secondary" data-close>Cancel</button><button class="btn" form="ef">Save</button></footer>`,
    {
      onOpen: dlg => {
        const form = $('#ef', dlg);
        if (t.attachments) fileState = filesWidget(dlg, existingFiles);
        if (type === 'vital') {
          const upd = () => { const b = bmi(form.elements.height.value, form.elements.weight.value); $('#bmiOut', dlg).textContent = b ? `BMI ${b} — ${bmiLabel(b)}` : ''; };
          form.addEventListener('input', upd); upd();
        }
        form.onsubmit = async ev => {
          ev.preventDefault();
          const data = readForm(form, t.fields);
          if (!data) { toast('Please fill the required fields'); return; }
          if (type === 'vital' && !t.fields.some(f => f.key !== 'date' && f.key !== 'time' && f.key !== 'notes' && data[f.key])) { toast('Enter at least one measurement'); return; }
          const rec = Object.assign({}, entry || {}, data, {
            type,
            memberId: chooseMember ? form.elements.memberId.value : memberId
          });
          if (type === 'reminder' && !entry) rec.done = false;
          const savedRec = await VaultDB.save('entries', rec);
          if (fileState) await applyFiles(fileState, savedRec.id);
          dlg.done(savedRec);
        };
      }
    });
  if (saved) { toast('Saved ✓'); route(); }
  return saved;
}

// ---------------------------------------------------------------- entry detail
async function openEntry(id) {
  const e = await VaultDB.get('entries', id);
  if (!e || e.deleted) return;
  const t = TYPES[e.type];
  const member = await VaultDB.get('members', e.memberId);
  const files = t.attachments ? await VaultDB.attachmentsFor(e.id) : [];
  const rows = t.fields.filter(f => e[f.key]).map(f => {
    let v = e[f.key];
    if (f.type === 'date') v = fmtDate(v);
    if (f.unit === '₹') v = money(v); else if (f.unit) v = `${v} ${f.unit}`;
    return `<dt>${esc(f.label)}</dt><dd>${esc(v)}</dd>`;
  });
  if (e.type === 'vital' && bmi(e.height, e.weight)) rows.push(`<dt>BMI</dt><dd>${bmi(e.height, e.weight)} — ${bmiLabel(bmi(e.height, e.weight))}</dd>`);
  if (member && member.dob && entryDate(e)) rows.push(`<dt>Age then</dt><dd>${esc(ageText(member.dob, entryDate(e)))}</dd>`);

  let thumbs = '';
  for (const a of files) {
    const url = await attUrl(a.id);
    thumbs += `<div class="thumb" data-view="${a.id}">${a.mime.startsWith('image/') && url ? `<img src="${url}">` : '📄<br>' + esc(a.name.slice(0, 18))}</div>`;
  }

  await openDialog(`
    <header><h3>${t.icon} ${esc(t.label)}${member ? ` · ${esc(member.name)}` : ''}</h3><button class="close" data-close>×</button></header>
    <div class="content">
      <dl class="kv">${rows.join('')}</dl>
      ${thumbs ? `<div style="margin-top:14px" class="files">${thumbs}</div>` : ''}
      ${e.type === 'reminder' ? `<div class="actions" style="margin-top:14px"><button class="btn secondary sm" data-ics>📅 Add to phone calendar</button></div>` : ''}
    </div>
    <footer><button class="btn danger" data-del>Delete</button><button class="btn secondary" data-edit>Edit</button></footer>`,
    {
      onOpen: dlg => {
        dlg.addEventListener('click', async ev => {
          const v = ev.target.closest('[data-view]');
          if (v) viewFile(v.dataset.view);
          if (ev.target.closest('[data-ics]')) downloadIcs([e], member ? [member] : []);
        });
        $('[data-edit]', dlg).onclick = () => { dlg.done(); openEntryForm(e.type, e.memberId, e); };
        $('[data-del]', dlg).onclick = async () => {
          if (await confirmBox(`Delete this ${t.label.toLowerCase()}? This will also be removed from your other device on the next sync.`)) {
            await VaultDB.softDelete('entries', e.id); dlg.done(); toast('Deleted'); route();
          }
        };
      }
    });
}

async function viewFile(id) {
  const a = await VaultDB.get('attachments', id);
  if (!a || !a.blob) return;
  const url = await attUrl(id);
  if (a.mime.startsWith('image/')) {
    openDialog(`<header><h3>${esc(a.name)}</h3><a class="btn sm secondary" href="${url}" download="${esc(a.name)}">Save</a><button class="close" data-close>×</button></header>
      <div class="content center"><img src="${url}" style="max-height:75dvh;border-radius:10px"></div>`);
  } else {
    window.open(url, '_blank');
  }
}

// ---------------------------------------------------------------- member form
async function openMemberForm(member = null) {
  const m = member || {};
  const fields = [
    { key: 'name', label: 'Full name', type: 'text', required: true },
    { key: 'relation', label: 'Relation', type: 'select', options: RELATIONS, half: true },
    { key: 'dob', label: 'Date of birth', type: 'date', half: true },
    { key: 'gender', label: 'Gender', type: 'select', options: GENDERS, half: true },
    { key: 'bloodGroup', label: 'Blood group', type: 'select', options: BLOOD_GROUPS, half: true },
    { key: 'phone', label: 'Mobile', type: 'tel', half: true },
    { key: 'birthWeight', label: 'Birth weight', type: 'number', unit: 'kg', step: '0.01', half: true },
    { key: 'doctorName', label: 'Family doctor', type: 'text', half: true },
    { key: 'doctorPhone', label: 'Doctor phone', type: 'tel', half: true },
    { key: 'emergencyName', label: 'Emergency contact', type: 'text', half: true },
    { key: 'emergencyPhone', label: 'Emergency phone', type: 'tel', half: true },
    { key: 'insurance', label: 'Health insurance (company & policy no.)', type: 'text' },
    { key: 'organDonor', label: 'Organ donor', type: 'select', options: ['Yes', 'No', 'Not decided'], half: true },
    { key: 'disability', label: 'Disability / special needs', type: 'text', half: true },
    { key: 'notes', label: 'Other notes', type: 'textarea' }
  ];
  const photo = m.photoId ? [await VaultDB.get('attachments', m.photoId)].filter(a => a && !a.deleted) : [];
  let fileState;
  const saved = await openDialog(`
    <header><h3>${member ? 'Edit' : 'Add'} family member</h3><button class="close" data-close>×</button></header>
    <form class="content form" id="mf" novalidate>
      <div class="f"><label>Photo</label><div class="files"></div></div>
      ${fields.map(f => fieldHtml(f, m[f.key])).join('')}
      ${member ? `<div class="f"><button type="button" class="btn danger sm" data-delm>Delete this member and all their records</button></div>` : ''}
    </form>
    <footer><button class="btn secondary" data-close>Cancel</button><button class="btn" form="mf">Save</button></footer>`,
    {
      onOpen: dlg => {
        fileState = filesWidget(dlg, photo, { single: true, label: '+ Photo' });
        const form = $('#mf', dlg);
        form.onsubmit = async ev => {
          ev.preventDefault();
          const data = readForm(form, fields);
          if (!data) { toast('Name is required'); return; }
          const rec = await VaultDB.save('members', Object.assign({}, m, data));
          const added = await applyFiles(fileState, rec.id);
          if (added.length) rec.photoId = added[0].id;
          else if (fileState.removed.includes(rec.photoId)) rec.photoId = null;
          dlg.done(await VaultDB.save('members', rec));
        };
        const del = $('[data-delm]', dlg);
        if (del) del.onclick = async () => {
          if (await confirmBox(`Delete ${m.name} and ALL their health records? This cannot be undone (unless you still have a backup).`)) {
            await VaultDB.softDelete('members', m.id); dlg.done(); toast('Member deleted'); location.hash = '#/';
          }
        };
      }
    });
  if (saved) {
    toast('Saved ✓');
    if (!member) location.hash = `#/m/${saved.id}/overview`; else route();
  }
}

// ---------------------------------------------------------------- reminders logic
function nextDate(date, repeat) {
  switch (repeat) {
    case 'Daily': return addDays(date, 1);
    case 'Weekly': return addDays(date, 7);
    case 'Monthly': return addMonths(date, 1);
    case 'Every 3 months': return addMonths(date, 3);
    case 'Every 6 months': return addMonths(date, 6);
    case 'Yearly': return addMonths(date, 12);
    default: return null;
  }
}

async function markReminderDone(id) {
  const r = await VaultDB.get('entries', id);
  let next = nextDate(r.date, r.repeat);
  if (next) {
    while (next <= today()) next = nextDate(next, r.repeat);
    r.date = next;
    r.lastDoneAt = new Date().toISOString();
    toast(`Done ✓ Next on ${fmtDate(next)}`);
  } else {
    r.done = !r.done;
    toast(r.done ? 'Marked done ✓' : 'Marked not done');
  }
  await VaultDB.save('entries', r);
  route();
}

// Reminders plus auto-items: vaccine next doses and visit follow-ups.
async function upcomingItems(memberId = null) {
  const all = memberId ? await VaultDB.entriesFor(memberId) : await VaultDB.all('entries');
  const items = [];
  for (const e of all) {
    if (e.type === 'reminder') items.push({ entry: e, date: e.date, time: e.time, title: e.title, done: !!e.done, kind: 'reminder' });
    if (e.type === 'vaccine' && e.nextDue) items.push({ entry: e, date: e.nextDue, title: `${e.name} – next dose`, auto: true });
    if (e.type === 'visit' && e.followUp && e.followUp >= addDays(today(), -30)) items.push({ entry: e, date: e.followUp, title: `Follow-up visit${e.doctor ? ' – Dr. ' + e.doctor : ''}`, auto: true });
  }
  return items.sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
}

function bucket(items) {
  const t = today(), week = addDays(t, 7);
  const open = items.filter(i => !i.done);
  return {
    overdue: open.filter(i => i.date < t && !(i.auto && i.entry.type === 'vaccine' && i.date < addDays(t, -60))),
    today: open.filter(i => i.date === t),
    week: open.filter(i => i.date > t && i.date <= week),
    later: open.filter(i => i.date > week),
    done: items.filter(i => i.done)
  };
}

async function reminderRows(items, memberMap) {
  return items.map(i => {
    const m = memberMap[i.entry.memberId];
    const who = m ? m.name : '';
    const right = `${esc(fmtDate(i.date))}${i.time ? `<div>${esc(i.time)}</div>` : ''}`;
    const btn = i.auto ? '' : `<button class="btn sm ${i.done ? 'secondary' : 'ok'}" data-act="done" data-id="${i.entry.id}">${i.done ? 'Undo' : '✓ Done'}</button>`;
    return `<div class="item ${i.done ? 'done' : ''}" data-act="open" data-id="${i.entry.id}">
      <div class="ic">${TYPES[i.entry.type].icon}</div>
      <div class="body"><div class="t">${esc(i.title)}</div><div class="s">${esc(who)}${i.auto ? ' · from ' + TYPES[i.entry.type].label.toLowerCase() : ''}</div></div>
      <div class="d">${right}<div style="margin-top:6px">${btn}</div></div></div>`;
  }).join('');
}

function icsEscape(s) { return String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1'); }
function downloadIcs(reminders, members) {
  const names = Object.fromEntries(members.map(m => [m.id, m.name]));
  const rr = { Daily: 'FREQ=DAILY', Weekly: 'FREQ=WEEKLY', Monthly: 'FREQ=MONTHLY', 'Every 3 months': 'FREQ=MONTHLY;INTERVAL=3', 'Every 6 months': 'FREQ=MONTHLY;INTERVAL=6', Yearly: 'FREQ=YEARLY' };
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Sudhars Family Health Vault//EN', 'CALSCALE:GREGORIAN'];
  for (const r of reminders) {
    if (r.done) continue;
    const d = r.date.replace(/-/g, '');
    lines.push('BEGIN:VEVENT', `UID:${r.id}@family-health-vault`, `DTSTAMP:${stamp}`);
    if (r.time) {
      const t = r.time.replace(':', '') + '00';
      lines.push(`DTSTART:${d}T${t}`, 'DURATION:PT15M');
    } else {
      lines.push(`DTSTART;VALUE=DATE:${d}`);
    }
    lines.push(`SUMMARY:${icsEscape(r.title + (names[r.memberId] ? ' – ' + names[r.memberId] : ''))}`);
    if (r.notes) lines.push(`DESCRIPTION:${icsEscape(r.notes)}`);
    if (rr[r.repeat]) lines.push(`RRULE:${rr[r.repeat]}`);
    lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEscape(r.title)}`, `TRIGGER:${r.time ? '-PT0M' : 'PT9H'}`, 'END:VALARM', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = reminders.length === 1 ? 'health-reminder.ics' : 'family-health-reminders.ics';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast('Open the downloaded file to add it to your calendar');
}

// Show a notification for due reminders while the app is open.
async function checkNotifications() {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const notified = await VaultDB.getMeta('notified', {});
  const nowTime = new Date().toTimeString().slice(0, 5);
  const members = Object.fromEntries((await VaultDB.members()).map(m => [m.id, m]));
  const due = (await VaultDB.entriesOfType('reminder')).filter(r => !r.done &&
    (r.date < today() || (r.date === today() && (!r.time || r.time <= nowTime))));
  let changed = false;
  for (const r of due) {
    const key = r.id + '@' + r.date;
    if (notified[key]) continue;
    const body = `${members[r.memberId] ? members[r.memberId].name + ' · ' : ''}${r.time || fmtDate(r.date)}`;
    try {
      const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration();
      if (reg) await reg.showNotification('⏰ ' + r.title, { body, tag: key, icon: 'icon-192.png' });
      else new Notification('⏰ ' + r.title, { body, tag: key });
    } catch (e) { console.warn(e); }
    notified[key] = true; changed = true;
  }
  if (changed) await VaultDB.setMeta('notified', notified);
}

async function updateNavBadge() {
  const b = bucket(await upcomingItems());
  const n = b.overdue.length + b.today.length;
  const dot = $('#remDot');
  dot.hidden = !n; dot.textContent = n;
}

// ---------------------------------------------------------------- charts
const METRICS = {
  weight: { label: 'Weight', unit: 'kg', series: [['weight', 'Weight']] },
  height: { label: 'Height', unit: 'cm', series: [['height', 'Height']] },
  bmi: { label: 'BMI', unit: '', series: [['bmi', 'BMI']] },
  bp: { label: 'BP', unit: 'mmHg', series: [['bpSys', 'Systolic'], ['bpDia', 'Diastolic']] },
  sugar: { label: 'Sugar', unit: 'mg/dL', series: [['sugarFasting', 'Fasting'], ['sugarPP', 'After food']] },
  pulse: { label: 'Pulse', unit: 'bpm', series: [['pulse', 'Pulse']] },
  spo2: { label: 'SpO₂', unit: '%', series: [['spo2', 'SpO₂']] },
  temperature: { label: 'Temp', unit: '°F', series: [['temperature', 'Temp']] },
  headCirc: { label: 'Head', unit: 'cm', series: [['headCirc', 'Head circ.']] }
};

function chartSvg(vitals, metric) {
  const m = METRICS[metric];
  const val = (v, k) => k === 'bmi' ? Number(bmi(v.height, v.weight)) : Number(v[k]);
  const series = m.series.map(([k, name]) => ({ name, pts: vitals.filter(v => v.date && val(v, k) > 0).map(v => ({ d: v.date, t: new Date(v.date).getTime(), v: val(v, k) })) }));
  const allPts = series.flatMap(s => s.pts);
  if (allPts.length < 1) return `<div class="empty">No ${m.label.toLowerCase()} readings yet.</div>`;

  // Draw at the real on-screen width so text isn't stretched on phones.
  const W = Math.max(260, Math.min(900, view.clientWidth - 64)), H = 220, L = 44, R = 14, T = 14, B = 30;
  let min = Math.min(...allPts.map(p => p.v)), max = Math.max(...allPts.map(p => p.v));
  const pad = (max - min) * 0.15 || Math.max(1, max * 0.05);
  min -= pad; max += pad;
  const t0 = Math.min(...allPts.map(p => p.t)), t1 = Math.max(...allPts.map(p => p.t));
  const x = t => t1 === t0 ? L + (W - L - R) / 2 : L + (t - t0) / (t1 - t0) * (W - L - R);
  const y = v => T + (max - v) / (max - min) * (H - T - B);

  let g = '';
  for (let i = 0; i <= 4; i++) {
    const v = max - (max - min) * i / 4, yy = y(v);
    g += `<line class="grid-line" x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}"/><text class="axis" x="${L - 6}" y="${yy + 4}" text-anchor="end">${v.toFixed(max - min < 10 ? 1 : 0)}</text>`;
  }
  const labelDates = [...new Set(allPts.map(p => p.d))].sort();
  const pick = labelDates.length <= 4 ? labelDates : [labelDates[0], labelDates[Math.floor(labelDates.length / 3)], labelDates[Math.floor(2 * labelDates.length / 3)], labelDates[labelDates.length - 1]];
  for (const d of pick) {
    const dt = new Date(d);
    const anchor = pick.length > 1 && d === pick[0] ? 'start' : pick.length > 1 && d === pick[pick.length - 1] ? 'end' : 'middle';
    g += `<text class="axis" x="${x(dt.getTime())}" y="${H - 8}" text-anchor="${anchor}">${dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' })}</text>`;
  }
  series.forEach((s, i) => {
    const cls = i ? 'b' : '';
    const pts = s.pts.sort((a, b) => a.t - b.t);
    if (pts.length > 1) g += `<polyline class="line ${cls}" points="${pts.map(p => `${x(p.t)},${y(p.v)}`).join(' ')}"/>`;
    g += pts.map(p => `<circle class="pt ${cls}" cx="${x(p.t)}" cy="${y(p.v)}" r="4"><title>${fmtDate(p.d)}: ${p.v} ${m.unit}</title></circle>`).join('');
  });
  const legend = series.length > 1 ? `<div class="row small muted" style="justify-content:center;gap:16px">${series.map((s, i) => `<span><span style="color:var(--${i ? 'brand-2' : 'brand'})">●</span> ${esc(s.name)}</span>`).join('')}</div>` : '';
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${m.label} trend">${g}</svg>${legend}`;
}

function latestVitals(vitals) {
  const sorted = vitals.slice().sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
  const latest = {};
  for (const v of sorted) for (const k of Object.keys(v)) if (v[k] !== '' && v[k] != null) latest[k] = { value: v[k], date: v.date };
  return latest;
}

// ================================================================ VIEWS
async function renderHome() {
  setHeader('Family Health Vault'); setNav('home');
  const members = await VaultDB.members();
  const entries = await VaultDB.all('entries');
  const items = await upcomingItems();
  const b = bucket(items);
  const memberMap = Object.fromEntries(members.map(m => [m.id, m]));
  const year = String(new Date().getFullYear());
  const spent = entries.filter(e => (e.type === 'bill' || e.type === 'visit') && (e.date || '').startsWith(year)).reduce((s, e) => s + Number(e.amount || 0), 0);
  const lastExport = await VaultDB.getMeta('lastExport');
  const staleDays = lastExport ? Math.floor((Date.now() - new Date(lastExport)) / 864e5) : null;

  const cards = [];
  for (const m of members) {
    const v = latestVitals(entries.filter(e => e.memberId === m.id && e.type === 'vital'));
    const allergies = entries.filter(e => e.memberId === m.id && e.type === 'allergy').length;
    cards.push(`<a class="member-card" href="#/m/${m.id}/overview">${await avatarHtml(m)}
      <div class="name">${esc(m.name)}</div>
      <div class="small muted">${esc([m.relation, ageText(m.dob)].filter(Boolean).join(' · '))}</div>
      <div class="chips" style="justify-content:center;margin-top:6px">
        ${m.bloodGroup ? `<span class="badge danger">🩸 ${esc(m.bloodGroup)}</span>` : ''}
        ${allergies ? `<span class="badge warn">⚠️ ${allergies}</span>` : ''}
      </div>
      ${v.weight || v.height ? `<div class="small muted" style="margin-top:6px">${[v.height && v.height.value + ' cm', v.weight && v.weight.value + ' kg'].filter(Boolean).join(' · ')}</div>` : ''}
    </a>`);
  }

  const dueNow = b.overdue.concat(b.today);
  view.innerHTML = `
    ${members.length && (staleDays === null || staleDays >= 7) ? `<div class="banner info"><span>🔄</span><span class="grow">${staleDays === null ? 'You haven\'t backed up yet.' : `Last backup was ${staleDays} days ago.`} Sync to keep your laptop and phone up to date.</span><a class="btn sm" href="#/sync">Sync</a></div>` : ''}
    ${dueNow.length ? `<div class="card"><h2>⏰ Due now <span class="badge danger">${dueNow.length}</span><span class="spacer"></span><a class="small" href="#/reminders">All</a></h2><div class="list">${await reminderRows(dueNow.slice(0, 5), memberMap)}</div></div>` : ''}
    <div class="grid stats" style="margin-bottom:14px">
      <div class="stat"><div class="label">Members</div><div class="value">${members.length}</div></div>
      <div class="stat"><div class="label">Records</div><div class="value">${entries.filter(e => e.type !== 'reminder').length}</div></div>
      <div class="stat"><div class="label">Spent ${year}</div><div class="value">${money(spent)}</div></div>
      <div class="stat"><div class="label">This week</div><div class="value">${b.week.length}</div><div class="hint">reminders</div></div>
    </div>
    <div class="card">
      <h2>👨‍👩‍👧‍👦 Family</h2>
      <div class="grid members">${cards.join('')}<a class="member-card add" href="#" data-act="add-member">+ Add member</a></div>
    </div>
    ${!members.length ? `<div class="card"><h2>👋 Welcome</h2><p class="muted">Start by adding each family member. Then record their vitals, allergies, conditions, doctor visits, reports and bills. Everything is stored only on this device — use <b>Sync</b> to copy it to your other device.</p><div class="actions"><button class="btn" data-act="add-member">Add first member</button><a class="btn secondary" href="#/sync">Import a backup</a></div></div>` : ''}
    ${b.week.length ? `<div class="card"><h2>📅 Coming up this week</h2><div class="list">${await reminderRows(b.week.slice(0, 6), memberMap)}</div></div>` : ''}
  `;
}

const MEMBER_TABS = [['overview', 'Overview'], ['vitals', 'Vitals'], ['history', 'Medical history'], ['visits', 'Visits & sickness'], ['documents', 'Reports & bills'], ['reminders', 'Reminders'], ['emergency', 'Emergency']];
let chartMetric = 'weight';

async function renderMember(id, tab = 'overview') {
  const m = await VaultDB.get('members', id);
  if (!m || m.deleted) { location.hash = '#/'; return; }
  setHeader(m.name, '#/'); setNav('home');
  const entries = await VaultDB.entriesFor(id);
  const of = type => sortByDateDesc(entries.filter(e => e.type === type));
  const vitals = entries.filter(e => e.type === 'vital');
  const lv = latestVitals(vitals);

  const head = `<div class="card"><div class="profile">${await avatarHtml(m, 'lg')}
    <div style="flex:1;min-width:0"><h2>${esc(m.name)}</h2>
      <div class="muted small">${esc([m.relation, ageText(m.dob) && 'Age ' + ageText(m.dob), m.gender].filter(Boolean).join(' · '))}</div>
      <div class="facts">${m.bloodGroup ? `<span class="badge danger">🩸 ${esc(m.bloodGroup)}</span>` : ''}${m.dob ? `<span class="badge">🎂 ${esc(fmtDate(m.dob))}</span>` : ''}</div>
    </div><button class="btn secondary sm no-print" data-act="edit-member">Edit</button></div></div>
    <nav class="tabs">${MEMBER_TABS.map(([k, l]) => `<a href="#/m/${id}/${k}" class="${k === tab ? 'active' : ''}">${l}</a>`).join('')}</nav>`;

  let body = '';
  const addBtn = type => `<button class="btn sm secondary" data-act="add" data-type="${type}">+ Add</button>`;
  const section = async (type, list) => {
    const t = TYPES[type];
    await withFileCounts(list);
    return `<div class="card"><h2>${t.icon} ${esc(t.plural || t.label)} <span class="badge">${list.length}</span><span class="spacer"></span>${addBtn(type)}</h2>
      <div class="list">${list.map(e => itemHtml(e)).join('') || `<div class="empty">None recorded</div>`}</div></div>`;
  };

  if (tab === 'overview') {
    const tile = (label, v, unit, hint) => `<div class="stat"><div class="label">${label}</div><div class="value">${v ? esc(v) + (unit ? ` <span class="small muted">${unit}</span>` : '') : '—'}</div>${hint ? `<div class="hint">${esc(hint)}</div>` : ''}</div>`;
    const bmiVal = lv.height && lv.weight ? bmi(lv.height.value, lv.weight.value) : '';
    const allergies = of('allergy'), conditions = of('condition').filter(c => c.status !== 'Resolved');
    const meds = of('medicine').filter(x => !x.endDate || x.endDate >= today());
    const upcoming = bucket(await upcomingItems(id));
    const next = upcoming.overdue.concat(upcoming.today, upcoming.week, upcoming.later).slice(0, 4);
    const recent = await withFileCounts(sortByDateDesc(entries.filter(e => ['visit', 'sickness', 'document', 'bill'].includes(e.type))).slice(0, 5));
    const info = [['📞 Mobile', m.phone], ['👨‍⚕️ Family doctor', [m.doctorName, m.doctorPhone].filter(Boolean).join(' · ')], ['🆘 Emergency', [m.emergencyName, m.emergencyPhone].filter(Boolean).join(' · ')], ['🛡️ Insurance', m.insurance], ['👶 Birth weight', m.birthWeight && m.birthWeight + ' kg'], ['♿ Special needs', m.disability], ['❤️ Organ donor', m.organDonor], ['📝 Notes', m.notes]].filter(r => r[1]);

    body = `
      <div class="grid stats" style="margin-bottom:14px">
        ${tile('Height', lv.height && lv.height.value, 'cm')}
        ${tile('Weight', lv.weight && lv.weight.value, 'kg', lv.weight && fmtDate(lv.weight.date))}
        ${tile('BMI', bmiVal, '', bmiLabel(bmiVal))}
        ${tile('BP', lv.bpSys && lv.bpDia ? `${lv.bpSys.value}/${lv.bpDia.value}` : '', 'mmHg', lv.bpSys && fmtDate(lv.bpSys.date))}
        ${tile('Sugar (F)', lv.sugarFasting && lv.sugarFasting.value, 'mg/dL', lv.sugarFasting && fmtDate(lv.sugarFasting.date))}
      </div>
      <div class="card"><h2>⚠️ Allergies & conditions</h2>
        <div class="chips">${allergies.map(a => `<span class="badge danger">${esc(a.name)}${a.severity ? ' · ' + esc(a.severity) : ''}</span>`).join('')}${conditions.map(c => `<span class="badge warn">${esc(c.name)}</span>`).join('') || (allergies.length ? '' : '<span class="muted small">No allergies or conditions recorded</span>')}</div>
      </div>
      <div class="card"><h2>💊 Current medicines <span class="spacer"></span>${addBtn('medicine')}</h2><div class="list">${meds.map(e => itemHtml(e)).join('') || '<div class="empty">No current medicines</div>'}</div></div>
      ${next.length ? `<div class="card"><h2>⏰ Upcoming</h2><div class="list">${await reminderRows(next, { [m.id]: m })}</div></div>` : ''}
      <div class="card"><h2>🕑 Recent visits, reports & bills</h2><div class="list">${recent.map(e => itemHtml(e)).join('') || '<div class="empty">Nothing yet</div>'}</div></div>
      ${info.length ? `<div class="card"><h2>ℹ️ Details</h2><dl class="kv">${info.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl></div>` : ''}
      <div class="actions no-print"><button class="btn secondary" data-act="add" data-type="vital">+ Vitals</button><button class="btn secondary" data-act="add" data-type="visit">+ Doctor visit</button><button class="btn secondary" data-act="add" data-type="document">+ Report</button><button class="btn secondary" data-act="add" data-type="bill">+ Bill</button><button class="btn secondary" onclick="print()">🖨️ Print summary</button></div>`;
  }

  else if (tab === 'vitals') {
    const used = Object.keys(METRICS).filter(k => METRICS[k].series.some(([f]) => f === 'bmi' ? vitals.some(v => bmi(v.height, v.weight)) : vitals.some(v => v[f])));
    if (used.length && !used.includes(chartMetric)) chartMetric = used[0];
    const sorted = sortByDateDesc(vitals);
    body = `
      <div class="card"><h2>📈 Trend<span class="spacer"></span>${addBtn('vital')}</h2>
        ${used.length ? `<div class="chart-tabs">${used.map(k => `<button data-act="chart" data-metric="${k}" class="${k === chartMetric ? 'active' : ''}">${METRICS[k].label}</button>`).join('')}</div>
        <div class="chart">${chartSvg(vitals, chartMetric)}</div>` : '<div class="empty">Record height, weight, BP or sugar to see trends here.</div>'}
      </div>
      <div class="card"><h2>❤️ All readings <span class="badge">${sorted.length}</span></h2>
        <div class="list">${sorted.map(e => itemHtml(e, { extra: m.dob ? `<div class="s">Age ${esc(ageText(m.dob, e.date))}</div>` : '' })).join('') || '<div class="empty">No readings yet</div>'}</div></div>`;
  }

  else if (TAB_GROUPS[tab]) {
    if (tab === 'documents') {
      const bills = of('bill'), visits = of('visit');
      const total = bills.concat(visits).reduce((s, e) => s + Number(e.amount || 0), 0);
      body = `<div class="grid stats" style="margin-bottom:14px"><div class="stat"><div class="label">Total medical spend</div><div class="value">${money(total)}</div><div class="hint">bills + doctor fees</div></div></div>`;
    }
    for (const type of TAB_GROUPS[tab]) body += await section(type, of(type));
  }

  else if (tab === 'reminders') {
    const b = bucket(await upcomingItems(id));
    const map = { [m.id]: m };
    const block = async (title, list) => list.length ? `<div class="card"><h2>${title} <span class="badge">${list.length}</span></h2><div class="list">${await reminderRows(list, map)}</div></div>` : '';
    body = `<div class="actions" style="margin-bottom:14px">${addBtn('reminder')}</div>
      ${await block('🔴 Overdue', b.overdue)}${await block('📌 Today', b.today)}${await block('📅 Next 7 days', b.week)}${await block('🗓️ Later', b.later)}${await block('✅ Done', b.done)}
      ${!b.overdue.length && !b.today.length && !b.week.length && !b.later.length && !b.done.length ? '<div class="card empty">No reminders. Add medicine, vaccination or check-up reminders.</div>' : ''}`;
  }

  else if (tab === 'emergency') {
    const allergies = of('allergy'), conditions = of('condition').filter(c => c.status !== 'Resolved');
    const meds = of('medicine').filter(x => !x.endDate || x.endDate >= today());
    const tel = p => p ? `<a href="tel:${esc(p.replace(/\s/g, ''))}">${esc(p)}</a>` : '';
    body = `<div class="ecard">
      <div class="head">${await avatarHtml(m)}<div><div class="t">Emergency medical info</div><div class="n">${esc(m.name)}</div><div class="small">${esc([ageText(m.dob) && 'Age ' + ageText(m.dob), m.gender, lv.weight && lv.weight.value + ' kg'].filter(Boolean).join(' · '))}</div></div>
        <div class="blood"><small>BLOOD</small>${esc(m.bloodGroup || '?')}</div></div>
      <div class="sec"><h4>⚠️ Allergies</h4>${allergies.map(a => `<div><b>${esc(a.name)}</b>${a.reaction ? ' — ' + esc(a.reaction) : ''}${a.severity ? ` <span class="badge danger">${esc(a.severity)}</span>` : ''}</div>`).join('') || '<div class="muted">None known</div>'}</div>
      <div class="sec"><h4>🩺 Conditions</h4>${conditions.map(c => `<div>${esc(c.name)}</div>`).join('') || '<div class="muted">None recorded</div>'}</div>
      <div class="sec"><h4>💊 Current medicines</h4>${meds.map(x => `<div>${esc(x.name)}${x.dosage ? ' — ' + esc(x.dosage) : ''}${x.frequency ? ', ' + esc(x.frequency) : ''}</div>`).join('') || '<div class="muted">None</div>'}</div>
      <div class="sec"><h4>🆘 Emergency contact</h4><div class="call">${esc(m.emergencyName || '—')} ${tel(m.emergencyPhone)}</div></div>
      ${m.doctorName || m.doctorPhone ? `<div class="sec"><h4>👨‍⚕️ Family doctor</h4><div class="call">${esc(m.doctorName || '')} ${tel(m.doctorPhone)}</div></div>` : ''}
      ${m.insurance ? `<div class="sec"><h4>🛡️ Insurance</h4><div>${esc(m.insurance)}</div></div>` : ''}
      ${m.organDonor === 'Yes' ? `<div class="sec"><h4>Organ donor</h4><div>Yes</div></div>` : ''}
    </div>
    <div class="actions no-print" style="margin-top:14px"><button class="btn" onclick="print()">🖨️ Print / save as PDF</button><button class="btn secondary" data-act="edit-member">Edit contacts</button></div>
    <p class="small muted no-print">Tip: take a screenshot of this card and keep it as your phone's lock-screen or in your wallet.</p>`;
  }

  view.innerHTML = head + body;
  view.dataset.member = id;
}

async function renderReminders() {
  setHeader('Reminders', '#/'); setNav('reminders');
  const members = await VaultDB.members();
  const map = Object.fromEntries(members.map(m => [m.id, m]));
  const b = bucket(await upcomingItems());
  const block = async (title, list) => list.length ? `<div class="card"><h2>${title} <span class="badge">${list.length}</span></h2><div class="list">${await reminderRows(list, map)}</div></div>` : '';
  const perm = 'Notification' in window ? Notification.permission : 'unsupported';
  view.innerHTML = `
    ${perm === 'default' ? `<div class="banner info"><span>🔔</span><span class="grow">Allow notifications so the app can alert you about due reminders when it's open.</span><button class="btn sm" data-act="notify">Allow</button></div>` : ''}
    <div class="actions" style="margin-bottom:14px">
      <button class="btn" data-act="add" data-type="reminder">+ New reminder</button>
      <button class="btn secondary" data-act="ics-all">📅 Add all to phone calendar</button>
    </div>
    ${await block('🔴 Overdue', b.overdue)}${await block('📌 Today', b.today)}${await block('📅 Next 7 days', b.week)}${await block('🗓️ Later', b.later)}${await block('✅ Done', b.done.slice(0, 20))}
    ${!members.length ? '<div class="card empty">Add a family member first.</div>' : (!b.overdue.length && !b.today.length && !b.week.length && !b.later.length && !b.done.length ? '<div class="card empty">No reminders yet.<br>Add medicine, vaccination, check-up or refill reminders.</div>' : '')}
    <p class="small muted">Reminders show here and on the home screen. For alarms even when the app is closed, use <b>Add all to phone calendar</b> — your phone's calendar will ring at the set time. Vaccination "next dose" dates and doctor follow-ups appear here automatically.</p>`;
}

let installPrompt = null;
async function renderSync() {
  setHeader('Backup & Sync', '#/'); setNav('sync');
  const device = await VaultBackup.deviceName();
  const lastExport = await VaultDB.getMeta('lastExport');
  const lastImport = await VaultDB.getMeta('lastImport');
  const members = await VaultDB.members();
  const entries = await VaultDB.all('entries');
  const files = await VaultDB.all('attachments');
  let usage = '';
  if (navigator.storage && navigator.storage.estimate) {
    const est = await navigator.storage.estimate();
    usage = `${(est.usage / 1048576).toFixed(1)} MB used`;
  }
  const isStandalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;

  view.innerHTML = `
    <div class="card">
      <h2>🔄 How to sync laptop ⇄ phone</h2>
      <ol class="steps small">
        <li>On the device where you added new records, tap <b>Export backup</b>.</li>
        <li>Send the file to your other device — OneDrive, Google Drive, WhatsApp "message yourself", Bluetooth or USB.</li>
        <li>On the other device, tap <b>Import backup</b> and choose that file.</li>
      </ol>
      <p class="small muted">Import <b>merges</b>: new records are added, edited records keep the latest version, deletions carry over. Nothing is overwritten blindly. To make both identical, do it both ways: phone → laptop, then laptop → phone.</p>
    </div>

    <div class="card">
      <h2>📤 Export backup</h2>
      <form class="form" id="exf">
        <div class="f half"><label>This device's name</label><div class="input-wrap"><input id="devName" value="${esc(device)}"></div></div>
        <div class="f half"><label>Password (optional, recommended)</label><div class="input-wrap"><input id="expw" type="password" autocomplete="new-password" placeholder="Lock the file"></div></div>
        <div class="f"><div class="actions">
          ${navigator.canShare ? '<button type="button" class="btn big" data-act="export-share">📲 Export & share</button>' : ''}
          <button type="button" class="btn ${navigator.canShare ? 'secondary' : ''} big" data-act="export-dl">💾 Export & save file</button>
        </div></div>
      </form>
      <p class="small muted" style="margin-top:10px">If you set a password you'll need it to import the file. Use one you won't forget — it can't be recovered.</p>
    </div>

    <div class="card">
      <h2>📥 Import backup</h2>
      <p class="small muted">Choose a backup file exported from your other device (or an old Phase 1 backup).</p>
      <label class="btn big block">📂 Choose backup file<input type="file" id="impf" accept=".json,application/json" hidden></label>
    </div>

    <div class="card">
      <h2>📊 On this device</h2>
      <dl class="kv">
        <dt>Members</dt><dd>${members.length}</dd>
        <dt>Records</dt><dd>${entries.length}</dd>
        <dt>Photos / files</dt><dd>${files.length}${usage ? ` · ${usage}` : ''}</dd>
        <dt>Last export</dt><dd>${lastExport ? new Date(lastExport).toLocaleString('en-IN') : 'Never'}</dd>
        <dt>Last import</dt><dd>${lastImport ? `${new Date(lastImport.at).toLocaleString('en-IN')} (from ${esc(lastImport.from)})` : 'Never'}</dd>
      </dl>
    </div>

    <div class="card">
      <h2>📱 Install as an app</h2>
      ${isStandalone ? '<p class="small">✅ Installed — you\'re using the app version.</p>' : `
      <p class="small muted">Install it so it opens like a normal app and works without internet.</p>
      ${installPrompt ? '<button class="btn" data-act="install">Install app</button>' : `<ul class="steps small">
        <li><b>Android (Chrome):</b> menu ⋮ → <i>Add to Home screen</i> / <i>Install app</i></li>
        <li><b>iPhone (Safari):</b> Share ⬆ → <i>Add to Home Screen</i></li>
        <li><b>Laptop (Chrome / Edge):</b> install icon at the right of the address bar</li></ul>`}`}
    </div>
    <p class="small muted center">All data stays on this device. Nothing is uploaded anywhere.</p>`;

  $('#devName').onchange = async ev => { await VaultDB.setMeta('deviceName', ev.target.value.trim() || 'Device'); toast('Device name saved'); };
  $('#impf').onchange = async ev => {
    const file = ev.target.files[0]; ev.target.value = '';
    if (!file) return;
    try {
      const res = await VaultBackup.importBackup(file, () => askPassword());
      urlCache.clear();
      toast(res.legacy ? `Imported ${res.added} items from Phase 1 backup ✓` : `Synced ✓ ${res.added} new, ${res.updated} updated, ${res.unchanged} unchanged`, 5000);
      route();
    } catch (e) { toast('⚠️ ' + e.message, 5000); }
  };
}

async function doExport(share) {
  const pw = $('#expw').value;
  try {
    const file = await VaultBackup.exportFile(pw);
    if (share && navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: 'Family Health Vault backup' }); }
      catch (e) { if (e.name === 'AbortError') return; throw e; }
    } else {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(file); a.download = file.name; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 3000);
    }
    toast(`Backup ready: ${file.name}`, 4000);
    route();
  } catch (e) { toast('⚠️ Export failed: ' + e.message, 5000); }
}

// ================================================================ router & events
async function route() {
  const token = ++routeToken;
  const parts = location.hash.replace(/^#\/?/, '').split('/');
  try {
    if (parts[0] === 'm' && parts[1]) await renderMember(parts[1], parts[2] || 'overview');
    else if (parts[0] === 'reminders') await renderReminders();
    else if (parts[0] === 'sync') await renderSync();
    else await renderHome();
  } catch (e) {
    console.error(e);
    view.innerHTML = `<div class="banner danger">Something went wrong: ${esc(e.message)}</div>`;
  }
  if (token === routeToken) updateNavBadge();
}

document.addEventListener('click', async ev => {
  const el = ev.target.closest('[data-act]');
  if (!el || el.closest('dialog')) return;
  const act = el.dataset.act;
  const memberId = view.dataset.member && location.hash.startsWith('#/m/') ? view.dataset.member : null;
  if (act === 'done') { ev.stopPropagation(); return markReminderDone(el.dataset.id); }
  ev.preventDefault();
  switch (act) {
    case 'open': return openEntry(el.dataset.id);
    case 'add': return openEntryForm(el.dataset.type, memberId);
    case 'add-member': return openMemberForm();
    case 'edit-member': return openMemberForm(await VaultDB.get('members', memberId));
    case 'chart': chartMetric = el.dataset.metric; return route();
    case 'export-share': return doExport(true);
    case 'export-dl': return doExport(false);
    case 'notify': await Notification.requestPermission(); checkNotifications(); return route();
    case 'ics-all': {
      const r = (await VaultDB.entriesOfType('reminder')).filter(x => !x.done);
      if (!r.length) return toast('No open reminders to add');
      return downloadIcs(r, await VaultDB.members());
    }
    case 'install':
      if (installPrompt) { installPrompt.prompt(); await installPrompt.userChoice; installPrompt = null; route(); }
      return;
  }
});

$('#fab').onclick = async () => {
  const memberId = location.hash.startsWith('#/m/') ? view.dataset.member : null;
  const tab = location.hash.split('/')[3] || 'overview';
  if (location.hash.startsWith('#/reminders')) return openEntryForm('reminder', null);
  if (!memberId) return openMemberForm();
  const defaults = { vitals: 'vital', reminders: 'reminder' };
  if (defaults[tab]) return openEntryForm(defaults[tab], memberId);
  // Otherwise ask what to add.
  const types = tab === 'history' ? TAB_GROUPS.history : tab === 'visits' ? TAB_GROUPS.visits : tab === 'documents' ? TAB_GROUPS.documents : ['vital', 'visit', 'sickness', 'document', 'bill', 'medicine', 'allergy', 'condition', 'vaccine', 'surgery', 'family', 'reminder'];
  const pick = await openDialog(`<header><h3>Add record</h3><button class="close" data-close>×</button></header>
    <div class="content"><div class="list">${types.map(t => `<div class="item" data-pick="${t}"><div class="ic">${TYPES[t].icon}</div><div class="body"><div class="t">${esc(TYPES[t].label)}</div></div></div>`).join('')}</div></div>`,
    { onOpen: dlg => dlg.addEventListener('click', ev => { const p = ev.target.closest('[data-pick]'); if (p) dlg.done(p.dataset.pick); }) });
  if (pick) openEntryForm(pick, memberId);
};

window.addEventListener('hashchange', () => { route(); window.scrollTo(0, 0); });
let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (document.querySelector('.chart svg') && !document.querySelector('dialog[open]')) route(); }, 300);
});
window.addEventListener('beforeinstallprompt', ev => { ev.preventDefault(); installPrompt = ev; });
document.addEventListener('visibilitychange', () => { if (!document.hidden) { checkNotifications(); updateNavBadge(); } });
setInterval(checkNotifications, 60000);

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(e => console.warn('Service worker not registered', e));
}

route();
checkNotifications();
