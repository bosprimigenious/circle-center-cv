import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
    computeScore,
    extractLlmSignals,
    extractVideoSignals,
    mergeSignals,
} from '../src/cheat/scoring.ts';
import {
    gazeXFromLandmarks,
    gazeYFromLandmarks,
    mouthAspectRatio,
    poseFromLandmarks,
} from '../src/cheat/geometry.ts';
import {
    PERSON_LEFT_IRIS,
    PERSON_LEFT_ORBIT,
    PERSON_RIGHT_IRIS,
    PERSON_RIGHT_ORBIT,
} from '../src/gaze/iris.ts';

const cases = [
    [['A-1'], 100, '是'],
    [['B2-1', 'B2-2', 'P-1', 'P-2', 'P-3'], 50, '疑似'],
    [['C-1'], 15, '否'],
    [['B3-1'], 70, '是'],
    [[], 0, '否'],
];

for (const [signals, expectedScore, expectedLabel] of cases) {
    const result = computeScore(signals);
    assert.equal(result.confidence, expectedScore, `score ${JSON.stringify(signals)}`);
    assert.equal(result.is_cheating, expectedLabel, `label ${JSON.stringify(signals)}`);
    assert.equal(result.score_audit.confidence_consistent, true);
}

const llmSignals = extractLlmSignals({
    signals: ['c_3'],
    reasons: [{ signal_id: 'B2-7' }, 'candidate mentions A-2'],
});
assert.deepEqual(llmSignals, ['A-2', 'B2-7', 'C-3']);
assert.deepEqual(mergeSignals(['B3-2', 'B3-1'], llmSignals), ['A-2', 'B2-7', 'B3-1']);

const videoSignals = extractVideoSignals({
    covered_ratio: 0.62,
    static_ratio: 0.2,
    down_ratio: 0.31,
    gaze: { no_face_ratio: 0.1 },
});
assert.deepEqual(videoSignals, ['B3-1', 'B3-7']);

const points = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
points[1] = { x: 0.5, y: 0.5, z: 0 };
points[10] = { x: 0.5, y: 0.2, z: 0 };
points[152] = { x: 0.5, y: 0.8, z: 0 };
for (const index of PERSON_RIGHT_ORBIT) points[index] = { x: 0.4, y: 0.4, z: 0 };
points[33] = { x: 0.35, y: 0.38, z: 0 };
points[133] = { x: 0.45, y: 0.42, z: 0 };
for (const index of PERSON_LEFT_ORBIT) points[index] = { x: 0.6, y: 0.4, z: 0 };
points[263] = { x: 0.65, y: 0.42, z: 0 };
points[362] = { x: 0.55, y: 0.38, z: 0 };
points[13] = { x: 0.5, y: 0.62, z: 0 };
points[14] = { x: 0.5, y: 0.72, z: 0 };
points[61] = { x: 0.4, y: 0.67, z: 0 };
points[291] = { x: 0.6, y: 0.67, z: 0 };
const plantIris = (irisIdx, cx, cy, radius = 0.012) => {
    const ring = [
        [cx, cy],
        [cx + radius, cy],
        [cx, cy + radius],
        [cx - radius, cy],
        [cx, cy - radius],
    ];
    irisIdx.forEach((index, offset) => {
        points[index] = { x: ring[offset][0], y: ring[offset][1], z: 0 };
    });
};
plantIris(PERSON_RIGHT_IRIS, 0.4, 0.4);
plantIris(PERSON_LEFT_IRIS, 0.6, 0.4);

const pose = poseFromLandmarks(points);
assert.ok(pose);
assert.equal(Number(pose.pitch.toFixed(4)), 0.5);
assert.equal(Number(pose.yaw.toFixed(4)), 0);

const gaze = gazeXFromLandmarks(points);
assert.ok(gaze != null);
assert.ok(Math.abs(gaze) < 0.08, `gazeX ${gaze}`);
const gazeY = gazeYFromLandmarks(points);
assert.ok(gazeY != null);
assert.ok(Math.abs(gazeY) < 0.2, `gazeY ${gazeY}`);

const mar = mouthAspectRatio(points);
assert.ok(mar != null);
assert.ok(mar > 0.4 && mar < 0.6);

const faceView = await readFile(new URL('../src/components/FaceView/FaceView.tsx', import.meta.url), 'utf8');
if (!faceView.includes('CheatSession')) {
    throw new Error('FaceView missing CheatSession wiring');
}
if (!faceView.includes('grabCoveredFrame')) {
    throw new Error('FaceView missing brightness/static sampling');
}

const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
if (!app.includes('视觉反作弊')) throw new Error('App missing cheat panel');
if (app.includes('analyzeTranscript') || app.includes('openrouter')) {
    throw new Error('public Pages must not ship LLM1 API client');
}

console.log('verify-cheat-scoring: pass');
