import { clamp, getRedScore } from '../utils/math';
import { getRadialSignal } from './centerEstimation';

export const estimateFirstBrightRingBrightness = (
    data: Uint8ClampedArray,
    width: number,
    height: number,
    centerX: number,
    centerY: number,
    brightRadii: number[],
) => {
    const firstRadius = brightRadii.find(radius => (
        radius > 8 && radius < Math.min(width, height) * 0.48
    ));
    if (firstRadius === undefined) return null;

    const halfBandWidth = clamp(firstRadius * 0.04, 2, 6);
    const angleSteps = Math.round(clamp(firstRadius * Math.PI * 1.15, 56, 180));
    const values: number[] = [];

    for (let angleIndex = 0; angleIndex < angleSteps; angleIndex += 1) {
        const angle = angleIndex / angleSteps * Math.PI * 2;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        for (let offset = -halfBandWidth; offset <= halfBandWidth; offset += 1) {
            const radius = firstRadius + offset;
            const x = Math.round(centerX + cos * radius);
            const y = Math.round(centerY + sin * radius);
            if (x < 0 || x >= width || y < 0 || y >= height) continue;

            const index = (y * width + x) * 4;
            const red = data[index];
            const green = data[index + 1];
            const blue = data[index + 2];
            const redScore = getRedScore(red, green, blue);
            if (red < 16 || redScore < 8 || red <= green * 1.02 || red <= blue * 1.02) continue;
            values.push(Math.max(red, green, blue) / 255);
        }
    }

    if (values.length < angleSteps * 0.18) return null;
    const sorted = values.sort((a, b) => a - b);
    const start = Math.floor(sorted.length * 0.12);
    const end = Math.max(start + 1, Math.ceil(sorted.length * 0.9));
    const trimmed = sorted.slice(start, end);
    return trimmed.reduce((total, value) => total + value, 0) / trimmed.length;
};

export const estimateCircularRingCoherence = (
    data: Uint8ClampedArray,
    width: number,
    height: number,
    centerX: number,
    centerY: number,
    radii: number[],
    signalReference: number,
) => {
    const usableRadii = radii
        .filter(radius => radius > 12 && radius < Math.min(width, height) * 0.46)
        .slice(0, 8);
    if (usableRadii.length < 3) return 0;

    const angleSteps = 40;
    const signalThreshold = Math.max(8, signalReference * 0.26);
    let totalScore = 0;
    let radiusCount = 0;

    usableRadii.forEach((radius) => {
        const searchRadius = clamp(radius * 0.055, 4, 14);
        let support = 0;
        let weightedOffset = 0;
        let supportWeight = 0;

        for (let angleIndex = 0; angleIndex < angleSteps; angleIndex += 1) {
            const angle = angleIndex / angleSteps * Math.PI * 2;
            const cos = Math.cos(angle);
            const sin = Math.sin(angle);
            let bestSignal = 0;
            let bestOffset = 0;

            for (let offset = -searchRadius; offset <= searchRadius; offset += 2) {
                const sampleRadius = radius + offset;
                const x = Math.round(centerX + cos * sampleRadius);
                const y = Math.round(centerY + sin * sampleRadius);
                if (x < 1 || x >= width - 1 || y < 1 || y >= height - 1) continue;
                const signal = getRadialSignal(data, width, x, y) ?? 0;
                if (signal > bestSignal) {
                    bestSignal = signal;
                    bestOffset = offset;
                }
            }

            if (bestSignal < signalThreshold) continue;
            support += 1;
            supportWeight += bestSignal;
            weightedOffset += Math.abs(bestOffset) * bestSignal;
        }

        if (support < angleSteps * 0.28 || supportWeight <= 0) return;
        const supportRatio = support / angleSteps;
        const offsetPenalty = clamp((weightedOffset / supportWeight) / searchRadius, 0, 1);
        totalScore += supportRatio * (1 - offsetPenalty * 0.72);
        radiusCount += 1;
    });

    return radiusCount > 0 ? clamp(totalScore / radiusCount, 0, 1) : 0;
};
