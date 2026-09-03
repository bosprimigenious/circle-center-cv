import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { palmCenter, handOverFace } from '../src/hand/geometry.ts';
import { shouldersFromPose } from '../src/pose/shoulders.ts';
import { POSE_FINGER_INDICES } from '../src/pose/types.ts';
import { faceQualityFrom } from '../src/face/completeness.ts';
import { irisGazeFromLandmarks, PERSON_LEFT_IRIS, PERSON_LEFT_ORBIT, PERSON_RIGHT_IRIS, PERSON_RIGHT_ORBIT } from '../src/gaze/iris.ts';

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

const pose = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.8, z: 0, visibility: 0.2 }));
pose[0] = { x: 0.5, y: 0.28, z: 0, visibility: 0.99 };
pose[11] = { x: 0.35, y: 0.55, z: 0, visibility: 0.99 };
pose[12] = { x: 0.65, y: 0.55, z: 0, visibility: 0.99 };
pose[13] = { x: 0.28, y: 0.70, z: 0, visibility: 0.9 };
pose[14] = { x: 0.72, y: 0.70, z: 0, visibility: 0.9 };
pose[15] = { x: 0.22, y: 0.88, z: 0, visibility: 0.9 };
pose[16] = { x: 0.78, y: 0.88, z: 0, visibility: 0.9 };
pose[23] = { x: 0.40, y: 0.95, z: 0, visibility: 0.8 };
pose[24] = { x: 0.60, y: 0.95, z: 0, visibility: 0.8 };
for (const index of POSE_FINGER_INDICES) pose[index] = { x: 0.2, y: 0.9, z: 0, visibility: 0.8 };

const shoulders = shouldersFromPose(pose, { x: 0.5, y: 0.28, z: 0 });
assert.ok(shoulders);
assert.equal(shoulders.poseFingers, 6);
assert.ok(shoulders.leftElbow && shoulders.rightWrist);
assert.ok(shoulders.hipWidth != null && shoulders.hipWidth > 0);
assert.ok(shoulders.torsoDrop != null);
assert.ok((shoulders.leftRaise ?? 1) < 0, 'wrists below shoulders → negative raise');

const raised = pose.map((point) => ({ ...point }));
raised[15] = { x: 0.30, y: 0.35, z: 0, visibility: 0.95 };
const up = shouldersFromPose(raised, { x: 0.5, y: 0.28, z: 0 });
assert.ok(up && (up.leftRaise ?? 0) > 0.1, `raised left hand ${up?.leftRaise}`);

const fingerOver = pose.map((point) => ({ ...point, visibility: 0.2 }));
fingerOver[18] = { x: 0.5, y: 0.45, z: 0, visibility: 0.95 };
const box = { x: 0.22, y: 0.12, width: 0.56, height: 0.68 };
const fingerQuality = faceQualityFrom({
    landmarks: points,
    box,
    iris: irisGazeFromLandmarks(points),
    poseLandmarks: fingerOver,
});
assert.equal(fingerQuality.handOverFace, true);

const emptyHand = Array.from({ length: 21 }, () => ({ x: 0.1, y: 0.9, z: 0 }));
assert.equal(handOverFace(box, [{ landmarks: emptyHand, handedness: 'Left', score: 1, palm: palmCenter(emptyHand) }]), false);

const covering = Array.from({ length: 21 }, () => ({ x: 0.1, y: 0.9, z: 0 }));
covering[8] = { x: 0.5, y: 0.4, z: 0 };
assert.equal(handOverFace(box, [{ landmarks: covering, handedness: 'Right', score: 1, palm: palmCenter(covering) }]), true);

const overlay = await readFile(new URL('../src/face/overlay.ts', import.meta.url), 'utf8');
if (!overlay.includes('drawHandOverlay')) throw new Error('overlay missing hands');
if (!overlay.includes('HAND_CONNECTIONS')) throw new Error('overlay must use HandLandmarker connections');

const landmarker = await readFile(new URL('../src/pose/landmarker.ts', import.meta.url), 'utf8');
if (landmarker.includes('pose_landmarker_lite.task')) throw new Error('pose still on lite');
if (!landmarker.includes('pose_landmarker_full.task')) throw new Error('pose must use full');

console.log('verify-hand: pass');
