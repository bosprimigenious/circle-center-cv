import { useCallback, useEffect, useRef, useState } from 'react';
import {
    detectFaceLandmarks,
    getFaceEngineLabel,
    subscribeFaceEngineStatus,
    warmupFaceLandmarker,
} from '../../face/landmarker';
import { drawFaceOverlay } from '../../face/overlay';
import type { FaceFrameResult } from '../../face/types';
import './FaceView.css';

const DETECT_INTERVAL_MS = 66;
const PANEL_INTERVAL_MS = 200;

type FaceViewProps = {
    onFrameResult?: (result: FaceFrameResult | null) => void;
};

export default function FaceView({ onFrameResult }: FaceViewProps) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const imageRef = useRef<HTMLImageElement>(null);
    const overlayRef = useRef<HTMLCanvasElement>(null);
    const latestRef = useRef<FaceFrameResult | null>(null);
    const objectUrlRef = useRef<string | null>(null);
    const onFrameResultRef = useRef(onFrameResult);
    const busyRef = useRef(false);
    const lastDetectAtRef = useRef(0);
    const lastPanelAtRef = useRef(0);

    const [sourceMode, setSourceMode] = useState<'camera' | 'image'>('camera');
    const [imageUrl, setImageUrl] = useState<string | null>(null);
    const [imageToken, setImageToken] = useState(0);
    const [imageName, setImageName] = useState('未选择');
    const [errorMsg, setErrorMsg] = useState('');
    const [engine, setEngine] = useState('正在加载 Face Landmarker…');
    const [engineReady, setEngineReady] = useState(false);
    const [loadElapsed, setLoadElapsed] = useState(0);
    const [result, setResult] = useState<FaceFrameResult | null>(null);
    const sourceModeRef = useRef(sourceMode);

    useEffect(() => {
        onFrameResultRef.current = onFrameResult;
    }, [onFrameResult]);

    useEffect(() => {
        sourceModeRef.current = sourceMode;
    }, [sourceMode]);

    useEffect(() => {
        const started = performance.now();
        const unsubscribe = subscribeFaceEngineStatus(setEngine);
        const tick = window.setInterval(() => {
            setLoadElapsed(Math.max(0, Math.round((performance.now() - started) / 1000)));
        }, 250);
        void warmupFaceLandmarker()
            .then(() => {
                setEngineReady(true);
                setEngine(getFaceEngineLabel());
            })
            .catch((error) => {
                setEngine(error instanceof Error ? error.message : String(error));
            });
        return () => {
            unsubscribe();
            window.clearInterval(tick);
        };
    }, []);

    const paintOverlay = useCallback(() => {
        const canvas = overlayRef.current;
        if (!canvas) return;
        const media = sourceModeRef.current === 'image' ? imageRef.current : videoRef.current;
        const objectFit = media ? getComputedStyle(media).objectFit : 'cover';
        drawFaceOverlay(canvas, latestRef.current, objectFit);
    }, []);

    const publish = useCallback((next: FaceFrameResult | null, forcePanel = false) => {
        latestRef.current = next;
        paintOverlay();
        const now = performance.now();
        if (!forcePanel && now - lastPanelAtRef.current < PANEL_INTERVAL_MS) return;
        lastPanelAtRef.current = now;
        setResult(next);
        onFrameResultRef.current?.(next);
        if (next?.engine) setEngine(next.engine);
    }, [paintOverlay]);

    useEffect(() => {
        return () => {
            if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
        };
    }, []);

    useEffect(() => {
        let stream: MediaStream | null = null;
        let cancelled = false;
        if (sourceMode !== 'camera') return undefined;

        const start = async () => {
            try {
                stream = await navigator.mediaDevices.getUserMedia({
                    video: {
                        width: { ideal: 640, max: 960 },
                        height: { ideal: 480, max: 720 },
                        frameRate: { ideal: 20, max: 24 },
                        facingMode: 'user',
                    },
                    audio: false,
                });
                if (cancelled) return;
                if (videoRef.current) {
                    videoRef.current.srcObject = stream;
                    await videoRef.current.play();
                }
            } catch (error) {
                if (cancelled) return;
                setErrorMsg(error instanceof Error ? error.message : String(error));
            }
        };
        void start();

        return () => {
            cancelled = true;
            stream?.getTracks().forEach((track) => track.stop());
        };
    }, [sourceMode]);

    useEffect(() => {
        let cancelled = false;
        let frame = 0;
        if (!engineReady) return undefined;

        const analyze = async () => {
            if (cancelled || busyRef.current) return;
            const source = sourceMode === 'image' ? imageRef.current : videoRef.current;
            if (!source) return;
            if (source instanceof HTMLVideoElement && (source.readyState < 2 || !source.videoWidth)) return;
            if (source instanceof HTMLImageElement && (!source.complete || !source.naturalWidth)) return;
            const now = performance.now();
            if (sourceMode === 'camera' && now - lastDetectAtRef.current < DETECT_INTERVAL_MS) {
                paintOverlay();
                return;
            }
            lastDetectAtRef.current = now;
            busyRef.current = true;
            try {
                const next = await detectFaceLandmarks(
                    source,
                    sourceMode === 'image' ? 'IMAGE' : 'VIDEO',
                    now,
                );
                if (!cancelled) publish(next);
            } finally {
                busyRef.current = false;
            }
        };

        if (sourceMode === 'image') {
            void analyze();
            return () => {
                cancelled = true;
            };
        }

        const tick = () => {
            void analyze();
            frame = window.requestAnimationFrame(tick);
        };
        frame = window.requestAnimationFrame(tick);
        return () => {
            cancelled = true;
            window.cancelAnimationFrame(frame);
        };
    }, [engineReady, imageToken, imageUrl, paintOverlay, publish, sourceMode]);

    useEffect(() => {
        const render = () => paintOverlay();
        render();
        const observer = new ResizeObserver(render);
        if (overlayRef.current) observer.observe(overlayRef.current);
        window.addEventListener('resize', render);
        return () => {
            observer.disconnect();
            window.removeEventListener('resize', render);
        };
    }, [paintOverlay, sourceMode]);

    const hud = !engineReady
        ? `正在加载 Face Landmarker… ${loadElapsed}s`
        : result
            ? result.faceCount > 0
                ? `${result.faceCount} 张脸 · 每张 ${result.landmarkCount} 点（期望 ${result.expectedLandmarkCount}）`
                : result.error ?? '未检测到人脸'
            : '等待画面…';

    return (
        <div className={`camera-container source-${sourceMode === 'image' ? 'demo' : 'camera'}`}>
            <div className="camera-video-wrapper">
                <div className="camera-source-panel">
                    <div className="source-segment" role="group" aria-label="图像输入源">
                        <button
                            type="button"
                            className={sourceMode === 'camera' ? 'is-active' : ''}
                            onClick={() => {
                                setSourceMode('camera');
                                publish(null, true);
                            }}
                        >
                            摄像头
                        </button>
                        <button
                            type="button"
                            className={sourceMode === 'image' ? 'is-active' : ''}
                            onClick={() => {
                                setErrorMsg('');
                                setSourceMode('image');
                            }}
                        >
                            本地图片
                        </button>
                    </div>
                    {sourceMode === 'image' && (
                        <div className="demo-source-tools">
                            <label className="demo-file-button">
                                选择人脸图
                                <input
                                    type="file"
                                    accept="image/*"
                                    onChange={(event) => {
                                        const file = event.target.files?.[0];
                                        if (!file) return;
                                        if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
                                        const url = URL.createObjectURL(file);
                                        objectUrlRef.current = url;
                                        setImageUrl(url);
                                        setImageName(file.name);
                                        event.currentTarget.value = '';
                                    }}
                                />
                            </label>
                            <span className="demo-image-name">{imageName}</span>
                        </div>
                    )}
                </div>
                {errorMsg ? (
                    <div className="camera-error">
                        <p>无法打开摄像头：{errorMsg}</p>
                        <button
                            type="button"
                            className="camera-error-action"
                            onClick={() => {
                                setErrorMsg('');
                                setSourceMode('image');
                            }}
                        >
                            改用本地图片
                        </button>
                    </div>
                ) : sourceMode === 'image' ? (
                    imageUrl ? (
                        <img
                            ref={imageRef}
                            src={imageUrl}
                            className="camera-video demo-image"
                            alt="人脸图"
                            onLoad={() => setImageToken((token) => token + 1)}
                        />
                    ) : (
                        <div className="camera-error">
                            <p>请选择一张含人脸的图片。</p>
                        </div>
                    )
                ) : (
                    <video ref={videoRef} className="camera-video" playsInline muted autoPlay />
                )}
                <canvas ref={overlayRef} className="camera-overlay" />
                <div className="camera-hud">
                    <strong>{hud}</strong>
                    <span>{engine} · 478 点网格含虹膜，不是 6 点检测器</span>
                </div>
            </div>
        </div>
    );
}
