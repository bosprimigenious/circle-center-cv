import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { FrameAnalysis } from '../../types';
import type {
    CameraViewProps,
    CameraViewHandle,
    CameraAnalysis,
    AnalysisStabilizerState,
    ExposureControl,
    ExtendedCapabilities,
    ExtendedSettings,
    ExposureProperty,
    InputSourceMode,
    DemoCenterOffset,
} from './types';
import {
    EV_MIN,
    EV_MAX,
    EV_STEP,
    FIRST_BRIGHT_RING_TARGET_BRIGHTNESS,
    FIRST_BRIGHT_RING_TARGET_DEADBAND,
    PEAK_BRIGHTNESS_FALLBACK_TARGET,
    PEAK_BRIGHTNESS_FALLBACK_DEADBAND,
    AUTO_ANALYZE_INTERVAL_MS,
    demoPresets,
    demoPresetCenters,
} from './constants';
import { clamp } from './utils/math';
import { getExposureFilter, evToValue, formatEv, getInitialExposure } from './utils/exposure';
import { drawSourceToCanvas } from './utils/canvas';
import { buildSyntheticInterferogram, createShiftedDemoImage } from './utils/demoImages';
import { detectRings } from './analysis/ringDetection';
import { stabilizeAnalysis } from './analysis/stabilizer';
import { drawOverlay } from './analysis/overlay';
import { applyAnalysisProfile } from './analysis/profile';
import './CameraView.css';

const CameraView = forwardRef<CameraViewHandle, CameraViewProps>(({
    mode = 'calibration',
    onFrameAnalysis,
    onStreamReady,
    centerConfirmed = false,
    autoAnalyze = true,
    analysisProfile = 'general',
    onManualAnalyze,
    manualAnalyzeLabel = '截帧解算',
    manualAnalyzeStatus,
    className,
}, ref) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const demoImageRef = useRef<HTMLImageElement>(null);
    const overlayRef = useRef<HTMLCanvasElement>(null);
    const exposureRailRef = useRef<HTMLDivElement>(null);
    const analysisCanvasRef = useRef<HTMLCanvasElement>(document.createElement('canvas'));
    const captureCanvasRef = useRef<HTMLCanvasElement>(document.createElement('canvas'));
    const objectUrlRef = useRef<string | null>(null);
    const trackRef = useRef<MediaStreamTrack | null>(null);
    const capabilitiesRef = useRef<ExtendedCapabilities | null>(null);
    const exposureControlRef = useRef<ExposureControl | null>(null);
    const latestAnalysisRef = useRef<CameraAnalysis | null>(null);
    const analysisStabilizerRef = useRef<AnalysisStabilizerState>({
        analysis: null,
        candidatePattern: null,
        candidatePatternCount: 0,
        detectedCount: 0,
        missingCount: 0,
        kalman: null,
    });
    const exposureRef = useRef(0);
    const evRef = useRef(0);
    const exposureLockedRef = useRef(false);
    const autoAdjustAtRef = useRef(0);

    const [sourceMode, setSourceModeState] = useState<InputSourceMode>('demo');
    const [demoBaseImageUrl, setDemoBaseImageUrl] = useState(() => buildSyntheticInterferogram('centered'));
    const [demoImageUrl, setDemoImageUrl] = useState(() => buildSyntheticInterferogram('centered'));
    const [demoCenter, setDemoCenter] = useState<DemoCenterOffset>(demoPresetCenters.centered);
    const [demoPatternOverride, setDemoPatternOverride] = useState<FrameAnalysis['fringePattern'] | null>('rings');
    const [demoImageName, setDemoImageName] = useState('内置样张：居中圆环');
    const [demoImageToken, setDemoImageToken] = useState(0);
    const [errorMsg, setErrorMsg] = useState('');
    const [, setExposure] = useState(0);
    const [evValue, setEvValue] = useState(0);
    const [exposureLocked, setExposureLocked] = useState(false);
    const [statusText, setStatusText] = useState('演示模式：使用显示 EV');
    const [analysis, setAnalysis] = useState<CameraAnalysis | null>(null);

    const analyzeCurrentSource = useCallback(() => {
        const source = sourceMode === 'demo' ? demoImageRef.current : videoRef.current;
        if (!source) return null;
        if (source instanceof HTMLVideoElement && (source.readyState < 2 || !source.videoWidth || !source.videoHeight)) return null;
        if (source instanceof HTMLImageElement && (!source.complete || !source.naturalWidth)) return null;

        const predictedCenter = analysisStabilizerRef.current.kalman?.getPredictedCenter() ?? null;
        let nextAnalysis = detectRings(source, analysisCanvasRef.current, evRef.current, predictedCenter);
        if (!nextAnalysis) return null;
        if (sourceMode === 'demo' && demoPatternOverride) {
            const isStraightDemo = demoPatternOverride === 'straight';
            nextAnalysis = {
                ...nextAnalysis,
                fringePattern: demoPatternOverride,
                orientationRad: isStraightDemo
                    ? nextAnalysis.lineOrientationRad ?? nextAnalysis.orientationRad
                    : nextAnalysis.orientationRad,
                status: isStraightDemo ? 'detected' : nextAnalysis.status,
                ringCount: isStraightDemo ? 0 : nextAnalysis.ringCount,
                ringRadiiPx: isStraightDemo ? [] : nextAnalysis.ringRadiiPx,
                brightRingRadiiPx: isStraightDemo ? [] : nextAnalysis.brightRingRadiiPx,
                darkRingRadiiPx: isStraightDemo ? [] : nextAnalysis.darkRingRadiiPx,
                circularity: demoPatternOverride === 'ellipse'
                    ? Math.min(nextAnalysis.circularity, 0.62)
                    : isStraightDemo
                        ? Math.max(nextAnalysis.circularity, 0.82)
                        : nextAnalysis.circularity,
            };
        }

        const profiledAnalysis = applyAnalysisProfile(nextAnalysis, analysisProfile);
        const stableAnalysis = autoAnalyze
            ? stabilizeAnalysis(profiledAnalysis, analysisStabilizerRef.current)
            : profiledAnalysis;

        latestAnalysisRef.current = stableAnalysis;
        setAnalysis(stableAnalysis);
        onFrameAnalysis?.(stableAnalysis);
        return stableAnalysis;
    }, [analysisProfile, autoAnalyze, demoPatternOverride, onFrameAnalysis, sourceMode]);

    const resetAnalysisState = useCallback(() => {
        analysisStabilizerRef.current.kalman?.reset();
        analysisStabilizerRef.current = {
            analysis: null,
            candidatePattern: null,
            candidatePatternCount: 0,
            detectedCount: 0,
            missingCount: 0,
            kalman: null,
        };
        latestAnalysisRef.current = null;
        setAnalysis(null);
    }, []);

    useImperativeHandle(ref, () => ({
        captureFrame: () => {
            if (sourceMode === 'demo') {
                const image = demoImageRef.current;
                if (!image || !image.naturalWidth || !image.naturalHeight) return null;
                return drawSourceToCanvas(image, captureCanvasRef.current, 0.86, evRef.current);
            }
            const video = videoRef.current;
            if (!video || !video.videoWidth || !video.videoHeight) return null;
            return drawSourceToCanvas(video, captureCanvasRef.current, 0.86, evRef.current);
        },
        analyzeCurrentFrame: () => analyzeCurrentSource(),
    }), [analyzeCurrentSource, sourceMode]);

    useEffect(() => {
        exposureLockedRef.current = exposureLocked;
    }, [exposureLocked]);

    useEffect(() => {
        return () => {
            if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
        };
    }, []);

    const setDemoImage = useCallback((
        url: string,
        name: string,
        isObjectUrl = false,
        nextCenter: DemoCenterOffset = demoPresetCenters.centered,
        patternOverride: FrameAnalysis['fringePattern'] | null = null,
    ) => {
        resetAnalysisState();
        if (objectUrlRef.current) {
            URL.revokeObjectURL(objectUrlRef.current);
            objectUrlRef.current = null;
        }
        if (isObjectUrl) objectUrlRef.current = url;
        setDemoBaseImageUrl(url);
        setDemoImageName(name);
        setDemoCenter(nextCenter);
        setDemoPatternOverride(patternOverride);
    }, [resetAnalysisState]);

    useEffect(() => {
        let cancelled = false;
        createShiftedDemoImage(demoBaseImageUrl, demoCenter)
            .then((url) => {
                if (cancelled) return;
                setDemoImageUrl(url);
                setDemoImageToken(token => token + 1);
            })
            .catch(() => {
                if (cancelled) return;
                setDemoImageUrl(demoBaseImageUrl);
                setDemoImageToken(token => token + 1);
            });

        return () => {
            cancelled = true;
        };
    }, [demoBaseImageUrl, demoCenter]);

    const changeSourceMode = useCallback((nextMode: InputSourceMode) => {
        setSourceModeState(nextMode);
        setErrorMsg('');
        resetAnalysisState();
        if (nextMode === 'demo') setStatusText('演示模式：使用显示 EV');
    }, [resetAnalysisState]);

    const applyExposure = useCallback(async (nextEv: number, source: 'auto' | 'manual' | 'lock') => {
        const boundedEv = clamp(nextEv, EV_MIN, EV_MAX);
        const track = trackRef.current;
        const control = exposureControlRef.current;
        const prefix = source === 'auto' ? '自动 EV' : source === 'lock' ? '已锁定' : '手动 EV';

        evRef.current = boundedEv;
        setEvValue(boundedEv);

        if (!track || !control) {
            setStatusText(`${prefix} ${formatEv(boundedEv)}（显示增强）`);
            return;
        }

        const nextExposure = evToValue(boundedEv, control);
        exposureRef.current = nextExposure;
        setExposure(nextExposure);

        try {
            const capabilities = capabilitiesRef.current;
            const supportedModes = capabilities?.exposureMode ?? [];
            const constraint: Record<string, unknown> = {};
            if (supportedModes.includes('manual')) constraint.exposureMode = 'manual';
            constraint[control.property] = nextExposure;
            await track.applyConstraints({ advanced: [constraint] } as MediaTrackConstraints);
            setStatusText(`${prefix} ${formatEv(boundedEv)}（硬件同步 + 显示增强）`);
        } catch {
            setStatusText(`${prefix} ${formatEv(boundedEv)}（硬件曝光不可用，已用显示增强）`);
        }
    }, []);

    const updateExposureFromPointer = (clientY: number) => {
        const rail = exposureRailRef.current;
        if (!rail) return;
        const rect = rail.getBoundingClientRect();
        const ratio = clamp((rect.bottom - clientY) / rect.height, 0, 1);
        const rawEv = EV_MIN + ratio * (EV_MAX - EV_MIN);
        const steppedEv = Math.round(rawEv / EV_STEP) * EV_STEP;
        setExposureLocked(true);
        void applyExposure(steppedEv, 'manual');
    };

    useEffect(() => {
        let stream: MediaStream | null = null;
        let cancelled = false;

        const startCamera = async () => {
            if (sourceMode !== 'camera') {
                setErrorMsg('');
                onStreamReady?.(null);
                trackRef.current = null;
                exposureControlRef.current = null;
                setStatusText('演示模式：使用显示 EV');
                return;
            }

            try {
                setErrorMsg('');
                stream = await navigator.mediaDevices.getUserMedia({
                    video: { width: { ideal: 1280 }, height: { ideal: 960 }, facingMode: 'environment' },
                    audio: false,
                });
                if (cancelled) return;
                const [track] = stream.getVideoTracks();
                trackRef.current = track ?? null;

                const capabilities = track?.getCapabilities?.() as ExtendedCapabilities | undefined;
                const settings = track?.getSettings?.() as ExtendedSettings | undefined;
                capabilitiesRef.current = capabilities ?? null;

                const capability = capabilities?.exposureCompensation ?? capabilities?.exposureTime;
                const property: ExposureProperty | null = capabilities?.exposureCompensation
                    ? 'exposureCompensation'
                    : capabilities?.exposureTime
                        ? 'exposureTime'
                        : null;

                if (capability && property) {
                    const nextControl = {
                        property,
                        min: capability.min,
                        max: capability.max,
                        step: capability.step || 1,
                    };
                    const initialExposure = getInitialExposure(nextControl, settings ?? {});
                    exposureControlRef.current = nextControl;
                    exposureRef.current = initialExposure;
                    setExposure(initialExposure);
                    evRef.current = 0;
                    setEvValue(0);
                    setStatusText(`自动 EV 待命 ${formatEv(0)}`);
                } else {
                    exposureControlRef.current = null;
                    evRef.current = 0;
                    setEvValue(0);
                    setStatusText('当前设备未开放硬件曝光，使用显示 EV');
                }

                if (videoRef.current) {
                    videoRef.current.srcObject = stream;
                    videoRef.current.onloadedmetadata = () => {
                        videoRef.current?.play();
                    };
                }
                onStreamReady?.(stream);
            } catch (err: unknown) {
                if (cancelled) return;
                const errorMessage = err instanceof Error ? err.message : String(err);
                setErrorMsg(`无法访问摄像头，请检查权限：${errorMessage}`);
                onStreamReady?.(null);
            }
        };

        startCamera();

        return () => {
            cancelled = true;
            onStreamReady?.(null);
            trackRef.current = null;
            stream?.getTracks().forEach(track => track.stop());
        };
    }, [onStreamReady, sourceMode]);

    useEffect(() => {
        if (!autoAnalyze) return undefined;

        const runTick = () => {
            const stableAnalysis = analyzeCurrentSource();
            if (!stableAnalysis) return false;
            if (sourceMode === 'demo') return true;

            const now = Date.now();
            if (exposureLockedRef.current || now - autoAdjustAtRef.current < 360) return true;

            const measuredBrightness = stableAnalysis.firstBrightRingBrightness ?? stableAnalysis.peakBrightness;
            const targetBrightness = stableAnalysis.firstBrightRingBrightness === null
                ? PEAK_BRIGHTNESS_FALLBACK_TARGET
                : FIRST_BRIGHT_RING_TARGET_BRIGHTNESS;
            const deadband = stableAnalysis.firstBrightRingBrightness === null
                ? PEAK_BRIGHTNESS_FALLBACK_DEADBAND
                : FIRST_BRIGHT_RING_TARGET_DEADBAND;
            const error = targetBrightness - measuredBrightness;
            if (Math.abs(error) < deadband) return true;

            autoAdjustAtRef.current = now;
            const adjustment = Math.abs(error) > 0.16 ? 0.2 : 0.1;
            const nextEv = evRef.current + Math.sign(error) * adjustment;
            void applyExposure(nextEv, 'auto');
            return true;
        };

        runTick();
        const readyPoll = window.setInterval(() => {
            if (latestAnalysisRef.current) {
                window.clearInterval(readyPoll);
                return;
            }
            runTick();
        }, 250);
        const timer = window.setInterval(runTick, AUTO_ANALYZE_INTERVAL_MS);

        return () => {
            window.clearInterval(timer);
            window.clearInterval(readyPoll);
        };
    }, [analyzeCurrentSource, applyExposure, autoAnalyze, sourceMode, demoImageToken]);

    useEffect(() => {
        const render = () => {
            if (!overlayRef.current) return;
            const media = sourceMode === 'demo' ? demoImageRef.current : videoRef.current;
            const objectFit = media ? getComputedStyle(media).objectFit : 'cover';
            drawOverlay(overlayRef.current, latestAnalysisRef.current, mode, centerConfirmed, objectFit);
        };
        render();
        const observer = new ResizeObserver(render);
        if (overlayRef.current) observer.observe(overlayRef.current);
        window.addEventListener('resize', render);
        return () => {
            observer.disconnect();
            window.removeEventListener('resize', render);
        };
    }, [analysis, centerConfirmed, mode, sourceMode]);

    const exposureRatio = clamp((evValue - EV_MIN) / (EV_MAX - EV_MIN), 0, 1);
    const axisStyle = { '--exposure-ratio': String(exposureRatio) } as React.CSSProperties;
    const cameraVideoStyle = {
        '--camera-exposure-filter': getExposureFilter(evValue),
    } as React.CSSProperties;
    const hudStatusText = (() => {
        if (!analysis) return '未检测到有效圆环';
        const hasRingState = (analysis.ringCount ?? 0) > 0 || analysis.fringePattern === 'rings' || analysis.fringePattern === 'ellipse';
        if (analysis.status === 'searching' && !hasRingState) return '未检测到有效圆环';
        if (analysis.status === 'centered') return '圆心已接近画面中心';
        if (analysis.fringePattern === 'straight') return '检测到直线条纹';
        if (analysis.fringePattern === 'ellipse') return '检测到椭圆环，圆心未居中';

        const frameW = analysis.frameWidth || 1;
        const frameH = analysis.frameHeight || 1;
        const offLeft = analysis.centerX < frameW * 0.12 || analysis.offsetXNorm < -0.78;
        const offRight = analysis.centerX > frameW * 0.88 || analysis.offsetXNorm > 0.78;
        const offTop = analysis.centerY < frameH * 0.12 || analysis.offsetYNorm < -0.78;
        const offBottom = analysis.centerY > frameH * 0.88 || analysis.offsetYNorm > 0.78;
        if (offLeft) return hasRingState ? '圆心偏左，可见右半圆弧' : '圆心偏左';
        if (offRight) return hasRingState ? '圆心偏右，可见左半圆弧' : '圆心偏右';
        if (offTop) return hasRingState ? '圆心偏上，可见下半圆弧' : '圆心偏上';
        if (offBottom) return hasRingState ? '圆心偏下，可见上半圆弧' : '圆心偏下';
        if (analysis.status === 'searching' && hasRingState) return '圆环可见，圆心未锁定';

        const threshold = 0.055;
        const horizontal = Math.abs(analysis.offsetXNorm) >= threshold
            ? analysis.offsetXNorm > 0 ? '偏右' : '偏左'
            : '';
        const vertical = Math.abs(analysis.offsetYNorm) >= threshold
            ? analysis.offsetYNorm > 0 ? '偏下' : '偏上'
            : '';

        if (horizontal || vertical) return `圆心${horizontal}${vertical}`;
        return hasRingState ? '检测到圆环' : '检测到图像结构';
    })();
    const hudPatternMetric = analysis?.fringePattern === 'straight'
        ? '类型 直线条纹'
        : `环数 ${analysis?.ringCount ?? 0}`;
    const hudBrightnessText = analysis?.firstBrightRingBrightness !== null && analysis?.firstBrightRingBrightness !== undefined
        ? `一阶亮环 ${Math.round(analysis.firstBrightRingBrightness * 100)}%`
        : `峰值 ${Math.round((analysis?.peakBrightness ?? 0) * 100)}%`;

    return (
        <div className={`camera-container camera-mode-${mode} source-${sourceMode}${className ? ` ${className}` : ''}`}>
            <div className="camera-video-wrapper" style={cameraVideoStyle}>
                <div className="camera-source-panel">
                    <div className="source-segment" role="group" aria-label="图像输入源">
                        <button
                            type="button"
                            className={sourceMode === 'camera' ? 'is-active' : ''}
                            onClick={() => changeSourceMode('camera')}
                        >
                            摄像头
                        </button>
                        <button
                            type="button"
                            className={sourceMode === 'demo' ? 'is-active' : ''}
                            onClick={() => changeSourceMode('demo')}
                        >
                            演示图片
                        </button>
                    </div>
                    {onManualAnalyze && (
                        <button
                            type="button"
                            className="manual-analyze-button"
                            onClick={onManualAnalyze}
                            title={manualAnalyzeStatus ?? manualAnalyzeLabel}
                        >
                            {manualAnalyzeLabel}
                        </button>
                    )}
                    {sourceMode === 'demo' && (
                        <div className="demo-source-tools">
                            <label className="demo-file-button">
                                本地图片
                                <input
                                    type="file"
                                    accept="image/*"
                                    onChange={(event) => {
                                        const file = event.target.files?.[0];
                                        if (!file) return;
                                        setDemoImage(URL.createObjectURL(file), file.name, true);
                                        event.currentTarget.value = '';
                                    }}
                                />
                            </label>
                            <div className="demo-presets" aria-label="内置模拟样张">
                                {demoPresets.map((preset) => (
                                    <button
                                        key={preset.id}
                                        type="button"
                                        title={preset.description}
                                        onClick={() => {
                                            setDemoImage(
                                                buildSyntheticInterferogram(preset.id),
                                                `内置样张：${preset.label}`,
                                                false,
                                                demoPresetCenters[preset.id],
                                                preset.id === 'straight' ? 'straight' : preset.id === 'ellipse' ? 'ellipse' : 'rings',
                                            );
                                        }}
                                    >
                                        {preset.label}
                                    </button>
                                ))}
                            </div>
                            <span className="demo-image-name">{demoImageName}</span>
                            <div className="demo-center-controls">
                                <label>
                                    <span>X {demoCenter.x}%</span>
                                    <input
                                        type="range"
                                        min={-35}
                                        max={35}
                                        step={1}
                                        value={demoCenter.x}
                                        onChange={(event) => setDemoCenter(prev => ({ ...prev, x: Number(event.target.value) }))}
                                    />
                                </label>
                                <label>
                                    <span>Y {demoCenter.y}%</span>
                                    <input
                                        type="range"
                                        min={-35}
                                        max={35}
                                        step={1}
                                        value={demoCenter.y}
                                        onChange={(event) => setDemoCenter(prev => ({ ...prev, y: Number(event.target.value) }))}
                                    />
                                </label>
                                <button type="button" onClick={() => setDemoCenter(demoPresetCenters.centered)}>
                                    居中
                                </button>
                            </div>
                        </div>
                    )}
                </div>
                {errorMsg ? (
                    <div className="camera-error">
                        <p>{errorMsg}</p>
                        <button
                            type="button"
                            className="camera-error-action"
                            onClick={() => changeSourceMode('demo')}
                        >
                            改用演示图片
                        </button>
                    </div>
                ) : sourceMode === 'demo' ? (
                    <img
                        ref={demoImageRef}
                        src={demoImageUrl}
                        className="camera-video demo-image"
                        alt="演示圆环"
                        onLoad={() => setDemoImageToken(token => token + 1)}
                    />
                ) : (
                    <video ref={videoRef} className="camera-video" playsInline muted autoPlay />
                )}
                <canvas ref={overlayRef} className="camera-overlay" />
                <div className="camera-crosshair" aria-hidden="true">
                    <span className="camera-crosshair-line horizontal" />
                    <span className="camera-crosshair-line vertical" />
                    <span className="camera-crosshair-ring" />
                    <span className="camera-crosshair-dot" />
                </div>
                <div className="camera-hud">
                    <strong>{hudStatusText}</strong>
                    <span>
                        置信度 {Math.round((analysis?.confidence ?? 0) * 100)}% · {hudPatternMetric} · 圆度 {Math.round((analysis?.circularity ?? 0) * 100)}% · {hudBrightnessText}
                    </span>
                    {manualAnalyzeStatus ? <em className="camera-hud-status">{manualAnalyzeStatus}</em> : null}
                </div>

                <div className="exposure-axis-panel" style={axisStyle}>
                    <div className="exposure-axis-meta">
                        <span>EV</span>
                        <strong>{formatEv(evValue)}</strong>
                    </div>
                    <p className="exposure-shortcut-hint">↑↓ 调 EV · Shift 大步</p>
                    <div
                        ref={exposureRailRef}
                        className="exposure-axis"
                        role="slider"
                        aria-label="曝光补偿 EV"
                        aria-valuemin={EV_MIN}
                        aria-valuemax={EV_MAX}
                        aria-valuenow={evValue}
                        tabIndex={0}
                        onPointerDown={(event) => {
                            event.currentTarget.setPointerCapture(event.pointerId);
                            updateExposureFromPointer(event.clientY);
                        }}
                        onPointerMove={(event) => {
                            if (event.buttons !== 1) return;
                            updateExposureFromPointer(event.clientY);
                        }}
                        onKeyDown={(event) => {
                            const amount = event.shiftKey ? 0.5 : EV_STEP;
                            if (event.key === 'ArrowUp') {
                                setExposureLocked(true);
                                void applyExposure(evValue + amount, 'manual');
                            }
                            if (event.key === 'ArrowDown') {
                                setExposureLocked(true);
                                void applyExposure(evValue - amount, 'manual');
                            }
                        }}
                    >
                        <span className="exposure-track" />
                        <span className="exposure-fill" />
                        <span className="exposure-thumb" />
                        <span className="exposure-tick top"><b>+2</b></span>
                        <span className="exposure-tick upper"><b>+1</b></span>
                        <span className="exposure-tick middle"><b>0</b></span>
                        <span className="exposure-tick lower"><b>-1</b></span>
                        <span className="exposure-tick bottom"><b>-2</b></span>
                    </div>
                    <button
                        type="button"
                        className={`exposure-lock ${exposureLocked ? 'is-locked' : ''}`}
                        onClick={() => {
                            const nextLocked = !exposureLocked;
                            setExposureLocked(nextLocked);
                            if (nextLocked) void applyExposure(evValue, 'lock');
                            else setStatusText('自动 EV 已开启');
                        }}
                    >
                        {exposureLocked ? '锁定' : '自动'}
                    </button>
                    <span className="camera-support-note">{statusText}</span>
                </div>
            </div>
        </div>
    );
});

CameraView.displayName = 'CameraView';

export default CameraView;
