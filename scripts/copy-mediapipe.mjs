import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const wasmSrc = path.join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const wasmDst = path.join(root, 'public', 'mediapipe', 'wasm');
const modelDst = path.join(root, 'public', 'models', 'face_landmarker.task');
const modelUrl = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const gazeDst = path.join(root, 'public', 'models', 'mobileone_s0_gaze.onnx');
const gazeUrl = 'https://github.com/yakhyo/gaze-estimation/releases/download/weights/mobileone_s0_gaze.onnx';
const ortSrc = path.join(root, 'node_modules', 'onnxruntime-web', 'dist');
const ortDst = path.join(root, 'public', 'ort');
const ortFiles = [
    'ort-wasm-simd-threaded.wasm',
    'ort-wasm-simd-threaded.mjs',
];

if (!fs.existsSync(wasmSrc)) {
    console.error(`missing ${wasmSrc}; run npm install first`);
    process.exit(1);
}

fs.mkdirSync(wasmDst, { recursive: true });
fs.mkdirSync(path.dirname(modelDst), { recursive: true });
const wasmFiles = [
    'vision_wasm_internal.js',
    'vision_wasm_internal.wasm',
    'vision_wasm_nosimd_internal.js',
    'vision_wasm_nosimd_internal.wasm',
];
for (const name of wasmFiles) {
    fs.copyFileSync(path.join(wasmSrc, name), path.join(wasmDst, name));
}
for (const entry of fs.readdirSync(wasmDst)) {
    if (!wasmFiles.includes(entry)) fs.rmSync(path.join(wasmDst, entry), { force: true });
}
console.log(`copied wasm -> ${path.relative(root, wasmDst)} (${wasmFiles.join(', ')})`);

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

if (!fs.existsSync(ortSrc)) {
    console.error(`missing ${ortSrc}; run npm install first`);
    process.exit(1);
}
fs.mkdirSync(ortDst, { recursive: true });
for (const name of ortFiles) {
    const from = path.join(ortSrc, name);
    if (!fs.existsSync(from)) {
        console.error(`missing ORT wasm ${from}`);
        process.exit(1);
    }
    fs.copyFileSync(from, path.join(ortDst, name));
}
for (const entry of fs.readdirSync(ortDst)) {
    if (!ortFiles.includes(entry)) fs.rmSync(path.join(ortDst, entry), { force: true });
}
console.log(`copied ort wasm -> ${path.relative(root, ortDst)} (${ortFiles.join(', ')})`);

if (!fs.existsSync(gazeDst) || fs.statSync(gazeDst).size < 1_000_000) {
    const response = await fetch(gazeUrl);
    if (!response.ok) {
        console.error(`download failed: ${response.status} ${response.statusText} ${gazeUrl}`);
        process.exit(1);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(gazeDst, buffer);
    console.log(`downloaded gaze model ${buffer.length} bytes -> ${path.relative(root, gazeDst)}`);
} else {
    console.log(`keep existing gaze model ${path.relative(root, gazeDst)}`);
}
