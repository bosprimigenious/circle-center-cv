import assert from 'node:assert/strict';
import { eyeAspectRatio } from '../src/cheat/geometry.ts';
import { PERSON_LEFT_ORBIT, PERSON_RIGHT_ORBIT } from '../src/gaze/iris.ts';
import { FATIGUE_THRESHOLDS, FatigueSession, perclosFromTicks } from '../src/fatigue/session.ts';

const setEye = (points, indices, open) => {
    const [p1, p2, p3, p4, p5, p6] = indices;
    const midX = (points[p1].x + points[p4].x) / 2;
    const midY = (points[p1].y + points[p4].y) / 2;
    const halfW = Math.abs(points[p4].x - points[p1].x) / 2;
    const halfH = open ? halfW * 0.35 : halfW * 0.04;
    points[p2] = { x: midX - halfW * 0.3, y: midY - halfH, z: 0 };
    points[p3] = { x: midX + halfW * 0.3, y: midY - halfH, z: 0 };
    points[p5] = { x: midX + halfW * 0.3, y: midY + halfH, z: 0 };
    points[p6] = { x: midX - halfW * 0.3, y: midY + halfH, z: 0 };
};

const face = () => {
    const points = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
    for (const index of PERSON_RIGHT_ORBIT) points[index] = { x: 0.4, y: 0.4, z: 0 };
    points[33] = { x: 0.35, y: 0.4, z: 0 };
    points[133] = { x: 0.45, y: 0.4, z: 0 };
    for (const index of PERSON_LEFT_ORBIT) points[index] = { x: 0.6, y: 0.4, z: 0 };
    points[362] = { x: 0.55, y: 0.4, z: 0 };
    points[263] = { x: 0.65, y: 0.4, z: 0 };
    return points;
};

const openFace = face();
setEye(openFace, [33, 160, 158, 133, 153, 144], true);
setEye(openFace, [362, 385, 387, 263, 373, 380], true);
const openEar = eyeAspectRatio(openFace);
assert.ok(openEar != null && openEar > 0.25, `open EAR ${openEar}`);

const closedFace = face();
setEye(closedFace, [33, 160, 158, 133, 153, 144], false);
setEye(closedFace, [362, 385, 387, 263, 373, 380], false);
const closedEar = eyeAspectRatio(closedFace);
assert.ok(closedEar != null && closedEar < FATIGUE_THRESHOLDS.EAR_CLOSED, `closed EAR ${closedEar}`);

const perclos = perclosFromTicks(
    [
        { t: 0, closed: false },
        { t: 8, closed: true },
        { t: 10, closed: true },
    ],
    10,
    60,
);
assert.ok(perclos != null && Math.abs(perclos - 0.2) < 1e-6, `perclos ${perclos}`);
assert.equal(perclosFromTicks([{ t: 0, closed: true }, { t: 3, closed: true }], 3, 60), null);

const awake = new FatigueSession();
for (let index = 0; index <= 40; index += 1) {
    const live = awake.ingest({
        tSec: index * 0.2,
        ear: 0.30,
        mar: 0.2,
        orbitAspect: 0.4,
        irisRadius: 0.012,
        headDown: false,
    });
    if (index === 40) {
        assert.equal(live.label, '清醒');
        assert.equal(live.gazeBlurry, false);
        assert.equal(live.level, 'ok');
    }
}

const sleepy = new FatigueSession();
for (let index = 0; index <= 10; index += 1) {
    sleepy.ingest({
        tSec: index * 0.2,
        ear: 0.30,
        mar: 0.2,
        orbitAspect: 0.4,
        headDown: false,
    });
}
let last = sleepy.snapshot();
for (let index = 11; index <= 20; index += 1) {
    last = sleepy.ingest({
        tSec: index * 0.2,
        ear: 0.12,
        mar: 0.2,
        orbitAspect: 0.12,
        headDown: false,
    });
}
assert.equal(last.eyesClosed, true);
assert.equal(last.gazeBlurry, true);
assert.ok(last.closedSec >= FATIGUE_THRESHOLDS.MICROSLEEP_SEC, `closedSec ${last.closedSec}`);
assert.equal(last.level, 'danger');
assert.ok(last.reasons.includes('持续闭眼'));
assert.ok(last.reasons.includes('视线模糊'));

const nod = new FatigueSession();
const blur = nod.ingest({
    tSec: 0,
    ear: 0.18,
    mar: 0.2,
    orbitAspect: 0.2,
    headDown: true,
});
assert.equal(blur.gazeBlurry, true);
assert.equal(blur.headDown, true);
assert.equal(blur.level, 'danger');
assert.ok(blur.reasons.includes('低头'));
assert.ok(blur.reasons.includes('视线模糊'));

const overlay = await import('node:fs/promises').then((fs) => fs.readFile(
    new URL('../src/face/overlay.ts', import.meta.url),
    'utf8',
));
if (!overlay.includes('gaze.blurry')) throw new Error('overlay must hide rays when gaze is blurry');

const faceView = await import('node:fs/promises').then((fs) => fs.readFile(
    new URL('../src/components/FaceView/FaceView.tsx', import.meta.url),
    'utf8',
));
if (!faceView.includes('FatigueSession')) throw new Error('FaceView missing FatigueSession');

console.log('verify-fatigue: pass');
