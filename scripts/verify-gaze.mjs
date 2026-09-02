import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { decodeBinLogits, L2CS_BINS } from '../src/gaze/decode.ts';
import {
    irisGazeFromLandmarks,
    PERSON_LEFT_IRIS,
    PERSON_LEFT_ORBIT,
    PERSON_RIGHT_IRIS,
    PERSON_RIGHT_ORBIT,
} from '../src/gaze/iris.ts';
import { gazeXFromLandmarks, gazeYFromLandmarks } from '../src/cheat/geometry.ts';
import { describeLook, fusedIrisRay, rayFromEye } from '../src/gaze/iris.ts';
import { APPEARANCE_WEIGHT, fuseGazeInstant, geometricGazeFrom, resetGazeFuse } from '../src/gaze/fuse.ts';
import { eulerFromMatrix, yawRotationMatrix } from '../src/gaze/headPose.ts';
import { shouldersFromPose } from '../src/pose/shoulders.ts';
import { CheatSession } from '../src/cheat/session.ts';
import { THRESHOLDS } from '../src/cheat/scoring.ts';
import { faceQualityFrom, l2csBoxTrusted } from '../src/face/completeness.ts';

const uniform = new Float32Array(L2CS_BINS).fill(1);
const uniformDeg = decodeBinLogits(uniform) * 180 / Math.PI;
assert.ok(Math.abs(uniformDeg - (44.5 * 4 - 180)) < 1e-4, `uniform logits ${uniformDeg}`);

const peak = new Float32Array(L2CS_BINS);
peak[45] = 20;
assert.ok(Math.abs(decodeBinLogits(peak)) < 1e-5, 'bin 45 is 0 degrees');

const leftPeak = new Float32Array(L2CS_BINS);
leftPeak[30] = 20;
const leftRad = decodeBinLogits(leftPeak);
assert.ok(leftRad < -0.5, `bin 30 should be negative yaw, got ${leftRad}`);

const plantIris = (target, irisIdx, cx, cy, radius = 0.012) => {
    const ring = [
        [cx, cy],
        [cx + radius, cy],
        [cx, cy + radius],
        [cx - radius, cy],
        [cx, cy - radius],
    ];
    irisIdx.forEach((index, offset) => {
        target[index] = { x: ring[offset][0], y: ring[offset][1], z: 0 };
    });
};

const points = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
points[1] = { x: 0.5, y: 0.42, z: 0 };
points[10] = { x: 0.5, y: 0.22, z: 0 };
points[152] = { x: 0.5, y: 0.72, z: 0 };
points[234] = { x: 0.28, y: 0.48, z: 0 };
points[454] = { x: 0.72, y: 0.48, z: 0 };
for (const index of PERSON_RIGHT_ORBIT) points[index] = { x: 0.4, y: 0.4, z: 0 };
points[33] = { x: 0.35, y: 0.38, z: 0 };
points[133] = { x: 0.45, y: 0.42, z: 0 };
plantIris(points, PERSON_RIGHT_IRIS, 0.4, 0.4);

for (const index of PERSON_LEFT_ORBIT) points[index] = { x: 0.6, y: 0.4, z: 0 };
points[362] = { x: 0.55, y: 0.38, z: 0 };
points[263] = { x: 0.65, y: 0.42, z: 0 };
plantIris(points, PERSON_LEFT_IRIS, 0.6, 0.4);

const iris = irisGazeFromLandmarks(points);
assert.ok(iris.left && iris.right, 'both orbits measured');
assert.ok(Math.abs(iris.gazeX) < 0.08, `centered iris gazeX ${iris.gazeX}`);
assert.ok(iris.gazeY != null && Math.abs(iris.gazeY) < 0.25, `centered iris gazeY ${iris.gazeY}`);
assert.equal(gazeXFromLandmarks(points), iris.gazeX);
assert.equal(gazeYFromLandmarks(points), iris.gazeY);

plantIris(points, PERSON_RIGHT_IRIS, 0.44, 0.41);
plantIris(points, PERSON_LEFT_IRIS, 0.64, 0.41);
const lookingRight = irisGazeFromLandmarks(points);
assert.ok(lookingRight.gazeX != null && lookingRight.gazeX > 0.15, `rightward iris ${lookingRight.gazeX}`);
const rightRay = rayFromEye(lookingRight.right);
assert.ok(rightRay && rightRay.dx > 0, `right iris ray should go right, dx=${rightRay?.dx}`);
const fused = fusedIrisRay(lookingRight);
assert.ok(fused && fused.dx > 0, 'fused iris ray should follow the eyes');
assert.equal(describeLook(0, 0, null), '看镜头');
assert.equal(describeLook(0.3, 0.2, null), '看右下');
assert.equal(describeLook(0.3, 0, { yaw: 0, pitch: 0 }), '看右');
assert.equal(describeLook(null, null, { yaw: 0.6, pitch: 0 }), '看左');
assert.equal(describeLook(0.3, 0, { yaw: 0, pitch: 0 }, { yaw: 0.6, pitch: 0 }), '看左');

const identity = eulerFromMatrix({ data: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] });
assert.ok(identity && Math.abs(identity.yaw) < 1e-9 && Math.abs(identity.pitch) < 1e-9 && Math.abs(identity.roll) < 1e-9, 'identity matrix is zero pose');
const yaw30 = 30 * Math.PI / 180;
const fromYaw = eulerFromMatrix({ data: yawRotationMatrix(yaw30) });
assert.ok(fromYaw && Math.abs(fromYaw.yaw - yaw30) < 1e-6, `pure yaw matrix, got ${fromYaw?.yaw}`);
assert.ok(fromYaw && Math.abs(fromYaw.pitch) < 1e-6 && Math.abs(fromYaw.roll) < 1e-6, 'pure yaw has no pitch/roll');
assert.equal(eulerFromMatrix(null), null);
assert.equal(eulerFromMatrix({ data: [1, 0, 0] }), null);

const head = { yaw: 0.2, pitch: -0.1, roll: 0 };
const geoCenter = geometricGazeFrom(head, { gazeX: 0, gazeY: 0 }, false);
assert.ok(geoCenter && Math.abs(geoCenter.yaw - 0.2) < 1e-9 && Math.abs(geoCenter.pitch - -0.1) < 1e-9, 'centered iris follows head');
const geoRight = geometricGazeFrom(head, { gazeX: 0.2, gazeY: 0 }, false);
assert.ok(geoRight && geoRight.yaw < geoCenter.yaw, `iris to image-right decreases yaw, ${geoRight?.yaw} vs ${geoCenter?.yaw}`);
const geoBlurry = geometricGazeFrom(head, { gazeX: 0.2, gazeY: 0.2 }, true);
assert.ok(geoBlurry && Math.abs(geoBlurry.yaw - head.yaw) < 1e-9 && Math.abs(geoBlurry.pitch - head.pitch) < 1e-9, 'blurry drops iris term');

resetGazeFuse();
const fusedFresh = fuseGazeInstant({
    head,
    iris: { gazeX: 0, gazeY: 0 },
    l2cs: { yaw: 0.4, pitch: 0 },
    l2csAgeMs: 0,
    blurry: false,
});
assert.equal(fusedFresh.appearanceWeight, APPEARANCE_WEIGHT);
const expectedYaw = APPEARANCE_WEIGHT * 0.4 + (1 - APPEARANCE_WEIGHT) * 0.2;
assert.ok(fusedFresh.fused && Math.abs(fusedFresh.fused.yaw - expectedYaw) < 1e-9, `fresh fuse yaw ${fusedFresh.fused?.yaw}`);
const fusedStale = fuseGazeInstant({
    head,
    iris: { gazeX: 0, gazeY: 0 },
    l2cs: { yaw: 0.4, pitch: 0 },
    l2csAgeMs: 500,
    blurry: false,
});
assert.ok(fusedStale.appearanceWeight < APPEARANCE_WEIGHT, 'stale L2CS down-weights appearance');
assert.ok(fusedStale.fused && Math.abs(fusedStale.fused.yaw - geoCenter.yaw) < Math.abs(fusedFresh.fused.yaw - geoCenter.yaw), 'stale fuse stays closer to geometric');
const geoOnly = fuseGazeInstant({
    head,
    iris: { gazeX: 0, gazeY: 0 },
    l2cs: null,
    l2csAgeMs: Number.POSITIVE_INFINITY,
    blurry: false,
});
assert.equal(geoOnly.appearanceWeight, 0);
assert.deepEqual(geoOnly.fused, geoCenter);

const posePoints = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 1 }));
posePoints[11] = { x: 0.35, y: 0.55, z: 0, visibility: 0.99 };
posePoints[12] = { x: 0.65, y: 0.55, z: 0, visibility: 0.99 };
posePoints[0] = { x: 0.5, y: 0.28, z: 0, visibility: 0.99 };
const shoulders = shouldersFromPose(posePoints, { x: 0.5, y: 0.28, z: 0 });
assert.ok(shoulders, 'shoulders visible');
assert.ok(shoulders.drop < -0.5, `nose above shoulders, drop=${shoulders.drop}`);
assert.ok(Math.abs(shoulders.yaw) < 0.05, `centered yaw ${shoulders.yaw}`);
const downShoulders = shouldersFromPose(posePoints, { x: 0.5, y: 0.48, z: 0 });
assert.ok(downShoulders && downShoulders.drop > shoulders.drop, 'looking down raises drop toward the shoulder line');
const turned = shouldersFromPose(posePoints, { x: 0.62, y: 0.28, z: 0 });
assert.ok(turned && turned.yaw > 0.2, `nose toward image-right raises yaw, got ${turned?.yaw}`);

const hidden = posePoints.map((point, index) => (
    index === 11 || index === 12 ? { ...point, visibility: 0.1 } : point
));
assert.equal(shouldersFromPose(hidden, { x: 0.5, y: 0.28, z: 0 }), null);

const cheat = new CheatSession();
for (let index = 0; index < THRESHOLDS.BASELINE_MIN_SAMPLES; index += 1) {
    cheat.ingest({
        tSec: index * THRESHOLDS.VIDEO_INTERVAL_SEC,
        landmarks: points,
        faceCount: 1,
        forceSample: true,
        shoulders: { drop: -0.9, yaw: 0 },
    });
}
const lookingDown = cheat.ingest({
    tSec: THRESHOLDS.BASELINE_MIN_SAMPLES * THRESHOLDS.VIDEO_INTERVAL_SEC,
    landmarks: points,
    faceCount: 1,
    forceSample: true,
    shoulders: { drop: -0.9 + THRESHOLDS.SHOULDER_DROP_DELTA + 0.05, yaw: 0 },
});
assert.equal(lookingDown.live.shoulderVisible, true);
assert.equal(lookingDown.live.headDown, true);
const lookingAside = cheat.ingest({
    tSec: (THRESHOLDS.BASELINE_MIN_SAMPLES + 1) * THRESHOLDS.VIDEO_INTERVAL_SEC,
    landmarks: points,
    faceCount: 1,
    forceSample: true,
    shoulders: { drop: -0.9, yaw: THRESHOLDS.SHOULDER_YAW_DELTA + 0.05 },
});
assert.equal(lookingAside.live.headTurn, true);

const fusedCheat = new CheatSession();
for (let index = 0; index < THRESHOLDS.BASELINE_MIN_SAMPLES; index += 1) {
    fusedCheat.ingest({
        tSec: index * THRESHOLDS.VIDEO_INTERVAL_SEC,
        landmarks: points,
        faceCount: 1,
        forceSample: true,
        fused: { yaw: 0, pitch: 0 },
    });
}
const fusedAway = fusedCheat.ingest({
    tSec: THRESHOLDS.BASELINE_MIN_SAMPLES * THRESHOLDS.VIDEO_INTERVAL_SEC,
    landmarks: points,
    faceCount: 1,
    forceSample: true,
    fused: { yaw: THRESHOLDS.L2CS_YAW_AWAY_RAD + 0.05, pitch: 0 },
});
assert.equal(fusedAway.live.gazeAway, true);
assert.equal(fusedAway.live.gazeDirection, 'right');
assert.ok(fusedAway.live.fusedYaw != null && fusedAway.live.fusedYaw > 0, 'live fused yaw is wired');

const collapsed = points.map((point) => ({ ...point }));
for (const index of PERSON_RIGHT_IRIS) collapsed[index] = { x: 0.4, y: 0.4, z: 0 };
for (const index of PERSON_LEFT_IRIS) collapsed[index] = { x: 0.6, y: 0.4, z: 0 };
const collapsedIris = irisGazeFromLandmarks(collapsed);
assert.equal(collapsedIris.left, null, 'collapsed iris radius must drop the eye');
assert.equal(collapsedIris.right, null);
assert.equal(collapsedIris.gazeX, null);

const oneEye = points.map((point) => ({ ...point }));
for (const index of PERSON_LEFT_IRIS) oneEye[index] = { x: 0.05, y: 0.05, z: 0 };
const one = irisGazeFromLandmarks(oneEye);
assert.ok(one.right && !one.left, 'occluded far iris is dropped, near eye kept');
assert.ok(one.gazeX != null, 'one good eye still yields gazeX');

const fullBox = { x: 0.22, y: 0.12, width: 0.56, height: 0.68 };
const okQuality = faceQualityFrom({
    landmarks: points,
    box: fullBox,
    iris: irisGazeFromLandmarks(points),
});
assert.equal(okQuality.pitchTrusted, true);
assert.equal(okQuality.irisTrusted, true);
assert.equal(okQuality.label, '完整');
assert.equal(l2csBoxTrusted(fullBox), true);
assert.equal(l2csBoxTrusted({ x: 0.01, y: 0.2, width: 0.4, height: 0.5 }), false);

const chinOut = points.map((point) => ({ ...point }));
chinOut[152] = { x: 0.5, y: 0.995, z: 0 };
const clipQuality = faceQualityFrom({
    landmarks: chinOut,
    box: { x: 0.2, y: 0.4, width: 0.5, height: 0.62 },
    iris: irisGazeFromLandmarks(chinOut),
});
assert.equal(clipQuality.clipBottom, true);
assert.equal(clipQuality.pitchTrusted, false);
assert.equal(clipQuality.l2csTrusted, false);

const poseForHand = Array.from({ length: 33 }, () => ({ x: 0.1, y: 0.9, z: 0, visibility: 0.2 }));
poseForHand[15] = { x: 0.5, y: 0.45, z: 0, visibility: 0.95 };
const handQuality = faceQualityFrom({
    landmarks: points,
    box: fullBox,
    iris: irisGazeFromLandmarks(points),
    poseLandmarks: poseForHand,
});
assert.equal(handQuality.handOverFace, true);
assert.equal(handQuality.irisTrusted, false);
assert.match(handQuality.label, /手挡脸/);

const clipCheat = new CheatSession();
for (let index = 0; index < THRESHOLDS.BASELINE_MIN_SAMPLES; index += 1) {
    clipCheat.ingest({
        tSec: index * THRESHOLDS.VIDEO_INTERVAL_SEC,
        landmarks: points,
        faceCount: 1,
        forceSample: true,
    });
}
const downLm = points.map((point) => ({ ...point }));
downLm[1] = { x: 0.5, y: 0.55, z: 0 };
const trustedDown = clipCheat.ingest({
    tSec: THRESHOLDS.BASELINE_MIN_SAMPLES * THRESHOLDS.VIDEO_INTERVAL_SEC,
    landmarks: downLm,
    faceCount: 1,
    forceSample: true,
});
assert.equal(trustedDown.live.headDown, true, 'complete face still flags head-down from pitch');
const untrustedDown = clipCheat.ingest({
    tSec: (THRESHOLDS.BASELINE_MIN_SAMPLES + 1) * THRESHOLDS.VIDEO_INTERVAL_SEC,
    landmarks: downLm,
    faceCount: 1,
    forceSample: true,
    quality: {
        pitchTrusted: false,
        yawTrusted: false,
        irisTrusted: false,
        l2csTrusted: false,
        clipped: true,
        label: '出框下',
    },
});
assert.equal(untrustedDown.live.headDown, false, 'clipped face without shoulders must not flag head-down');
assert.equal(untrustedDown.live.faceClipped, true);
assert.ok(untrustedDown.video.quality_flags.includes('face_clipped'));

const shoulderClip = new CheatSession();
for (let index = 0; index < THRESHOLDS.BASELINE_MIN_SAMPLES; index += 1) {
    shoulderClip.ingest({
        tSec: index * THRESHOLDS.VIDEO_INTERVAL_SEC,
        landmarks: points,
        faceCount: 1,
        forceSample: true,
        shoulders: { drop: -0.9, yaw: 0 },
    });
}
const shoulderDown = shoulderClip.ingest({
    tSec: THRESHOLDS.BASELINE_MIN_SAMPLES * THRESHOLDS.VIDEO_INTERVAL_SEC,
    landmarks: downLm,
    faceCount: 1,
    forceSample: true,
    shoulders: { drop: -0.9 + THRESHOLDS.SHOULDER_DROP_DELTA + 0.05, yaw: 0 },
    quality: {
        pitchTrusted: false,
        yawTrusted: true,
        irisTrusted: true,
        l2csTrusted: false,
        clipped: true,
        label: '出框下',
    },
});
assert.equal(shoulderDown.live.headDown, true, 'clipped face still uses shoulders for head-down');

const landmarker = await readFile(new URL('../src/face/landmarker.ts', import.meta.url), 'utf8');
if (!landmarker.includes('FACE_LANDMARK_COUNT')) throw new Error('478 landmarker missing');
if (!landmarker.includes('outputFacialTransformationMatrixes: true')) {
    throw new Error('Face Landmarker must request facialTransformationMatrixes for 3D head pose');
}
if (!landmarker.includes('eulerFromMatrix')) throw new Error('landmarker missing eulerFromMatrix');

const overlay = await readFile(new URL('../src/face/overlay.ts', import.meta.url), 'utf8');
if (!overlay.includes('drawIrisEllipse')) throw new Error('overlay missing iris ellipse');
if (!overlay.includes('drawOrbitBox')) throw new Error('overlay missing 眼眶 box');
if (!overlay.includes('fusedRay')) throw new Error('overlay missing fused gaze ray');
if (!overlay.includes('geometricRay')) throw new Error('overlay missing geometric gaze ray');
if (overlay.includes('FACE_LANDMARKS_TESSELATION')) throw new Error('tessellation came back');

const faceView = await readFile(new URL('../src/components/FaceView/FaceView.tsx', import.meta.url), 'utf8');
if (!faceView.includes('detectFrame')) throw new Error('FaceView missing multi-model detectFrame');
if (!faceView.includes('irisGazeFromLandmarks')) throw new Error('FaceView missing 眼眶 iris');
if (!faceView.includes('rayFromEye')) throw new Error('FaceView missing iris rays');
if (!faceView.includes('fuseGaze')) throw new Error('FaceView missing fuseGaze');
if (!faceView.includes('FatigueSession')) throw new Error('FaceView missing FatigueSession');
if (!faceView.includes('LookSession')) throw new Error('FaceView missing LookSession');
if (!faceView.includes('faceQualityFrom')) throw new Error('FaceView missing faceQualityFrom');

const pipeline = await readFile(new URL('../src/face/pipeline.ts', import.meta.url), 'utf8');
if (!pipeline.includes('detectFaceLandmarks') || !pipeline.includes('detectPoseLandmarks')) {
    throw new Error('pipeline must call face and pose together');
}
if (!pipeline.includes('Promise.all')) throw new Error('pipeline must run models in parallel');
if (!pipeline.includes('l2csAgeMs')) throw new Error('pipeline must expose L2CS age for fusion');
if (!pipeline.includes('lastL2csResolvedAt')) throw new Error('L2CS age must use resolve time, not start time');
if (!pipeline.includes('l2csBoxTrusted')) throw new Error('pipeline must skip L2CS on clipped face boxes');

const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
if (!app.includes('MobileGaze')) throw new Error('App missing MobileGaze copy');
if (!app.includes('融合 yaw / pitch°')) throw new Error('App missing fused gaze metric');
if (!app.includes('疲劳检测')) throw new Error('App missing 疲劳检测 panel');
if (!app.includes('PERCLOS')) throw new Error('App missing PERCLOS');

const copy = await readFile(new URL('./copy-mediapipe.mjs', import.meta.url), 'utf8');
if (!copy.includes('mobileone_s0_gaze.onnx')) throw new Error('postinstall missing MobileGaze download');
if (!copy.includes('pose_landmarker_lite.task')) throw new Error('postinstall missing Pose lite download');
if (!copy.includes('ort-wasm-simd-threaded.wasm')) throw new Error('postinstall missing ORT wasm copy');

console.log('verify-gaze: pass');
