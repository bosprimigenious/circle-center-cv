import { useMemo, useState } from 'react';
import FaceView from './components/FaceView/FaceView';
import { describeSignal, riskLabel, riskLevel } from './cheat/scoring';
import { regionLabels } from './face/regions';
import type { FaceFrameResult, FaceRegionName } from './face/types';
import './App.css';

const formatPct = (value: number | undefined | null) => (
    typeof value === 'number' && Number.isFinite(value) ? `${Math.round(value * 100)}%` : '—'
);

const formatNum = (value: number | undefined | null, digits = 3) => (
    typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : '—'
);

const ratioClass = (value: number | null | undefined, danger: number, warn?: number) => {
    if (typeof value !== 'number') return '';
    if (value >= danger) return 'is-danger';
    if (warn != null && value >= warn) return 'is-warn';
    return 'is-ok';
};

const regionOrder: FaceRegionName[] = [
    'mesh', 'oval', 'lips', 'leftBrow', 'rightBrow', 'leftEye', 'rightEye', 'leftIris', 'rightIris',
];

export default function App() {
    const [faceResult, setFaceResult] = useState<FaceFrameResult | null>(null);
    const cheat = faceResult?.cheat ?? null;

    const cheatRows = useMemo(() => {
        if (!cheat) return [];
        const video = cheat.video;
        const live = cheat.live;
        const gaze = video.gaze;
        return [
            { label: '遮挡率', value: formatPct(video.covered_ratio), className: ratioClass(video.covered_ratio, 0.5, 0.3) },
            { label: '静止率', value: formatPct(video.static_ratio), className: ratioClass(video.static_ratio, 0.99, 0.5) },
            { label: '无人脸率', value: formatPct(gaze.no_face_ratio), className: ratioClass(gaze.no_face_ratio, 0.5) },
            { label: '低头率', value: formatPct(video.down_ratio), className: ratioClass(video.down_ratio, 0.3, 0.15) },
            { label: '转头率', value: formatPct(video.head_turn_ratio), className: ratioClass(video.head_turn_ratio, 0.3) },
            { label: '视线偏离', value: formatPct(video.away_ratio), className: ratioClass(video.away_ratio, 0.3) },
            { label: '采样', value: `${video.sample_count} · ${gaze.status}` },
            { label: '视线引擎', value: video.gaze_engine },
            { label: '本帧低头', value: live.headDown ? '是' : '否', className: live.headDown ? 'is-warn' : '' },
            { label: '本帧转头', value: live.headTurn ? '是' : '否', className: live.headTurn ? 'is-warn' : '' },
            { label: '本帧侧视', value: live.gazeAway ? (live.gazeDirection ?? '是') : '否', className: live.gazeAway ? 'is-warn' : '' },
            { label: '眼神看哪', value: live.gazeLook, className: live.gazeLook !== '看镜头' ? 'is-warn' : '' },
            { label: '肩膀', value: live.shoulderVisible ? `有 · drop ${formatNum(live.shoulderDrop)} / yaw ${formatNum(live.shoulderYaw)}` : '未检出（近景可回退脸部 pitch）' },
            { label: 'pitch / yaw', value: `${formatNum(live.pitch)} / ${formatNum(live.yaw)}` },
            { label: '虹膜 gazeX / Y', value: `${formatNum(live.gazeX)} / ${formatNum(live.gazeY)}` },
            { label: '头矩阵 yaw / pitch°', value: faceResult?.gaze?.head
                ? `${formatNum(faceResult.gaze.head.yaw * 180 / Math.PI, 1)} / ${formatNum(faceResult.gaze.head.pitch * 180 / Math.PI, 1)}`
                : '—' },
            { label: 'L2CS yaw / pitch°', value: `${formatNum(live.l2csYaw != null ? live.l2csYaw * 180 / Math.PI : null, 1)} / ${formatNum(live.l2csPitch != null ? live.l2csPitch * 180 / Math.PI : null, 1)}` },
            { label: '融合 yaw / pitch°', value: `${formatNum(live.fusedYaw != null ? live.fusedYaw * 180 / Math.PI : null, 1)} / ${formatNum(live.fusedPitch != null ? live.fusedPitch * 180 / Math.PI : null, 1)}` },
            { label: '虹膜半径 左/右', value: `${formatNum(live.irisLeftR, 4)} / ${formatNum(live.irisRightR, 4)}` },
            { label: '嘴部 MAR', value: formatNum(live.mar) },
            { label: '眼 EAR', value: formatNum(live.ear) },
            { label: '张嘴', value: live.mouthOpen ? `是 · jawOpen ${formatNum(live.jawOpen, 2)}` : `否 · ${formatNum(live.jawOpen, 2)}` },
        ];
    }, [cheat, faceResult]);

    const look = faceResult?.look ?? null;
    const lookRows = useMemo(() => {
        if (!look) return [];
        const dir = look.direction === 'left' ? '左' : look.direction === 'right' ? '右' : '—';
        return [
            { label: '状态', value: look.label, className: look.level === 'danger' ? 'is-danger' : look.level === 'warn' ? 'is-warn' : 'is-ok' },
            { label: '原因', value: look.reasons.length ? look.reasons.join(' / ') : '无' },
            { label: '疑似第二屏', value: look.secondScreen ? `是 · ${dir}` : '否', className: look.secondScreen ? 'is-danger' : '' },
            { label: '侧向驻留', value: `${formatNum(look.asideSec, 1)}s`, className: look.asideSec >= 2 ? 'is-danger' : look.asideSec >= 0.8 ? 'is-warn' : '' },
            { label: '转头但仍看镜头', value: look.headTurnButCamera ? '是' : '否' },
            { label: '转头持续', value: `${formatNum(look.headTurnSec, 1)}s`, className: look.headTurnSec >= 1 ? 'is-warn' : '' },
            { label: '低头看稿', value: look.notes ? '是' : '否', className: look.notes ? 'is-warn' : '' },
        ];
    }, [look]);

    const fatigue = faceResult?.fatigue ?? null;
    const fatigueRows = useMemo(() => {
        if (!fatigue) return [];
        return [
            { label: '状态', value: fatigue.label, className: fatigue.level === 'danger' ? 'is-danger' : fatigue.level === 'warn' ? 'is-warn' : 'is-ok' },
            { label: '原因', value: fatigue.reasons.length ? fatigue.reasons.join(' / ') : '无' },
            { label: '视线模糊', value: fatigue.gazeBlurry ? '是' : '否', className: fatigue.gazeBlurry ? 'is-warn' : '' },
            { label: '闭眼', value: fatigue.eyesClosed ? `是 · ${formatNum(fatigue.closedSec, 1)}s` : '否', className: fatigue.eyesClosed ? 'is-warn' : '' },
            { label: 'PERCLOS', value: formatPct(fatigue.perclos), className: ratioClass(fatigue.perclos, 0.2, 0.12) },
            { label: 'EAR / 阈', value: `${formatNum(fatigue.ear)} / ${formatNum(fatigue.earThreshold)}` },
            { label: '打哈欠', value: fatigue.yawn ? '是' : '否', className: fatigue.yawn ? 'is-warn' : '' },
            { label: '眨眼/分', value: formatNum(fatigue.blinkPerMin, 1) },
        ];
    }, [fatigue]);

    const rows = useMemo(() => {
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

    const scored = cheat?.scored;
    const level = scored ? riskLevel(scored.confidence) : '';
    const signals = cheat?.videoSignals ?? [];

    return (
        <div className="app-shell">
            <header className="app-header">
                <div>
                    <p className="app-kicker">检测 · 478 点 · 肩膀 · 融合视线 · 第二屏 · 疲劳</p>
                    <h1>人脸 478 + Pose 肩 + 几何×L2CS 融合</h1>
                </div>
                <p className="app-note">
                    同一帧并行三个模型：Face Landmarker 478（含 4×4 头部位姿矩阵）、Pose Landmarker lite（肩点 11/12）、MobileGaze L2CS。视线 = 头矩阵 + 虹膜眼内转（每帧几何）与 L2CS 外观加权，再 EMA。转头看肩/头 yaw；盯第二屏看融合视线是否在同一侧停住 ≥2s（低头看稿不算）。疲劳走几何：低头 + EAR/PERCLOS。不含文本 LLM1、声纹、人脸 1:1、ASR。文件不上传。
                </p>
            </header>
            <main className="app-main">
                <section className="stage">
                    <FaceView onFrameResult={setFaceResult} />
                </section>
                <aside className="panel">
                    <h2>视觉反作弊</h2>
                    {scored ? (
                        <>
                            <div className={`verdict is-${level}`}>
                                <strong>{riskLabel(scored.is_cheating, scored.confidence)}</strong>
                                <span>{scored.confidence} 分 · {scored.is_cheating}</span>
                            </div>
                            <p className="signal-line">
                                {signals.length
                                    ? signals.map((id) => `${id} ${describeSignal(id).text}`).join('；')
                                    : '无 B3 信号'}
                            </p>
                            <dl>
                                {cheatRows.map((row) => (
                                    <div key={row.label} className="metric">
                                        <dt>{row.label}</dt>
                                        <dd className={row.className}>{row.value}</dd>
                                    </div>
                                ))}
                            </dl>
                        </>
                    ) : (
                        <p className="panel-empty">等待画面后按约 2 秒采样一次。</p>
                    )}
                    <h2>转头 / 第二屏</h2>
                    {look ? (
                        <dl>
                            {lookRows.map((row) => (
                                <div key={row.label} className="metric">
                                    <dt>{row.label}</dt>
                                    <dd className={row.className}>{row.value}</dd>
                                </div>
                            ))}
                        </dl>
                    ) : (
                        <p className="panel-empty">等待画面后按帧累计侧视驻留。摄像头看不见第二块屏，只能从视线停在同一侧推断。</p>
                    )}
                    <h2>疲劳检测</h2>
                    {fatigue ? (
                        <dl>
                            {fatigueRows.map((row) => (
                                <div key={row.label} className="metric">
                                    <dt>{row.label}</dt>
                                    <dd className={row.className}>{row.value}</dd>
                                </div>
                            ))}
                        </dl>
                    ) : (
                        <p className="panel-empty">等待画面后按帧累计 EAR / PERCLOS。</p>
                    )}
                    <h2>本帧网格</h2>
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
