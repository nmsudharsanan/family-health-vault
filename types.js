'use strict';
/**
 * Every kind of health entry the vault stores. Forms, lists and the backup
 * all work from this table, so adding a new kind of record = adding one
 * entry here.
 *
 * field: { key, label, type: text|number|date|time|select|textarea, options,
 *          required, step, unit, placeholder, half (half-width on wide screens) }
 */
const RELATIONS = ['Self', 'Spouse', 'Father', 'Mother', 'Son', 'Daughter', 'Brother', 'Sister',
  'Grandfather', 'Grandmother', 'Grandson', 'Granddaughter', 'Father-in-law', 'Mother-in-law', 'Other'];
const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'Unknown'];
const GENDERS = ['Male', 'Female', 'Other'];

const TYPES = {
  vital: {
    label: 'Vitals', icon: '❤️', dateKey: 'date', attachments: false,
    fields: [
      { key: 'date', label: 'Date', type: 'date', required: true, half: true },
      { key: 'time', label: 'Time', type: 'time', half: true },
      { key: 'height', label: 'Height', type: 'number', unit: 'cm', step: '0.1', half: true },
      { key: 'weight', label: 'Weight', type: 'number', unit: 'kg', step: '0.1', half: true },
      { key: 'bpSys', label: 'BP systolic (upper)', type: 'number', unit: 'mmHg', half: true },
      { key: 'bpDia', label: 'BP diastolic (lower)', type: 'number', unit: 'mmHg', half: true },
      { key: 'sugarFasting', label: 'Sugar – fasting', type: 'number', unit: 'mg/dL', half: true },
      { key: 'sugarPP', label: 'Sugar – after food', type: 'number', unit: 'mg/dL', half: true },
      { key: 'pulse', label: 'Pulse', type: 'number', unit: 'bpm', half: true },
      { key: 'spo2', label: 'SpO₂', type: 'number', unit: '%', half: true },
      { key: 'temperature', label: 'Temperature', type: 'number', unit: '°F', step: '0.1', half: true },
      { key: 'headCirc', label: 'Head circumference (kids)', type: 'number', unit: 'cm', step: '0.1', half: true },
      { key: 'notes', label: 'Notes', type: 'textarea' }
    ],
    summary: e => {
      const parts = [];
      if (e.height) parts.push(`${e.height} cm`);
      if (e.weight) parts.push(`${e.weight} kg`);
      const b = bmi(e.height, e.weight); if (b) parts.push(`BMI ${b}`);
      if (e.bpSys && e.bpDia) parts.push(`BP ${e.bpSys}/${e.bpDia}`);
      if (e.sugarFasting) parts.push(`FBS ${e.sugarFasting}`);
      if (e.sugarPP) parts.push(`PPBS ${e.sugarPP}`);
      if (e.pulse) parts.push(`Pulse ${e.pulse}`);
      if (e.spo2) parts.push(`SpO₂ ${e.spo2}%`);
      if (e.temperature) parts.push(`${e.temperature}°F`);
      return { title: parts.join(' · ') || 'Vitals', sub: e.notes };
    }
  },

  allergy: {
    label: 'Allergy', plural: 'Allergies', icon: '⚠️', dateKey: 'since',
    fields: [
      { key: 'name', label: 'Allergic to', type: 'text', required: true, placeholder: 'e.g. Penicillin, peanuts, dust' },
      { key: 'reaction', label: 'Reaction', type: 'text', placeholder: 'e.g. rash, breathing difficulty' },
      { key: 'severity', label: 'Severity', type: 'select', options: ['Mild', 'Moderate', 'Severe'], half: true },
      { key: 'since', label: 'Noticed on', type: 'date', half: true },
      { key: 'notes', label: 'Notes', type: 'textarea' }
    ],
    summary: e => ({ title: e.name, sub: [e.reaction, e.notes].filter(Boolean).join(' — '), badge: e.severity, badgeKind: e.severity === 'Severe' ? 'danger' : e.severity === 'Moderate' ? 'warn' : '' })
  },

  condition: {
    label: 'Condition', plural: 'Chronic conditions', icon: '🩺', dateKey: 'since',
    fields: [
      { key: 'name', label: 'Condition', type: 'text', required: true, placeholder: 'e.g. Diabetes type 2, Asthma, Thyroid' },
      { key: 'since', label: 'Diagnosed on', type: 'date', half: true },
      { key: 'status', label: 'Status', type: 'select', options: ['Active', 'Controlled', 'Resolved'], half: true },
      { key: 'doctor', label: 'Treating doctor', type: 'text' },
      { key: 'notes', label: 'Notes', type: 'textarea' }
    ],
    summary: e => ({ title: e.name, sub: [e.doctor && `Dr. ${e.doctor}`, e.notes].filter(Boolean).join(' — '), badge: e.status, badgeKind: e.status === 'Active' ? 'warn' : e.status === 'Resolved' ? 'ok' : '' })
  },

  medicine: {
    label: 'Medicine', plural: 'Medicines', icon: '💊', dateKey: 'startDate',
    fields: [
      { key: 'name', label: 'Medicine name', type: 'text', required: true },
      { key: 'dosage', label: 'Dosage', type: 'text', placeholder: 'e.g. 500 mg, 1 tablet', half: true },
      { key: 'frequency', label: 'How often', type: 'select', options: ['Once daily', 'Twice daily', 'Three times daily', 'At night', 'Before food', 'After food', 'Weekly', 'As needed'], half: true },
      { key: 'startDate', label: 'Started on', type: 'date', half: true },
      { key: 'endDate', label: 'Stop on (blank = ongoing)', type: 'date', half: true },
      { key: 'purpose', label: 'For', type: 'text', placeholder: 'e.g. BP, thyroid' },
      { key: 'notes', label: 'Notes', type: 'textarea' }
    ],
    summary: e => {
      const active = !e.endDate || e.endDate >= today();
      return { title: e.name + (e.dosage ? ` · ${e.dosage}` : ''), sub: [e.frequency, e.purpose && `for ${e.purpose}`].filter(Boolean).join(' — '), badge: active ? 'Taking' : 'Stopped', badgeKind: active ? 'ok' : '' };
    }
  },

  vaccine: {
    label: 'Vaccination', plural: 'Vaccinations', icon: '💉', dateKey: 'date', attachments: true,
    fields: [
      { key: 'name', label: 'Vaccine', type: 'text', required: true, placeholder: 'e.g. BCG, MMR, Hepatitis B, Covid, Flu' },
      { key: 'dose', label: 'Dose', type: 'text', placeholder: 'e.g. 1st, Booster', half: true },
      { key: 'date', label: 'Given on', type: 'date', half: true },
      { key: 'nextDue', label: 'Next dose due', type: 'date', half: true },
      { key: 'place', label: 'Hospital / clinic', type: 'text', half: true },
      { key: 'notes', label: 'Notes', type: 'textarea' }
    ],
    summary: e => ({ title: e.name + (e.dose ? ` (${e.dose})` : ''), sub: [e.place, e.nextDue && `Next due ${fmtDate(e.nextDue)}`].filter(Boolean).join(' — '), badge: e.nextDue && e.nextDue >= today() ? 'Due ' + fmtDate(e.nextDue) : '', badgeKind: 'warn' })
  },

  surgery: {
    label: 'Surgery / procedure', plural: 'Surgeries & procedures', icon: '🏥', dateKey: 'date', attachments: true,
    fields: [
      { key: 'name', label: 'Surgery / procedure', type: 'text', required: true },
      { key: 'date', label: 'Date', type: 'date', half: true },
      { key: 'hospital', label: 'Hospital', type: 'text', half: true },
      { key: 'doctor', label: 'Surgeon', type: 'text' },
      { key: 'notes', label: 'Notes', type: 'textarea' }
    ],
    summary: e => ({ title: e.name, sub: [e.hospital, e.doctor && `Dr. ${e.doctor}`].filter(Boolean).join(' — ') })
  },

  family: {
    label: 'Family / genetic history', plural: 'Family & genetic history', icon: '🧬', dateKey: null,
    fields: [
      { key: 'relative', label: 'Relative', type: 'select', options: ['Father', 'Mother', 'Paternal grandfather', 'Paternal grandmother', 'Maternal grandfather', 'Maternal grandmother', 'Brother', 'Sister', 'Uncle / Aunt', 'Other'], required: true, half: true },
      { key: 'condition', label: 'Condition', type: 'text', required: true, placeholder: 'e.g. Diabetes, heart disease', half: true },
      { key: 'notes', label: 'Notes (age of onset, etc.)', type: 'textarea' }
    ],
    summary: e => ({ title: e.condition, sub: [e.relative, e.notes].filter(Boolean).join(' — ') })
  },

  visit: {
    label: 'Doctor visit', plural: 'Doctor visits', icon: '👨‍⚕️', dateKey: 'date', attachments: true,
    fields: [
      { key: 'date', label: 'Visit date', type: 'date', required: true, half: true },
      { key: 'doctor', label: 'Doctor', type: 'text', half: true },
      { key: 'hospital', label: 'Hospital / clinic', type: 'text' },
      { key: 'reason', label: 'Reason / symptoms', type: 'text' },
      { key: 'diagnosis', label: 'Diagnosis', type: 'text' },
      { key: 'medicines', label: 'Medicines prescribed', type: 'textarea', placeholder: 'Paracetamol 500 – 3 days\nCetirizine – 5 days' },
      { key: 'amount', label: 'Fees / bill', type: 'number', unit: '₹', half: true },
      { key: 'followUp', label: 'Follow-up on', type: 'date', half: true },
      { key: 'notes', label: 'Notes', type: 'textarea' }
    ],
    summary: e => ({ title: e.diagnosis || e.reason || 'Doctor visit', sub: [e.doctor && `Dr. ${e.doctor}`, e.hospital].filter(Boolean).join(' — '), badge: e.amount ? money(e.amount) : '' })
  },

  sickness: {
    label: 'Sickness episode', plural: 'Sickness episodes', icon: '🤒', dateKey: 'startDate', attachments: true,
    fields: [
      { key: 'name', label: 'Sickness', type: 'text', required: true, placeholder: 'e.g. Fever, cold, viral infection' },
      { key: 'startDate', label: 'Started', type: 'date', required: true, half: true },
      { key: 'endDate', label: 'Recovered', type: 'date', half: true },
      { key: 'symptoms', label: 'Symptoms', type: 'text' },
      { key: 'treatment', label: 'Treatment / medicines', type: 'textarea' },
      { key: 'notes', label: 'Notes', type: 'textarea' }
    ],
    summary: e => ({ title: e.name, sub: [e.symptoms, e.endDate ? `${days(e.startDate, e.endDate)} days` : 'Ongoing'].filter(Boolean).join(' — '), badge: e.endDate ? '' : 'Ongoing', badgeKind: 'warn' })
  },

  document: {
    label: 'Report / document', plural: 'Reports & documents', icon: '📄', dateKey: 'date', attachments: true,
    fields: [
      { key: 'title', label: 'Title', type: 'text', required: true, placeholder: 'e.g. Blood test, X-ray chest, Prescription' },
      { key: 'category', label: 'Type', type: 'select', options: ['Lab report', 'Scan / X-ray', 'Prescription', 'Discharge summary', 'Insurance', 'Certificate', 'Other'], half: true },
      { key: 'date', label: 'Date', type: 'date', required: true, half: true },
      { key: 'notes', label: 'Notes / key results', type: 'textarea' }
    ],
    summary: e => ({ title: e.title, sub: e.notes, badge: e.category })
  },

  bill: {
    label: 'Bill', plural: 'Bills', icon: '🧾', dateKey: 'date', attachments: true,
    fields: [
      { key: 'title', label: 'For', type: 'text', required: true, placeholder: 'e.g. Pharmacy, Lab test, Hospital' },
      { key: 'date', label: 'Date', type: 'date', required: true, half: true },
      { key: 'amount', label: 'Amount', type: 'number', unit: '₹', required: true, half: true },
      { key: 'paidTo', label: 'Paid to', type: 'text', half: true },
      { key: 'insurance', label: 'Insurance claim', type: 'select', options: ['Not claimed', 'Claimed', 'Reimbursed'], half: true },
      { key: 'notes', label: 'Notes', type: 'textarea' }
    ],
    summary: e => ({ title: e.title, sub: [e.paidTo, e.insurance && e.insurance !== 'Not claimed' ? e.insurance : ''].filter(Boolean).join(' — '), badge: money(e.amount) })
  },

  reminder: {
    label: 'Reminder', plural: 'Reminders', icon: '⏰', dateKey: 'date',
    fields: [
      { key: 'title', label: 'Remind me to', type: 'text', required: true, placeholder: 'e.g. Give thyroid tablet, Polio drops, BP check-up' },
      { key: 'kind', label: 'Type', type: 'select', options: ['Medicine', 'Vaccination', 'Check-up', 'Test', 'Refill', 'Other'], half: true },
      { key: 'repeat', label: 'Repeat', type: 'select', options: ['Never', 'Daily', 'Weekly', 'Monthly', 'Every 3 months', 'Every 6 months', 'Yearly'], half: true },
      { key: 'date', label: 'Date', type: 'date', required: true, half: true },
      { key: 'time', label: 'Time', type: 'time', half: true },
      { key: 'notes', label: 'Notes', type: 'textarea' }
    ],
    summary: e => ({ title: e.title, sub: [e.kind, e.repeat && e.repeat !== 'Never' ? `Repeats ${e.repeat.toLowerCase()}` : '', e.notes].filter(Boolean).join(' — ') })
  }
};

// Which entry types appear on which member tab.
const TAB_GROUPS = {
  history: ['allergy', 'condition', 'medicine', 'vaccine', 'surgery', 'family'],
  visits: ['visit', 'sickness'],
  documents: ['document', 'bill']
};

// ---- small shared helpers ----------------------------------------------
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function addMonths(iso, n) {
  const d = new Date(iso + 'T00:00:00'); const day = d.getDate();
  d.setDate(1); d.setMonth(d.getMonth() + n);
  d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function days(a, b) { return Math.round((new Date(b) - new Date(a)) / 864e5) + 1; }
function bmi(h, w) {
  h = Number(h); w = Number(w);
  return h > 0 && w > 0 ? (w / ((h / 100) ** 2)).toFixed(1) : '';
}
function bmiLabel(v) {
  v = Number(v); if (!v) return '';
  return v < 18.5 ? 'Underweight' : v < 25 ? 'Normal' : v < 30 ? 'Overweight' : 'Obese';
}
function ageText(dob, at) {
  if (!dob) return '';
  const d = new Date(dob + 'T00:00:00'), n = at ? new Date(at + 'T00:00:00') : new Date();
  let months = (n.getFullYear() - d.getFullYear()) * 12 + n.getMonth() - d.getMonth();
  if (n.getDate() < d.getDate()) months--;
  if (months < 0) return '';
  if (months < 24) return `${months} mo`;
  return `${Math.floor(months / 12)} yrs`;
}
function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  return isNaN(d) ? iso : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
function money(n) { return n === '' || n == null ? '' : '₹' + Number(n).toLocaleString('en-IN'); }
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function entryDate(e) { const k = TYPES[e.type] && TYPES[e.type].dateKey; return (k && e[k]) || ''; }
