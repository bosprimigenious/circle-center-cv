import { useMemo, useState } from 'react';
import CameraView from './components/CameraView';
import FaceView from './components/FaceView/FaceView';
import type { CameraAnalysis } from './components/CameraView/types';
import { regionLabels } from './face/regions';
import type { FaceFrameResult, FaceRegionName } from './face/types';
import './App.css';

type AppMode = 'rings' | 'face';

const formatPx = (value: number | undefined) => (
    typeof value === 'number' && Number.isFinite(value) ? value.toFixed(1) : '—'
);

const formatPct = (value: number | undefined) => (
    typeof value === 'number' && Number.isFinite(value) ? `${Math.round(value * 100)}%` : '—'
);

const formatList = (values: number[] | undefined, limit = 8) => {
    if (!values?.length) return '—';
    return values.slice(0, limit).map((value) => value.toFixed(1)).join(', ');
};

const patternLabel = (pattern: CameraAnalysis['fringePattern']) => {
    if (pattern === 'rings') return '圆环';
    if (pattern === 'ellipse') return '椭圆环';
    if (pattern === 'straight') return '直线条纹';
    return '未判定';
};

const statusLabel = (status: CameraAnalysis['status'] | undefined) => {
    if (status === 'centered') return '圆心居中';
    if (status === 'detected') return '已检出';
    return '搜索中';
};

const regionOrder: FaceRegionName[] = [
    'mesh', 'oval', 'lips', 'leftBrow', 'rightBrow', 'leftEye', 'rightEye', 'leftIris', 'rightIris',
];

export default function App() {
    const [mode, setMode] = useState<AppMode>('face');
    const [analysis, setAnalysis] = useState<CameraAnalysis | null>(null);
    const [faceResult, setFaceResult] = useState<FaceFrameResult | null>(null);

    const ringRows = useMemo(() => ([
        { label: '状态', value: statusLabel(analysis?.status) },
        { label: '图样', value: patternLabel(analysis?.fringePattern) },
        { label: '圆心 X', value: `${formatPx(analysis?.centerX)} px` },
        { label: '圆心 Y', value: `${formatPx(analysis?.centerY)} px` },
        { label: '偏移 X', value: formatPct(analysis?.offsetXNorm) },
        { label: '偏移 Y', value: formatPct(analysis?.offsetYNorm) },
        { label: '环数', value: String(analysis?.ringCount ?? 0) },
        { label: '圆度', value: formatPct(analysis?.circularity) },
        { label: '置信度', value: formatPct(analysis?.confidence) },
        { label: '亮环半径', value: formatList(analysis?.brightRingRadiiPx) },
        { label: '暗环半径', value: formatList(analysis?.darkRingRadiiPx) },
        { label: '全部半径', value: formatList(analysis?.ringRadiiPx) },
    ]), [analysis]);

    const faceRows = useMemo(() => {
        const primary = faceResult?.faces[0];
        const expressions = (primary?.blendshapes ?? [])
            .filter((item) => item.score > 0.12)
            .slice(0, 6)
            .map((item) => `${item.name} ${item.score.toFixed(2)}`)
            .join(' · ');
        const regionRows = regionOrder.map((name) => ({
            label: regionLabels[name],
            value: String(faceResult?.regions[name] ?? 0),
        }));
        return [
            { label: '引擎', value: faceResult?.engine ?? '—' },
            { label: '人脸数', value: String(faceResult?.faceCount ?? 0) },
            { label: '关键点', value: `${faceResult?.landmarkCount ?? 0} / ${faceResult?.expectedLandmarkCount ?? 478}` },
            { label: '框宽', value: primary ? formatPct(primary.box.width) : '—' },
            { label: '框高', value: primary ? formatPct(primary.box.height) : '—' },
            { label: '表情', value: expressions || '—' },
            ...regionRows,
        ];
    }, [faceResult]);

    const rows = mode === 'face' ? faceRows : ringRows;

    return (
        <div className="app-shell">
            <header className="app-header">
                <div>
                    <p className="app-kicker">检测 · 稠密关键点</p>
                    <h1>{mode === 'face' ? '人脸网格 478 点' : '圆心定位 + 圆环识别'}</h1>
                </div>
                <div className="app-header-side">
                    <div className="mode-segment" role="group" aria-label="算法">
                        <button
                            type="button"
                            className={mode === 'face' ? 'is-active' : ''}
                            onClick={() => setMode('face')}
                        >
                            人脸网格
                        </button>
                        <button
                            type="button"
                            className={mode === 'rings' ? 'is-active' : ''}
                            onClick={() => setMode('rings')}
                        >
                            圆环
                        </button>
                    </div>
                    <p className="app-note">
                        {mode === 'face'
                            ? 'MediaPipe Face Landmarker：478 个 3D 点（468 网格 + 10 虹膜），含轮廓/五官/虹膜分区。不是 6 点 Face Detector。'
                            : '传统 CV：高通能量质心、径向振荡、同心圆投票、径向剖面峰谷。'}
                    </p>
                </div>
            </header>
            <main className="app-main">
                <section className="stage">
                    {mode === 'face' ? (
                        <FaceView onFrameResult={setFaceResult} />
                    ) : (
                        <CameraView
                            mode="calibration"
                            autoAnalyze
                            onFrameAnalysis={setAnalysis}
                        />
                    )}
                </section>
                <aside className="panel">
                    <h2>本帧结果</h2>
                    <dl>
                        {rows.map((row) => (
                            <div key={row.label} className="metric">
                                <dt>{row.label}</dt>
                                <dd>{row.value}</dd>
                            </div>
                        ))}
                    </dl>
                </aside>
            </main>
        </div>
    );
}
