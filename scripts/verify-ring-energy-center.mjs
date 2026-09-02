/**
 * Contract: a bright blob above concentric rings must not steal the center.
 * Run: node scripts/verify-ring-energy-center.mjs
 */
import fs from 'node:fs/promises';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const boxBlur = (src, width, height, radius) => {
    const windowSize = radius * 2 + 1;
    const tmp = new Float32Array(src.length);
    const dst = new Float32Array(src.length);
    const lastX = width - 1;
    const lastY = height - 1;
    for (let y = 0; y < height; y += 1) {
        const row = y * width;
        let sum = 0;
        for (let x = -radius; x <= radius; x += 1) sum += src[row + clamp(x, 0, lastX)];
        for (let x = 0; x < width; x += 1) {
            tmp[row + x] = sum / windowSize;
            sum += src[row + clamp(x + radius + 1, 0, lastX)] - src[row + clamp(x - radius, 0, lastX)];
        }
    }
    for (let x = 0; x < width; x += 1) {
        let sum = 0;
        for (let y = -radius; y <= radius; y += 1) sum += tmp[clamp(y, 0, lastY) * width + x];
        for (let y = 0; y < height; y += 1) {
            dst[y * width + x] = sum / windowSize;
            sum += tmp[clamp(y + radius + 1, 0, lastY) * width + x] - tmp[clamp(y - radius, 0, lastY) * width + x];
        }
    }
    return dst;
};

const buildHighPassField = (data, width, height) => {
    const count = width * height;
    const red = new Float32Array(count);
    for (let i = 0; i < count; i += 1) red[i] = data[i * 4];
    const radius = Math.max(8, Math.round(Math.min(width, height) * 0.18));
    const blurred = boxBlur(red, width, height, radius);
    const residual = new Float32Array(count);
    let mass = 0;
    let sumX = 0;
    let sumY = 0;
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const index = y * width + x;
            const value = red[index] - blurred[index];
            residual[index] = value;
            const energy = (value * value) / (1 + blurred[index] / 35);
            mass += energy;
            sumX += energy * x;
            sumY += energy * y;
        }
    }
    const rms = Math.sqrt(mass / Math.max(count, 1));
    return {
        residual,
        energyX: mass > 1e-6 ? sumX / mass : width / 2,
        energyY: mass > 1e-6 ? sumY / mass : height / 2,
        energyConfidence: clamp((rms - 3) / 18, 0, 1),
    };
};

const medianValue = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
};

const sampleRed = (data, width, height, x, y) => {
    const px = Math.round(x);
    const py = Math.round(y);
    if (px < 0 || py < 0 || px >= width || py >= height) return null;
    return data[(py * width + px) * 4];
};

const smoothPolarProfile = (raw, window) => raw.map((value, index) => {
    if (value === null) return null;
    let total = 0;
    let weightTotal = 0;
    for (let offset = -window; offset <= window; offset += 1) {
        const source = raw[index + offset];
        if (source === null || source === undefined) continue;
        const weight = window + 1 - Math.abs(offset);
        total += source * weight;
        weightTotal += weight;
    }
    return weightTotal > 0 ? total / weightTotal : null;
});

const scoreRadialOscillationAt = (data, width, height, centerX, centerY) => {
    const minDim = Math.min(width, height);
    const farCorner = Math.hypot(
        Math.max(centerX, width - centerX, 0),
        Math.max(centerY, height - centerY, 0),
    );
    const minRadius = 10;
    const maxRadius = Math.max(24, Math.floor(Math.min(farCorner, Math.hypot(width, height) * 0.9)));
    const angleCount = 16;
    const coverageFloor = 0.3;
    const raw = [];
    for (let radius = minRadius; radius <= maxRadius; radius += 1) {
        const samples = [];
        for (let k = 0; k < angleCount; k += 1) {
            const angle = (k / angleCount) * Math.PI * 2;
            const value = sampleRed(data, width, height, centerX + Math.cos(angle) * radius, centerY + Math.sin(angle) * radius);
            if (value !== null) samples.push(value);
        }
        raw.push(samples.length >= angleCount * coverageFloor ? medianValue(samples) : null);
    }
    const fine = smoothPolarProfile(raw, 2);
    const coarse = smoothPolarProfile(raw, 10);
    let energy = 0;
    let count = 0;
    for (let index = 0; index < fine.length; index += 1) {
        const high = fine[index];
        const low = coarse[index];
        if (high === null || low === null) continue;
        const residual = high - low;
        energy += residual * residual;
        count += 1;
    }
    if (count < 16) return 0;
    const visible = Math.min(1, count / Math.max(24, minDim * 0.12));
    return Math.sqrt(energy / count) * (0.55 + 0.45 * visible);
};

const voteConcentricCenter = (data, width, height) => {
    const count = width * height;
    const red = new Float32Array(count);
    for (let i = 0; i < count; i += 1) red[i] = data[i * 4];
    const bandPass = boxBlur(red, width, height, 2);
    const envelope = boxBlur(red, width, height, 8);
    for (let i = 0; i < count; i += 1) bandPass[i] -= envelope[i];
    const pad = Math.round(Math.min(width, height) * 0.55);
    const originX = -pad;
    const originY = -pad;
    const accW = Math.ceil((width + pad * 2) / 2);
    const accH = Math.ceil((height + pad * 2) / 2);
    const acc = new Float32Array(accW * accH);
    const minRadius = 12;
    const maxRadius = Math.floor(Math.hypot(width, height) * 0.9);
    let magSum = 0;
    let magCount = 0;
    for (let y = 2; y < height - 2; y += 2) {
        for (let x = 2; x < width - 2; x += 2) {
            const gx = bandPass[y * width + x + 1] - bandPass[y * width + x - 1];
            const gy = bandPass[(y + 1) * width + x] - bandPass[(y - 1) * width + x];
            magSum += Math.hypot(gx, gy);
            magCount += 1;
        }
    }
    const magThresh = magCount > 0 ? (magSum / magCount) * 1.2 : 4;
    for (let y = 2; y < height - 2; y += 2) {
        for (let x = 2; x < width - 2; x += 2) {
            const gx = bandPass[y * width + x + 1] - bandPass[y * width + x - 1];
            const gy = bandPass[(y + 1) * width + x] - bandPass[(y - 1) * width + x];
            const mag = Math.hypot(gx, gy);
            if (mag < magThresh) continue;
            const glow = envelope[y * width + x] / 255;
            const weight = mag / (1 + glow * glow * 8);
            const nx = gx / mag;
            const ny = gy / mag;
            for (const dir of [-1, 1]) {
                for (let t = minRadius; t <= maxRadius; t += 3) {
                    const ax = Math.round((x + dir * t * nx - originX) / 2);
                    const ay = Math.round((y + dir * t * ny - originY) / 2);
                    if (ax < 1 || ay < 1 || ax >= accW - 1 || ay >= accH - 1) continue;
                    acc[ay * accW + ax] += weight;
                }
            }
        }
    }
    let best = 0;
    let bestX = Math.round((width / 2 - originX) / 2);
    let bestY = Math.round((height / 2 - originY) / 2);
    for (let y = 1; y < accH - 1; y += 1) {
        for (let x = 1; x < accW - 1; x += 1) {
            const value = acc[y * accW + x]
                + acc[y * accW + x - 1]
                + acc[y * accW + x + 1]
                + acc[(y - 1) * accW + x]
                + acc[(y + 1) * accW + x];
            if (value > best) {
                best = value;
                bestX = x;
                bestY = y;
            }
        }
    }
    return { x: bestX * 2 + originX, y: bestY * 2 + originY, score: best };
};

const refineCenterByRadialOscillation = (data, width, height, initialX, initialY) => {
    const voted = voteConcentricCenter(data, width, height);
    const padX = Math.round(width * 0.45);
    const padY = Math.round(height * 0.45);
    const x0 = -padX;
    const x1 = width + padX;
    const y0 = -padY;
    const y1 = height + padY;
    const anchorX = voted.score > 0 ? voted.x : initialX;
    const anchorY = voted.score > 0 ? voted.y : initialY;
    let bestX = clamp(anchorX, x0, x1);
    let bestY = clamp(anchorY, y0, y1);
    let bestScore = scoreRadialOscillationAt(data, width, height, bestX, bestY);
    const consider = (x, y) => {
        const cx = clamp(x, x0, x1);
        const cy = clamp(y, y0, y1);
        if (Math.hypot(cx - anchorX, cy - anchorY) > 3) return;
        const score = scoreRadialOscillationAt(data, width, height, cx, cy);
        if (score > bestScore) {
            bestScore = score;
            bestX = cx;
            bestY = cy;
        }
    };
    const coarseStep = 1;
    for (let dy = -2; dy <= 2; dy += coarseStep) {
        for (let dx = -2; dx <= 2; dx += coarseStep) consider(anchorX + dx, anchorY + dy);
    }
    return {
        x: bestX,
        y: bestY,
        score: bestScore > 0 ? bestScore : (voted.score > 0 ? 1 : 0),
    };
};

const width = 240;
const height = 180;
const ringX = 120;
const ringY = 128;
const blobX = 120;
const blobY = 68;

const data = new Uint8ClampedArray(width * height * 4);
for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
        const radius = Math.hypot(x - ringX, y - ringY);
        const rings = 110 + 85 * Math.cos(radius / 5.5);
        const blob = Math.exp(-((x - blobX) ** 2 + (y - blobY) ** 2) / (2 * 26 ** 2));
        const red = Math.max(0, Math.min(255, rings * 0.28 + blob * 200));
        const index = (y * width + x) * 4;
        data[index] = red;
        data[index + 1] = red * 0.22;
        data[index + 2] = red * 0.18;
        data[index + 3] = 255;
    }
}

const field = buildHighPassField(data, width, height);
const ringScore = scoreRadialOscillationAt(data, width, height, ringX, ringY);
const blobScore = scoreRadialOscillationAt(data, width, height, blobX, blobY);
const refined = refineCenterByRadialOscillation(data, width, height, blobX, blobY);
const refinedDistRing = Math.hypot(refined.x - ringX, refined.y - ringY);
const refinedDistBlob = Math.hypot(refined.x - blobX, refined.y - blobY);

console.log({
    energy: { x: Number(field.energyX.toFixed(1)), y: Number(field.energyY.toFixed(1)), c: Number(field.energyConfidence.toFixed(3)) },
    ringScore: Number(ringScore.toFixed(1)),
    blobScore: Number(blobScore.toFixed(1)),
    refined: { x: Number(refined.x.toFixed(1)), y: Number(refined.y.toFixed(1)), score: Number(refined.score.toFixed(1)) },
    refinedDistRing: Number(refinedDistRing.toFixed(1)),
    refinedDistBlob: Number(refinedDistBlob.toFixed(1)),
});

const failures = [];
if (!(ringScore > blobScore * 1.15)) failures.push(`oscillation at rings ${ringScore.toFixed(1)} not > blob ${blobScore.toFixed(1)}`);
if (refinedDistRing >= refinedDistBlob) failures.push(`search stuck on blob (${refinedDistBlob.toFixed(1)}) not rings (${refinedDistRing.toFixed(1)})`);
if (refinedDistRing > 16) failures.push(`refined center ${refinedDistRing.toFixed(1)}px from true ring center`);
if (refined.y < (ringY + blobY) / 2) failures.push(`refined Y ${refined.y.toFixed(1)} still above mid, rings are below`);

const leftRingX = -20;
const leftRingY = 90;
const rightBlobX = 160;
const rightBlobY = 100;
const leftData = new Uint8ClampedArray(width * height * 4);
for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
        const radius = Math.hypot(x - leftRingX, y - leftRingY);
        const rings = 110 + 85 * Math.cos(radius / 6.5);
        const blob = Math.exp(-((x - rightBlobX) ** 2 + (y - rightBlobY) ** 2) / (2 * 28 ** 2));
        const red = Math.max(0, Math.min(255, rings * 0.55 + blob * 210));
        const index = (y * width + x) * 4;
        leftData[index] = red;
        leftData[index + 1] = red * 0.22;
        leftData[index + 2] = red * 0.18;
        leftData[index + 3] = 255;
    }
}
const leftRefined = refineCenterByRadialOscillation(leftData, width, height, rightBlobX, rightBlobY);
const leftDistRing = Math.hypot(leftRefined.x - leftRingX, leftRefined.y - leftRingY);
const leftDistBlob = Math.hypot(leftRefined.x - rightBlobX, leftRefined.y - rightBlobY);
console.log({
    leftArc: {
        refined: { x: Number(leftRefined.x.toFixed(1)), y: Number(leftRefined.y.toFixed(1)) },
        distRing: Number(leftDistRing.toFixed(1)),
        distBlob: Number(leftDistBlob.toFixed(1)),
    },
});
if (leftDistRing >= leftDistBlob) failures.push(`left-arc search stuck on right blob (${leftDistBlob.toFixed(1)}) not off-frame center (${leftDistRing.toFixed(1)})`);
if (leftDistRing > 18) failures.push(`left-arc center ${leftDistRing.toFixed(1)}px from true off-frame center`);
if (leftRefined.x > width * 0.22) failures.push(`left-arc center x=${leftRefined.x.toFixed(1)} still in-frame instead of left half-arc`);

const source = await fs.readFile(new URL('../src/components/CameraView/analysis/centerEstimation.ts', import.meta.url), 'utf8');
const detectSource = await fs.readFile(new URL('../src/components/CameraView/analysis/ringDetection.ts', import.meta.url), 'utf8');
if (!source.includes('medianValue(samples)')) failures.push('centerEstimation.ts missing polar median sampling');
if (!source.includes('dir * t * nx')) failures.push('centerEstimation.ts missing concentric-ring Hough vote');
if (!source.includes('glow * glow * 8')) failures.push('centerEstimation.ts missing glow-downweighted Hough votes');
if (!source.includes('originX = -pad')) failures.push('centerEstimation.ts does not allow off-frame ring centers');
if (!detectSource.includes('refineCenterByRadialOscillation')) failures.push('ringDetection.ts does not refine the ring center');
const cameraSource = await fs.readFile(new URL('../src/components/CameraView/constants.ts', import.meta.url), 'utf8');
if (!cameraSource.includes('AUTO_ANALYZE_INTERVAL_MS = 2000')) failures.push('auto-analyze interval is not 2000ms');

if (failures.length) {
    console.error('verify-ring-energy-center: FAIL');
    failures.forEach((item) => console.error(' -', item));
    process.exit(1);
}

console.log('verify-ring-energy-center: pass');
