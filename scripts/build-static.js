#!/usr/bin/env node
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');

const toCopy = [
  'index.html',
  'sketch.js',
  'style.css',
  'fiveserver.config.js',
  'jsconfig.json',
  'libraries',
];

async function exists(p) {
  try { await fsp.access(p); return true; } catch(e) { return false; }
}

async function rmDir(p) {
  if (!await exists(p)) return;
  // Node 16+ supports rm with recursive; fall back to recursive rmdir
  try {
    await fsp.rm(p, { recursive: true, force: true });
  } catch (e) {
    // fallback
    const rimraf = async dir => {
      const entries = await fsp.readdir(dir, { withFileTypes: true });
      await Promise.all(entries.map(e => {
        const full = path.join(dir, e.name);
        return e.isDirectory() ? rimraf(full) : fsp.unlink(full);
      }));
      await fsp.rmdir(dir);
    };
    await rimraf(p);
  }
}

async function copyRecursive(src, dest) {
  const stat = await fsp.stat(src);
  if (stat.isDirectory()) {
    await fsp.mkdir(dest, { recursive: true });
    const entries = await fsp.readdir(src);
    for (const name of entries) {
      await copyRecursive(path.join(src, name), path.join(dest, name));
    }
  } else {
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.copyFile(src, dest);
  }
}

(async function build() {
  try {
    await rmDir(dist);
    await fsp.mkdir(dist, { recursive: true });
    for (const item of toCopy) {
      const src = path.join(root, item);
      if (!await exists(src)) {
        console.warn('Skipping missing:', item);
        continue;
      }
      const dest = path.join(dist, item);
      await copyRecursive(src, dest);
      console.log('Copied', item);
    }
    console.log('\nBuild complete. Upload the contents of the "dist" folder to your webserver.');
    console.log('dist path:', dist);
  } catch (err) {
    console.error('Build failed:', err);
    process.exitCode = 2;
  }
})();
