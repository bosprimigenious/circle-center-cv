/** L2CS-Net / MobileGaze Gaze360 head: 90 bins × 4° − 180° → radians. */

export const L2CS_BINS = 90;
export const L2CS_BINWIDTH = 4;
export const L2CS_ANGLE_OFFSET = 180;

export const softmax = (logits: ArrayLike<number>): Float32Array => {
    const n = logits.length;
    const out = new Float32Array(n);
    if (!n) return out;
    let max = -Infinity;
    for (let index = 0; index < n; index += 1) {
        const value = logits[index];
        if (value > max) max = value;
    }
    let sum = 0;
    for (let index = 0; index < n; index += 1) {
        const exp = Math.exp(logits[index] - max);
        out[index] = exp;
        sum += exp;
    }
    if (sum <= 0) return out;
    for (let index = 0; index < n; index += 1) out[index] /= sum;
    return out;
};

/** Decode a 90-bin yaw or pitch logit vector to radians. */
export const decodeBinLogits = (logits: ArrayLike<number>): number => {
    const n = Math.min(L2CS_BINS, logits.length);
    const probs = softmax(n === logits.length ? logits : Array.from(logits).slice(0, n));
    let acc = 0;
    for (let index = 0; index < n; index += 1) acc += probs[index] * index;
    const degrees = acc * L2CS_BINWIDTH - L2CS_ANGLE_OFFSET;
    return degrees * (Math.PI / 180);
};
