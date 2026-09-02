import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { extractVideoSignals } from '../src/cheat/scoring.ts';
import { LOOK_THRESHOLDS, LookSession, lookingDownFrom } from '../src/look/session.ts';

const tick = (session, tSec, extra = {}) => session.ingest({
    tSec,
    gazeAway: false,
    gazeDirection: null,
    headTurn: false,
    headDown: false,
    fusedPitch: 0,
    gazeBlurry: false,
    ...extra,
});

const runFor = (session, from, to, step, extra) => {
    let last = null;
    for (let t = from; t <= to + 1e-9; t += step) last = tick(session, t, extra);
    return last;
};

assert.equal(lookingDownFrom({ headDown: true, fusedPitch: 0 }), true);
assert.equal(lookingDownFrom({ headDown: false, fusedPitch: -LOOK_THRESHOLDS.PITCH_NOTES_RAD - 0.01 }), true);
assert.equal(lookingDownFrom({ headDown: false, fusedPitch: 0 }), false);

const camera = new LookSession();
const cameraLive = runFor(camera, 0, 1.0, 0.1, {});
assert.equal(cameraLive.kind, 'camera');
assert.equal(cameraLive.secondScreen, false);
assert.equal(cameraLive.label, '看镜头');

const glance = new LookSession();
const glanceLive = runFor(glance, 0, 0.4, 0.05, { gazeAway: true, gazeDirection: 'left' });
assert.equal(glanceLive.kind, 'glance');
assert.equal(glanceLive.secondScreen, false);
assert.equal(glanceLive.direction, 'left');
assert.match(glanceLive.label, /扫视/);

const aside = new LookSession();
const asideLive = runFor(aside, 0, 1.2, 0.1, { gazeAway: true, gazeDirection: 'right' });
assert.equal(asideLive.kind, 'aside');
assert.equal(asideLive.secondScreen, false);

const screen = new LookSession();
const screenLive = runFor(screen, 0, 2.1, 0.1, {
    gazeAway: true,
    gazeDirection: 'left',
    headTurn: true,
});
assert.equal(screenLive.kind, 'second_screen');
assert.equal(screenLive.secondScreen, true);
assert.equal(screenLive.level, 'danger');
assert.ok(screenLive.asideSec >= LOOK_THRESHOLDS.DWELL_SEC, `asideSec ${screenLive.asideSec}`);
assert.match(screenLive.label, /第二屏/);
assert.ok(screenLive.reasons.some((item) => item.includes('转头')), 'second screen with head turn keeps 转头');

const vor = new LookSession();
const vorLive = runFor(vor, 0, 1.2, 0.1, { headTurn: true, gazeAway: false });
assert.equal(vorLive.kind, 'head_turn_camera');
assert.equal(vorLive.headTurnButCamera, true);
assert.equal(vorLive.secondScreen, false);
assert.equal(vorLive.label, '转头但仍看镜头');

const notes = new LookSession();
const notesLive = runFor(notes, 0, 3.0, 0.1, {
    gazeAway: true,
    gazeDirection: 'left',
    headDown: true,
});
assert.equal(notesLive.kind, 'notes');
assert.equal(notesLive.secondScreen, false);
assert.equal(notesLive.notes, true);

const gap = new LookSession();
runFor(gap, 0, 1.2, 0.1, { gazeAway: true, gazeDirection: 'right' });
runFor(gap, 1.3, 1.6, 0.1, { gazeAway: false, gazeBlurry: true });
const gapLive = runFor(gap, 1.7, 2.3, 0.1, { gazeAway: true, gazeDirection: 'right' });
assert.equal(gapLive.kind, 'second_screen', `blink gap should not reset dwell, kind=${gapLive.kind} aside=${gapLive.asideSec}`);

const resetDir = new LookSession();
runFor(resetDir, 0, 1.5, 0.1, { gazeAway: true, gazeDirection: 'left' });
const flipped = runFor(resetDir, 1.6, 2.4, 0.1, { gazeAway: true, gazeDirection: 'right' });
assert.equal(flipped.secondScreen, false, 'direction flip restarts dwell');
assert.equal(flipped.direction, 'right');

assert.deepEqual(
    extractVideoSignals({ covered_ratio: 0, static_ratio: 0, down_ratio: 0, gaze: { no_face_ratio: 0 } }),
    [],
);

const faceView = await readFile(new URL('../src/components/FaceView/FaceView.tsx', import.meta.url), 'utf8');
if (!faceView.includes('LookSession')) throw new Error('FaceView missing LookSession');

const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
if (!app.includes('转头 / 第二屏')) throw new Error('App missing 转头 / 第二屏 panel');
if (!app.includes('疑似第二屏')) throw new Error('App missing 疑似第二屏 metric');

const scoring = await readFile(new URL('../src/cheat/scoring.ts', import.meta.url), 'utf8');
if (scoring.includes('second_screen') || scoring.includes('B3-8')) {
    throw new Error('second-screen look must not mint a new B3 signal');
}

console.log('verify-look: pass');
