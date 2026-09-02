import { FilesetResolver } from '@mediapipe/tasks-vision';

export const WASM_ROOT = `${import.meta.env.BASE_URL}mediapipe/wasm`;

let filesetPromise: ReturnType<typeof FilesetResolver.forVisionTasks> | null = null;

export const resolveVisionFileset = () => {
    filesetPromise ??= FilesetResolver.forVisionTasks(WASM_ROOT);
    return filesetPromise;
};
