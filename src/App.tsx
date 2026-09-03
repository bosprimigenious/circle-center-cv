import { useMemo, useState } from 'react';
import FaceView from './components/FaceView/FaceView';
import { describeSignal, riskLabel, riskLevel, THRESHOLDS } from './cheat/scoring';
import { FATIGUE_THRESHOLDS } from './fatigue/session';
import { IRIS_PITCH_GAIN, IRIS_YAW_GAIN } from './gaze/fuse';
import { regionLabels } from './face/regions';
import type { FaceFrameResult, FaceRegionName } from './face/types';
import './App.css';

const formatPct = (value: number | undefined | null) => (
    typeof value === 'number' && Number.isFinite(value) ? `${Math.round(value * 100)}%` : '—'
);

const formatNum = (value: number | undefined | null, digits = 3) => (
    typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : '—'
);

const formatDeg = (value: number | undefined | null, digits = 1) => (
    typeof value === 'number' && Number.isFinite(value) ? `${(value * 180 / Math.PI).toFixed(digits)}°` : '—'
);

const formatBit = (value: boolean | null | undefined) => (
    value == null ? '—' : value ? '1' : '0'
);

const formatMs = (value: number | undefined | null) => (
    typeof value === 'number' && Number.isFinite(value) ? `${Math.round(value)}ms` : '—'
);

const formatPair = (
    a: number | null | undefined,
    b: number | null | undefined,
    digits = 3,
) => `${formatNum(a, digits)} / ${formatNum(b, digits)}`;

const formatVs = (delta: number | null | undefined, thresh: number, digits = 3) => {
    if (typeof delta !== 'number' || !Number.isFinite(delta)) return `— / 阈 ${formatNum(thresh, digits)}`;
    const ratio = thresh === 0 ? null : delta / thresh;
    return `${formatNum(delta, digits)} / 阈 ${formatNum(thresh, digits)} · ${formatNum(ratio, 2)}×`;
};

const spanSec = (segments: Array<{ start: number; end: number }> | undefined) => {
    if (!segments?.length) return 0;
    return segments.reduce((sum, item) => sum + Math.max(0, item.end - item.start), 0);
};

const orbitAspectOf = (box: { width: number; height: number } | null | undefined) => (
    box && box.width > 1e-6 ? box.height / box.width : null
);

const radiusRatioOf = (
    radius: number | null | undefined,
    box: { width: number } | null | undefined,
) => (
    typeof radius === 'number' && box && box.width > 1e-6 ? radius / box.width : null
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

    const cheatGroups = useMemo(() => {
        if (!cheat) return [];
        const video = cheat.video;
        const live = cheat.live;
        const tallies = video.gaze;
        const n = video.sample_count;
        const quality = faceResult?.quality ?? null;
        const gaze = faceResult?.gaze ?? null;
        const shoulders = faceResult?.pose?.shoulders ?? null;
        const hands = faceResult?.hands ?? null;
        const lookLive = faceResult?.look ?? null;
        const speechLive = faceResult?.speech ?? null;
        const avLive = faceResult?.avsync ?? null;
        const fatLive = faceResult?.fatigue ?? null;
        const l2csAge = gaze?.l2csAgeMs != null && Number.isFinite(gaze.l2csAgeMs) ? gaze.l2csAgeMs : null;
        const ray = gaze?.irisRay ?? null;
        return [
            {
                title: 'P2 会话',
                rows: [
                    { label: '遮挡率', value: formatPct(video.covered_ratio), className: ratioClass(video.covered_ratio, 0.5, 0.3) },
                    { label: '静止率', value: formatPct(video.static_ratio), className: ratioClass(video.static_ratio, 0.99, 0.5) },
                    { label: '无人脸率', value: `${formatPct(tallies.no_face_ratio)} · ${tallies.no_face_count}/${n}`, className: ratioClass(tallies.no_face_ratio, 0.5) },
                    { label: '低头率', value: `${formatPct(video.down_ratio)} · ${tallies.down_count}/${n}`, className: ratioClass(video.down_ratio, 0.3, 0.15) },
                    { label: '转头率', value: `${formatPct(video.head_turn_ratio)} · ${tallies.head_turn_count}/${n}`, className: ratioClass(video.head_turn_ratio, 0.3) },
                    { label: '视线偏离', value: `${formatPct(video.away_ratio)} · ${tallies.away_count}/${n}`, className: ratioClass(video.away_ratio, 0.3) },
                    { label: '采样', value: `${n} · ${formatNum(video.duration, 1)}s · ${tallies.status}` },
                    { label: '视线引擎', value: video.gaze_engine },
                ],
            },
            {
                title: '脸完整 / 遮挡',
                rows: [
                    { label: '人脸完整', value: `${live.faceQualityLabel || '—'} · 出框点 ${formatPct(quality?.outFrac ?? null)}`, className: live.faceClipped || live.handOverFace ? 'is-warn' : '' },
                    { label: '出框 上/下/左/右', value: `${formatBit(quality?.clipTop)} / ${formatBit(quality?.clipBottom)} / ${formatBit(quality?.clipLeft)} / ${formatBit(quality?.clipRight)}` },
                    { label: '手挡脸', value: formatBit(live.handOverFace), className: live.handOverFace ? 'is-danger' : '' },
                    { label: '可信 pitch/yaw', value: `${formatBit(live.pitchTrusted)} / ${formatBit(live.yawTrusted)}` },
                    { label: '虹膜可信', value: formatBit(live.irisTrusted), className: live.irisTrusted ? '' : 'is-warn' },
                    { label: 'L2CS 可信', value: formatBit(quality?.l2csTrusted ?? null) },
                ],
            },
            {
                title: '肩',
                rows: [
                    { label: '肩可见', value: formatBit(live.shoulderVisible) },
                    { label: '肩 vis L/R', value: formatPair(shoulders?.left?.visibility, shoulders?.right?.visibility, 2) },
                    { label: '肩宽', value: formatNum(shoulders?.width) },
                    { label: '肩中点 x/y', value: formatPair(shoulders?.mid?.x, shoulders?.mid?.y) },
                    { label: '肩 L x/y', value: formatPair(shoulders?.left?.x, shoulders?.left?.y) },
                    { label: '肩 R x/y', value: formatPair(shoulders?.right?.x, shoulders?.right?.y) },
                    { label: '肩 drop / yaw', value: formatPair(live.shoulderDrop, live.shoulderYaw) },
                    { label: '肩 roll', value: formatNum(shoulders?.roll) },
                    { label: '肩 drop 基线', value: formatNum(live.shoulderDropBase) },
                    { label: '肩 yaw 基线', value: formatNum(live.shoulderYawBase) },
                    { label: 'Δdrop', value: formatVs(live.shoulderDropDelta, THRESHOLDS.SHOULDER_DROP_DELTA), className: (live.shoulderDropDelta ?? 0) > THRESHOLDS.SHOULDER_DROP_DELTA ? 'is-warn' : '' },
                    { label: 'Δ肩 yaw', value: formatVs(live.shoulderYawDelta != null ? Math.abs(live.shoulderYawDelta) : null, THRESHOLDS.SHOULDER_YAW_DELTA), className: Math.abs(live.shoulderYawDelta ?? 0) > THRESHOLDS.SHOULDER_YAW_DELTA ? 'is-warn' : '' },
                    { label: '肘 vis L/R', value: formatPair(shoulders?.leftElbow?.visibility, shoulders?.rightElbow?.visibility, 2) },
                    { label: '腕 vis L/R', value: formatPair(shoulders?.leftWrist?.visibility, shoulders?.rightWrist?.visibility, 2) },
                    { label: '髋 vis L/R', value: formatPair(shoulders?.leftHip?.visibility, shoulders?.rightHip?.visibility, 2) },
                    { label: '髋宽', value: formatNum(shoulders?.hipWidth) },
                    { label: '躯干 drop', value: formatNum(shoulders?.torsoDrop) },
                    { label: '躯干 roll', value: formatNum(shoulders?.torsoRoll) },
                    { label: '抬手 L/R', value: formatPair(shoulders?.leftRaise, shoulders?.rightRaise), className: (shoulders?.leftRaise ?? 0) > 0.05 || (shoulders?.rightRaise ?? 0) > 0.05 ? 'is-warn' : '' },
                    { label: 'Pose 指尖', value: String(shoulders?.poseFingers ?? 0) },
                ],
            },
            {
                title: '手',
                rows: [
                    { label: '手数', value: String(hands?.hands.length ?? 0) },
                    { label: '左右', value: hands?.hands.length
                        ? hands.hands.map((hand) => `${hand.handedness === 'Left' ? '左' : hand.handedness === 'Right' ? '右' : hand.handedness} ${hand.landmarks.length}`).join(' · ')
                        : '0' },
                    { label: '掌心 1 x/y', value: hands?.hands[0] ? formatPair(hands.hands[0].palm.x, hands.hands[0].palm.y) : '—' },
                    { label: '掌心 2 x/y', value: hands?.hands[1] ? formatPair(hands.hands[1].palm.x, hands.hands[1].palm.y) : '—' },
                    { label: '手挡脸', value: formatBit(live.handOverFace), className: live.handOverFace ? 'is-danger' : '' },
                    { label: '引擎', value: hands?.engine ?? '—' },
                ],
            },
            {
                title: '虹膜',
                rows: [
                    { label: '虹膜可信', value: formatBit(live.irisTrusted), className: live.irisTrusted ? '' : 'is-warn' },
                    { label: '虹膜 gazeX / Y', value: formatPair(live.gazeX, live.gazeY) },
                    { label: '虹膜 yaw / pitch°', value: live.gazeX == null && live.gazeY == null
                        ? '—'
                        : `${formatDeg(live.gazeX != null ? -live.gazeX * IRIS_YAW_GAIN : null)} / ${formatDeg(live.gazeY != null ? -live.gazeY * IRIS_PITCH_GAIN : null)}` },
                    { label: '左 gazeX / Y', value: formatPair(gaze?.leftGazeX, gaze?.leftGazeY) },
                    { label: '右 gazeX / Y', value: formatPair(gaze?.rightGazeX, gaze?.rightGazeY) },
                    { label: '虹膜半径 左/右', value: formatPair(live.irisLeftR, live.irisRightR, 4) },
                    { label: '眼眶宽 左/右', value: formatPair(gaze?.leftOrbit?.width, gaze?.rightOrbit?.width, 4) },
                    { label: '眼眶高 左/右', value: formatPair(gaze?.leftOrbit?.height, gaze?.rightOrbit?.height, 4) },
                    { label: '眼裂 左/右', value: formatPair(orbitAspectOf(gaze?.leftOrbit), orbitAspectOf(gaze?.rightOrbit)) },
                    { label: '半径/眶宽 左/右', value: formatPair(
                        radiusRatioOf(live.irisLeftR, gaze?.leftOrbit),
                        radiusRatioOf(live.irisRightR, gaze?.rightOrbit),
                    ) },
                    { label: '虹膜射线 dx / dy', value: ray ? formatPair(ray.dx, ray.dy) : '—' },
                    { label: '左射线 dx / dy', value: gaze?.leftRay ? formatPair(gaze.leftRay.dx, gaze.leftRay.dy) : '—' },
                    { label: '右射线 dx / dy', value: gaze?.rightRay ? formatPair(gaze.rightRay.dx, gaze.rightRay.dy) : '—' },
                    { label: 'L2CS yaw / pitch°', value: `${formatDeg(live.l2csYaw)} / ${formatDeg(live.l2csPitch)}` },
                    { label: 'L2CS 龄', value: formatMs(l2csAge) },
                    { label: '几何 yaw / pitch°', value: gaze?.geometric
                        ? `${formatDeg(gaze.geometric.yaw)} / ${formatDeg(gaze.geometric.pitch)}`
                        : '—' },
                    { label: '融合 yaw / pitch°', value: `${formatDeg(live.fusedYaw)} / ${formatDeg(live.fusedPitch)}` },
                    { label: '融合外观权重', value: formatNum(gaze?.appearanceWeight, 2) },
                ],
            },
            {
                title: '低头',
                rows: [
                    { label: '低头率', value: `${formatPct(video.down_ratio)} · ${tallies.down_count}/${n}`, className: ratioClass(video.down_ratio, 0.3, 0.15) },
                    { label: '低头累计 s', value: formatNum(spanSec(video.evidence_segments.head_down), 1) },
                    { label: '本帧低头', value: formatBit(live.headDown), className: live.headDown ? 'is-warn' : '' },
                    { label: '低头来源', value: live.headSource ?? '—' },
                    { label: '2D pitch', value: `${formatNum(live.pitch)} · 基线 ${formatNum(live.pitchBase)}` },
                    { label: 'Δpitch', value: formatVs(live.pitchDelta, THRESHOLDS.PITCH_DOWN_DELTA), className: (live.pitchDelta ?? 0) > THRESHOLDS.PITCH_DOWN_DELTA ? 'is-warn' : '' },
                    { label: 'Δdrop', value: formatVs(live.shoulderDropDelta, THRESHOLDS.SHOULDER_DROP_DELTA), className: (live.shoulderDropDelta ?? 0) > THRESHOLDS.SHOULDER_DROP_DELTA ? 'is-warn' : '' },
                    { label: '矩阵 pitch°', value: formatDeg(gaze?.head?.pitch) },
                    { label: '融合 pitch°', value: formatDeg(live.fusedPitch) },
                    { label: 'pitch 可信', value: formatBit(live.pitchTrusted) },
                ],
            },
            {
                title: '转头',
                rows: [
                    { label: '转头率', value: `${formatPct(video.head_turn_ratio)} · ${tallies.head_turn_count}/${n}`, className: ratioClass(video.head_turn_ratio, 0.3) },
                    { label: '转头持续 s', value: formatNum(lookLive?.headTurnSec, 2), className: (lookLive?.headTurnSec ?? 0) >= 1 ? 'is-warn' : '' },
                    { label: '本帧转头', value: formatBit(live.headTurn), className: live.headTurn ? 'is-warn' : '' },
                    { label: '转头来源', value: live.headSource ?? '—' },
                    { label: 'VOR 看镜头', value: formatBit(lookLive?.headTurnButCamera ?? null) },
                    { label: '2D yaw', value: `${formatNum(live.yaw)} · 基线 ${formatNum(live.yawBase)}` },
                    { label: 'Δyaw', value: formatVs(live.yawDelta != null ? Math.abs(live.yawDelta) : null, THRESHOLDS.YAW_TURN_DELTA), className: Math.abs(live.yawDelta ?? 0) > THRESHOLDS.YAW_TURN_DELTA ? 'is-warn' : '' },
                    { label: 'Δ肩 yaw', value: formatVs(live.shoulderYawDelta != null ? Math.abs(live.shoulderYawDelta) : null, THRESHOLDS.SHOULDER_YAW_DELTA), className: Math.abs(live.shoulderYawDelta ?? 0) > THRESHOLDS.SHOULDER_YAW_DELTA ? 'is-warn' : '' },
                    { label: '矩阵 yaw°', value: formatDeg(gaze?.head?.yaw) },
                    { label: '融合 yaw°', value: formatDeg(live.fusedYaw) },
                    { label: 'yaw 可信', value: formatBit(live.yawTrusted) },
                    { label: '本帧侧视', value: live.gazeAway ? `1 · ${live.gazeDirection ?? ''}` : '0', className: live.gazeAway ? 'is-warn' : '' },
                    { label: '侧向驻留 s', value: formatNum(lookLive?.asideSec, 2), className: (lookLive?.asideSec ?? 0) >= 2 ? 'is-danger' : (lookLive?.asideSec ?? 0) >= 0.8 ? 'is-warn' : '' },
                    { label: '眼神看哪', value: live.gazeLook, className: live.gazeLook !== '看镜头' ? 'is-warn' : '' },
                ],
            },
            {
                title: '眼部',
                rows: [
                    { label: 'EAR L/R', value: formatPair(fatLive?.earLeft, fatLive?.earRight) },
                    { label: 'EAR / 阈', value: formatPair(fatLive?.ear ?? live.ear, fatLive?.earThreshold) },
                    { label: 'EAR 睁眼基线', value: formatNum(fatLive?.earOpen) },
                    { label: 'ΔEAR', value: formatVs(
                        fatLive?.earDrop,
                        (fatLive?.earOpen ?? 0) * (1 - FATIGUE_THRESHOLDS.SQUINT_EAR_RATIO) || 0.08,
                    ), className: fatLive?.squintNotes ? 'is-warn' : '' },
                    { label: '左右差', value: formatVs(fatLive?.earAsym, FATIGUE_THRESHOLDS.EAR_ASYM), className: fatLive?.earAsymFlag ? 'is-warn' : '' },
                    { label: '眼裂 min', value: formatNum(fatLive?.orbitAspect) },
                    { label: '眼裂阈', value: formatNum(FATIGUE_THRESHOLDS.ORBIT_SLIT) },
                    { label: '眨眼系数', value: formatNum(fatLive?.eyeBlink, 2) },
                    { label: '虹膜半径 / 基线', value: formatPair(fatLive?.irisRadius, fatLive?.irisBaseline, 4) },
                    { label: '眯眼看稿', value: `${formatBit(fatLive?.squintNotes ?? null)} · ${formatNum(fatLive?.squintSec, 2)}s`, className: fatLive?.squintNotes ? 'is-warn' : '' },
                    { label: '闭眼离镜', value: `${formatBit(fatLive?.eyesOffCam ?? null)} · ${formatNum(fatLive?.closedSec, 2)}s`, className: fatLive?.eyesOffCam ? 'is-danger' : fatLive?.eyesClosed ? 'is-warn' : '' },
                    { label: '虹膜被挡', value: formatBit(fatLive?.irisOccluded ?? null), className: fatLive?.irisOccluded ? 'is-warn' : '' },
                    { label: '闭眼占比', value: formatPct(fatLive?.perclos ?? null), className: ratioClass(fatLive?.perclos, FATIGUE_THRESHOLDS.PERCLOS_OFFCAM, FATIGUE_THRESHOLDS.PERCLOS_WARN) },
                    { label: '眨眼/分 · n', value: `${formatNum(fatLive?.blinkPerMin, 1)} · ${fatLive?.blinkCount ?? 0}`, className: fatLive?.blinkSparse || fatLive?.blinkBurst ? 'is-warn' : '' },
                    { label: '眨眼过稀', value: formatBit(fatLive?.blinkSparse ?? null), className: fatLive?.blinkSparse ? 'is-warn' : '' },
                    { label: '眨眼过密', value: formatBit(fatLive?.blinkBurst ?? null), className: fatLive?.blinkBurst ? 'is-warn' : '' },
                    { label: '凝视无眨眼', value: `${formatBit(fatLive?.stare ?? null)} · ${formatNum(fatLive?.stareSec, 2)}s`, className: fatLive?.stare ? 'is-warn' : '' },
                    { label: 'IBI', value: formatNum(fatLive?.ibiSec, 2) },
                    { label: '射线不可用', value: formatBit(fatLive?.gazeBlurry ?? null) },
                ],
            },
            {
                title: '头矩阵 / 口型 / 音画',
                rows: [
                    { label: '2D pitch / yaw', value: formatPair(live.pitch, live.yaw) },
                    { label: '头矩阵 yaw / pitch°', value: gaze?.head
                        ? `${formatDeg(gaze.head.yaw)} / ${formatDeg(gaze.head.pitch)}`
                        : '—' },
                    { label: '头矩阵 roll°', value: formatDeg(gaze?.head?.roll) },
                    { label: '第二屏', value: formatBit(lookLive?.secondScreen ?? null), className: lookLive?.secondScreen ? 'is-danger' : '' },
                    { label: '嘴部 MAR', value: formatNum(live.mar) },
                    { label: '张嘴', value: `${formatBit(live.mouthOpen)} · jawOpen ${formatNum(live.jawOpen, 2)}` },
                    { label: '说话次数', value: speechLive ? String(speechLive.count + (speechLive.speaking ? 1 : 0)) : '—' },
                    { label: '累计说话 s', value: formatNum(speechLive?.totalSpeakSec, 2) },
                    { label: '音画偏移', value: avLive?.lagSec == null ? '—' : `${Math.round(avLive.lagSec * 1000)}ms` },
                    { label: '口型∩声音', value: formatPct(avLive?.overlap ?? null) },
                    { label: 'RMS', value: formatPair(avLive?.rms, avLive?.rmsBaseline, 4) },
                ],
            },
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

    const speech = faceResult?.speech ?? null;
    const speechRows = useMemo(() => {
        if (!speech) return [];
        const recent = speech.utterances.slice(-6)
            .map((item) => `${item.index}# ${item.duration.toFixed(1)}s@${item.start.toFixed(1)}`)
            .join(' · ') || '无';
        return [
            { label: '状态', value: speech.label, className: speech.speaking ? 'is-ok' : '' },
            { label: '开始说话', value: speech.onset ? '本帧起音' : (speech.speaking ? '已在说' : '否'), className: speech.onset ? 'is-warn' : '' },
            { label: '说话次数', value: String(speech.count + (speech.speaking ? 1 : 0)) },
            { label: '本段时长', value: `${formatNum(speech.utterSec, 1)}s` },
            { label: '累计说话', value: `${formatNum(speech.totalSpeakSec, 1)}s` },
            { label: '最近几段', value: recent },
            { label: 'MAR / 基线', value: `${formatNum(speech.mar)} / ${formatNum(speech.marBaseline)}` },
            { label: '哈欠抑制', value: speech.yawnHold ? '是' : '否', className: speech.yawnHold ? 'is-warn' : '' },
        ];
    }, [speech]);

    const avsync = faceResult?.avsync ?? null;
    const avsyncRows = useMemo(() => {
        if (!avsync) return [];
        const lagMs = avsync.lagSec != null ? Math.round(avsync.lagSec * 1000) : null;
        return [
            { label: '状态', value: avsync.label, className: avsync.level === 'danger' ? 'is-danger' : avsync.level === 'warn' ? 'is-warn' : 'is-ok' },
            { label: '原因', value: avsync.reasons.length ? avsync.reasons.join(' / ') : '无' },
            { label: '音频说话', value: avsync.audioSpeaking ? '是' : '否', className: avsync.audioSpeaking ? 'is-ok' : '' },
            { label: '音频次数', value: String(avsync.audioCount) },
            { label: '口型说话', value: avsync.visualSpeaking ? '是' : '否' },
            { label: '偏移', value: lagMs == null ? '—' : `${lagMs > 0 ? '+' : ''}${lagMs}ms（正=声音晚）` },
            { label: '口型∩声音', value: formatPct(avsync.overlap) },
            { label: 'RMS / 基线', value: `${formatNum(avsync.rms, 4)} / ${formatNum(avsync.rmsBaseline, 4)}` },
        ];
    }, [avsync]);

    const fatigue = faceResult?.fatigue ?? null;
    const fatigueRows = useMemo(() => {
        if (!fatigue) return [];
        const squintDrop = (fatigue.earOpen ?? 0) * (1 - FATIGUE_THRESHOLDS.SQUINT_EAR_RATIO) || 0.08;
        return [
            { label: '状态', value: fatigue.label, className: fatigue.level === 'danger' ? 'is-danger' : fatigue.level === 'warn' ? 'is-warn' : 'is-ok' },
            { label: '原因', value: fatigue.reasons.length ? fatigue.reasons.join(' / ') : '无' },
            { label: 'EAR L/R', value: formatPair(fatigue.earLeft, fatigue.earRight) },
            { label: 'EAR / 阈', value: `${formatNum(fatigue.ear)} / ${formatNum(fatigue.earThreshold)}` },
            { label: 'EAR 睁眼基线', value: formatNum(fatigue.earOpen) },
            { label: 'ΔEAR', value: formatVs(fatigue.earDrop, squintDrop), className: fatigue.squintNotes ? 'is-warn' : '' },
            { label: '左右差', value: formatVs(fatigue.earAsym, FATIGUE_THRESHOLDS.EAR_ASYM), className: fatigue.earAsymFlag ? 'is-warn' : '' },
            { label: '眼裂 / 阈', value: `${formatNum(fatigue.orbitAspect)} / ${formatNum(FATIGUE_THRESHOLDS.ORBIT_SLIT)}` },
            { label: '眨眼系数', value: formatNum(fatigue.eyeBlink, 2) },
            { label: '虹膜半径 / 基线', value: `${formatNum(fatigue.irisRadius, 4)} / ${formatNum(fatigue.irisBaseline, 4)}` },
            { label: '眯眼看稿', value: `${formatBit(fatigue.squintNotes)} · ${formatNum(fatigue.squintSec, 2)}s`, className: fatigue.squintNotes ? 'is-warn' : '' },
            { label: '闭眼离镜', value: `${formatBit(fatigue.eyesOffCam)} · ${formatNum(fatigue.closedSec, 2)}s`, className: fatigue.eyesOffCam ? 'is-danger' : fatigue.eyesClosed ? 'is-warn' : '' },
            { label: '虹膜被挡', value: formatBit(fatigue.irisOccluded), className: fatigue.irisOccluded ? 'is-warn' : '' },
            { label: '闭眼占比', value: formatPct(fatigue.perclos), className: ratioClass(fatigue.perclos, FATIGUE_THRESHOLDS.PERCLOS_OFFCAM, FATIGUE_THRESHOLDS.PERCLOS_WARN) },
            { label: '眨眼/分 · n', value: `${formatNum(fatigue.blinkPerMin, 1)} · ${fatigue.blinkCount}`, className: fatigue.blinkSparse || fatigue.blinkBurst ? 'is-warn' : '' },
            { label: '眨眼过稀', value: formatBit(fatigue.blinkSparse), className: fatigue.blinkSparse ? 'is-warn' : '' },
            { label: '眨眼过密', value: formatBit(fatigue.blinkBurst), className: fatigue.blinkBurst ? 'is-warn' : '' },
            { label: '凝视无眨眼', value: `${formatBit(fatigue.stare)} · ${formatNum(fatigue.stareSec, 2)}s`, className: fatigue.stare ? 'is-warn' : '' },
            { label: 'IBI', value: formatNum(fatigue.ibiSec, 2) },
            { label: '射线不可用', value: formatBit(fatigue.gazeBlurry) },
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
                    <p className="app-kicker">检测 · 478 点 · Pose33 · 手21 · 融合视线 · 第二屏 · 说话 · 音画 · 眼部</p>
                    <h1>人脸 478 + Pose 肩肘腕 + 手21 + 几何×L2CS 融合</h1>
                </div>
                <p className="app-note">
                    同一帧并行四个模型：Face Landmarker 478（含 4×4 头部位姿矩阵）、Pose Landmarker full（33 点：肩肘腕指髋）、Hand Landmarker（每手 21 点，最多两只）、MobileGaze L2CS。低头 / 转头仍用肩 11/12 的 drop/yaw（B3 口径不变）；肘腕髋只加量化。手挡脸用腕/指尖/掌。视线 = 头矩阵 + 虹膜眼内转与 L2CS 融合。不含文本 LLM1、声纹、人脸 1:1、ASR。文件不上传。
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
                            {cheatGroups.map((group) => (
                                <div key={group.title} className="metric-group">
                                    <h3>{group.title}</h3>
                                    <dl>
                                        {group.rows.map((row) => (
                                            <div key={row.label} className="metric">
                                                <dt>{row.label}</dt>
                                                <dd className={row.className}>{row.value}</dd>
                                            </div>
                                        ))}
                                    </dl>
                                </div>
                            ))}
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
                    <h2>说话 / 口型</h2>
                    {speech ? (
                        <dl>
                            {speechRows.map((row) => (
                                <div key={row.label} className="metric">
                                    <dt>{row.label}</dt>
                                    <dd className={row.className}>{row.value}</dd>
                                </div>
                            ))}
                        </dl>
                    ) : (
                        <p className="panel-empty">等待画面后按帧记 MAR 包络和说话段。</p>
                    )}
                    <h2>音画同步</h2>
                    {avsync ? (
                        <dl>
                            {avsyncRows.map((row) => (
                                <div key={row.label} className="metric">
                                    <dt>{row.label}</dt>
                                    <dd className={row.className}>{row.value}</dd>
                                </div>
                            ))}
                        </dl>
                    ) : (
                        <p className="panel-empty">摄像头会要麦克风；本地 MP4 走音轨。RMS 和口型交叉相关，不做 ASR。</p>
                    )}
                    <h2>眼部读稿</h2>
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
                        <p className="panel-empty">等待画面后按帧累计 EAR / 眨眼间隔 / 闭眼占比。不计入 B3。</p>
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
