import type { RedSample, LineModel } from '../types';
import { clamp, normalizeLineAngle, smoothProfile, getQuantile, mergeNearbyRadii } from '../utils/math';

export const estimateLineModelFromSamples = (
    samples: RedSample[],
    width: number,
    height: number,
    centerX: number,
    centerY: number,
    lineAngle: number,
): LineModel => {
    if (samples.length < 24) return { angle: normalizeLineAngle(lineAngle), curve: 0, offsetsNorm: [] };

    const scale = Math.max(width, height);
    const sampleStride = Math.max(1, Math.ceil(samples.length / 7000));
    const scanSamples = samples.filter((_, index) => index % sampleStride === 0);
    const minOffset = -0.72;
    const maxOffset = 0.72;
    const binCount = 112;
    const binSize = (maxOffset - minOffset) / binCount;

    const scoreProjectionAngle = (angle: number) => {
        const normalX = -Math.sin(angle);
        const normalY = Math.cos(angle);
        const bins = Array.from({ length: binCount }, () => 0);
        scanSamples.forEach((sample) => {
            const dx = sample.x - centerX;
            const dy = sample.y - centerY;
            const offset = (dx * normalX + dy * normalY) / scale;
            if (offset < minOffset || offset > maxOffset) return;
            const index = clamp(Math.floor((offset - minOffset) / binSize), 0, binCount - 1);
            bins[index] += sample.weight;
        });

        const profile = smoothProfile(bins, 1);
        const baseline = getQuantile(profile, 0.35);
        const high = getQuantile(profile, 0.94);
        const threshold = baseline + Math.max(0.4, (high - baseline) * 0.22);
        let peakCount = 0;
        let peakEnergy = 0;
        for (let index = 2; index < profile.length - 2; index += 1) {
            const value = profile[index];
            if (value < threshold) continue;
            if (value < profile[index - 1] || value <= profile[index + 1]) continue;
            const shoulder = Math.max(profile[index - 2], profile[index + 2], baseline);
            const prominence = value - shoulder;
            if (prominence <= 0) continue;
            peakCount += 1;
            peakEnergy += prominence * prominence;
        }

        return peakCount >= 3
            ? peakEnergy * clamp(peakCount / 8, 0.55, 1.45)
            : peakEnergy * 0.2;
    };

    let bestAngle = normalizeLineAngle(lineAngle);
    let bestScore = -Infinity;
    for (let degrees = -88; degrees <= 88; degrees += 2) {
        const angle = degrees * Math.PI / 180;
        const score = scoreProjectionAngle(angle);
        if (score > bestScore) {
            bestScore = score;
            bestAngle = angle;
        }
    }
    const coarseBestAngle = bestAngle;
    for (let deltaDegrees = -2.5; deltaDegrees <= 2.5; deltaDegrees += 0.5) {
        const angle = normalizeLineAngle(coarseBestAngle + deltaDegrees * Math.PI / 180);
        const score = scoreProjectionAngle(angle);
        if (score > bestScore) {
            bestScore = score;
            bestAngle = angle;
        }
    }

    const directionX = Math.cos(bestAngle);
    const directionY = Math.sin(bestAngle);
    const normalX = -directionY;
    const normalY = directionX;
    const coordinates = samples
        .map((sample) => {
            const dx = sample.x - centerX;
            const dy = sample.y - centerY;
            return {
                u: (dx * directionX + dy * directionY) / scale,
                v: (dx * normalX + dy * normalY) / scale,
                weight: sample.weight,
            };
        })
        .filter(point => Math.abs(point.u) < 0.9 && Math.abs(point.v) < 0.9);

    if (coordinates.length < 24) return { angle: bestAngle, curve: 0, offsetsNorm: [] };

    let totalWeight = 0;
    let meanUU = 0;
    let meanV = 0;
    coordinates.forEach((point) => {
        if (Math.abs(point.u) < 0.06) return;
        const weight = point.weight;
        totalWeight += weight;
        meanUU += point.u * point.u * weight;
        meanV += point.v * weight;
    });
    meanUU /= Math.max(totalWeight, 1);
    meanV /= Math.max(totalWeight, 1);

    let numerator = 0;
    let denominator = 0;
    coordinates.forEach((point) => {
        if (Math.abs(point.u) < 0.06) return;
        const uu = point.u * point.u;
        const centeredUU = uu - meanUU;
        const centeredV = point.v - meanV;
        numerator += point.weight * centeredUU * centeredV;
        denominator += point.weight * centeredUU * centeredUU;
    });
    const curve = denominator > 1e-5 ? clamp(numerator / denominator, -0.55, 0.55) : 0;

    const bins = Array.from({ length: binCount }, () => 0);
    coordinates.forEach((point) => {
        const correctedOffset = point.v - curve * point.u * point.u;
        if (correctedOffset < minOffset || correctedOffset > maxOffset) return;
        const index = clamp(Math.floor((correctedOffset - minOffset) / binSize), 0, binCount - 1);
        bins[index] += point.weight;
    });

    const profile = smoothProfile(bins, 1);
    const peak = Math.max(...profile, 1);
    const offsets: number[] = [];
    for (let index = 1; index < profile.length - 1; index += 1) {
        if (profile[index] < peak * 0.18) continue;
        if (profile[index] < profile[index - 1] || profile[index] <= profile[index + 1]) continue;

        let weightedIndex = 0;
        let weightTotal = 0;
        for (let offset = -2; offset <= 2; offset += 1) {
            const sourceIndex = index + offset;
            if (sourceIndex < 0 || sourceIndex >= profile.length) continue;
            const weight = profile[sourceIndex];
            weightedIndex += sourceIndex * weight;
            weightTotal += weight;
        }
        if (weightTotal <= 0) continue;
        offsets.push(minOffset + (weightedIndex / weightTotal + 0.5) * binSize);
    }

    return {
        angle: bestAngle,
        curve,
        offsetsNorm: mergeNearbyRadii(offsets, 0.038).slice(0, 14),
    };
};
