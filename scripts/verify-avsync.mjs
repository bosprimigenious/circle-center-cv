import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { extractVideoSignals } from '../src/cheat/scoring.ts';
import { AvSyncSession, AVSYNC_THRESHOLDS } from '../src/avsync/session.ts';
import { bestLagSec, rmsFromTimeDomain, zscore } from '../src/avsync/energy.ts';

assert.ok(Math.abs(rmsFromTimeDomain([1, -1, 1, -1]) - 1) < 1e-9);
assert.equal(rmsFromTimeDomain([]), 0);
const z = zscore([1, 2, 3]);
assert.ok(Math.abs(z.reduce((sum, value) => sum + value, 0)) < 1e-9);

const dt = 0.05;
const n = 80;
const a = Array.from({ length: n }, (_, index) => Math.sin(2 * Math.PI * 2 * index * dt));
const delay = 4;
const b = a.map((_, index) => (index >= delay ? a[index - delay] : 0));
const lagged = bestLagSec(a, b, dt, 0.4);
assert.ok(lagged.lagSec != null && Math.abs(lagged.lagSec - delay * dt) < dt + 1e-9, `lag ${lagged.lagSec}`);

const aligned = new AvSyncSession();
for (let index = 0; index < 50; index += 1) {
    const t = index * dt;
    const wave = 0.2 + 0.1 * Math.sin(2 * Math.PI * 2 * t);
    aligned.ingest({
        tSec: t,
        mar: wave,
        rms: 0.03 + 0.02 * Math.sin(2 * Math.PI * 2 * t),
        visualSpeaking: wave > 0.22,
    });
}
const alignedLive = aligned.snapshot();
assert.ok(alignedLive.kind === 'sync' || alignedLive.kind === 'warmup', `aligned kind ${alignedLive.kind}`);
if (alignedLive.lagSec != null) {
    assert.ok(Math.abs(alignedLive.lagSec) <= AVSYNC_THRESHOLDS.SYNC_LAG_SEC + dt, `aligned lag ${alignedLive.lagSec}`);
}

const burst = (t, center) => Math.exp(-((t - center) ** 2) / (2 * 0.09 ** 2));
const late = new AvSyncSession();
for (let index = 0; index < 80; index += 1) {
    const t = index * dt;
    const mar = 0.08 + 0.22 * burst(t, 1.2);
    const rms = 0.004 + 0.05 * burst(t, 1.45);
    late.ingest({ tSec: t, mar, rms, visualSpeaking: mar > 0.16 });
}
const lateLive = late.snapshot();
assert.ok(lateLive.lagSec != null && lateLive.lagSec > 0.12, `late audio lag ${lateLive.lagSec}`);
assert.equal(lateLive.kind, 'lag');

const visualOnly = new AvSyncSession();
for (let index = 0; index < 50; index += 1) {
    visualOnly.ingest({
        tSec: index * dt,
        mar: 0.2 + 0.05 * Math.sin(index),
        rms: 0.002,
        visualSpeaking: true,
    });
}
assert.equal(visualOnly.snapshot().kind, 'visual_only');
assert.equal(visualOnly.snapshot().level, 'danger');

const audioOnly = new AvSyncSession();
for (let index = 0; index < 50; index += 1) {
    audioOnly.ingest({
        tSec: index * dt,
        mar: 0.07,
        rms: 0.05 + 0.02 * Math.sin(index),
        visualSpeaking: false,
    });
}
assert.equal(audioOnly.snapshot().kind, 'audio_only');

const silent = new AvSyncSession();
silent.ingest({ tSec: 0, mar: 0.07, rms: null, visualSpeaking: false });
assert.equal(silent.snapshot().kind, 'no_audio');

assert.deepEqual(
    extractVideoSignals({ covered_ratio: 0, static_ratio: 0, down_ratio: 0, gaze: { no_face_ratio: 0 } }),
    [],
);

const faceView = await readFile(new URL('../src/components/FaceView/FaceView.tsx', import.meta.url), 'utf8');
if (!faceView.includes('AvSyncSession')) throw new Error('FaceView missing AvSyncSession');
if (!faceView.includes('echoCancellation')) throw new Error('camera getUserMedia must request audio');
if (!faceView.includes('attachElement')) throw new Error('MP4 must attach MediaElement audio tap');

const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
if (!app.includes('音画同步')) throw new Error('App missing 音画同步 panel');

const scoring = await readFile(new URL('../src/cheat/scoring.ts', import.meta.url), 'utf8');
if (scoring.includes('AvSync') || scoring.includes('B3-9')) {
    throw new Error('AV sync must not mint a new B3 signal');
}

console.log('verify-avsync: pass');
