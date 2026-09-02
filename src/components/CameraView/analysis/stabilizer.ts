import type { CameraAnalysis, AnalysisStabilizerState } from '../types';
import { clamp, lerp, mergeNearbyRadii } from '../utils/math';
import { CenterKalmanFilter } from './kalmanFilter';

export const stabilizeAnalysis = (raw: CameraAnalysis, state: AnalysisStabilizerState): CameraAnalysis => {
    const previous = state.analysis;
    const rawDetected = raw.status !== 'searching' && raw.confidence >= 0.16;

    // ========== Kalman 预测（每帧执行） ==========
    let kalmanPred: { x: number; y: number } | null = null;
    if (state.kalman?.isInitialized()) {
        kalmanPred = state.kalman.predict();
    }

    // ========== 检测失败分支 ==========
    if (!rawDetected) {
        state.detectedCount = 0;
        state.missingCount += 1;
        state.candidatePattern = null;
        state.candidatePatternCount = 0;

        if (previous && previous.status !== 'searching' && state.missingCount < 4) {
            const heldConfidence = clamp(previous.confidence * 0.92, 0.18, 1);
            // 使用卡尔曼预测圆心（若可用），否则冻结上一帧
            const heldCenterX = kalmanPred && Number.isFinite(kalmanPred.x) ? kalmanPred.x : previous.centerX;
            const heldCenterY = kalmanPred && Number.isFinite(kalmanPred.y) ? kalmanPred.y : previous.centerY;
            const held: CameraAnalysis = {
                ...previous,
                timestamp: raw.timestamp,
                centerX: heldCenterX,
                centerY: heldCenterY,
                offsetXNorm: (heldCenterX - raw.frameWidth / 2) / (raw.frameWidth / 2),
                offsetYNorm: (heldCenterY - raw.frameHeight / 2) / (raw.frameHeight / 2),
                confidence: heldConfidence,
                peakBrightness: lerp(previous.peakBrightness, raw.peakBrightness, 0.18),
                firstBrightRingBrightness: raw.firstBrightRingBrightness === null
                    ? previous.firstBrightRingBrightness
                    : previous.firstBrightRingBrightness === null
                        ? raw.firstBrightRingBrightness
                        : lerp(previous.firstBrightRingBrightness, raw.firstBrightRingBrightness, 0.18),
                brightPixelRatio: lerp(previous.brightPixelRatio, raw.brightPixelRatio, 0.18),
            };
            state.analysis = held;
            return held;
        }

        state.analysis = raw;
        return raw;
    }

    // ========== 检测成功分支 ==========
    state.detectedCount += 1;
    state.missingCount = 0;

    // 首帧或画面尺寸变化：初始化卡尔曼
    if (!previous || previous.frameWidth !== raw.frameWidth || previous.frameHeight !== raw.frameHeight) {
        if (!state.kalman) state.kalman = new CenterKalmanFilter();
        state.kalman.initialize(raw.centerX, raw.centerY, raw.frameWidth, raw.frameHeight);
        state.analysis = raw;
        state.candidatePattern = raw.fringePattern ?? null;
        state.candidatePatternCount = 1;
        return raw;
    }

    // 预热阶段：低置信度修正
    if (previous.status === 'searching' && state.detectedCount < 2) {
        if (state.kalman?.isInitialized()) {
            state.kalman.correct(raw.centerX, raw.centerY, raw.confidence * 0.3);
        } else {
            if (!state.kalman) state.kalman = new CenterKalmanFilter();
            state.kalman.initialize(raw.centerX, raw.centerY, raw.frameWidth, raw.frameHeight);
        }
        const warming: CameraAnalysis = {
            ...raw,
            confidence: Math.min(raw.confidence, 0.17),
            status: 'searching',
        };
        state.analysis = warming;
        return warming;
    }

    // 模式稳定性判断
    const rawPattern = raw.fringePattern ?? 'rings';
    const previousPattern = previous.fringePattern ?? 'rings';
    let stablePattern = previousPattern;

    if (rawPattern === previousPattern) {
        state.candidatePattern = null;
        state.candidatePatternCount = 0;
    } else {
        state.candidatePatternCount = state.candidatePattern === rawPattern
            ? state.candidatePatternCount + 1
            : 1;
        state.candidatePattern = rawPattern;

        const switchFrames = rawPattern === 'rings' ? 3 : 5;
        const hasStrongEvidence = rawPattern === 'straight'
            ? raw.ringCount <= 4 && raw.confidence > 0.22
            : rawPattern === 'ellipse'
                ? raw.circularity < 0.8 && raw.ringCount >= 2
                : raw.circularity > 0.76 || raw.ringCount >= 5;
        if (state.candidatePatternCount >= switchFrames && hasStrongEvidence) {
            stablePattern = rawPattern;
            state.candidatePattern = null;
            state.candidatePatternCount = 0;
        }
    }

    // 场景切换检测
    const centerJump = Math.hypot(
        (raw.centerX - previous.centerX) / raw.frameWidth,
        (raw.centerY - previous.centerY) / raw.frameHeight,
    );
    const ringCountJump = Math.abs(raw.ringCount - previous.ringCount);
    const patternJump = rawPattern !== previousPattern && raw.confidence > 0.28;
    const looksLikeSceneChange = raw.confidence > 0.34
        && (
            centerJump > 0.18
            || ringCountJump >= 3
            || patternJump
        );
    if (looksLikeSceneChange) {
        // 重置卡尔曼并重新初始化
        if (!state.kalman) state.kalman = new CenterKalmanFilter();
        state.kalman.reset();
        state.kalman.initialize(raw.centerX, raw.centerY, raw.frameWidth, raw.frameHeight);
        state.analysis = raw;
        state.candidatePattern = raw.fringePattern ?? null;
        state.candidatePatternCount = 1;
        state.detectedCount = 1;
        state.missingCount = 0;
        return raw;
    }

    // ========== Kalman 修正（正常检测） ==========
    let centerX: number;
    let centerY: number;
    let isOutlier = false;

    if (state.kalman?.isInitialized()) {
        const result = state.kalman.correct(raw.centerX, raw.centerY, raw.confidence);
        centerX = result.x;
        centerY = result.y;
        isOutlier = result.isOutlier;
    } else {
        if (!state.kalman) state.kalman = new CenterKalmanFilter();
        state.kalman.initialize(raw.centerX, raw.centerY, raw.frameWidth, raw.frameHeight);
        centerX = raw.centerX;
        centerY = raw.centerY;
    }

    // 其他指标的 EMA 平滑（离群时降低更新率）
    const metricAlpha = isOutlier
        ? 0.06
        : clamp(0.1 + raw.confidence * 0.14, 0.12, 0.26);
    const countAlpha = stablePattern === previousPattern ? 0.16 : 0.28;

    const offsetXNorm = (centerX - raw.frameWidth / 2) / (raw.frameWidth / 2);
    const offsetYNorm = (centerY - raw.frameHeight / 2) / (raw.frameHeight / 2);
    const circularity = lerp(previous.circularity, raw.circularity, metricAlpha);
    const confidence = clamp(lerp(previous.confidence, raw.confidence, raw.confidence > previous.confidence ? 0.28 : 0.18), 0, 1);
    const brightPixelRatio = lerp(previous.brightPixelRatio, raw.brightPixelRatio, metricAlpha);
    const peakBrightness = lerp(previous.peakBrightness, raw.peakBrightness, metricAlpha);
    const firstBrightRingBrightness = raw.firstBrightRingBrightness === null
        ? previous.firstBrightRingBrightness
        : previous.firstBrightRingBrightness === null
            ? raw.firstBrightRingBrightness
            : lerp(previous.firstBrightRingBrightness, raw.firstBrightRingBrightness, metricAlpha);
    const smoothRadii = (nextRadii: number[], previousRadii: number[]) => (
        stablePattern === previousPattern
            ? nextRadii.map((radius, index) => (
                previousRadii[index] !== undefined
                    ? lerp(previousRadii[index], radius, metricAlpha)
                    : radius
            ))
            : nextRadii
    );
    const brightRingRadiiPx = smoothRadii(raw.brightRingRadiiPx ?? [], previous.brightRingRadiiPx ?? []);
    const darkRingRadiiPx = smoothRadii(raw.darkRingRadiiPx ?? [], previous.darkRingRadiiPx ?? []);
    const ringRadiiPx = mergeNearbyRadii([...brightRingRadiiPx, ...darkRingRadiiPx], 6);
    const ringCount = Math.round(lerp(previous.ringCount, ringRadiiPx.length, countAlpha));
    // 修复：使用物理模型估计的倾角和镜面间距，而非线性映射
    const estimatedMirrorDeltaMm = lerp(previous.estimatedMirrorDeltaMm, raw.estimatedMirrorDeltaMm, metricAlpha);
    const estimatedTiltXDeg = lerp(previous.estimatedTiltXDeg, raw.estimatedTiltXDeg, metricAlpha);
    const estimatedTiltYDeg = lerp(previous.estimatedTiltYDeg, raw.estimatedTiltYDeg, metricAlpha);
    const previousLineOrientation = previous.lineOrientationRad ?? previous.orientationRad ?? raw.lineOrientationRad ?? raw.orientationRad ?? 0;
    const rawLineOrientation = raw.lineOrientationRad ?? raw.orientationRad ?? previousLineOrientation;
    const lineOrientationRad = lerp(previousLineOrientation, rawLineOrientation, stablePattern === previousPattern ? 0.18 : 0.08);
    const previousOrientation = stablePattern === 'straight'
        ? previousLineOrientation
        : previous.orientationRad ?? raw.orientationRad ?? 0;
    const rawOrientation = stablePattern === 'straight'
        ? rawLineOrientation
        : raw.orientationRad ?? previousOrientation;
    const orientationRad = lerp(previousOrientation, rawOrientation, stablePattern === previousPattern ? 0.1 : 0.05);
    const previousLineCurve = previous.lineCurve ?? raw.lineCurve ?? 0;
    const rawLineCurve = raw.lineCurve ?? previousLineCurve;
    const lineCurve = stablePattern === 'straight'
        ? lerp(previousLineCurve, rawLineCurve, stablePattern === previousPattern ? metricAlpha : 0.08)
        : 0;
    const rawLineOffsets = raw.lineOffsetsNorm ?? [];
    const previousLineOffsets = previous.lineOffsetsNorm ?? [];
    const lineOffsetsNorm = stablePattern === 'straight'
        ? rawLineOffsets.length > 0
            ? stablePattern === previousPattern
                ? rawLineOffsets.map((offset, index) => (
                    previousLineOffsets[index] !== undefined
                        ? lerp(previousLineOffsets[index], offset, metricAlpha)
                        : offset
                ))
                : rawLineOffsets
            : previousLineOffsets
        : [];
    const isCurrentlyCentered = previous.status === 'centered';
    const centerLimit = isCurrentlyCentered ? 0.078 : 0.052;
    const circularityLimit = isCurrentlyCentered ? 0.76 : 0.82;
    const status = confidence < 0.18
        ? 'searching'
        : stablePattern === 'rings' && Math.abs(offsetXNorm) < centerLimit && Math.abs(offsetYNorm) < centerLimit && circularity > circularityLimit
            ? 'centered'
            : 'detected';

    const stabilized: CameraAnalysis = {
        ...raw,
        centerX,
        centerY,
        offsetXNorm,
        offsetYNorm,
        brightPixelRatio,
        ringCount: stablePattern === 'straight' ? 0 : ringCount,
        ringRadiiPx: stablePattern === 'straight' ? [] : ringRadiiPx,
        brightRingRadiiPx: stablePattern === 'straight' ? [] : brightRingRadiiPx,
        darkRingRadiiPx: stablePattern === 'straight' ? [] : darkRingRadiiPx,
        circularity,
        confidence,
        estimatedTiltXDeg,
        estimatedTiltYDeg,
        estimatedMirrorDeltaMm,
        status,
        fringePattern: stablePattern,
        orientationRad: stablePattern === 'straight' ? lineOrientationRad : orientationRad,
        lineOrientationRad,
        lineCurve,
        lineOffsetsNorm,
        peakBrightness,
        firstBrightRingBrightness,
    };

    state.analysis = stabilized;
    return stabilized;
};
