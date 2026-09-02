# 人脸网格 478 点

浏览器里跑 MediaPipe Face Landmarker：**478** 个 3D 点（468 网格 + 10 虹膜），不是 6 点 Face Detector，也不是身份识别。

在线演示：https://bosprimigenious.github.io/circle-center-cv/

摄像头需要 HTTPS；Pages 本身是 HTTPS。

## 仓库

- 代码：https://github.com/bosprimigenious/circle-center-cv
- 许可：MIT
- 部署：push `main` 后 `.github/workflows/pages.yml` 发 GitHub Pages

圆环 / 圆心定位已从本仓库删除，那套 classical CV 仍在 [interferometer-cv](https://github.com/bosprimigenious/interferometer-cv)。

## 模型

`face_landmarker.task`（float16，约 3.6MB）里三条网：

| 子模型 | 输入 | 作用 |
|---|---|---|
| BlazeFace short-range | 192×192 | 脸上有没有、粗框 |
| FaceMesh-V2 | 256×256 crop | 478 点 |
| Blendshape | 1×146×2 | 52 维表情系数 |

权重和 WASM 在 `npm install` / CI `postinstall` 下载拷贝，不进 git。运行在用户浏览器 GPU（失败则 CPU），没有云端推理。

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
