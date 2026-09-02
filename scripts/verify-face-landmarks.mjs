import { FaceLandmarker } from '@mediapipe/tasks-vision';

const unique = (connections) => {
    const indices = new Set();
    for (const item of connections ?? []) {
        indices.add(item.start);
        indices.add(item.end);
    }
    return indices;
};

const oval = unique(FaceLandmarker.FACE_LANDMARKS_FACE_OVAL);
const lips = unique(FaceLandmarker.FACE_LANDMARKS_LIPS);
const leftEye = unique(FaceLandmarker.FACE_LANDMARKS_LEFT_EYE);
const rightEye = unique(FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE);
const leftBrow = unique(FaceLandmarker.FACE_LANDMARKS_LEFT_EYEBROW);
const rightBrow = unique(FaceLandmarker.FACE_LANDMARKS_RIGHT_EYEBROW);
const leftIrisContour = unique(FaceLandmarker.FACE_LANDMARKS_LEFT_IRIS);
const rightIrisContour = unique(FaceLandmarker.FACE_LANDMARKS_RIGHT_IRIS);
const mesh = unique(FaceLandmarker.FACE_LANDMARKS_TESSELATION);
const leftIris = new Set([473, 474, 475, 476, 477]);
const rightIris = new Set([468, 469, 470, 471, 472]);
const all = new Set([...Array.from({ length: 478 }, (_, index) => index)]);

const summary = {
    oval: oval.size,
    lips: lips.size,
    leftEye: leftEye.size,
    rightEye: rightEye.size,
    leftBrow: leftBrow.size,
    rightBrow: rightBrow.size,
    leftIrisContour: leftIrisContour.size,
    rightIrisContour: rightIrisContour.size,
    mesh: mesh.size,
    irisCentersAndRims: leftIris.size + rightIris.size,
    all: all.size,
};

console.log(summary);

const failures = [];
if (mesh.size !== 468) failures.push(`tesselation covers ${mesh.size}, expected 468 mesh points`);
if (leftIris.size + rightIris.size !== 10) failures.push('iris index set is not 10 points');
if (all.size !== 478) failures.push(`canonical landmark count ${all.size} !== 478`);
if (lips.size < 16) failures.push(`lips only ${lips.size}`);
if (oval.size < 16) failures.push(`face oval only ${oval.size}`);
if (leftEye.size < 8 || rightEye.size < 8) failures.push('eye contours too sparse');
if (leftIrisContour.size < 4 || rightIrisContour.size < 4) failures.push('iris contours missing');
if (![...leftIrisContour].every((index) => leftIris.has(index))) failures.push('left iris contour outside 473-477');
if (![...rightIrisContour].every((index) => rightIris.has(index))) failures.push('right iris contour outside 468-472');

const source = await import('node:fs/promises').then((fs) => fs.readFile(
    new URL('../src/face/landmarker.ts', import.meta.url),
    'utf8',
));
if (source.includes('FaceDetector.createFromOptions')) failures.push('landmarker.ts still uses Face Detector');
if (!source.includes('outputFaceBlendshapes: true')) failures.push('blendshapes not requested');
if (!source.includes('numFaces: 4')) failures.push('multi-face not enabled');

if (failures.length) {
    console.error('verify-face-landmarks: FAIL');
    failures.forEach((item) => console.error(' -', item));
    process.exit(1);
}

console.log('verify-face-landmarks: pass');
