export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const lerp = (from: number, to: number, amount: number) => from + (to - from) * amount;

export const getRedScore = (red: number, green: number, blue: number) => red - Math.max(green, blue);

export const countProfilePeaks = (bins: number[]) => {
    const maxValue = Math.max(...bins, 1);
    let peaks = 0;
    for (let index = 1; index < bins.length - 1; index += 1) {
        const value = bins[index];
        if (
            value > maxValue * 0.28
            && value >= bins[index - 1]
            && value > bins[index + 1]
        ) {
            peaks += 1;
        }
    }
    return peaks;
};

export const smoothProfile = (values: number[], radius = 2) => values.map((_, index) => {
    let total = 0;
    let weightTotal = 0;
    for (let offset = -radius; offset <= radius; offset += 1) {
        const sourceIndex = index + offset;
        if (sourceIndex < 0 || sourceIndex >= values.length) continue;
        const weight = radius + 1 - Math.abs(offset);
        total += values[sourceIndex] * weight;
        weightTotal += weight;
    }
    return total / Math.max(weightTotal, 1);
});

export const getQuantile = (values: number[], quantile: number) => {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const index = clamp(Math.round((sorted.length - 1) * quantile), 0, sorted.length - 1);
    return sorted[index];
};

export const mergeNearbyRadii = (radii: number[], minGap: number) => {
    const sorted = [...radii].sort((a, b) => a - b);
    const merged: number[] = [];
    sorted.forEach((radius) => {
        const last = merged[merged.length - 1];
        if (last === undefined || radius - last >= minGap) {
            merged.push(radius);
        } else {
            merged[merged.length - 1] = (last + radius) / 2;
        }
    });
    return merged;
};

export const normalizeLineAngle = (angle: number) => {
    let normalized = ((angle % Math.PI) + Math.PI) % Math.PI;
    if (normalized > Math.PI / 2) normalized -= Math.PI;
    return normalized;
};
