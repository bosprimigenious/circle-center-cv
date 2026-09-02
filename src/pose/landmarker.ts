import { PoseLandmarker } from '@mediapipe/tasks-vision';
import { resolveVisionFileset } from '../face/visionFileset';
import { emptyPose, shouldersFromPose } from './shoulders';
import type { DetectedPose, PosePoint } from './types';

type RunningMode = 'IMAGE' | 'VIDEO';
type StatusListener = (status: string) => void;

const MODEL_PATH = `${import.meta.env.BASE_URL}models/pose_landmarker_lite.task`;

let landmarker: PoseLandmarker | null = null;
let runningMode: RunningMode = 'VIDEO';
let engineLabel = 'Pose Landmarker lite';
let engineStatus = '正在加载 Pose Landmarker…';
let modelBytes: Uint8Array | null = null;
let bootPromise: Promise<PoseLandmarker | null> | null = null;
let lastVideoTimestamp = 0;
const listeners = new Set<StatusListener>();

const setStatus = (next: string) => {
    engineStatus = next;
    listeners.forEach((listener) => listener(next));
};

export const getPoseEngineStatus = () => engineStatus;
export const getPoseEngineLabel = () => engineLabel;

export const subscribePoseEngineStatus = (listener: StatusListener) => {
    listeners.add(listener);
    listener(engineStatus);
    return () => {
        listeners.delete(listener);
    };
};

const loadModelBytes = async () => {
    if (modelBytes) return modelBytes;
    const response = await fetch(MODEL_PATH);
    if (!response.ok) throw new Error(`无法加载 Pose 模型（HTTP ${response.status}）`);
    modelBytes = new Uint8Array(await response.arrayBuffer());
    return modelBytes;
};

const poseOptions = (mode: RunningMode, delegate: 'GPU' | 'CPU', modelAssetBuffer: Uint8Array) => ({
    baseOptions: {
        modelAssetBuffer,
        delegate,
    },
    runningMode: mode,
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
    outputSegmentationMasks: false,
});

const createLandmarker = async (delegate: 'GPU' | 'CPU', mode: RunningMode) => {
    const [wasm, model] = await Promise.all([resolveVisionFileset(), loadModelBytes()]);
    return PoseLandmarker.createFromOptions(wasm, poseOptions(mode, delegate, model.slice()));
};

const createWithFallback = async (mode: RunningMode) => {
    setStatus('正在下载 Pose 模型…');
    await Promise.all([resolveVisionFileset(), loadModelBytes()]);
    setStatus('正在初始化 Pose GPU…');
    try {
        const instance = await createLandmarker('GPU', mode);
        engineLabel = 'Pose Landmarker lite · GPU';
        setStatus(engineLabel);
        return instance;
    } catch (error) {
        console.warn('Pose Landmarker GPU init failed, falling back to CPU', error);
        setStatus('Pose GPU 不可用，改用 CPU…');
        const instance = await createLandmarker('CPU', mode);
        engineLabel = 'Pose Landmarker lite · CPU';
        setStatus(engineLabel);
        return instance;
    }
};

const applyRunningMode = async (instance: PoseLandmarker, mode: RunningMode) => {
    if (runningMode === mode) return instance;
    try {
        await instance.setOptions({ runningMode: mode });
        runningMode = mode;
        lastVideoTimestamp = 0;
        return instance;
    } catch (error) {
        console.warn('Pose setOptions runningMode failed, recreating', error);
        instance.close();
        landmarker = null;
        const recreated = await createWithFallback(mode);
        landmarker = recreated;
        runningMode = mode;
        lastVideoTimestamp = 0;
        return recreated;
    }
};

export const ensurePoseLandmarker = async (mode: RunningMode = 'VIDEO') => {
    while (true) {
        if (landmarker && runningMode === mode) return landmarker;
        if (bootPromise) {
            await bootPromise;
            continue;
        }
        bootPromise = (async () => {
            try {
                if (!landmarker) {
                    landmarker = await createWithFallback(mode);
                    runningMode = mode;
                    lastVideoTimestamp = 0;
                    return landmarker;
                }
                return applyRunningMode(landmarker, mode);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                engineLabel = 'Pose 不可用';
                setStatus(`Pose 加载失败：${message}`);
                console.warn('Pose Landmarker init failed', error);
                return null;
            }
        })().finally(() => {
            bootPromise = null;
        });
        return bootPromise;
    }
};

export const warmupPoseLandmarker = () => ensurePoseLandmarker('VIDEO');

const toPoints = (landmarks: Array<{ x: number; y: number; z?: number; visibility?: number }>): PosePoint[] => (
    landmarks.map((point) => ({
        x: point.x,
        y: point.y,
        z: point.z ?? 0,
        visibility: point.visibility ?? 1,
    }))
);

const runDetection = (
    instance: PoseLandmarker,
    source: HTMLVideoElement | HTMLImageElement,
    mode: RunningMode,
    timestampMs: number,
) => {
    if (mode !== 'VIDEO') return instance.detect(source);
    const nextTimestamp = timestampMs <= lastVideoTimestamp ? lastVideoTimestamp + 1 : timestampMs;
    lastVideoTimestamp = nextTimestamp;
    return instance.detectForVideo(source, nextTimestamp);
};

export const detectPoseLandmarks = async (
    source: HTMLVideoElement | HTMLImageElement,
    mode: RunningMode,
    timestampMs = performance.now(),
): Promise<DetectedPose> => {
    try {
        const instance = await ensurePoseLandmarker(mode);
        if (!instance) return emptyPose(engineLabel, engineStatus);
        const result = runDetection(instance, source, mode, timestampMs);
        const raw = result.landmarks?.[0] ?? [];
        const landmarks = toPoints(raw);
        return {
            landmarks,
            shoulders: shouldersFromPose(landmarks),
            engine: engineLabel,
        };
    } catch (error) {
        return emptyPose(engineLabel, error instanceof Error ? error.message : String(error));
    }
};
