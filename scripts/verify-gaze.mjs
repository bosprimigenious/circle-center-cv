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
if (!faceView.includes('estimateGazeFromBox')) throw new Error('FaceView missing MobileGaze call');
if (!faceView.includes('irisGazeFromLandmarks')) throw new Error('FaceView missing 眼眶 iris');
if (/疲劳|PERCLOS|drowsiness/i.test(faceView)) throw new Error('fatigue detection must not be added');

const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
if (!app.includes('MobileGaze')) throw new Error('App missing MobileGaze copy');
if (/(PERCLOS|drowsiness|blinkRate)/i.test(app)) throw new Error('fatigue metrics leaked into App');

const copy = await readFile(new URL('./copy-mediapipe.mjs', import.meta.url), 'utf8');
if (!copy.includes('mobileone_s0_gaze.onnx')) throw new Error('postinstall missing MobileGaze download');
if (!copy.includes('ort-wasm-simd-threaded.wasm')) throw new Error('postinstall missing ORT wasm copy');

console.log('verify-gaze: pass');
