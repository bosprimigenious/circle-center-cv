# 圆心定位 + 圆环识别 + 人脸网格

从 [interferometer-cv](https://github.com/bosprimigenious/interferometer-cv) 抽出的浏览器 CV 演示：

- **圆环**：圆心定位 + 同心圆环识别（classical CV）
- **人脸网格**：MediaPipe Face Landmarker，**478** 个 3D 点（468 网格 + 10 虹膜），不是 6 点 Face Detector

在线演示（GitHub Pages）：https://bosprimigenious.github.io/circle-center-cv/

摄像头需要 HTTPS；Pages 站点本身是 HTTPS。浏览器会问摄像头权限。

## 开源仓库

- 代码：https://github.com/bosprimigenious/circle-center-cv
- 许可：MIT
- 部署：push `main` 后 `.github/workflows/pages.yml` 构建并发布 Pages

不含：倾角 CNN、3D 调仪、多智能体、波长拟合、作业后台。

## 人脸网格（不是 6 点检测）

`Face Detector` 只有框 + 6 个点，覆盖不够。本仓库接的是 **MediaPipe Face Landmarker**：

- **478** 个 3D 关键点（468 网格 + 10 虹膜）
- 分区：脸轮廓、眉、眼、唇、虹膜
- 可选 52 个 blendshape

页面顶部切到「人脸网格」。摄像头或上传人脸图。权重 `public/models/face_landmarker.task` 和 WASM `public/mediapipe/wasm` 在 `npm install` 时下载/拷贝，不进 git。

## 圆环算法

| 模块 | 路径 | 做什么 |
|---|---|---|
| 圆心定位 | `src/components/CameraView/analysis/centerEstimation.ts` | 高通能量质心、径向振荡打分、同心圆法向投票、几何中心、最小二乘径向拟合 |
| 圆环识别 | `src/components/CameraView/analysis/ringDetection.ts` | 红通道采样 → 圆心 → 径向剖面峰谷 → 亮/暗环交替序列 |
| 圆度 | `src/components/CameraView/analysis/ringAnalysis.ts` | 一阶亮环亮度、圆周相干性 |
| 叠加 | `src/components/CameraView/analysis/overlay.ts` | 圆心十字 + 亮/暗环 |
| 时序 | `src/components/CameraView/analysis/stabilizer.ts` + `kalmanFilter.ts` | 圆心 Kalman + 环半径 EMA |

## 本地运行

```bash
git clone https://github.com/bosprimigenious/circle-center-cv.git
cd circle-center-cv
npm install
npm run dev
```

打开 http://localhost:5173/

## 验证

```bash
npm run verify:center   # 亮斑不得抢走圆环圆心；半圆弧圆心可在画外
npm run verify:face     # 478 点拓扑：网格 + 虹膜 + 五官分区
npm run build           # tsc + vite
```
