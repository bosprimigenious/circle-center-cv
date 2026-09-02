import type { FrameAnalysis } from '../../../types';
import type { CameraAnalysis, RingCandidate, RedSample } from '../types';
import { getSourceSize } from '../utils/canvas';
import { getExposureFilter } from '../utils/exposure';
import {
    clamp,
    getRedScore,
    smoothProfile,
    getQuantile,
    countProfilePeaks,
    normalizeLineAngle,
} from '../utils/math';
import {
    getRadialSignal,
    fitRadialCenter,
    estimateCenterFromRingGeometry,
    refineCenterByRadialOscillation,
    buildHighPassField,
} from './centerEstimation';
import {
    estimateFirstBrightRingBrightness,
    estimateCircularRingCoherence,
} from './ringAnalysis';
import { estimateLineModelFromSamples } from './lineModel';

export const detectRings = (
    source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
    canvas: HTMLCanvasElement,
    ev = 0,
    predictedCenter?: { x: number; y: number } | null,
): CameraAnalysis | null => {
    const { width: sourceWidth, height: sourceHeight } = getSourceSize(source);
    if (!sourceWidth || !sourceHeight) return null;

    // 提升处理分辨率以改善环间距检测精度
    const width = 480;
    const height = Math.max(280, Math.round(width * sourceHeight / sourceWidth));
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.filter = getExposureFilter(ev);
    ctx.drawImage(source, 0, 0, width, height);
    ctx.filter = 'none';

    const image = ctx.getImageData(0, 0, width, height);
    const { data } = image;
    let peakBrightness = 0;
    let peakRedScore = 0;
    for (let y = 0; y < height; y += 2) {
        for (let x = 0; x < width; x += 2) {
            const index = (y * width + x) * 4;
            const red = data[index];
            const green = data[index + 1];
            const blue = data[index + 2];
            peakBrightness = Math.max(peakBrightness, Math.max(red, green, blue) / 255);
            peakRedScore = Math.max(peakRedScore, getRedScore(red, green, blue));
        }
    }

    // Task 1: 低亮度时降低红色阈值，提升弱信号检测能力
    const adaptiveFactor = peakRedScore < 30 ? 0.15 : 0.24;
    const redScoreThreshold = Math.max(5, Math.min(72, peakRedScore * adaptiveFactor));
    const scoreMap = new Float32Array(width * height);
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const index = (y * width + x) * 4;
            const red = data[index];
            const green = data[index + 1];
            const blue = data[index + 2];
            scoreMap[y * width + x] = Math.max(0, getRedScore(red, green, blue)) * clamp(red / 180, 0, 1.2);
        }
    }

    const samples: RedSample[] = [];
    const xProjection = Array.from({ length: 72 }, () => 0);
    const yProjection = Array.from({ length: 54 }, () => 0);
    let count = 0;
    let sumX = 0;
    let sumY = 0;
    let totalWeight = 0;
    let minX = width;
    let maxX = 0;
    let minY = height;
    let maxY = 0;

    for (let y = 0; y < height; y += 2) {
        for (let x = 0; x < width; x += 2) {
            const index = (y * width + x) * 4;
            const red = data[index];
            const green = data[index + 1];
            const blue = data[index + 2];
            const redScore = getRedScore(red, green, blue);
            // Task 1: 降低亮度下限，允许更弱的红色信号进入
            const isBrightRed = red > 12
                && redScore > redScoreThreshold
                && red > green * 0.98
                && red > blue * 0.98;
            if (!isBrightRed) continue;
            const weight = clamp((redScore - redScoreThreshold) / Math.max(1, peakRedScore - redScoreThreshold), 0.12, 1)
                * clamp(red / 180, 0.25, 1);
            count += 1;
            sumX += x * weight;
            sumY += y * weight;
            totalWeight += weight;
            samples.push({ x, y, weight });
            xProjection[Math.min(xProjection.length - 1, Math.floor(x / width * xProjection.length))] += weight;
            yProjection[Math.min(yProjection.length - 1, Math.floor(y / height * yProjection.length))] += weight;
            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x);
            minY = Math.min(minY, y);
            maxY = Math.max(maxY, y);
        }
    }

    const sampleCount = Math.ceil(width / 2) * Math.ceil(height / 2);
    const brightPixelRatio = count / sampleCount;
    // Task 1: 渐进式信号强度替代二值判断，降低门控阈值
    const rawSignalStrength = clamp((count / 12) * (peakRedScore / 10), 0, 1);
    const hasSignal = rawSignalStrength > 0.1;
    const spanX = hasSignal ? Math.max(1, maxX - minX) : 0;
    const spanY = hasSignal ? Math.max(1, maxY - minY) : 0;
    const centroidX = hasSignal ? sumX / Math.max(totalWeight, 1) : width / 2;
    const centroidY = hasSignal ? sumY / Math.max(totalWeight, 1) : height / 2;
    const boundingCenterX = hasSignal ? (minX + maxX) / 2 : width / 2;
    const boundingCenterY = hasSignal ? (minY + maxY) / 2 : height / 2;
    const radialCenter = hasSignal ? fitRadialCenter(samples, scoreMap, width, height, peakRedScore) : null;
    const geometryCenter = hasSignal ? estimateCenterFromRingGeometry(samples, width, height) : null;
    const highPass = hasSignal ? buildHighPassField(data, width, height) : null;
    const energyX = highPass && highPass.energyConfidence > 0.06 ? highPass.energyX : null;
    const energyY = highPass && highPass.energyConfidence > 0.06 ? highPass.energyY : null;
    const useEnergy = energyX !== null && energyY !== null;
    const energyWeight = useEnergy ? 0.18 : 0;
    const radialWeight = radialCenter
        ? (useEnergy ? 0.22 : clamp(0.72 + radialCenter.confidence * 0.2, 0.72, 0.92))
        : 0;
    const geometryWeight = geometryCenter ? (useEnergy ? 0.08 : 0.28 * geometryCenter.confidence) : 0;
    const boundingWeight = hasSignal ? 0.04 * clamp(Math.min(spanX, spanY) / Math.max(spanX, spanY, 1), 0.35, 1) : 0;
    const centroidWeight = hasSignal ? Math.max(0.02, 1 - energyWeight - radialWeight - geometryWeight - boundingWeight) : 0;
    const totalCenterWeight = Math.max(1, energyWeight + radialWeight + geometryWeight + boundingWeight + centroidWeight);
    const roughCenterX = hasSignal
        ? (
            energyWeight * (energyX ?? centroidX)
            + radialWeight * (radialCenter?.x ?? geometryCenter?.x ?? centroidX)
            + geometryWeight * (geometryCenter?.x ?? centroidX)
            + boundingWeight * boundingCenterX
            + centroidWeight * centroidX
        ) / totalCenterWeight
        : width / 2;
    const roughCenterY = hasSignal
        ? (
            energyWeight * (energyY ?? centroidY)
            + radialWeight * (radialCenter?.y ?? geometryCenter?.y ?? centroidY)
            + geometryWeight * (geometryCenter?.y ?? centroidY)
            + boundingWeight * boundingCenterY
            + centroidWeight * centroidY
        ) / totalCenterWeight
        : height / 2;
    let searchCenterX = energyX ?? roughCenterX;
    let searchCenterY = energyY ?? roughCenterY;
    if (predictedCenter && hasSignal) {
        const hintAnchorX = energyX ?? roughCenterX;
        const hintAnchorY = energyY ?? roughCenterY;
        const hintDist = Math.hypot(predictedCenter.x - hintAnchorX, predictedCenter.y - hintAnchorY);
        const maxHintDist = Math.min(width, height) * 0.22;
        if (hintDist < maxHintDist) {
            const hintWeight = 0.2 * (1 - hintDist / maxHintDist);
            searchCenterX = searchCenterX * (1 - hintWeight) + predictedCenter.x * hintWeight;
            searchCenterY = searchCenterY * (1 - hintWeight) + predictedCenter.y * hintWeight;
        }
    }
    const refinedCenter = hasSignal
        ? refineCenterByRadialOscillation(
            data,
            width,
            height,
            searchCenterX,
            searchCenterY,
        )
        : null;
    const acceptRefinedCenter = Boolean(refinedCenter && refinedCenter.score > 0);
    const centerX = acceptRefinedCenter && refinedCenter ? refinedCenter.x : roughCenterX;
    const centerY = acceptRefinedCenter && refinedCenter ? refinedCenter.y : roughCenterY;
    const boundingCircularity = hasSignal ? clamp(Math.min(spanX, spanY) / Math.max(spanX, spanY), 0, 1) : 0;

    let xx = 0;
    let yy = 0;
    let xy = 0;
    let shapeWeight = 0;
    if (hasSignal) {
        const innerRadius = Math.min(width, height) * 0.045;
        samples.forEach((sample) => {
            const dx = sample.x - centerX;
            const dy = sample.y - centerY;
            if (Math.hypot(dx, dy) < innerRadius) return;
            xx += dx * dx * sample.weight;
            yy += dy * dy * sample.weight;
            xy += dx * dy * sample.weight;
            shapeWeight += sample.weight;
        });
    }

    let covarianceCircularity = boundingCircularity;
    let orientationRad = 0;
    if (shapeWeight > 1) {
        xx /= shapeWeight;
        yy /= shapeWeight;
        xy /= shapeWeight;
        const trace = xx + yy;
        const delta = Math.sqrt(Math.max(0, (xx - yy) * (xx - yy) + 4 * xy * xy));
        const major = Math.max(1, (trace + delta) / 2);
        const minor = Math.max(0, (trace - delta) / 2);
        covarianceCircularity = clamp(Math.sqrt(minor / major), 0, 1);
        orientationRad = 0.5 * Math.atan2(2 * xy, xx - yy);
    }

    const nearestEdge = hasSignal ? Math.min(minX, width - maxX, minY, height - maxY) : 999;
    const edgeContact = clamp(1 - nearestEdge / 26, 0, 1);
    const edgeCompensationGate = clamp((boundingCircularity - 0.64) / 0.28, 0, 1);
    const edgeCompensatedCircularity = covarianceCircularity
        + (1 - covarianceCircularity) * edgeContact * edgeCompensationGate * 0.56;
    const shapeCircularity = hasSignal
        ? clamp(Math.max(edgeCompensatedCircularity, boundingCircularity * 0.82), 0, 1)
        : 0;

    let lineOrientationRad = orientationRad;
    if (hasSignal) {
        let gradXX = 0;
        let gradYY = 0;
        let gradXY = 0;
        let gradWeight = 0;
        samples.forEach((sample) => {
            const x = Math.round(sample.x);
            const y = Math.round(sample.y);
            if (x <= 0 || x >= width - 1 || y <= 0 || y >= height - 1) return;
            const gx = scoreMap[y * width + x + 1] - scoreMap[y * width + x - 1];
            const gy = scoreMap[(y + 1) * width + x] - scoreMap[(y - 1) * width + x];
            const gradient = Math.hypot(gx, gy);
            if (gradient < Math.max(4, peakRedScore * 0.045)) return;
            const weight = sample.weight * gradient;
            gradXX += weight * gx * gx;
            gradYY += weight * gy * gy;
            gradXY += weight * gx * gy;
            gradWeight += weight;
        });
        if (gradWeight > 1) {
            const normalAngle = 0.5 * Math.atan2(2 * gradXY, gradXX - gradYY);
            lineOrientationRad = normalAngle + Math.PI / 2;
        }
    }
    lineOrientationRad = normalizeLineAngle(lineOrientationRad);
    const lineModel = hasSignal
        ? estimateLineModelFromSamples(samples, width, height, centerX, centerY, lineOrientationRad)
        : { angle: lineOrientationRad, curve: 0, offsetsNorm: [] };
    lineOrientationRad = lineModel.angle;

    const maxRadius = Math.min(
        Math.ceil(Math.hypot(width, height) * 1.05),
        Math.max(
            24,
            Math.ceil(Math.max(
                Math.hypot(centerX, centerY),
                Math.hypot(centerX - width, centerY),
                Math.hypot(centerX, centerY - height),
                Math.hypot(centerX - width, centerY - height),
            )),
        ),
    );
    const radialBins = Array.from({ length: maxRadius + 1 }, () => ({
        signalTotal: 0,
        redTotal: 0,
        redScoreTotal: 0,
        count: 0,
    }));
    for (let y = 1; y < height; y += 2) {
        for (let x = 1; x < width; x += 2) {
            const radius = Math.round(Math.hypot(x - centerX, y - centerY));
            if (radius > maxRadius) continue;
            const signal = getRadialSignal(data, width, x, y);
            if (signal === null) continue;
            radialBins[radius].signalTotal += signal;
            radialBins[radius].count += 1;
        }
    }

    const rawProfile = radialBins.map((bin) => (
        bin.count > 3
            ? bin.signalTotal / bin.count
            : 0
    ));
    const profile = smoothProfile(smoothProfile(rawProfile, 2), 2);
    const backgroundProfile = smoothProfile(rawProfile, 10);
    const contrastProfile = profile.map((value, index) => value - backgroundProfile[index]);
    const validProfile = profile.slice(8).filter((value) => value > 0);
    const lowProfile = getQuantile(validProfile, 0.18);
    const highProfile = getQuantile(validProfile, 0.92);
    const profileContrast = highProfile - lowProfile;
    const contrastScale = Math.max(5, profileContrast);
    const contrastValues = contrastProfile
        .slice(8)
        .filter((_, index) => radialBins[index + 8]?.count > 3)
        .map(value => Math.abs(value));
    const radialOscillationScale = Math.max(1.2, getQuantile(contrastValues, 0.82));
    const brightRingCandidates: RingCandidate[] = [];
    const darkRingCandidates: RingCandidate[] = [];
    const refineCandidateRadius = (radius: number, type: RingCandidate['type']) => {
        let weightedRadius = 0;
        let weightTotal = 0;
        for (let offset = -3; offset <= 3; offset += 1) {
            const index = radius + offset;
            if (index < 0 || index >= contrastProfile.length) continue;
            const signedValue = type === 'bright' ? contrastProfile[index] : -contrastProfile[index];
            const weight = Math.max(0, signedValue);
            if (weight <= 0) continue;
            weightedRadius += index * weight;
            weightTotal += weight;
        }
        return weightTotal > 0 ? weightedRadius / weightTotal : radius;
    };
    const mergeRingCandidates = (candidates: RingCandidate[], minGap: number) => {
        const sorted = [...candidates].sort((a, b) => a.radius - b.radius);
        const groups: RingCandidate[][] = [];
        sorted.forEach((candidate) => {
            const group = groups[groups.length - 1];
            const groupCenter = group
                ? group.reduce((total, item) => total + item.radius, 0) / group.length
                : 0;
            if (!group || candidate.radius - groupCenter >= minGap) {
                groups.push([candidate]);
            } else {
                group.push(candidate);
            }
        });

        return groups.map((group) => {
            const strengthTotal = group.reduce((total, item) => total + item.strength, 0);
            const strongest = group.reduce((best, item) => item.strength > best.strength ? item : best, group[0]);
            if (strengthTotal <= 0) return strongest;
            return {
                ...strongest,
                radius: group.reduce((total, item) => total + item.radius * item.strength, 0) / strengthTotal,
                strength: strengthTotal / group.length,
            };
        });
    };

    for (let radius = 9; radius < maxRadius - 4; radius += 1) {
        if (radialBins[radius].count < 4) continue;
        const value = profile[radius];
        const left = profile[radius - 2];
        const right = profile[radius + 2];
        const localOuter = Math.max(profile[radius - 4], profile[radius + 4]);
        const localInner = Math.min(profile[radius - 4], profile[radius + 4]);
        const isBrightPeak = value > highProfile - contrastScale * 0.7
            && value > left
            && value >= right
            && value - localInner > contrastScale * 0.1;
        const isDarkValley = value < lowProfile + contrastScale * 0.7
            && value < left
            && value <= right
            && localOuter - value > contrastScale * 0.09;
        const contrastValue = contrastProfile[radius];
        const contrastLeft = contrastProfile[radius - 2];
        const contrastRight = contrastProfile[radius + 2];
        const localContrastOuter = Math.max(contrastProfile[radius - 4], contrastProfile[radius + 4]);
        const localContrastInner = Math.min(contrastProfile[radius - 4], contrastProfile[radius + 4]);
        const isOscillationPeak = contrastValue > radialOscillationScale * 0.34
            && contrastValue > contrastLeft
            && contrastValue >= contrastRight
            && contrastValue - localContrastInner > radialOscillationScale * 0.24;
        const isOscillationValley = contrastValue < -radialOscillationScale * 0.34
            && contrastValue < contrastLeft
            && contrastValue <= contrastRight
            && localContrastOuter - contrastValue > radialOscillationScale * 0.24;
        if (isBrightPeak || isOscillationPeak) {
            const strength = Math.max(value - localInner, contrastValue - localContrastInner, radialOscillationScale * 0.12);
            brightRingCandidates.push({
                radius: refineCandidateRadius(radius, 'bright'),
                type: 'bright',
                strength,
            });
        }
        if (isDarkValley || isOscillationValley) {
            const strength = Math.max(localOuter - value, localContrastOuter - contrastValue, radialOscillationScale * 0.12);
            darkRingCandidates.push({
                radius: refineCandidateRadius(radius, 'dark'),
                type: 'dark',
                strength,
            });
        }
    }

    const candidateBrightRings = mergeRingCandidates(brightRingCandidates, 8);
    const candidateDarkRings = mergeRingCandidates(darkRingCandidates, 8);
    const hasNearbyAlternatingRing = (candidate: RingCandidate, oppositeCandidates: RingCandidate[]) => (
        oppositeCandidates.some((oppositeCandidate) => {
            const distance = Math.abs(oppositeCandidate.radius - candidate.radius);
            return distance >= 3 && distance <= 42;
        })
    );
    const alternatingCandidates = [...candidateBrightRings, ...candidateDarkRings]
        .filter(candidate => hasNearbyAlternatingRing(
            candidate,
            candidate.type === 'bright' ? candidateDarkRings : candidateBrightRings,
        ))
        .sort((a, b) => a.radius - b.radius)
        .reduce<RingCandidate[]>((sequence, candidate) => {
            const previous = sequence[sequence.length - 1];
            if (!previous) return [candidate];
            if (Math.abs(candidate.radius - previous.radius) < 3) {
                if (candidate.strength > previous.strength) sequence[sequence.length - 1] = candidate;
                return sequence;
            }
            if (previous.type === candidate.type) {
                if (candidate.strength > previous.strength) sequence[sequence.length - 1] = candidate;
                return sequence;
            }
            sequence.push(candidate);
            return sequence;
        }, []);
    const brightRings = alternatingCandidates
        .filter(candidate => candidate.type === 'bright')
        .map(candidate => candidate.radius);
    const darkRings = alternatingCandidates
        .filter(candidate => candidate.type === 'dark')
        .map(candidate => candidate.radius);
    const ringRadiiPx = alternatingCandidates.map(candidate => candidate.radius);
    const firstBrightRingBrightness = estimateFirstBrightRingBrightness(
        data,
        width,
        height,
        centerX,
        centerY,
        brightRings,
    );

    const offsetXNorm = (centerX - width / 2) / (width / 2);
    const offsetYNorm = (centerY - height / 2) / (height / 2);
    const signalStrength = clamp((peakBrightness - 0.08) / 0.42, 0.34, 1);
    const linePeakCount = Math.max(countProfilePeaks(xProjection), countProfilePeaks(yProjection));
    // Task 3: 放宽环证据要求——允许只有亮环或只有暗环，降低对比度阈值
    const ringEvidence = ringRadiiPx.length >= 1
        && (brightRings.length >= 1 || darkRings.length >= 1)
        && (profileContrast > 1.5 || radialOscillationScale > 1.0);
    const circularRingCoherence = ringEvidence
        ? estimateCircularRingCoherence(data, width, height, centerX, centerY, ringRadiiPx, highProfile)
        : 0;
    const ringCircularity = circularRingCoherence > 0
        ? clamp(0.58 + circularRingCoherence * 0.42, 0, 1)
        : 0;
    const circularity = ringEvidence
        ? Math.max(shapeCircularity, ringCircularity)
        : shapeCircularity;
    // Task 3: 放宽直线条纹检测条件，增加梯度方向一致性辅助判据
    const gradientConsistency = hasSignal && (orientationRad !== 0 || lineOrientationRad !== 0);
    const straightEvidence = !ringEvidence
        && linePeakCount >= 4
        && brightPixelRatio > 0.001
        && ringRadiiPx.length <= 3
        && circularity < 0.86
        && (linePeakCount >= 6 || gradientConsistency);
    const ellipseEvidence = ringEvidence && circularity < 0.78 && circularRingCoherence < 0.48;
    const circleEvidence = ringEvidence && !ellipseEvidence && !straightEvidence;
    const hasPatternEvidence = circleEvidence || ellipseEvidence || straightEvidence;
    const structureScore = Math.max(clamp(ringRadiiPx.length / 6, 0, 1), clamp(linePeakCount / 7, 0, 1));
    const fringePattern: FrameAnalysis['fringePattern'] | undefined = !hasPatternEvidence
        ? undefined
        : straightEvidence
            ? 'straight'
            : ellipseEvidence
                ? 'ellipse'
                : 'rings';
    const patternStrength = clamp(Math.max(profileContrast / 20, radialOscillationScale / 7), 0.52, 1);
    // Task 3: 弱条纹模式——对比度低但有规律振荡时仍返回结果
    const weakFringe = hasSignal && !hasPatternEvidence
        && radialOscillationScale > 0.8
        && profileContrast > 0.8
        && ringRadiiPx.length >= 1;
    const effectivePattern = hasPatternEvidence || weakFringe;
    const confidence = hasSignal && effectivePattern
        ? clamp(
            (0.2 + brightPixelRatio * 5 + circularity * 0.34 + structureScore * 0.44) * signalStrength * patternStrength,
            0, 1
        ) * (weakFringe ? 0.6 : 1)
        : 0;
    const status: FrameAnalysis['status'] = !effectivePattern || confidence < 0.12
        ? 'searching'
        : Math.abs(offsetXNorm) < 0.05 && Math.abs(offsetYNorm) < 0.05 && circularity > 0.82 && fringePattern === 'rings'
            ? 'centered'
            : 'detected';

    // Task 5: 诊断失败原因分类
    let failureReason: import('../../../types').DetectionFailureReason = null;
    if (status === 'searching') {
        if (!hasSignal) {
            failureReason = 'noSignal';
        } else if (profileContrast < 1.5 && radialOscillationScale < 1.0) {
            failureReason = 'lowContrast';
        } else if (hasSignal && !effectivePattern) {
            const nearestEdge = Math.min(minX, width - maxX, minY, height - maxY);
            failureReason = nearestEdge < 8 ? 'edgeClipping' : 'noRingPattern';
        }
    }

    return {
        timestamp: Date.now(),
        frameWidth: width,
        frameHeight: height,
        centerX,
        centerY,
        offsetXNorm,
        offsetYNorm,
        brightPixelRatio,
        ringCount: ringRadiiPx.length,
        ringRadiiPx,
        brightRingRadiiPx: brightRings,
        darkRingRadiiPx: darkRings,
        circularity,
        confidence,
        // Task 4: 基于环间距的物理倾角估计替代简单线性映射
        estimatedTiltXDeg: estimateTiltFromPhysics(offsetYNorm, ringRadiiPx, width),
        estimatedTiltYDeg: estimateTiltFromPhysics(offsetXNorm, ringRadiiPx, width),
        estimatedMirrorDeltaMm: estimateMirrorDelta(ringRadiiPx, circularity, brightRings),
        status,
        fringePattern,
        orientationRad: fringePattern === 'straight' ? lineOrientationRad : orientationRad,
        lineOrientationRad,
        lineCurve: lineModel.curve,
        lineOffsetsNorm: lineModel.offsetsNorm,
        peakBrightness,
        firstBrightRingBrightness,
        signalStrength: rawSignalStrength,
        failureReason,
    };
};

// Task 4: 基于环间距的物理倾角估计
// 原理：圆心偏移量与倾角成正比，比例系数与环间距相关
const estimateTiltFromPhysics = (
    offsetNorm: number,
    ringRadii: number[],
    frameWidth: number,
): number => {
    if (ringRadii.length < 2) {
        // 环数不足时回退到线性映射，但使用更合理的系数
        return offsetNorm * 2.0;
    }
    // 从环间距估计有效焦距（像素单位）
    // 环间距 Δr ∝ sqrt(n) 对于等倾干涉，相邻环间距递减
    // 有效焦距 f_eff ≈ frameWidth * screenDistance / screenSize
    // 简化：用最大环半径近似 f_eff
    const maxRingRadius = ringRadii[ringRadii.length - 1];
    const effectiveFocalLength = Math.max(80, maxRingRadius * 2.5);
    // 偏移量（像素）= offsetNorm * (frameWidth / 2)
    const offsetPx = offsetNorm * (frameWidth / 2);
    // tilt = arctan(offsetPx / f_eff) * 180 / PI
    const tiltDeg = Math.atan(offsetPx / effectiveFocalLength) * 180 / Math.PI;
    return clamp(tiltDeg, -5, 5);
};

// Task 4: 基于环密度估计镜面间距
const estimateMirrorDelta = (
    ringRadii: number[],
    circularity: number,
    brightRings: number[],
): number => {
    if (brightRings.length >= 2) {
        // 从亮环间距估计 d：ring_spacing ∝ wavelength * D / (2d)
        // 平均环间距越小，d 越大
        let totalSpacing = 0;
        for (let i = 1; i < brightRings.length; i++) {
            totalSpacing += brightRings[i] - brightRings[i - 1];
        }
        const avgSpacing = totalSpacing / (brightRings.length - 1);
        // 经验校准：间距 15-30px 对应 0.02-0.06mm
        const dFromSpacing = clamp(0.045 * (20 / Math.max(8, avgSpacing)), 0.008, 0.09);
        const dFromCount = clamp(0.018 + ringRadii.length * 0.0048 + (1 - circularity) * 0.015, 0.006, 0.095);
        // 加权融合两种估计
        return clamp(dFromSpacing * 0.6 + dFromCount * 0.4, 0.006, 0.095);
    }
    return clamp(0.018 + ringRadii.length * 0.0048 + (1 - circularity) * 0.015, 0.006, 0.095);
};
