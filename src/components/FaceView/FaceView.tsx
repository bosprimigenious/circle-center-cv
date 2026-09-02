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

type SourceMode = 'camera' | 'image' | 'video';

type FaceViewProps = {
    onFrameResult?: (result: FaceFrameResult | null) => void;
};

const isMp4File = (file: File) => (
    file.type === 'video/mp4' || /\.mp4$/i.test(file.name)
);

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

    const [sourceMode, setSourceMode] = useState<SourceMode>('camera');
    const [imageUrl, setImageUrl] = useState<string | null>(null);
    const [imageToken, setImageToken] = useState(0);
    const [imageName, setImageName] = useState('未选择');
    const [videoUrl, setVideoUrl] = useState<string | null>(null);
    const [videoName, setVideoName] = useState('未选择');
    const [videoError, setVideoError] = useState('');
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

    const revokeObjectUrl = useCallback(() => {
        if (!objectUrlRef.current) return;
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
    }, []);

    const assignObjectUrl = useCallback((file: File) => {
        revokeObjectUrl();
        const url = URL.createObjectURL(file);
        objectUrlRef.current = url;
        return url;
    }, [revokeObjectUrl]);

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

    useEffect(() => () => revokeObjectUrl(), [revokeObjectUrl]);

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
            if (sourceMode !== 'image' && now - lastDetectAtRef.current < DETECT_INTERVAL_MS) {
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
    }, [engineReady, imageToken, imageUrl, paintOverlay, publish, sourceMode, videoUrl]);

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

    const switchMode = (next: SourceMode) => {
        if (next === sourceMode) return;
        setErrorMsg('');
        setVideoError('');
        if (next !== 'image') {
            setImageUrl(null);
            setImageName('未选择');
        }
        if (next !== 'video') {
            setVideoUrl(null);
            setVideoName('未选择');
        }
        revokeObjectUrl();
        setSourceMode(next);
        publish(null, true);
    };

    return (
        <div className={`camera-container source-${sourceMode === 'image' ? 'demo' : 'camera'}${sourceMode === 'video' ? ' source-file-video' : ''}`}>
            <div className="camera-video-wrapper">
                <div className="camera-source-panel">
                    <div className="source-segment" role="group" aria-label="图像输入源">
                        <button
                            type="button"
                            className={sourceMode === 'camera' ? 'is-active' : ''}
                            onClick={() => switchMode('camera')}
                        >
                            摄像头
                        </button>
                        <button
                            type="button"
                            className={sourceMode === 'image' ? 'is-active' : ''}
                            onClick={() => switchMode('image')}
                        >
                            本地图片
                        </button>
                        <button
                            type="button"
                            className={sourceMode === 'video' ? 'is-active' : ''}
                            onClick={() => switchMode('video')}
                        >
                            本地视频
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
                                        setImageUrl(assignObjectUrl(file));
                                        setImageName(file.name);
                                        event.currentTarget.value = '';
                                    }}
                                />
                            </label>
                            <span className="demo-image-name">{imageName}</span>
                        </div>
                    )}
                    {sourceMode === 'video' && (
                        <div className="demo-source-tools">
                            <label className="demo-file-button">
                                选择 MP4
                                <input
                                    type="file"
                                    accept="video/mp4,.mp4"
                                    onChange={(event) => {
                                        const file = event.target.files?.[0];
                                        event.currentTarget.value = '';
                                        if (!file) return;
                                        if (!isMp4File(file)) {
                                            setVideoError('请选择 MP4 文件（建议 H.264）。');
                                            setVideoUrl(null);
                                            setVideoName(file.name);
                                            return;
                                        }
                                        setVideoError('');
                                        setVideoUrl(assignObjectUrl(file));
                                        setVideoName(file.name);
                                        publish(null, true);
                                    }}
                                />
                            </label>
                            <span className="demo-image-name">{videoName}</span>
                        </div>
                    )}
                </div>
                {errorMsg ? (
                    <div className="camera-error">
                        <p>无法打开摄像头：{errorMsg}</p>
                        <button
                            type="button"
                            className="camera-error-action"
                            onClick={() => switchMode('image')}
                        >
                            改用本地图片
                        </button>
                        <button
                            type="button"
                            className="camera-error-action"
                            onClick={() => switchMode('video')}
                        >
                            改用本地视频
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
                ) : sourceMode === 'video' ? (
                    videoError ? (
                        <div className="camera-error">
                            <p>{videoError}</p>
                        </div>
                    ) : videoUrl ? (
                        <video
                            key={videoUrl}
                            ref={videoRef}
                            className="camera-video"
                            src={videoUrl}
                            controls
                            playsInline
                            muted
                            autoPlay
                            loop
                            onError={() => {
                                setVideoError('无法解码该视频。请换成 H.264 编码的 MP4（HEVC/AV1 在部分 Chrome 上播不了）。');
                            }}
                        />
                    ) : (
                        <div className="camera-error">
                            <p>请选择一段含人脸的 MP4。检测在浏览器里逐帧跑，文件不会上传到服务器。</p>
                        </div>
                    )
                ) : (
                    <video key="camera" ref={videoRef} className="camera-video" playsInline muted autoPlay />
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
