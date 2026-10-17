# Sudhars Family Health Vault — Phase 2

An offline family health app that works on both the laptop and the phone.
All data stays on each device and nothing is uploaded.

## What it records (per family member)
- **Profile:** photo, DOB/age, gender, blood group, mobile, birth weight, family doctor, emergency contact, insurance, organ donor, special needs
- **Vitals with charts:** height, weight, BMI, BP, sugar (fasting / after food), pulse, SpO₂, temperature, head circumference for kids
- **Medical history:** allergies, chronic conditions, current medicines, vaccinations (with next-dose dates), surgeries, family / genetic history
- **Visits & sickness:** doctor visits (diagnosis, medicines, fees, follow-up), sickness episodes
- **Reports & bills:** lab reports, scans and prescriptions as photos or PDFs, bills with a running total
- **Reminders:** medicines, vaccinations, check-ups; daily / weekly / monthly / yearly. "Add to phone calendar" gives real alarms.
- **Emergency card:** blood group, allergies, medicines and contacts on one printable card

## Syncing laptop ⇄ phone
1. **Sync** tab → **Export backup** (setting a password is recommended).
2. Send the file to the other device (OneDrive, WhatsApp to yourself, USB).
3. On the other device: **Sync** tab → **Import backup**.

Import *merges*: the newest version of each record wins and deletions carry over.
Old Phase 1 backups (`family-health-vault-backup.json`) can be imported too.

## Running it
- **Laptop:** double-click `start-vault.bat`, or open the hosted link once it's online.
- **Phone:** the app must be opened from an `https://` link to install and work offline (for example from GitHub Pages or Netlify).
  Open the link in Chrome → ⋮ → *Install app*. Hosting puts only the app's code online; your health data never leaves the phone.

## Files
`index.html` · `css/app.css` · `js/types.js` (record kinds and fields) · `js/db.js` (storage) ·
`js/backup.js` (export / import / merge) · `js/app.js` (screens) · `sw.js` (offline) · `manifest.webmanifest`

When you change any app file, bump `CACHE` in `sw.js` so installed copies update.
