import { useCallback, useEffect, useRef, useState } from 'react';
import { eyeAspectRatio, mouthAspectRatio } from '../../cheat/geometry.ts';
import { CheatSession } from '../../cheat/session';
import { FatigueSession } from '../../fatigue/session';
import { fuseGaze } from '../../gaze/fuse';
import { LookSession } from '../../look/session';
import { SpeechSession } from '../../speech/session';
import { AvSyncSession } from '../../avsync/session';
import { AudioTap } from '../../avsync/tap';
import { getFaceEngineLabel, subscribeFaceEngineStatus } from '../../face/landmarker';
import { detectFrame, resetPipelineCache, warmupVisionPipeline } from '../../face/pipeline';
import { drawFaceOverlay } from '../../face/overlay';
import type { FaceFrameResult } from '../../face/types';
import {
    describeLook,
    fusedIrisRay,
    irisGazeFromLandmarks,
    l2csRayFrom,
    rayFromEye,
} from '../../gaze/iris';
import { getGazeEngineLabel, subscribeGazeEngineStatus } from '../../gaze/l2cs';
import { getPoseEngineLabel, subscribePoseEngineStatus } from '../../pose/landmarker';
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
    const cheatSessionRef = useRef(new CheatSession());
    const fatigueSessionRef = useRef(new FatigueSession());
    const lookSessionRef = useRef(new LookSession());
    const speechSessionRef = useRef(new SpeechSession());
    const avsyncSessionRef = useRef(new AvSyncSession());
    const audioTapRef = useRef<AudioTap | null>(null);
    const audioErrorRef = useRef<string | null>(null);
    const sessionOriginRef = useRef(0);
    const lastCoveredAtRef = useRef(0);
    const lastVideoTimeRef = useRef(0);
    const coveredCanvasRef = useRef<HTMLCanvasElement | null>(null);

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
        const syncEngine = () => {
            setEngine(`${getFaceEngineLabel()} · ${getPoseEngineLabel()} · ${getGazeEngineLabel()}`);
        };
        const unsubscribeFace = subscribeFaceEngineStatus(syncEngine);
        const unsubscribePose = subscribePoseEngineStatus(syncEngine);
        const unsubscribeGaze = subscribeGazeEngineStatus(syncEngine);
        const tick = window.setInterval(() => {
            setLoadElapsed(Math.max(0, Math.round((performance.now() - started) / 1000)));
        }, 250);
        void warmupVisionPipeline()
            .then(() => {
                setEngineReady(true);
                syncEngine();
            })
            .catch((error) => {
                setEngine(error instanceof Error ? error.message : String(error));
            });
        return () => {
            unsubscribeFace();
            unsubscribePose();
            unsubscribeGaze();
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

    const resetCheat = useCallback(() => {
        cheatSessionRef.current.reset();
        fatigueSessionRef.current.reset();
        lookSessionRef.current.reset();
        speechSessionRef.current.reset();
        avsyncSessionRef.current.reset();
        sessionOriginRef.current = performance.now();
        lastCoveredAtRef.current = 0;
        lastVideoTimeRef.current = 0;
        resetPipelineCache();
    }, []);

    const grabCoveredFrame = useCallback((media: HTMLVideoElement | HTMLImageElement) => {
        let canvas = coveredCanvasRef.current;
        if (!canvas) {
            canvas = document.createElement('canvas');
            canvas.width = 320;
            canvas.height = 240;
            coveredCanvasRef.current = canvas;
        }
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return undefined;
        ctx.drawImage(media, 0, 0, 320, 240);
        return ctx.getImageData(0, 0, 320, 240);
    }, []);

    useEffect(() => {
        resetCheat();
    }, [imageToken, imageUrl, resetCheat, sourceMode, videoUrl]);

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

        const video = {
            width: { ideal: 640, max: 960 },
            height: { ideal: 480, max: 720 },
            frameRate: { ideal: 20, max: 24 },
            facingMode: 'user' as const,
        };
        const start = async () => {
            try {
                audioErrorRef.current = null;
                try {
                    stream = await navigator.mediaDevices.getUserMedia({
                        video,
                        audio: { echoCancellation: true, noiseSuppression: true },
                    });
                } catch (audioError) {
                    stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
                    audioErrorRef.current = audioError instanceof Error ? audioError.message : '麦克风不可用';
                }
                if (cancelled) return;
                audioTapRef.current ??= new AudioTap();
                await audioTapRef.current.attachStream(stream);
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
            audioTapRef.current?.close();
            audioTapRef.current = null;
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
                const { face: next, pose, l2cs, l2csAgeMs } = await detectFrame(
                    source,
                    sourceMode === 'image' ? 'IMAGE' : 'VIDEO',
                    now,
                );
                if (source instanceof HTMLVideoElement) {
                    if (source.currentTime + 0.5 < lastVideoTimeRef.current) resetCheat();
                    lastVideoTimeRef.current = source.currentTime;
                }
                const face = next.faces[0];
                const iris = irisGazeFromLandmarks(face?.landmarks);
                const origin = iris.left && iris.right
                    ? { x: (iris.left.center.x + iris.right.center.x) / 2, y: (iris.left.center.y + iris.right.center.y) / 2 }
                    : face?.landmarks[1]
                        ? { x: face.landmarks[1].x, y: face.landmarks[1].y }
                        : null;
                const tSec = sourceMode === 'video' && source instanceof HTMLVideoElement
                    ? source.currentTime
                    : (now - sessionOriginRef.current) / 1000;
                const forceSample = sourceMode === 'image' || now - lastCoveredAtRef.current >= 2000;
                if (forceSample) lastCoveredAtRef.current = now;
                const jawOpen = face?.blendshapes.find((item) => item.name === 'jawOpen')?.score ?? null;
                const blinkLeft = face?.blendshapes.find((item) => item.name === 'eyeBlinkLeft')?.score;
                const blinkRight = face?.blendshapes.find((item) => item.name === 'eyeBlinkRight')?.score;
                const blinks = [blinkLeft, blinkRight].filter((value): value is number => typeof value === 'number');
                const eyeBlink = blinks.length ? blinks.reduce((sum, value) => sum + value, 0) / blinks.length : null;
                const orbitAspects = [iris.left?.orbit, iris.right?.orbit]
                    .filter((box): box is NonNullable<typeof box> => !!box && box.width > 1e-6)
                    .map((box) => box.height / box.width);
                const irisRadii = [iris.left?.radius, iris.right?.radius]
                    .filter((value): value is number => typeof value === 'number');
                const ear = face ? eyeAspectRatio(face.landmarks) : null;
                const mar = face ? mouthAspectRatio(face.landmarks) : null;
                const orbitAspect = orbitAspects.length ? Math.min(...orbitAspects) : null;
                const blurryHint = (ear != null && ear < 0.21) || (orbitAspect != null && orbitAspect < 0.28);
                const fusedGaze = fuseGaze({
                    head: face?.headPose ?? null,
                    iris,
                    l2cs,
                    l2csAgeMs,
                    blurry: blurryHint,
                });
                const gazeEngine = [
                    'mediapipe-iris-orbit',
                    l2cs ? 'mobilegaze-l2cs' : null,
                    face?.headPose ? 'face-matrix' : null,
                    fusedGaze.fused ? 'fused' : null,
                    pose.shoulders ? 'pose-shoulders' : null,
                ].filter(Boolean).join('+');
                const cheat = cheatSessionRef.current.ingest({
                    tSec,
                    landmarks: face?.landmarks ?? null,
                    faceCount: next.faceCount,
                    jawOpen,
                    imageData: forceSample ? grabCoveredFrame(source) : undefined,
                    forceSample,
                    l2cs,
                    fused: fusedGaze.fused,
                    gazeEngine,
                    shoulders: pose.shoulders
                        ? { drop: pose.shoulders.drop, yaw: pose.shoulders.yaw }
                        : null,
                });
                const fatigue = fatigueSessionRef.current.ingest({
                    tSec,
                    ear,
                    mar,
                    jawOpen,
                    eyeBlink,
                    irisRadius: irisRadii.length
                        ? irisRadii.reduce((sum, value) => sum + value, 0) / irisRadii.length
                        : null,
                    orbitAspect,
                    headDown: cheat.live.headDown,
                });
                const look = lookSessionRef.current.ingest({
                    tSec,
                    gazeAway: cheat.live.gazeAway,
                    gazeDirection: cheat.live.gazeDirection,
                    headTurn: cheat.live.headTurn,
                    headDown: cheat.live.headDown,
                    fusedPitch: fusedGaze.fused?.pitch ?? null,
                    gazeBlurry: fatigue.gazeBlurry,
                });
                const speech = speechSessionRef.current.ingest({
                    tSec,
                    mar,
                    jawOpen,
                });
                const avsync = avsyncSessionRef.current.ingest({
                    tSec,
                    mar,
                    visualSpeaking: speech.speaking,
                    rms: audioTapRef.current?.rms() ?? null,
                    audioError: audioErrorRef.current,
                });
                const gaze = {
                    leftOrbit: iris.left?.orbit ?? null,
                    rightOrbit: iris.right?.orbit ?? null,
                    leftIris: iris.left
                        ? { x: iris.left.center.x, y: iris.left.center.y, radius: iris.left.radius }
                        : null,
                    rightIris: iris.right
                        ? { x: iris.right.center.x, y: iris.right.center.y, radius: iris.right.radius }
                        : null,
                    origin,
                    l2cs,
                    irisGazeX: iris.gazeX,
                    irisGazeY: iris.gazeY,
                    leftRay: rayFromEye(iris.left),
                    rightRay: rayFromEye(iris.right),
                    irisRay: fusedIrisRay(iris),
                    l2csRay: origin && l2cs ? l2csRayFrom(origin, l2cs) : null,
                    geometricRay: origin && fusedGaze.geometric ? l2csRayFrom(origin, fusedGaze.geometric, 0.24) : null,
                    fusedRay: origin && fusedGaze.fused ? l2csRayFrom(origin, fusedGaze.fused, 0.32) : null,
                    look: describeLook(iris.gazeX, iris.gazeY, l2cs, fusedGaze.fused),
                    blurry: fatigue.gazeBlurry,
                    fused: fusedGaze.fused,
                    head: face?.headPose ?? null,
                };
                if (!cancelled) {
                    publish({
                        ...next,
                        cheat,
                        gaze,
                        pose,
                        fatigue,
                        look,
                        speech,
                        avsync,
                        engine: `${next.engine} · ${pose.engine}`,
                    });
                }
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
    }, [engineReady, grabCoveredFrame, imageToken, imageUrl, paintOverlay, publish, resetCheat, sourceMode, videoUrl]);

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
                ? `${result.faceCount} 张脸 · ${result.landmarkCount} 点 · 肩 ${result.pose?.shoulders ? '有' : '无'} · ${result.look?.label ?? result.gaze?.look ?? ''} · ${result.speech?.label ?? ''} · ${result.avsync?.label ?? ''} · ${result.fatigue?.label ?? ''}`
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
        resetCheat();
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
                            autoPlay
                            loop
                            onPlay={(event) => {
                                audioErrorRef.current = null;
                                audioTapRef.current ??= new AudioTap();
                                void audioTapRef.current.attachElement(event.currentTarget).catch(() => {
                                    audioErrorRef.current = '无法读取视频音轨';
                                });
                            }}
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
                    <span>{engine} · 478 + 肩点 + 融合视线 + 第二屏 + 说话 + 音画 + 疲劳</span>
                </div>
            </div>
        </div>
    );
}
