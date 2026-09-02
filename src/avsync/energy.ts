export const rmsFromTimeDomain = (samples: ArrayLike<number>) => {
    const n = samples.length;
    if (!n) return 0;
    let sum = 0;
    for (let index = 0; index < n; index += 1) {
        const value = samples[index];
        sum += value * value;
    }
    return Math.sqrt(sum / n);
};

export const zscore = (values: number[]) => {
    if (!values.length) return values.slice();
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    let variance = 0;
    for (const value of values) variance += (value - mean) ** 2;
    const std = Math.sqrt(variance / values.length);
    if (std < 1e-9) return values.map(() => 0);
    return values.map((value) => (value - mean) / std);
};

export const resampleSeries = (
    ticks: Array<{ t: number; value: number }>,
    start: number,
    end: number,
    dt: number,
) => {
    const out: number[] = [];
    if (!ticks.length || dt <= 0 || end < start) return out;
    let index = 0;
    for (let t = start; t <= end + 1e-9; t += dt) {
        while (index + 1 < ticks.length && ticks[index + 1].t <= t) index += 1;
        const cur = ticks[index];
        const next = ticks[index + 1];
        if (!cur) {
            out.push(0);
            continue;
        }
        if (!next || next.t === cur.t || t <= cur.t) {
            out.push(cur.value);
            continue;
        }
        const w = (t - cur.t) / (next.t - cur.t);
        out.push(cur.value + (next.value - cur.value) * Math.min(1, Math.max(0, w)));
    }
    return out;
};

/**
 * lagSec > 0：b 相对 a 滞后（音频晚于口型）。
 * 返回平均点积最大的整数格点延迟。
 */
export const bestLagSec = (a: number[], b: number[], dt: number, maxLagSec: number) => {
    if (a.length < 4 || b.length < 4 || dt <= 0) return { lagSec: null as number | null, score: 0 };
    const za = zscore(a);
    const zb = zscore(b);
    const maxLag = Math.max(1, Math.round(maxLagSec / dt));
    let bestLag = 0;
    let bestScore = -Infinity;
    for (let lag = -maxLag; lag <= maxLag; lag += 1) {
        let sum = 0;
        let n = 0;
        for (let index = 0; index < za.length; index += 1) {
            const other = index + lag;
            if (other < 0 || other >= zb.length) continue;
            sum += za[index] * zb[other];
            n += 1;
        }
        if (n < 4) continue;
        const score = sum / n;
        if (score > bestScore) {
            bestScore = score;
            bestLag = lag;
        }
    }
    if (!Number.isFinite(bestScore) || bestScore === -Infinity) return { lagSec: null, score: 0 };
    return { lagSec: bestLag * dt, score: bestScore };
};
