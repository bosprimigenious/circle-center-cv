import * as ort from 'onnxruntime-web/wasm';
import type { FaceBox } from '../face/types';
import { decodeBinLogits } from './decode';
import type { L2csGaze } from './types';

const WASM_ROOT = `${import.meta.env.BASE_URL}ort/`;
const MODEL_PATH = `${import.meta.env.BASE_URL}models/mobileone_s0_gaze.onnx`;
const INPUT_SIZE = 448;
const IMAGENET_MEAN = [0.485, 0.456, 0.406];
const IMAGENET_STD = [0.229, 0.224, 0.225];
const FACE_PAD = 0.12;

type StatusListener = (status: string) => void;

let session: ort.InferenceSession | null = null;
let bootPromise: Promise<ort.InferenceSession | null> | null = null;
let engineLabel = 'MobileGaze L2CS';
let engineStatus = '正在加载 MobileGaze…';
const listeners = new Set<StatusListener>();
let cropCanvas: HTMLCanvasElement | null = null;

const setStatus = (next: string) => {
    engineStatus = next;
    listeners.forEach((listener) => listener(next));
};

export const getGazeEngineStatus = () => engineStatus;
export const getGazeEngineLabel = () => engineLabel;

export const subscribeGazeEngineStatus = (listener: StatusListener) => {
    listeners.add(listener);
    listener(engineStatus);
    return () => {
        listeners.delete(listener);
    };
};

const configureOrt = () => {
    ort.env.wasm.wasmPaths = WASM_ROOT;
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.simd = true;
};

const cropCanvas2d = () => {
    if (!cropCanvas) {
        cropCanvas = document.createElement('canvas');
        cropCanvas.width = INPUT_SIZE;
        cropCanvas.height = INPUT_SIZE;
    }
    const ctx = cropCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('无法创建虹膜/视线 crop canvas');
    return ctx;
};

const sourceSize = (source: HTMLVideoElement | HTMLImageElement) => {
    if (source instanceof HTMLVideoElement) {
        return { width: source.videoWidth, height: source.videoHeight };
    }
    return { width: source.naturalWidth, height: source.naturalHeight };
};

const paddedPixelBox = (box: FaceBox, width: number, height: number) => {
    const padX = box.width * FACE_PAD;
    const padY = box.height * FACE_PAD;
    const x = Math.max(0, (box.x - padX) * width);
    const y = Math.max(0, (box.y - padY) * height);
    const x2 = Math.min(width, (box.x + box.width + padX) * width);
    const y2 = Math.min(height, (box.y + box.height + padY) * height);
    return { x, y, w: Math.max(1, x2 - x), h: Math.max(1, y2 - y) };
};

const toNchwImageNet = (image: ImageData): Float32Array => {
    const { data, width, height } = image;
    const plane = width * height;
    const out = new Float32Array(3 * plane);
    for (let pixel = 0, index = 0; pixel < plane; pixel += 1, index += 4) {
        out[pixel] = (data[index] / 255 - IMAGENET_MEAN[0]) / IMAGENET_STD[0];
        out[plane + pixel] = (data[index + 1] / 255 - IMAGENET_MEAN[1]) / IMAGENET_STD[1];
        out[2 * plane + pixel] = (data[index + 2] / 255 - IMAGENET_MEAN[2]) / IMAGENET_STD[2];
    }
    return out;
};

const logitsFrom = (tensor: ort.Tensor | undefined): ArrayLike<number> => {
    if (!tensor) return [];
    const data = tensor.data;
    if (data instanceof Float32Array || data instanceof Float64Array) return data;
    if (ArrayBuffer.isView(data)) return new Float32Array(data.buffer, data.byteOffset, data.byteLength / 4);
    return Float32Array.from(Array.from(data as Iterable<unknown>, (value) => Number(value)));
};

const pickYawPitch = (results: Record<string, ort.Tensor>, names: readonly string[]) => {
    const keys = Object.keys(results);
    const yawKey = keys.find((key) => /yaw/i.test(key)) ?? names[0] ?? keys[0];
    const pitchKey = keys.find((key) => /pitch/i.test(key)) ?? names[1] ?? keys[1] ?? yawKey;
    return {
        yaw: decodeBinLogits(logitsFrom(results[yawKey])),
        pitch: decodeBinLogits(logitsFrom(results[pitchKey])),
    };
};

const createSession = async () => {
    configureOrt();
    setStatus('正在下载 MobileGaze ONNX…');
    return ort.InferenceSession.create(MODEL_PATH, {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all',
    });
};

export const ensureGazeEstimator = async () => {
    if (session) return session;
    if (bootPromise) return bootPromise;
    bootPromise = (async () => {
        try {
            const next = await createSession();
            session = next;
            engineLabel = 'MobileGaze L2CS · WASM';
            setStatus(engineLabel);
            return next;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            engineLabel = 'MobileGaze 不可用';
            setStatus(`MobileGaze 加载失败：${message}`);
            console.warn('MobileGaze L2CS init failed', error);
            return null;
        }
    })().finally(() => {
        bootPromise = null;
    });
    return bootPromise;
};

export const warmupGazeEstimator = () => ensureGazeEstimator();

export const estimateGazeFromBox = async (
    source: HTMLVideoElement | HTMLImageElement,
    box: FaceBox | null | undefined,
): Promise<L2csGaze | null> => {
    if (!box || box.width < 0.04 || box.height < 0.04) return null;
    const instance = await ensureGazeEstimator();
    if (!instance) return null;
    const { width, height } = sourceSize(source);
    if (!width || !height) return null;
    const crop = paddedPixelBox(box, width, height);
    const ctx = cropCanvas2d();
    ctx.drawImage(source, crop.x, crop.y, crop.w, crop.h, 0, 0, INPUT_SIZE, INPUT_SIZE);
    const image = ctx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE);
    const tensor = new ort.Tensor('float32', toNchwImageNet(image), [1, 3, INPUT_SIZE, INPUT_SIZE]);
    const inputName = instance.inputNames[0] ?? 'input';
    const results = await instance.run({ [inputName]: tensor });
    return pickYawPitch(results as Record<string, ort.Tensor>, instance.outputNames);
};
