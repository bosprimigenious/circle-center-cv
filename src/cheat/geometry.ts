import type { FaceLandmarkPoint } from '../face/types';

const dist = (a: FaceLandmarkPoint, b: FaceLandmarkPoint) => (
    Math.hypot(a.x - b.x, a.y - b.y)
);

export const poseFromLandmarks = (lm: FaceLandmarkPoint[]) => {
    if (!lm || lm.length < 264) return null;
    const nose = lm[1];
    const chin = lm[152];
    const forehead = lm[10];
    const leftEye = lm[33];
    const rightEye = lm[263];
    if (!nose || !chin || !forehead || !leftEye || !rightEye) return null;
    const faceH = chin.y - forehead.y;
    if (Math.abs(faceH) < 1e-4) return null;
    const pitch = (nose.y - forehead.y) / faceH;
    const eyeCenter = (leftEye.x + rightEye.x) / 2;
    const yaw = nose.x - eyeCenter;
    return { pitch, yaw };
};

export const gazeXFromLandmarks = (lm: FaceLandmarkPoint[]) => {
    if (!lm || lm.length <= 477) return null;
    const eyeRatio = (outerIdx: number, innerIdx: number, irisIdx: number[]) => {
        const outer = lm[outerIdx];
        const inner = lm[innerIdx];
        if (!outer || !inner) return null;
        const leftX = Math.min(outer.x, inner.x);
        const rightX = Math.max(outer.x, inner.x);
        const width = rightX - leftX;
        if (width <= 1e-6) return null;
        let irisSum = 0;
        let irisN = 0;
        for (const index of irisIdx) {
            const point = lm[index];
            if (!point) continue;
            irisSum += point.x;
            irisN += 1;
        }
        if (!irisN) return null;
        return (irisSum / irisN - leftX) / width - 0.5;
    };
    const left = eyeRatio(33, 133, [468, 469, 470, 471, 472]);
    const right = eyeRatio(362, 263, [473, 474, 475, 476, 477]);
    const vals = [left, right].filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    if (!vals.length) return null;
    return vals.reduce((sum, value) => sum + value, 0) / vals.length;
};

/** 嘴部开合度：内唇上下距 / 嘴角距。火山文档缺口，P2 脚本未用。 */
export const mouthAspectRatio = (lm: FaceLandmarkPoint[]) => {
    const upper = lm[13];
    const lower = lm[14];
    const left = lm[61];
    const right = lm[291];
    if (!upper || !lower || !left || !right) return null;
    const width = dist(left, right);
    if (width < 1e-6) return null;
    return dist(upper, lower) / width;
};

export const eyeAspectRatio = (lm: FaceLandmarkPoint[]) => {
    const oneEye = (indices: [number, number, number, number, number, number]) => {
        const points = indices.map((index) => lm[index]);
        if (points.some((point) => !point)) return null;
        const [p1, p2, p3, p4, p5, p6] = points as FaceLandmarkPoint[];
        const horizontal = dist(p1, p4);
        if (horizontal < 1e-6) return null;
        return (dist(p2, p6) + dist(p3, p5)) / (2 * horizontal);
    };
    const left = oneEye([33, 160, 158, 133, 153, 144]);
    const right = oneEye([362, 385, 387, 263, 373, 380]);
    const vals = [left, right].filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    if (!vals.length) return null;
    return vals.reduce((sum, value) => sum + value, 0) / vals.length;
};

export const brightnessAndGray = (imageData: ImageData) => {
    const { data, width, height } = imageData;
    const gray = new Float32Array(width * height);
    let sum = 0;
    for (let index = 0, pixel = 0; index < data.length; index += 4, pixel += 1) {
        const value = 0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2];
        gray[pixel] = value;
        sum += value;
    }
    return { brightness: sum / (width * height), gray };
};

export const meanAbsDiff = (a: Float32Array, b: Float32Array) => {
    const n = Math.min(a.length, b.length);
    if (!n) return 0;
    let sum = 0;
    for (let index = 0; index < n; index += 1) sum += Math.abs(a[index] - b[index]);
    return sum / n;
};

export const median = (values: Array<number | null | undefined>) => {
    const clean = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value)).sort((a, b) => a - b);
    if (!clean.length) return null;
    const mid = Math.floor(clean.length / 2);
    return clean.length % 2 ? clean[mid] : (clean[mid - 1] + clean[mid]) / 2;
};
