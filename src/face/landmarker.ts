import { FaceLandmarker, type FaceLandmarkerResult } from '@mediapipe/tasks-vision';
import { countFaceRegions, emptyRegionCounts, FACE_LANDMARK_COUNT } from './regions';
import type { DetectedFace, FaceFrameResult, FaceLandmarkPoint } from './types';
import { resolveVisionFileset } from './visionFileset';

type RunningMode = 'IMAGE' | 'VIDEO';
type StatusListener = (status: string) => void;

const MODEL_PATH = `${import.meta.env.BASE_URL}models/face_landmarker.task`;

let landmarker: FaceLandmarker | null = null;
let runningMode: RunningMode = 'VIDEO';
let engineLabel = 'MediaPipe Face Landmarker';
let engineStatus = '正在加载 Face Landmarker…';
let modelBytes: Uint8Array | null = null;
let bootPromise: Promise<FaceLandmarker> | null = null;
let lastVideoTimestamp = 0;
const listeners = new Set<StatusListener>();

const setStatus = (next: string) => {
    engineStatus = next;
    listeners.forEach((listener) => listener(next));
};

export const getFaceEngineStatus = () => engineStatus;
export const getFaceEngineLabel = () => engineLabel;

export const subscribeFaceEngineStatus = (listener: StatusListener) => {
    listeners.add(listener);
    listener(engineStatus);
    return () => {
        listeners.delete(listener);
    };
};

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

const toFrameResult = (result: FaceLandmarkerResult, width: number, height: number): FaceFrameResult => {
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
};

const loadModelBytes = async () => {
    if (modelBytes) return modelBytes;
    const response = await fetch(MODEL_PATH);
    if (!response.ok) {
        throw new Error(`无法加载人脸模型（HTTP ${response.status}）`);
    }
    modelBytes = new Uint8Array(await response.arrayBuffer());
    return modelBytes;
};

const landmarkerOptions = (mode: RunningMode, delegate: 'GPU' | 'CPU', modelAssetBuffer: Uint8Array) => ({
    baseOptions: {
        modelAssetBuffer,
        delegate,
    },
    runningMode: mode,
    numFaces: 1,
    minFaceDetectionConfidence: 0.5,
    minFacePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
    outputFaceBlendshapes: true,
    outputFacialTransformationMatrixes: false,
});

const createLandmarker = async (delegate: 'GPU' | 'CPU', mode: RunningMode) => {
    const [wasm, model] = await Promise.all([resolveVisionFileset(), loadModelBytes()]);
    return FaceLandmarker.createFromOptions(wasm, landmarkerOptions(mode, delegate, model.slice()));
};

const createWithFallback = async (mode: RunningMode) => {
    setStatus('正在下载 WASM 与模型…');
    await Promise.all([resolveVisionFileset(), loadModelBytes()]);
    setStatus('正在初始化 GPU…');
    try {
        const instance = await createLandmarker('GPU', mode);
        engineLabel = 'MediaPipe Face Landmarker · GPU';
        setStatus(engineLabel);
        return instance;
    } catch (error) {
        console.warn('Face Landmarker GPU init failed, falling back to CPU', error);
        setStatus('GPU 不可用，改用 CPU…');
        const instance = await createLandmarker('CPU', mode);
        engineLabel = 'MediaPipe Face Landmarker · CPU';
        setStatus(engineLabel);
        return instance;
    }
};

const applyRunningMode = async (instance: FaceLandmarker, mode: RunningMode) => {
    if (runningMode === mode) return instance;
    try {
        await instance.setOptions({ runningMode: mode });
        runningMode = mode;
        lastVideoTimestamp = 0;
        return instance;
    } catch (error) {
        console.warn('setOptions runningMode failed, recreating landmarker', error);
        instance.close();
        landmarker = null;
        const recreated = await createWithFallback(mode);
        landmarker = recreated;
        runningMode = mode;
        lastVideoTimestamp = 0;
        return recreated;
    }
};

export const ensureFaceLandmarker = async (mode: RunningMode = 'VIDEO') => {
    while (true) {
        if (landmarker && runningMode === mode) return landmarker;
        if (bootPromise) {
            await bootPromise;
            continue;
        }
        bootPromise = (async () => {
            if (!landmarker) {
                landmarker = await createWithFallback(mode);
                runningMode = mode;
                lastVideoTimestamp = 0;
                return landmarker;
            }
            return applyRunningMode(landmarker, mode);
        })().finally(() => {
            bootPromise = null;
        });
        return bootPromise;
    }
};

export const warmupFaceLandmarker = () => ensureFaceLandmarker('VIDEO');

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

const isVideoModeError = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    return /runningMode|video mode/i.test(message);
};

const runDetection = (
    instance: FaceLandmarker,
    source: HTMLVideoElement | HTMLImageElement,
    mode: RunningMode,
    timestampMs: number,
) => {
    if (mode !== 'VIDEO') {
        return instance.detect(source);
    }
    const nextTimestamp = timestampMs <= lastVideoTimestamp ? lastVideoTimestamp + 1 : timestampMs;
    lastVideoTimestamp = nextTimestamp;
    return instance.detectForVideo(source, nextTimestamp);
};

export const detectFaceLandmarks = async (
    source: HTMLVideoElement | HTMLImageElement,
    mode: RunningMode,
    timestampMs = performance.now(),
): Promise<FaceFrameResult> => {
    const { width, height } = sourceSize(source);
    if (!width || !height) return emptyResult(width, height, '画面尚未就绪');

    try {
        let instance = await ensureFaceLandmarker(mode);
        try {
            return toFrameResult(runDetection(instance, source, mode, timestampMs), width, height);
        } catch (error) {
            if (!isVideoModeError(error)) throw error;
            instance.close();
            landmarker = null;
            runningMode = mode;
            instance = await ensureFaceLandmarker(mode);
            return toFrameResult(runDetection(instance, source, mode, timestampMs), width, height);
        }
    } catch (error) {
        return emptyResult(
            width,
            height,
            error instanceof Error ? error.message : String(error),
        );
    }
};
