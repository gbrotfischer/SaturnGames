#!/usr/bin/env node
const fsp = require('fs/promises');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const DIST_DIR = path.join(ROOT, 'dist');

async function main() {
  await cleanDir(DIST_DIR);
  await copyDir(PUBLIC_DIR, DIST_DIR);
  await writeClientEnv();
  console.log('Build completed. Output in dist/.');
}

async function cleanDir(dir) {
  await fsp.rm(dir, { recursive: true, force: true });
  await fsp.mkdir(dir, { recursive: true });
}

async function copyDir(src, dest) {
  const entries = await fsp.readdir(src, { withFileTypes: true });
  await Promise.all(entries.map(async (entry) => {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await fsp.mkdir(destPath, { recursive: true });
      await copyDir(srcPath, destPath);
    } else if (entry.isFile()) {
      await fsp.copyFile(srcPath, destPath);
    }
  }));
}

async function writeClientEnv() {
  const clientEnv = {
    SUPABASE_URL: process.env.SUPABASE_URL || '',
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || '',
    STRIPE_PUBLISHABLE_KEY: process.env.STRIPE_PUBLISHABLE_KEY || '',
    BASE_URL: process.env.BASE_URL || ''
  };

  const file = path.join(DIST_DIR, 'env.js');
  const contents = `window.__ENV = ${JSON.stringify(clientEnv)};\n`;
  await fsp.writeFile(file, contents, 'utf8');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
