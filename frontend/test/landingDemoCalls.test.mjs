// The demo library on the landing page is generated from the sample manifest. This fails when a recording is added, removed or
// renamed without regenerating it (node ../backend/bench/build-reference.mjs), so the page can never list a call that is not there.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DEMO_CALLS } from '../src/lib/reference.js';

const manifest = JSON.parse(fs.readFileSync(new URL('../../backend/samples/manifest.json', import.meta.url), 'utf8')).samples;

test('the landing demo library lists exactly the core and stress recordings in the manifest', () => {
  const expected = manifest.filter((e) => e.group === 'core' || e.group === 'stress').map((e) => e.id);
  assert.equal(expected.length, 15);
  assert.deepEqual(DEMO_CALLS.map((c) => c.id), expected);
});

test('every listed recording exists and has a category and a measured result', () => {
  for (const c of DEMO_CALLS) {
    assert.ok(fs.existsSync(new URL(`../../backend/samples/${c.id}`, import.meta.url)), `${c.id} is missing from backend/samples`);
    assert.ok(c.category, `${c.id} has no category`);
    assert.ok(c.measured, `${c.id} has no measured result`);
  }
});
