import { FaceLandmarker, FilesetResolver, type FaceLandmarkerResult } from '@mediapipe/tasks-vision';
import { countFaceRegions, emptyRegionCounts, FACE_LANDMARK_COUNT } from './regions';
import type { DetectedFace, FaceFrameResult, FaceLandmarkPoint } from './types';

const WASM_ROOT = `${import.meta.env.BASE_URL}mediapipe/wasm`;
const MODEL_PATH = `${import.meta.env.BASE_URL}models/face_landmarker.task`;

let landmarker: FaceLandmarker | null = null;
let runningMode: 'IMAGE' | 'VIDEO' = 'IMAGE';
let engineLabel = 'MediaPipe Face Landmarker';

const boxFromLandmarks = (landmarks: FaceLandmarkPoint[]): DetectedFace['box'] => {
    let minX = 1;
    let minY = 1;
    let maxX = 0;
    let maxY = 0;
    landmarks.forEach((point) => {
        minX = Math.min(minX, point.x);
        minY = Math.min(minY, point.y);
        maxX = Math.max(maxX, point.x);
        maxY = Math.max(maxY, point.y);
    });
    return {
        x: minX,
        y: minY,
        width: Math.max(0, maxX - minX),
        height: Math.max(0, maxY - minY),
    };
};

const toFaces = (result: FaceLandmarkerResult): DetectedFace[] => (
    (result.faceLandmarks ?? []).map((landmarks, index) => {
        const points: FaceLandmarkPoint[] = landmarks.map((point) => ({
            x: point.x,
            y: point.y,
            z: point.z ?? 0,
        }));
        const categories = result.faceBlendshapes?.[index]?.categories ?? [];
        return {
            landmarks: points,
            box: boxFromLandmarks(points),
            blendshapes: categories
                .map((item) => ({ name: item.categoryName, score: item.score }))
                .sort((a, b) => b.score - a.score),
        };
    })
);

const createLandmarker = async (delegate: 'GPU' | 'CPU') => (
    FaceLandmarker.createFromOptions(await FilesetResolver.forVisionTasks(WASM_ROOT), {
        baseOptions: {
            modelAssetPath: MODEL_PATH,
            delegate,
        },
        runningMode,
        numFaces: 4,
        minFaceDetectionConfidence: 0.5,
        minFacePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: true,
    })
);

export const ensureFaceLandmarker = async () => {
    if (landmarker) return landmarker;
    try {
        landmarker = await createLandmarker('GPU');
        engineLabel = 'MediaPipe Face Landmarker · GPU';
    } catch {
        landmarker = await createLandmarker('CPU');
        engineLabel = 'MediaPipe Face Landmarker · CPU';
    }
    return landmarker;
};

const emptyResult = (
    width: number,
    height: number,
    error?: string,
): FaceFrameResult => ({
    timestamp: Date.now(),
    frameWidth: width,
    frameHeight: height,
    faceCount: 0,
    landmarkCount: 0,
    expectedLandmarkCount: FACE_LANDMARK_COUNT,
    regions: emptyRegionCounts(),
    faces: [],
    engine: engineLabel,
    error,
});

const sourceSize = (source: HTMLVideoElement | HTMLImageElement) => {
    if (source instanceof HTMLVideoElement) {
        return { width: source.videoWidth, height: source.videoHeight };
    }
    return { width: source.naturalWidth, height: source.naturalHeight };
};

export const detectFaceLandmarks = async (
    source: HTMLVideoElement | HTMLImageElement,
    mode: 'IMAGE' | 'VIDEO',
    timestampMs = performance.now(),
): Promise<FaceFrameResult> => {
    const { width, height } = sourceSize(source);
    if (!width || !height) return emptyResult(width, height, '画面尚未就绪');

    try {
        const instance = await ensureFaceLandmarker();
        if (runningMode !== mode) {
            await instance.setOptions({ runningMode: mode });
            runningMode = mode;
        }
        const result = mode === 'VIDEO'
            ? instance.detectForVideo(source, timestampMs)
            : instance.detect(source);
        const faces = toFaces(result);
        const primary = faces[0];
        return {
            timestamp: Date.now(),
            frameWidth: width,
            frameHeight: height,
            faceCount: faces.length,
            landmarkCount: primary?.landmarks.length ?? 0,
            expectedLandmarkCount: FACE_LANDMARK_COUNT,
            regions: primary ? countFaceRegions(primary.landmarks) : emptyRegionCounts(),
            faces,
            engine: engineLabel,
        };
    } catch (error) {
        return emptyResult(
            width,
            height,
            error instanceof Error ? error.message : String(error),
        );
    }
};
