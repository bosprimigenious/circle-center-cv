# 人脸网格 478 点 + 几何×L2CS 融合视线

浏览器里同一帧并行三个模型：

1. **MediaPipe Face Landmarker 478**（468 网格 + 10 虹膜）。打开 `outputFacialTransformationMatrixes`，从 4×4 取头 yaw/pitch/roll。不改拓扑、不换权重。
2. **MediaPipe Pose Landmarker lite**（33 点）。用肩点 11/12 作低头 / 转头参照；近景看不见肩时回退脸部 pitch/yaw。
3. **MobileGaze MobileOne-S0**（L2CS-Net 系，Gaze360 预训练 ONNX，约 4.8MB）。吃 478 框出的人脸 crop，输出视线 yaw / pitch。视频模式约 180ms 节流。

视线精度走混合，不加第四个神经网络：

- **几何 3D**：头部位姿 + 虹膜相对眼眶的眼内转角（每帧、无节流）。
- **外观 L2CS**：对人脸 crop 回归 yaw/pitch，补几何在大转头 / 光照上的误差。
- **融合**：L2CS 新鲜时外观权重 0.55；超过 400ms 降到 0.19，几何补帧间。闭眼 / 视线模糊丢掉虹膜项。输出再 EMA（α=0.38）。
- 白粗箭 = 融合；浅绿 = 几何；橙 = L2CS；青 = 虹膜。

调研过、没加进来的：

| 候选 | 为什么不加 |
|---|---|
| yakhyo ResNet-18 ONNX | Gaze360 MAE 12.84°，比 S0 的 12.58° 差，且约 43MB |
| yakhyo ResNet-34 ONNX | MAE 11.33°，约 81.6MB，Pages WASM 不合适 |
| [WebEyeTrack / BlazeGaze](https://github.com/RedHawk-ai/WebEyeTrack) | 屏幕落点（PoG），TF.js，自己再跑一遍 MediaPipe，CDN 写死 |
| GazeML / RT-GENE / ETH-XGaze ResNet | 训练栈或体积不适合本仓库的 WASM Pages |

S0 的 12.58° 是 Gaze360 论文口径，不是本页现场 MAE。融合没有单独的公开测试集数字。

虹膜走眼眶 crop：用眼轮廓当眶，拟合虹膜圆心和半径，从左右瞳孔画出射线。

转头 / 盯第二屏也不另加模型，摄像头看不见旁边那块屏：

- **转头**：Pose 肩线 yaw，近景回退脸 yaw / 头矩阵。头转了但融合视线仍朝镜头 → 「转头但仍看镜头」（补偿性眼动），不是看旁边。
- **盯第二屏**：融合视线相对基线偏向同一侧，并在该侧停住 ≥2s。扫视（短于 0.8s）不叫。低头（肩线或 pitch）算看稿/手机，不算第二屏。眨眼空隙 ≤0.5s 不拆段。
- 监考文献里也是这条：头姿 + 视线 + **时间滤波**，不是再训一个「第二屏分类器」。ProctorGuard 一类系统把「头正眼斜」用 L2CS 补上，软异常默认约 1.5s 才报警。
- 没加：屏幕 PoG 标定、`getScreenDetails` 读有几块屏、YOLO 检手机、人脸 1:1 换人。这些要么要权限/第二路传感器，要么已经明确不做。

疲劳检测不另加模型，用已有 478 几何：低头（肩线）、EAR 闭眼、PERCLOS（滚动窗口闭眼占比）、眼裂变窄 → 视线模糊（虹膜被眼皮挡住，射线不画）。口径对齐 Soukupová EAR、[e-candeloro/Driver-State-Detection](https://github.com/e-candeloro/Driver-State-Detection)（MIT）的 PERCLOS、以及浏览器连续闭眼计时。

在线演示：https://bosprimigenious.github.io/circle-center-cv/

摄像头需要 HTTPS；Pages 本身是 HTTPS。本地 MP4 在浏览器里逐帧跑，文件不上传。建议 H.264。

视觉反作弊通道（遮挡 / 静止 / 无人脸 / 低头 / 转头 / 虹膜+融合视线 / 嘴部 MAR）按 P2 脚本阈值计 B3-*。侧视优先用融合 yaw，没有融合再退 L2CS。疲劳、转头/第二屏是单独两栏，**不计入 B3**（P2 目录没有对应信号）。不含文本 LLM1、声纹、人脸 1:1、ASR。

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
