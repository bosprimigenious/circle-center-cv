# 人脸网格 478 点 + MobileGaze 视线

浏览器里同一帧并行三个模型：

1. **MediaPipe Face Landmarker 478**（468 网格 + 10 虹膜）。不改拓扑、不换权重。
2. **MediaPipe Pose Landmarker lite**（33 点）。用肩点 11/12 作低头 / 转头参照；近景看不见肩时回退脸部 pitch/yaw。
3. **MobileGaze MobileOne-S0**（L2CS-Net 系，Gaze360 预训练 ONNX，约 4.8MB）。吃 478 框出的人脸 crop，输出视线 yaw / pitch。

虹膜走眼眶 crop：用眼轮廓当眶，拟合虹膜圆心和半径，从左右瞳孔画出射线（眼神往哪走）。

疲劳检测不另加模型，用已有 478 几何：低头（肩线）、EAR 闭眼、PERCLOS（滚动窗口闭眼占比）、眼裂变窄 → 视线模糊（虹膜被眼皮挡住，射线不画）。口径对齐 Soukupová EAR、[e-candeloro/Driver-State-Detection](https://github.com/e-candeloro/Driver-State-Detection)（MIT）的 PERCLOS、以及浏览器连续闭眼计时。

在线演示：https://bosprimigenious.github.io/circle-center-cv/

摄像头需要 HTTPS；Pages 本身是 HTTPS。本地 MP4 在浏览器里逐帧跑，文件不上传。建议 H.264。

视觉反作弊通道（遮挡 / 静止 / 无人脸 / 低头 / 转头 / 虹膜+L2CS 视线 / 嘴部 MAR）按 P2 脚本阈值计 B3-*。疲劳是单独一栏，不计入 B3。不含文本 LLM1、声纹、人脸 1:1、ASR。

## 仓库

- 代码：https://github.com/bosprimigenious/circle-center-cv
- 许可：MIT
- 部署：push `main` 后 `.github/workflows/pages.yml` 发 GitHub Pages

圆环 / 圆心定位已从本仓库删除，那套 classical CV 仍在 [interferometer-cv](https://github.com/bosprimigenious/interferometer-cv)。

## 模型

`face_landmarker.task`（float16，约 3.6MB，Google，Apache-2.0）里三条网：

| 子模型 | 输入 | 作用 |
|---|---|---|
| BlazeFace short-range | 192×192 | 脸上有没有、粗框 |
| FaceMesh-V2 | 256×256 crop | 478 点 |
| Blendshape | 1×146×2 | 52 维表情系数 |

第二模型 `pose_landmarker_lite.task`（BlazePose GHUM，约 5.5MB，Google）。第三模型 `mobileone_s0_gaze.onnx`（约 4.8MB，[yakhyo/gaze-estimation](https://github.com/yakhyo/gaze-estimation) MIT，L2CS-Net / Gaze360）。浏览器里用 onnxruntime-web WASM 推理；GitHub Pages 无 COOP，强制单线程。Pose / L2CS 加载失败时 478 仍可用。

权重和 WASM 在 `npm install` / CI `postinstall` 下载拷贝，不进 git。没有云端推理。

为 Windows 核显：摄像头 ideal 640×480、检测约 15 fps、叠加画 478 点阵（fillRect）和五官轮廓，不画 ~2600 条三角网格连线、`numFaces=1`、DPR 上限 1.25。Chrome 请打开硬件加速。

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
npm run verify:face
npm run build
```
