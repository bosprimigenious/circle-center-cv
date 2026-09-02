import type { FrameAnalysis } from '../../../types';
import type { CameraViewProps } from '../types';
import { clamp, mergeNearbyRadii } from '../utils/math';
import { getObjectFitMapping, mapFramePointToOverlay } from './overlayFit';

export const drawOverlay = (
    canvas: HTMLCanvasElement,
    analysis: FrameAnalysis | null,
    mode: CameraViewProps['mode'],
    centerConfirmed: boolean,
    objectFit = 'cover',
) => {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const frameWidth = analysis?.frameWidth ?? width;
    const frameHeight = analysis?.frameHeight ?? height;
    const mapping = getObjectFitMapping(width, height, frameWidth, frameHeight, objectFit);
    const { scaleX, scaleY, offsetX: displayOffsetX, offsetY: displayOffsetY } = mapping;
    const displayScale = scaleX;
    const resolvedFit = (objectFit || 'cover').trim().toLowerCase() || 'cover';
    canvas.dataset.overlayFit = resolvedFit;
    if (analysis) {
        canvas.dataset.centerX = String(Math.round(analysis.centerX * 100) / 100);
        canvas.dataset.centerY = String(Math.round(analysis.centerY * 100) / 100);
        canvas.dataset.frameWidth = String(analysis.frameWidth);
        canvas.dataset.frameHeight = String(analysis.frameHeight);
    }
    const mappedCenter = analysis
        ? mapFramePointToOverlay(analysis.centerX, analysis.centerY, mapping)
        : { x: width / 2, y: height / 2 };
    const cx = mappedCenter.x;
    const cy = mappedCenter.y;
    const confidence = analysis?.confidence ?? 0;

    if (mode === 'analysis') {
        const gradient = ctx.createLinearGradient(0, 0, width, height);
        gradient.addColorStop(0, 'rgba(12, 118, 255, 0.18)');
        gradient.addColorStop(1, 'rgba(21, 201, 255, 0.06)');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);

        ctx.strokeStyle = 'rgba(73, 196, 255, 0.72)';
        ctx.lineWidth = 1;
        for (let x = 0; x < width; x += 56) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x + height * 0.35, height);
            ctx.stroke();
        }

        ctx.strokeStyle = centerConfirmed ? 'rgba(74, 222, 128, 0.95)' : 'rgba(125, 211, 252, 0.9)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(width, height);
        ctx.moveTo(width, 0);
        ctx.lineTo(0, height);
        ctx.stroke();
    }

    const hasRingOverlay = Boolean(
        analysis
        && analysis.fringePattern !== 'straight'
        && ((analysis.ringRadiiPx?.length ?? 0) > 0 || analysis.fringePattern === 'rings' || analysis.fringePattern === 'ellipse'),
    );
    if (confidence > 0.12 || hasRingOverlay) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(displayOffsetX, displayOffsetY, frameWidth * scaleX, frameHeight * scaleY);
        ctx.clip();

        if (analysis && analysis.fringePattern !== 'straight' && analysis.ringRadiiPx.length > 0) {
            ctx.save();
            ctx.shadowBlur = 8;
            const isEllipseFit = analysis.fringePattern === 'ellipse';
            const ellipseScale = isEllipseFit ? clamp(analysis.circularity, 0.45, 0.92) : 1;
            const ellipseAngle = isEllipseFit ? analysis.orientationRad ?? 0 : 0;

            const drawDetectedRings = (
                radii: number[],
                color: 'bright' | 'dark' | 'fallback',
                limit: number,
            ) => {
                radii.slice(0, limit).forEach((radius, index) => {
                    const scaledRadius = radius * displayScale;
                    const maxDrawRadius = Math.hypot(width, height) * 1.8;
                    if (scaledRadius < 6 || scaledRadius > maxDrawRadius) return;
                    const alpha = Math.max(0.34, 0.92 - index * 0.04);
                    const ringLabel = color === 'bright'
                        ? `亮${index + 1}`
                        : color === 'dark'
                            ? `暗${index + 1}`
                            : `环${index + 1}`;
                    const labelColor = color === 'bright' ? '#fee2e2' : '#dbeafe';
                    const labelSide = cx < width * 0.42 ? 1 : cx > width * 0.58 ? -1 : 0.72;
                    const rawLabelX = cx + scaledRadius * (labelSide === 0.72 ? 0.72 : 0.88 * labelSide);
                    const rawLabelY = cy - scaledRadius * (labelSide === 0.72 ? 0.42 : 0.12) + index * 15;
                    const labelX = clamp(rawLabelX, 8, width - 46);
                    const labelY = clamp(rawLabelY, 14 + index * 16, height - 16);

                    ctx.lineWidth = color === 'bright' ? 1.8 : 1.45;
                    ctx.setLineDash(color === 'dark' ? [7, 5] : []);
                    ctx.shadowColor = color === 'bright'
                        ? 'rgba(248, 113, 113, 0.36)'
                        : 'rgba(14, 165, 233, 0.34)';
                    ctx.strokeStyle = color === 'bright'
                        ? `rgba(254, 202, 202, ${alpha})`
                        : color === 'dark'
                            ? `rgba(125, 211, 252, ${alpha})`
                            : `rgba(186, 230, 253, ${alpha})`;
                    ctx.beginPath();
                    ctx.ellipse(cx, cy, scaledRadius, scaledRadius * ellipseScale, ellipseAngle, 0, Math.PI * 2);
                    ctx.stroke();

                    ctx.setLineDash([]);
                    ctx.shadowBlur = 0;
                    ctx.font = '700 11px system-ui, sans-serif';
                    ctx.textBaseline = 'middle';
                    const labelWidth = ctx.measureText(ringLabel).width + 12;
                    ctx.fillStyle = color === 'bright'
                        ? 'rgba(127, 29, 29, 0.72)'
                        : 'rgba(8, 47, 73, 0.72)';
                    ctx.fillRect(labelX - 5, labelY - 9, labelWidth, 18);
                    ctx.strokeStyle = color === 'bright'
                        ? 'rgba(254, 202, 202, 0.75)'
                        : 'rgba(186, 230, 253, 0.75)';
                    ctx.lineWidth = 1;
                    ctx.strokeRect(labelX - 5, labelY - 9, labelWidth, 18);
                    ctx.fillStyle = labelColor;
                    ctx.fillText(ringLabel, labelX + 1, labelY);
                    ctx.shadowBlur = 8;
                });
            };

            const brightRings = analysis.brightRingRadiiPx ?? [];
            const darkRings = analysis.darkRingRadiiPx ?? [];
            if (brightRings.length || darkRings.length) {
                drawDetectedRings(darkRings, 'dark', 8);
                drawDetectedRings(brightRings, 'bright', 8);
            } else {
                drawDetectedRings(analysis.ringRadiiPx, 'fallback', 10);
            }

            ctx.restore();
        }

        if (analysis?.fringePattern === 'straight') {
            ctx.save();
            const lineAngle = analysis.orientationRad ?? 0;
            const dirX = Math.cos(lineAngle);
            const dirY = Math.sin(lineAngle);
            const normalX = -dirY;
            const normalY = dirX;
            const maxDisplayDimension = Math.max(frameWidth, frameHeight) * displayScale;
            const offsets = analysis.lineOffsetsNorm?.length
                ? analysis.lineOffsetsNorm.map(offset => offset * maxDisplayDimension)
                : [-90, -60, -30, 0, 30, 60, 90];
            const uniqueOffsets = mergeNearbyRadii(offsets, 18).slice(0, 9);
            const lineCurve = analysis.lineCurve ?? 0;
            const extent = Math.hypot(width, height);
            ctx.lineWidth = 1.7;
            ctx.strokeStyle = 'rgba(125, 211, 252, 0.86)';
            ctx.shadowColor = 'rgba(14, 165, 233, 0.28)';
            ctx.shadowBlur = 8;
            uniqueOffsets.forEach((offset) => {
                ctx.beginPath();
                for (let step = -48; step <= 48; step += 1) {
                    const major = step / 48 * extent;
                    const bend = lineCurve * (major / maxDisplayDimension) * (major / maxDisplayDimension) * maxDisplayDimension;
                    const px = cx + dirX * major + normalX * (offset + bend);
                    const py = cy + dirY * major + normalY * (offset + bend);
                    if (step === -48) {
                        ctx.moveTo(px, py);
                    } else {
                        ctx.lineTo(px, py);
                    }
                }
                ctx.stroke();
            });
            ctx.restore();
        }

        ctx.strokeStyle = mode === 'analysis' ? 'rgba(125, 211, 252, 0.95)' : 'rgba(255, 89, 89, 0.95)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cx - 18, cy);
        ctx.lineTo(cx + 18, cy);
        ctx.moveTo(cx, cy - 18);
        ctx.lineTo(cx, cy + 18);
        ctx.stroke();

        ctx.fillStyle = mode === 'analysis' ? 'rgba(14, 165, 233, 0.86)' : 'rgba(255, 64, 64, 0.82)';
        ctx.beginPath();
        ctx.arc(cx, cy, 4, 0, Math.PI * 2);
        ctx.fill();

        if (mode === 'analysis' && analysis) {
            ctx.fillStyle = 'rgba(191, 239, 255, 0.95)';
            ctx.strokeStyle = 'rgba(14, 165, 233, 0.9)';
            analysis.ringRadiiPx.slice(0, 12).forEach((radius, index) => {
                const scaledRadius = radius * displayScale;
                const points = [
                    [cx + scaledRadius * 0.72, cy + scaledRadius * 0.72],
                    [cx - scaledRadius * 0.72, cy - scaledRadius * 0.72],
                    [cx + scaledRadius * 0.72, cy - scaledRadius * 0.72],
                    [cx - scaledRadius * 0.72, cy + scaledRadius * 0.72],
                ];
                points.forEach(([x, y]) => {
                    if (x < 0 || y < 0 || x > width || y > height) return;
                    ctx.beginPath();
                    ctx.arc(x, y, 3.2, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.stroke();
                });
                ctx.fillText(String(index + 1), cx + scaledRadius * 0.72 + 5, cy + scaledRadius * 0.72 - 5);
            });
        }

        ctx.restore();
    }

    // Task 5: 检测失败时显示诊断信息
    if (analysis?.status === 'searching' && analysis.failureReason) {
        const failureLabels: Record<string, string> = {
            noSignal: '⚠ 未检测到信号 — 检查摄像头对准 / 曝光',
            lowContrast: '⚠ 对比度不足 — 降低环境光 / 调曝光',
            noRingPattern: '⚠ 未识别环模式 — 调节镜面倾角',
            edgeClipping: '⚠ 条纹超出画面 — 调整摄像头距离',
        };
        const label = failureLabels[analysis.failureReason] ?? '检测中...';
        const signalBar = analysis.signalStrength ?? 0;

        ctx.save();
        // 信号强度条
        const barX = 10;
        const barY = height - 36;
        const barW = 120;
        const barH = 6;
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(barX - 4, barY - 18, barW + 8, 44);
        ctx.fillStyle = 'rgba(60,60,60,0.8)';
        ctx.fillRect(barX, barY, barW, barH);
        ctx.fillStyle = signalBar > 0.3 ? 'rgba(34,197,94,0.9)' : 'rgba(239,68,68,0.9)';
        ctx.fillRect(barX, barY, barW * signalBar, barH);
        ctx.fillStyle = 'rgba(200,200,200,0.85)';
        ctx.font = '600 10px system-ui, sans-serif';
        ctx.fillText(`信号: ${(signalBar * 100).toFixed(0)}%`, barX, barY - 5);

        // 失败原因
        ctx.fillStyle = 'rgba(255,200,60,0.95)';
        ctx.font = '600 11px system-ui, sans-serif';
        ctx.fillText(label, barX, barY + barH + 14);
        ctx.restore();
    }
};
