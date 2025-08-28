#!/usr/bin/env node
// Deletes files in uploads/ older than the configured age (minutes)
const fs = require('fs');
const path = require('path');

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
const AGE_MINUTES = process.env.AGE_MINUTES ? parseInt(process.env.AGE_MINUTES, 10) : 60; // default 60 minutes

if (!fs.existsSync(UPLOADS_DIR)) {
  console.log('Uploads directory not found, nothing to clean:', UPLOADS_DIR);
  process.exit(0);
}

const now = Date.now();
const ageMs = AGE_MINUTES * 60 * 1000;

let removed = 0;
fs.readdirSync(UPLOADS_DIR).forEach((f) => {
  const p = path.join(UPLOADS_DIR, f);
  try {
    const st = fs.statSync(p);
    if (now - st.mtimeMs > ageMs) {
      fs.unlinkSync(p);
      console.log('Removed', p);
      removed++;
    }
  } catch (e) {
    console.warn('Could not remove', p, e.message || e);
  }
});

console.log(`Done. Removed ${removed} files older than ${AGE_MINUTES} minutes.`);
