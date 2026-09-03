import { HandLandmarker } from '@mediapipe/tasks-vision';
import { resolveVisionFileset } from '../face/visionFileset';
import { palmCenter } from './geometry';
import type { DetectedHand, DetectedHands, HandPoint } from './types';

type RunningMode = 'IMAGE' | 'VIDEO';
type StatusListener = (status: string) => void;

const MODEL_PATH = `${import.meta.env.BASE_URL}models/hand_landmarker.task`;

let landmarker: HandLandmarker | null = null;
let runningMode: RunningMode = 'VIDEO';
let engineLabel = 'Hand Landmarker';
let engineStatus = '正在加载 Hand Landmarker…';
let modelBytes: Uint8Array | null = null;
let bootPromise: Promise<HandLandmarker | null> | null = null;
let lastVideoTimestamp = 0;
const listeners = new Set<StatusListener>();

const setStatus = (next: string) => {
    engineStatus = next;
    listeners.forEach((listener) => listener(next));
};

export const getHandEngineStatus = () => engineStatus;
export const getHandEngineLabel = () => engineLabel;

export const subscribeHandEngineStatus = (listener: StatusListener) => {
    listeners.add(listener);
    listener(engineStatus);
    return () => {
        listeners.delete(listener);
    };
};

export const emptyHands = (engine: string, error?: string): DetectedHands => ({
    hands: [],
    engine,
    error,
});

const loadModelBytes = async () => {
    if (modelBytes) return modelBytes;
    const response = await fetch(MODEL_PATH);
    if (!response.ok) throw new Error(`无法加载 Hand 模型（HTTP ${response.status}）`);
    modelBytes = new Uint8Array(await response.arrayBuffer());
    return modelBytes;
};

const handOptions = (mode: RunningMode, delegate: 'GPU' | 'CPU', modelAssetBuffer: Uint8Array) => ({
    baseOptions: {
        modelAssetBuffer,
        delegate,
    },
    runningMode: mode,
    numHands: 2,
    minHandDetectionConfidence: 0.5,
    minHandPresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
});

const createLandmarker = async (delegate: 'GPU' | 'CPU', mode: RunningMode) => {
    const [wasm, model] = await Promise.all([resolveVisionFileset(), loadModelBytes()]);
    return HandLandmarker.createFromOptions(wasm, handOptions(mode, delegate, model.slice()));
};

const createWithFallback = async (mode: RunningMode) => {
    setStatus('正在下载 Hand 模型…');
    await Promise.all([resolveVisionFileset(), loadModelBytes()]);
    setStatus('正在初始化 Hand GPU…');
    try {
        const instance = await createLandmarker('GPU', mode);
        engineLabel = 'Hand Landmarker · GPU';
        setStatus(engineLabel);
        return instance;
    } catch (error) {
        console.warn('Hand Landmarker GPU init failed, falling back to CPU', error);
        setStatus('Hand GPU 不可用，改用 CPU…');
        const instance = await createLandmarker('CPU', mode);
        engineLabel = 'Hand Landmarker · CPU';
        setStatus(engineLabel);
        return instance;
    }
};

const applyRunningMode = async (instance: HandLandmarker, mode: RunningMode) => {
    if (runningMode === mode) return instance;
    try {
        await instance.setOptions({ runningMode: mode });
        runningMode = mode;
        lastVideoTimestamp = 0;
        return instance;
    } catch (error) {
        console.warn('Hand setOptions runningMode failed, recreating', error);
        instance.close();
        landmarker = null;
        const recreated = await createWithFallback(mode);
        landmarker = recreated;
        runningMode = mode;
        lastVideoTimestamp = 0;
        return recreated;
    }
};

export const ensureHandLandmarker = async (mode: RunningMode = 'VIDEO') => {
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
                engineLabel = 'Hand 不可用';
                setStatus(`Hand 加载失败：${message}`);
                console.warn('Hand Landmarker init failed', error);
                return null;
            }
        })().finally(() => {
            bootPromise = null;
        });
        return bootPromise;
    }
};

export const warmupHandLandmarker = () => ensureHandLandmarker('VIDEO');

const toPoints = (landmarks: Array<{ x: number; y: number; z?: number }>): HandPoint[] => (
    landmarks.map((point) => ({
        x: point.x,
        y: point.y,
        z: point.z ?? 0,
    }))
);

const runDetection = (
    instance: HandLandmarker,
    source: HTMLVideoElement | HTMLImageElement,
    mode: RunningMode,
    timestampMs: number,
) => {
    if (mode !== 'VIDEO') return instance.detect(source);
    const nextTimestamp = timestampMs <= lastVideoTimestamp ? lastVideoTimestamp + 1 : timestampMs;
    lastVideoTimestamp = nextTimestamp;
    return instance.detectForVideo(source, nextTimestamp);
};

export const detectHandLandmarks = async (
    source: HTMLVideoElement | HTMLImageElement,
    mode: RunningMode,
    timestampMs = performance.now(),
): Promise<DetectedHands> => {
    try {
        const instance = await ensureHandLandmarker(mode);
        if (!instance) return emptyHands(engineLabel, engineStatus);
        const result = runDetection(instance, source, mode, timestampMs);
        const hands: DetectedHand[] = (result.landmarks ?? []).map((landmarks, index) => {
            const category = result.handedness?.[index]?.[0];
            const points = toPoints(landmarks);
            return {
                landmarks: points,
                handedness: category?.categoryName ?? 'Unknown',
                score: category?.score ?? 0,
                palm: palmCenter(points),
            };
        });
        return {
            hands,
            engine: engineLabel,
        };
    } catch (error) {
        return emptyHands(engineLabel, error instanceof Error ? error.message : String(error));
    }
};
