'use strict';

/**
 * Testläufer: führt alle Dateien in tests/suites aus und fasst zusammen.
 *
 * Aufruf:  npm test
 *          npm test -- qrcode      (nur passende Suiten)
 */
const fs = require('fs');
const path = require('path');

const SUITE_DIR = path.join(__dirname, 'suites');

/** Sammelt Prüfungen und meldet Fehler, ohne den Lauf abzubrechen. */
class Check {
  constructor(name) {
    this.name = name;
    this.passed = 0;
    this.failures = [];
  }

  /** Wahrheitsprüfung. */
  ok(condition, label, detail = '') {
    if (condition) {
      this.passed++;
      console.log(`    ✓ ${label}`);
    } else {
      this.failures.push({ label, detail });
      console.log(`    ✗ ${label}${detail ? ` – ${detail}` : ''}`);
    }
  }

  /** Gleichheitsprüfung mit aussagekräftiger Meldung. */
  equal(actual, expected, label) {
    this.ok(
      actual === expected,
      label,
      actual === expected ? '' : `erwartet ${JSON.stringify(expected)}, war ${JSON.stringify(actual)}`
    );
  }

  /** Enthält-Prüfung für Texte. */
  contains(haystack, needle, label) {
    const hit = String(haystack).includes(needle);
    this.ok(hit, label, hit ? '' : `„${needle}“ fehlt in „${String(haystack).slice(0, 80)}“`);
  }
}

async function main() {
  const filter = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const files = fs.readdirSync(SUITE_DIR)
    .filter((f) => f.endsWith('.js'))
    .filter((f) => filter.length === 0 || filter.some((needle) => f.includes(needle)))
    .sort();

  if (files.length === 0) {
    console.error('Keine passenden Testdateien gefunden.');
    process.exit(1);
  }

  const results = [];
  const started = Date.now();

  for (const file of files) {
    const suite = require(path.join(SUITE_DIR, file));
    const name = suite.name || file.replace(/\.js$/, '');
    console.log(`\n▸ ${name}`);

    const check = new Check(name);
    try {
      await suite.run(check);
    } catch (err) {
      check.failures.push({ label: 'Suite abgebrochen', detail: err.message });
      console.log(`    ✗ Suite abgebrochen – ${err.message}`);
      if (process.env.VERBOSE) console.error(err);
    }
    results.push(check);
  }

  const passed = results.reduce((sum, r) => sum + r.passed, 0);
  const failed = results.reduce((sum, r) => sum + r.failures.length, 0);
  const seconds = ((Date.now() - started) / 1000).toFixed(1);

  console.log(`\n${'─'.repeat(52)}`);
  results.forEach((r) => {
    const mark = r.failures.length === 0 ? '✓' : '✗';
    console.log(`${mark} ${r.name}: ${r.passed} bestanden, ${r.failures.length} fehlgeschlagen`);
  });
  console.log(`${'─'.repeat(52)}`);
  console.log(`${passed} bestanden, ${failed} fehlgeschlagen (${seconds}s)`);

  if (failed > 0) {
    console.log('\nFehlgeschlagen:');
    results.forEach((r) => r.failures.forEach((f) => {
      console.log(`  • [${r.name}] ${f.label}${f.detail ? ` – ${f.detail}` : ''}`);
    }));
  }

  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('Testlauf abgebrochen:', err);
  process.exit(1);
});
