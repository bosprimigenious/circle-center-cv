import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const wasmSrc = path.join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const wasmDst = path.join(root, 'public', 'mediapipe', 'wasm');
const modelDst = path.join(root, 'public', 'models', 'face_landmarker.task');
const modelUrl = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

if (!fs.existsSync(wasmSrc)) {
    console.error(`missing ${wasmSrc}; run npm install first`);
    process.exit(1);
}

fs.mkdirSync(wasmDst, { recursive: true });
fs.mkdirSync(path.dirname(modelDst), { recursive: true });
fs.cpSync(wasmSrc, wasmDst, { recursive: true });
console.log(`copied wasm -> ${path.relative(root, wasmDst)}`);

if (!fs.existsSync(modelDst) || fs.statSync(modelDst).size < 1_000_000) {
    const response = await fetch(modelUrl);
    if (!response.ok) {
        console.error(`download failed: ${response.status} ${response.statusText} ${modelUrl}`);
        process.exit(1);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(modelDst, buffer);
    console.log(`downloaded model ${buffer.length} bytes -> ${path.relative(root, modelDst)}`);
} else {
    console.log(`keep existing model ${path.relative(root, modelDst)}`);
}
