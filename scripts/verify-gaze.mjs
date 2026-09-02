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
import { shouldersFromPose } from '../src/pose/shoulders.ts';
import { CheatSession } from '../src/cheat/session.ts';
import { THRESHOLDS } from '../src/cheat/scoring.ts';

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

const points = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
for (const index of PERSON_RIGHT_ORBIT) points[index] = { x: 0.4, y: 0.4, z: 0 };
points[33] = { x: 0.35, y: 0.38, z: 0 };
points[133] = { x: 0.45, y: 0.42, z: 0 };
for (const index of PERSON_RIGHT_IRIS) points[index] = { x: 0.4, y: 0.4, z: 0 };

for (const index of PERSON_LEFT_ORBIT) points[index] = { x: 0.6, y: 0.4, z: 0 };
points[362] = { x: 0.55, y: 0.38, z: 0 };
points[263] = { x: 0.65, y: 0.42, z: 0 };
for (const index of PERSON_LEFT_IRIS) points[index] = { x: 0.6, y: 0.4, z: 0 };

const iris = irisGazeFromLandmarks(points);
assert.ok(iris.left && iris.right, 'both orbits measured');
assert.ok(Math.abs(iris.gazeX) < 0.08, `centered iris gazeX ${iris.gazeX}`);
assert.ok(iris.gazeY != null && Math.abs(iris.gazeY) < 0.25, `centered iris gazeY ${iris.gazeY}`);
assert.equal(gazeXFromLandmarks(points), iris.gazeX);
assert.equal(gazeYFromLandmarks(points), iris.gazeY);

for (const index of PERSON_RIGHT_IRIS) points[index] = { x: 0.44, y: 0.41, z: 0 };
for (const index of PERSON_LEFT_IRIS) points[index] = { x: 0.64, y: 0.41, z: 0 };
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

const landmarker = await readFile(new URL('../src/face/landmarker.ts', import.meta.url), 'utf8');
if (!landmarker.includes('FACE_LANDMARK_COUNT')) throw new Error('478 landmarker missing');
if (landmarker.includes('outputFacialTransformationMatrixes: true')) {
    throw new Error('do not silently flip 478 landmarker options in this change');
}

const overlay = await readFile(new URL('../src/face/overlay.ts', import.meta.url), 'utf8');
if (!overlay.includes('drawIrisEllipse')) throw new Error('overlay missing iris ellipse');
if (!overlay.includes('drawOrbitBox')) throw new Error('overlay missing 眼眶 box');
if (overlay.includes('FACE_LANDMARKS_TESSELATION')) throw new Error('tessellation came back');

const faceView = await readFile(new URL('../src/components/FaceView/FaceView.tsx', import.meta.url), 'utf8');
if (!faceView.includes('detectFrame')) throw new Error('FaceView missing multi-model detectFrame');
if (!faceView.includes('irisGazeFromLandmarks')) throw new Error('FaceView missing 眼眶 iris');
if (!faceView.includes('rayFromEye')) throw new Error('FaceView missing iris rays');
if (!faceView.includes('FatigueSession')) throw new Error('FaceView missing FatigueSession');

const pipeline = await readFile(new URL('../src/face/pipeline.ts', import.meta.url), 'utf8');
if (!pipeline.includes('detectFaceLandmarks') || !pipeline.includes('detectPoseLandmarks')) {
    throw new Error('pipeline must call face and pose together');
}
if (!pipeline.includes('Promise.all')) throw new Error('pipeline must run models in parallel');

const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
if (!app.includes('MobileGaze')) throw new Error('App missing MobileGaze copy');
if (!app.includes('疲劳检测')) throw new Error('App missing 疲劳检测 panel');
if (!app.includes('PERCLOS')) throw new Error('App missing PERCLOS');

const copy = await readFile(new URL('./copy-mediapipe.mjs', import.meta.url), 'utf8');
if (!copy.includes('mobileone_s0_gaze.onnx')) throw new Error('postinstall missing MobileGaze download');
if (!copy.includes('pose_landmarker_lite.task')) throw new Error('postinstall missing Pose lite download');
if (!copy.includes('ort-wasm-simd-threaded.wasm')) throw new Error('postinstall missing ORT wasm copy');

console.log('verify-gaze: pass');
