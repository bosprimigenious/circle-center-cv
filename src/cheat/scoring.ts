/**
 * P2 脚本权威计分（对齐 interview-cheat-detector / anti_cheat_service.py）。
 * 本页只跑视频几何信号 B3-*；文本 A/B/C/P 仍由 LLM1 抽，这里不调模型。
 */

export const SIGNAL_ID_RE = /\b(A-[1-3]|B[123]-\d+|C-\d+|P-\d+)\b/g;
export const SEVERE_VIDEO_SIGNALS = ['B3-1', 'B3-2', 'B3-3'] as const;
export const C_TO_B_UPGRADE: Record<string, string> = { 'C-3': 'B2-7' };

export const THRESHOLDS = {
    VIDEO_INTERVAL_SEC: 2,
    DARK: 20,
    STATIC_DIFF: 2.0,
    COVERED_WARN: 0.3,
    COVERED_SEVERE: 0.5,
    STATIC_WARN: 0.5,
    STATIC_SEVERE: 0.99,
    DOWN_DANGER: 0.3,
    DOWN_WARN: 0.15,
    AWAY: 0.3,
    NO_FACE_SEVERE: 0.5,
    BASELINE_DURATION_SEC: 60,
    BASELINE_MIN_SAMPLES: 8,
    PITCH_DOWN_DELTA: 0.08,
    YAW_TURN_DELTA: 0.06,
    GAZE_AWAY_DELTA: 0.08,
    L2CS_YAW_AWAY_RAD: 0.30,
};

export const SIGNAL_CATALOG: Record<string, { level: string; text: string }> = {
    'A-1': { level: 'A', text: '明确承认自己是 AI / 语言模型' },
    'A-2': { level: 'A', text: '暴露生成过程（「作为 AI」「我无法访问」等）' },
    'A-3': { level: 'A', text: '当场承认使用了 ChatGPT / 大模型辅助' },
    'B1-1': { level: 'B', text: '回答只说一两个字就停，明显在等下一段' },
    'B2-1': { level: 'B', text: '口语词与书面长段严重割裂' },
    'B2-2': { level: 'B', text: '每题同一套「第一…第二…第三」模板' },
    'B2-7': { level: 'B', text: '被追问时风格突然变成书面稿' },
    'B3-1': { level: 'B', text: '摄像头严重遮挡（脚本）' },
    'B3-2': { level: 'B', text: '采样帧大量无人脸（脚本）' },
    'B3-3': { level: 'B', text: '画面几乎全程静止（脚本）' },
    'B3-7': { level: 'B', text: '低头率超阈值，可能在看手机/稿（脚本）' },
    'C-1': { level: 'C', text: '全程方法论框架，没有个人经历' },
    'C-2': { level: 'C', text: '同时堆多个异常精确数据' },
    'C-3': { level: 'C', text: '追问时风格变化（弱；可升级为 B2-7）' },
    'P-1': { level: 'P', text: '真实口误或自我修正' },
    'P-2': { level: 'P', text: '思考停顿后换了说法' },
    'P-3': { level: 'P', text: '有具体项目场景细节' },
};

export type CheatScore = {
    signals: string[];
    has_a: boolean;
    Nb: number;
    Nc: number;
    Np: number;
    Nsv: number;
    raw: number;
    deduction: number;
    deduction_base: number;
    confidence: number;
    is_cheating: '是' | '疑似' | '否';
    score_audit: {
        formula: string;
        calculated_confidence: number;
        confidence_consistent: boolean;
        notes: string;
        counts: { Nb: number; Nc: number; Np: number; Nsv: number };
        a_hits: string[];
        b_hits: string[];
        c_hits: string[];
        p_hits: string[];
        raw?: number;
        deduction?: number;
        deduction_base?: number;
    };
};

export type VideoSignalInput = {
    covered_ratio?: number | null;
    static_ratio?: number | null;
    down_ratio?: number | null;
    gaze?: { no_face_ratio?: number | null };
};

export const normalizeSignalId = (value: unknown): string | null => {
    if (value == null) return null;
    const text = String(value).trim().toUpperCase().replace(/_/g, '-');
    SIGNAL_ID_RE.lastIndex = 0;
    let match = SIGNAL_ID_RE.exec(text);
    if (!match) {
        SIGNAL_ID_RE.lastIndex = 0;
        match = SIGNAL_ID_RE.exec(` ${text} `);
    }
    return match ? match[1] : null;
};

const collectSignalIdsFromObj = (obj: unknown, out: Set<string>) => {
    if (obj == null) return;
    if (typeof obj === 'string') {
        const upper = obj.toUpperCase().replace(/_/g, '-');
        SIGNAL_ID_RE.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = SIGNAL_ID_RE.exec(upper))) out.add(match[1]);
        return;
    }
    if (Array.isArray(obj)) {
        for (const item of obj) {
            if (typeof item === 'string') {
                const sid = normalizeSignalId(item);
                if (sid) out.add(sid);
                else collectSignalIdsFromObj(item, out);
            } else if (item && typeof item === 'object') {
                const record = item as Record<string, unknown>;
                for (const key of ['signal_id', 'id', 'signal', 'code']) {
                    if (key in record) {
                        const sid = normalizeSignalId(record[key]);
                        if (sid) out.add(sid);
                    }
                }
                collectSignalIdsFromObj(item, out);
            } else {
                collectSignalIdsFromObj(item, out);
            }
        }
        return;
    }
    if (typeof obj === 'object') {
        const record = obj as Record<string, unknown>;
        for (const key of ['signals', 'hit_signals', 'signal_ids', 'matched_signals', 'signal_list']) {
            if (key in record) collectSignalIdsFromObj(record[key], out);
        }
        for (const key of ['reasons', 'evidence', 'hits', 'details']) {
            if (key in record) collectSignalIdsFromObj(record[key], out);
        }
    }
};

export const extractLlmSignals = (textRes: unknown): string[] => {
    const found = new Set<string>();
    collectSignalIdsFromObj(textRes, found);
    return Array.from(found).sort();
};

export const extractVideoSignals = (videoRes: VideoSignalInput | null | undefined): string[] => {
    if (!videoRes) return [];
    const signals: string[] = [];
    const gaze = videoRes.gaze || {};
    const covered = videoRes.covered_ratio;
    const staticRatio = videoRes.static_ratio;
    const noFace = gaze.no_face_ratio;
    const down = videoRes.down_ratio;

    let severe: string | null = null;
    if (covered != null && covered >= THRESHOLDS.COVERED_SEVERE) severe = 'B3-1';
    else if (noFace != null && noFace >= THRESHOLDS.NO_FACE_SEVERE) severe = 'B3-2';
    else if (staticRatio != null && staticRatio >= THRESHOLDS.STATIC_SEVERE) severe = 'B3-3';
    if (severe) signals.push(severe);
    if (down != null && down >= THRESHOLDS.DOWN_DANGER) signals.push('B3-7');
    return signals;
};

export const applySignalRules = (signals: string[]): string[] => {
    let unique = Array.from(new Set(signals)).sort();
    const dropped = new Set<string>();
    for (const [cId, bId] of Object.entries(C_TO_B_UPGRADE)) {
        if (unique.includes(cId) && unique.includes(bId)) dropped.add(cId);
    }
    unique = unique.filter((item) => !dropped.has(item));
    const presentSevere = SEVERE_VIDEO_SIGNALS.filter((item) => unique.includes(item));
    if (presentSevere.length > 1) {
        const keep = presentSevere[0];
        unique = unique.filter((item) => !SEVERE_VIDEO_SIGNALS.includes(item as typeof SEVERE_VIDEO_SIGNALS[number]) || item === keep);
    }
    return unique.sort();
};

export const mergeSignals = (videoSignals: string[], llmSignals: string[]): string[] => (
    applySignalRules([...(videoSignals || []), ...(llmSignals || [])])
);

export const computeScore = (signals: string[]): CheatScore => {
    const normalized = applySignalRules(signals || []);
    const aHits = normalized.filter((item) => item.startsWith('A-'));
    const bHits = normalized.filter((item) => item.startsWith('B'));
    const cHits = normalized.filter((item) => item.startsWith('C-'));
    const pHits = normalized.filter((item) => item.startsWith('P-'));
    const hasA = aHits.length > 0;
    const Nb = bHits.length;
    const Nc = cHits.length;
    const Np = pHits.length;
    const Nsv = normalized.some((item) => (SEVERE_VIDEO_SIGNALS as readonly string[]).includes(item)) ? 1 : 0;
    const formula =
        '有A则confidence=100；无A则raw=min(100,30×Nb+15×Nc)，deduction按Np/Nb规则计算，confidence=min(100,max(0,raw-deduction))后应用硬性下限';

    if (hasA) {
        return {
            signals: normalized,
            has_a: true,
            Nb,
            Nc,
            Np,
            Nsv,
            raw: 100,
            deduction: 0,
            deduction_base: 0,
            confidence: 100,
            is_cheating: '是',
            score_audit: {
                formula,
                calculated_confidence: 100,
                confidence_consistent: true,
                notes: `命中A：${aHits.join(', ')}；confidence=100`,
                counts: { Nb, Nc, Np, Nsv },
                a_hits: aHits,
                b_hits: bHits,
                c_hits: cHits,
                p_hits: pHits,
            },
        };
    }

    const raw = Math.min(100, 30 * Nb + 15 * Nc);
    const deductionBase = 5 * Np;
    let deduction = 0;
    if (Np === 0) deduction = 0;
    else if (Nb === 0) deduction = Math.min(deductionBase, 10, raw);
    else deduction = Math.min(deductionBase, 10, 5 * Nb);

    let confidence = Math.min(100, Math.max(0, raw - deduction));
    const notes = [
        '无A',
        `按counts计算raw=${raw}`,
        `deduction_base=${deductionBase}，deduction=${deduction}`,
        `初始confidence=${confidence}`,
    ];

    let floor = 0;
    if (Nb >= 1) floor = Math.max(floor, 45);
    if (Nsv === 1) floor = Math.max(floor, 70);
    if (floor > 0 && confidence < floor) {
        notes.push(`应用硬性下限${floor}（原${confidence}）`);
        confidence = floor;
    }

    if (Nb === 0 && Nc === 0 && confidence !== 0) {
        confidence = 0;
        notes.push('无A/B/C命中，confidence置0');
    }

    let isCheating: CheatScore['is_cheating'] = '否';
    if (confidence >= 70) isCheating = '是';
    else if (confidence >= 40) isCheating = '疑似';

    if ((Nb >= 2 || Nsv === 1) && isCheating === '否') {
        isCheating = '疑似';
        notes.push('Nb≥2或Nsv=1，标签至少为疑似');
    }
    if (Nsv === 1) {
        isCheating = '是';
        notes.push('Nsv=1，is_cheating判定为是');
    }

    return {
        signals: normalized,
        has_a: false,
        Nb,
        Nc,
        Np,
        Nsv,
        raw,
        deduction,
        deduction_base: deductionBase,
        confidence,
        is_cheating: isCheating,
        score_audit: {
            formula,
            calculated_confidence: confidence,
            confidence_consistent: true,
            notes: notes.join('；'),
            counts: { Nb, Nc, Np, Nsv },
            raw,
            deduction,
            deduction_base: deductionBase,
            a_hits: aHits,
            b_hits: bHits,
            c_hits: cHits,
            p_hits: pHits,
        },
    };
};

export const riskLevel = (confidence: number) => {
    if (confidence >= 70) return 'danger';
    if (confidence >= 40) return 'warn';
    return 'ok';
};

export const riskLabel = (isCheating: string, confidence: number) => {
    if (isCheating === '是' || confidence >= 70) return '高风险 · 疑似作弊';
    if (isCheating === '疑似' || confidence >= 40) return '中风险 · 需复核';
    return '低风险 · 正常';
};

export const describeSignal = (id: string) => SIGNAL_CATALOG[id] || { level: id[0], text: id };
