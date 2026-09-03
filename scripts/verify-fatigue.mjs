import assert from 'node:assert/strict';
import { eyeAspectRatio, eyeAspectRatios } from '../src/cheat/geometry.ts';
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
const openPair = eyeAspectRatios(openFace);
assert.ok(openPair.left != null && openPair.right != null);

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
        orbitAspect: 0.4,
        irisRadius: 0.012,
        headDown: false,
    });
    if (index === 40) {
        assert.equal(live.label, '眼部正常');
        assert.equal(live.gazeBlurry, false);
        assert.equal(live.squintNotes, false);
        assert.equal(live.level, 'ok');
    }
}

const fp = new FatigueSession();
for (let index = 0; index < 12; index += 1) {
    fp.ingest({
        tSec: index * 0.2,
        ear: 0.382,
        orbitAspect: 0.34,
        irisRadius: 0.0103,
        eyeBlink: 0.27,
        headDown: false,
    });
}
const fpLive = fp.ingest({
    tSec: 2.4,
    ear: 0.296,
    orbitAspect: 0.324,
    irisRadius: 0.0098,
    eyeBlink: 0.27,
    headDown: false,
    lookingDown: false,
});
assert.equal(fpLive.gazeBlurry, false, 'slightly low EAR must not hide gaze rays');
assert.equal(fpLive.squintNotes, false);
assert.equal(fpLive.eyesOffCam, false);
assert.equal(fpLive.level, 'ok');
assert.equal(fpLive.label, '眼部正常');

const sleepy = new FatigueSession();
for (let index = 0; index <= 10; index += 1) {
    sleepy.ingest({
        tSec: index * 0.2,
        ear: 0.30,
        orbitAspect: 0.4,
        headDown: false,
    });
}
let last = sleepy.snapshot();
for (let index = 11; index <= 20; index += 1) {
    last = sleepy.ingest({
        tSec: index * 0.2,
        ear: 0.12,
        orbitAspect: 0.12,
        headDown: false,
    });
}
assert.equal(last.eyesClosed, true);
assert.equal(last.gazeBlurry, true);
assert.ok(last.closedSec >= FATIGUE_THRESHOLDS.MICROSLEEP_SEC, `closedSec ${last.closedSec}`);
assert.equal(last.eyesOffCam, true);
assert.equal(last.level, 'danger');
assert.equal(last.label, '闭眼离镜');
assert.ok(last.reasons.includes('闭眼离镜'));
assert.equal(last.reasons.includes('视线模糊'), false);
assert.equal(last.reasons.includes('打哈欠'), false);

const nod = new FatigueSession();
let nodLive = nod.ingest({
    tSec: 0,
    ear: 0.18,
    orbitAspect: 0.2,
    headDown: true,
    lookingDown: true,
});
assert.equal(nodLive.squintNotes, true);
assert.equal(nodLive.gazeBlurry, true);
assert.equal(nodLive.level, 'warn');
assert.ok(nodLive.reasons.includes('眯眼看稿'));
nodLive = nod.ingest({
    tSec: 0.9,
    ear: 0.18,
    orbitAspect: 0.2,
    headDown: true,
    lookingDown: true,
});
assert.equal(nodLive.level, 'danger');
assert.equal(nodLive.label, '眯眼看稿');
assert.equal(nodLive.eyesOffCam, false);

const asym = new FatigueSession().ingest({
    tSec: 0,
    ear: 0.25,
    earLeft: 0.32,
    earRight: 0.18,
    orbitAspect: 0.4,
    headDown: false,
});
assert.ok((asym.earAsym ?? 0) > FATIGUE_THRESHOLDS.EAR_ASYM, `earAsym ${asym.earAsym}`);
assert.equal(asym.earAsymFlag, true);
assert.ok(asym.reasons.includes('左右眼不对称'));

const stare = new FatigueSession();
stare.ingest({ tSec: 0, ear: 0.30, orbitAspect: 0.4, headDown: false });
stare.ingest({ tSec: 0.2, ear: 0.12, orbitAspect: 0.12, headDown: false });
stare.ingest({ tSec: 0.4, ear: 0.30, orbitAspect: 0.4, headDown: false });
const stareLive = stare.ingest({
    tSec: 4.0,
    ear: 0.30,
    orbitAspect: 0.4,
    headDown: false,
    gazeAway: true,
});
assert.equal(stareLive.stare, true);
assert.ok(stareLive.stareSec >= FATIGUE_THRESHOLDS.STARE_SEC, `stareSec ${stareLive.stareSec}`);
assert.ok(stareLive.reasons.includes('凝视读稿'));
assert.equal(stareLive.ibiSec, null);

const sparse = new FatigueSession();
sparse.ingest({ tSec: 0, ear: 0.30, orbitAspect: 0.4, headDown: false });
sparse.ingest({ tSec: 0.2, ear: 0.12, orbitAspect: 0.12, headDown: false });
sparse.ingest({ tSec: 0.4, ear: 0.30, orbitAspect: 0.4, headDown: false });
const sparseLive = sparse.ingest({ tSec: 21, ear: 0.30, orbitAspect: 0.4, headDown: false });
assert.equal(sparseLive.blinkSparse, true);
assert.ok(sparseLive.reasons.includes('眨眼过稀'));
assert.ok(sparseLive.reasons.includes('凝视过久'));

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
if (!faceView.includes('eyeAspectRatios')) throw new Error('FaceView missing per-eye EAR');
if (!faceView.includes('lookingDownFrom')) throw new Error('FaceView missing lookingDown for 眯眼看稿');
if (faceView.includes('+ 疲劳')) throw new Error('FaceView HUD still says 疲劳');

const app = await import('node:fs/promises').then((fs) => fs.readFile(
    new URL('../src/App.tsx', import.meta.url),
    'utf8',
));
if (app.includes('疲劳检测') || app.includes('title: \'疲劳\'')) throw new Error('App still brands 疲劳');
if (!app.includes('眯眼看稿')) throw new Error('App missing 眯眼看稿');
if (!app.includes('闭眼离镜')) throw new Error('App missing 闭眼离镜');
if (!app.includes('IBI')) throw new Error('App missing IBI');

console.log('verify-fatigue: pass');
