#!/usr/bin/env node
// Builds the deployment package in .deploy/ (spec 004 R61) and optionally verifies it.
//
//   node scripts/package.js           # assemble .deploy/ (expects `npm run build` first)
//   node scripts/package.js --check   # assemble, then verify contents; exit 1 on violation
//
// ALLOWLIST, not denylist: only the entries named in INCLUDE are copied, so a new file in the
// repo can never be shipped by accident. (.funcignore remains for `func azure functionapp publish`.)
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const out = path.join(root, '.deploy');
const INCLUDE = ['dist', 'host.json', 'package.json', 'package-lock.json'];
const DEV_PACKAGES = ['vitest', 'azurite', 'typescript'];
const FORBIDDEN_TOP_LEVEL = ['src', 'test', 'specs', 'scripts', 'infra', 'docs', '.azurite', '.github'];

function assemble() {
  if (!fs.existsSync(path.join(root, 'dist', 'src', 'functions'))) {
    fail('dist/src/functions not found — run `npm run build` first');
  }
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out);
  for (const entry of INCLUDE) {
    fs.cpSync(path.join(root, entry), path.join(out, entry), { recursive: true });
  }
  // Production dependencies only; --ignore-scripts: nothing from node_modules runs at package time.
  execSync('npm ci --omit=dev --ignore-scripts --no-audit --no-fund', { cwd: out, stdio: 'inherit' });
}

function check() {
  const problems = [];
  const top = fs.readdirSync(out);

  for (const required of ['dist', 'host.json', 'package.json', 'node_modules']) {
    if (!top.includes(required)) problems.push(`missing required entry: ${required}`);
  }
  for (const name of top) {
    if (FORBIDDEN_TOP_LEVEL.includes(name)) problems.push(`forbidden top-level entry: ${name}`);
    if (/^local\.settings.*\.json$/.test(name)) problems.push(`forbidden settings file: ${name}`);
  }
  for (const pkg of DEV_PACKAGES) {
    if (fs.existsSync(path.join(out, 'node_modules', pkg))) problems.push(`dev dependency shipped: ${pkg}`);
  }
  // TypeScript sources anywhere outside node_modules (declaration files inside packages are fine).
  walk(out, (file) => {
    const rel = path.relative(out, file).split(path.sep).join('/');
    if (rel.startsWith('node_modules/')) return;
    if (rel.endsWith('.ts') && !rel.endsWith('.d.ts')) problems.push(`TypeScript source shipped: ${rel}`);
    if (rel.endsWith('.test.js')) problems.push(`test file shipped: ${rel}`);
  });

  if (problems.length) {
    console.error(`\nR61 package check FAILED (${problems.length}):`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  const prodDeps = fs.readdirSync(path.join(out, 'node_modules')).filter((n) => !n.startsWith('.'));
  console.log(`\nR61 package check passed. Top level: ${top.sort().join(', ')}`);
  console.log(`node_modules entries: ${prodDeps.length} (dev packages absent: ${DEV_PACKAGES.join(', ')})`);
}

function walk(dir, visit) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, visit);
    else visit(full);
  }
}

function fail(msg) {
  console.error(`package: ${msg}`);
  process.exit(1);
}

const checkOnly = process.argv.includes('--check-only'); // verify an existing .deploy/ without rebuilding
if (!checkOnly) assemble();
if (checkOnly || process.argv.includes('--check')) check();
