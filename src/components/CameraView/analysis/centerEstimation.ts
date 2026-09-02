import type { RedSample } from '../types';
import { clamp, getRedScore } from '../utils/math';

export type HighPassField = {
    residual: Float32Array;
    energyX: number;
    energyY: number;
    energyConfidence: number;
};

const boxBlur = (src: Float32Array, width: number, height: number, radius: number) => {
    const windowSize = radius * 2 + 1;
    const tmp = new Float32Array(src.length);
    const dst = new Float32Array(src.length);
    const lastX = width - 1;
    const lastY = height - 1;

    for (let y = 0; y < height; y += 1) {
        const row = y * width;
        let sum = 0;
        for (let x = -radius; x <= radius; x += 1) {
            sum += src[row + clamp(x, 0, lastX)];
        }
        for (let x = 0; x < width; x += 1) {
            tmp[row + x] = sum / windowSize;
            sum += src[row + clamp(x + radius + 1, 0, lastX)] - src[row + clamp(x - radius, 0, lastX)];
        }
    }

    for (let x = 0; x < width; x += 1) {
        let sum = 0;
        for (let y = -radius; y <= radius; y += 1) {
            sum += tmp[clamp(y, 0, lastY) * width + x];
        }
        for (let y = 0; y < height; y += 1) {
            dst[y * width + x] = sum / windowSize;
            sum += tmp[clamp(y + radius + 1, 0, lastY) * width + x] - tmp[clamp(y - radius, 0, lastY) * width + x];
        }
    }

    return dst;
};

/**
 * High-pass the red channel so a bright beam envelope does not steal the
 * ring center. Residual^2 energy centroid is the same cue as ml/geometry_map.
 */
export const buildHighPassField = (
    data: Uint8ClampedArray,
    width: number,
    height: number,
): HighPassField => {
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

export const getRadialSignal = (data: Uint8ClampedArray, width: number, x: number, y: number) => {
    const index = (y * width + x) * 4;
    const red = data[index];
    const green = data[index + 1];
    const blue = data[index + 2];
    const redScore = Math.max(0, getRedScore(red, green, blue));
    const brightness = Math.max(red, green, blue);
    if (brightness <= 7 || red <= green * 0.72 || red <= blue * 0.72) return null;
    return red * 0.5 + redScore * 1.35 - Math.max(green, blue) * 0.12;
};

const medianValue = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
};

const sampleRed = (
    data: Uint8ClampedArray,
    width: number,
    height: number,
    x: number,
    y: number,
) => {
    const px = Math.round(x);
    const py = Math.round(y);
    if (px < 0 || py < 0 || px >= width || py >= height) return null;
    return data[(py * width + px) * 4];
};

const smoothPolarProfile = (raw: Array<number | null>, window: number) => (
    raw.map((value, index) => {
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
    })
);

/**
 * Polar-median band-pass RMS. Concentric rings make the median along each
 * circle oscillate with radius; a beam blob does not.
 * Partial arcs (center off-frame) still score if ~30% of the circle is visible.
 */
export const scoreRadialOscillationAt = (
    data: Uint8ClampedArray,
    width: number,
    height: number,
    centerX: number,
    centerY: number,
) => {
    const minDim = Math.min(width, height);
    const farCorner = Math.hypot(
        Math.max(centerX, width - centerX, 0),
        Math.max(centerY, height - centerY, 0),
    );
    const minRadius = 10;
    const maxRadius = Math.max(24, Math.floor(Math.min(farCorner, Math.hypot(width, height) * 0.9)));
    const angleCount = 16;
    const coverageFloor = 0.3;
    const raw: Array<number | null> = [];
    for (let radius = minRadius; radius <= maxRadius; radius += 1) {
        const samples: number[] = [];
        for (let k = 0; k < angleCount; k += 1) {
            const angle = (k / angleCount) * Math.PI * 2;
            const value = sampleRed(
                data,
                width,
                height,
                centerX + Math.cos(angle) * radius,
                centerY + Math.sin(angle) * radius,
            );
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

/**
 * Ring-edge normals of a concentric interferogram intersect at the center.
 * Band-pass the red channel, downweight the beam glow, and allow the
 * center to sit off-frame when only a half-arc is visible.
 */
const voteConcentricCenter = (
    data: Uint8ClampedArray,
    width: number,
    height: number,
) => {
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

export const refineCenterByRadialOscillation = (
    data: Uint8ClampedArray,
    width: number,
    height: number,
    initialX: number,
    initialY: number,
) => {
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

    const consider = (x: number, y: number) => {
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
        for (let dx = -2; dx <= 2; dx += coarseStep) {
            consider(anchorX + dx, anchorY + dy);
        }
    }

    return {
        x: bestX,
        y: bestY,
        score: bestScore > 0 ? bestScore : (voted.score > 0 ? 1 : 0),
    };
};

export const estimateCenterFromRingGeometry = (
    samples: RedSample[],
    width: number,
    height: number,
) => {
    if (samples.length < 20) return null;
    const totalWeight = samples.reduce((total, sample) => total + sample.weight, 0);
    const weightedQuantile = (axis: 'x' | 'y', quantile: number) => {
        const sorted = [...samples].sort((a, b) => a[axis] - b[axis]);
        let running = 0;
        for (const sample of sorted) {
            running += sample.weight;
            if (running >= totalWeight * quantile) return sample[axis];
        }
        return sorted[sorted.length - 1][axis];
    };
    const left = weightedQuantile('x', 0.08);
    const right = weightedQuantile('x', 0.92);
    const top = weightedQuantile('y', 0.08);
    const bottom = weightedQuantile('y', 0.92);
    const x = (left + right) / 2;
    const y = (top + bottom) / 2;
    const spanX = Math.max(1, right - left);
    const spanY = Math.max(1, bottom - top);
    const confidence = clamp(Math.min(spanX, spanY) / Math.max(spanX, spanY) + samples.length / 600, 0, 1);
    if (x < 0 || x > width || y < 0 || y > height) return null;
    return { x, y, confidence };
};

export const fitRadialCenter = (
    samples: RedSample[],
    scoreMap: Float32Array,
    width: number,
    height: number,
    peakScore: number,
) => {
    let a = 0;
    let b = 0;
    let d = 0;
    let rhsX = 0;
    let rhsY = 0;
    let voteWeight = 0;

    samples.forEach((sample) => {
        const x = Math.round(sample.x);
        const y = Math.round(sample.y);
        if (x <= 0 || x >= width - 1 || y <= 0 || y >= height - 1) return;

        const gx = scoreMap[y * width + x + 1] - scoreMap[y * width + x - 1];
        const gy = scoreMap[(y + 1) * width + x] - scoreMap[(y - 1) * width + x];
        const gradient = Math.hypot(gx, gy);
        if (gradient < Math.max(4, peakScore * 0.045)) return;

        const lineNormalX = -gy / gradient;
        const lineNormalY = gx / gradient;
        const weight = sample.weight * clamp(gradient / Math.max(peakScore, 1), 0.08, 1);
        const dot = lineNormalX * x + lineNormalY * y;

        a += weight * lineNormalX * lineNormalX;
        b += weight * lineNormalX * lineNormalY;
        d += weight * lineNormalY * lineNormalY;
        rhsX += weight * lineNormalX * dot;
        rhsY += weight * lineNormalY * dot;
        voteWeight += weight;
    });

    const determinant = a * d - b * b;
    // 降低投票门控，让弱信号也能参与圆心估计
    if (voteWeight < 2 || Math.abs(determinant) < voteWeight * voteWeight * 0.0005) return null;

    const x = (d * rhsX - b * rhsY) / determinant;
    const y = (a * rhsY - b * rhsX) / determinant;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    if (x < -width * 0.45 || x > width * 1.45 || y < -height * 0.45 || y > height * 1.45) return null;

    return {
        x,
        y,
        confidence: clamp(voteWeight / Math.max(samples.length * 0.04, 1), 0, 1),
    };
};
