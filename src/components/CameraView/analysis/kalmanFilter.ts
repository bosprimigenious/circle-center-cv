/**
 * 2D 常速卡尔曼滤波器 — 用于干涉条纹圆心时序跟踪
 *
 * 状态向量: [cx, cy, vx, vy]  位置 + 速度（像素/帧）
 * 观测向量: [cx, cy]          仅观测位置
 *
 * 工作流程:
 *   1. predict()  → 根据上一帧状态预测当前圆心位置
 *   2. correct()  → 用新帧的检测结果修正预测
 *   3. 离群剔除   → 归一化新息平方(NIS)超过阈值时自动降权
 */
export class CenterKalmanFilter {
    // 状态: [cx, cy, vx, vy]
    private state = new Float64Array(4);
    // 协方差矩阵 4×4，以行主序存储
    private cov = new Float64Array(16);

    private initialized = false;

    // 过程噪声强度（加速度方差，像素²/帧⁴）
    private readonly processNoise: number;
    // 基础测量噪声（像素²）
    private readonly baseMeasurementNoise: number;
    // 离群剔除 NIS 阈值（2自由度卡方 99% ≈ 9.21）
    private readonly outlierThreshold: number;

    constructor(
        processNoise = 3.0,
        baseMeasurementNoise = 250,
        outlierThreshold = 9.5,
    ) {
        this.processNoise = processNoise;
        this.baseMeasurementNoise = baseMeasurementNoise;
        this.outlierThreshold = outlierThreshold;
    }

    isInitialized(): boolean {
        return this.initialized;
    }

    /** 用首次测量初始化滤波器 */
    initialize(x: number, y: number, frameWidth: number, frameHeight: number): void {
        this.state[0] = x;
        this.state[1] = y;
        this.state[2] = 0; // 初始速度为零
        this.state[3] = 0;

        // 初始协方差：位置不确定度大，速度不确定度中等
        const posVar = Math.max(frameWidth, frameHeight) * 0.15;
        const velVar = 8;
        this.cov.fill(0);
        this.cov[0] = posVar * posVar;
        this.cov[5] = posVar * posVar;
        this.cov[10] = velVar * velVar;
        this.cov[15] = velVar * velVar;

        this.initialized = true;
    }

    /** 重置滤波器（场景切换时调用） */
    reset(): void {
        this.initialized = false;
        this.state.fill(0);
        this.cov.fill(0);
    }

    /**
     * 预测步骤：根据当前状态推演下一帧
     * 返回预测的圆心位置
     */
    predict(dt = 1): { x: number; y: number } {
        if (!this.initialized) return { x: NaN, y: NaN };

        // 状态转移: x' = F·x  (F 为常速模型)
        this.state[0] += this.state[2] * dt; // cx += vx*dt
        this.state[1] += this.state[3] * dt; // cy += vy*dt

        // 协方差传播: P' = F·P·F^T + Q
        const P = this.cov;
        const dt2 = dt * dt;
        const dt3 = dt2 * dt;
        const dt4 = dt2 * dt2;
        const q = this.processNoise;

        // F·P (仅修改前两行受速度耦合影响的部分)
        // F = [[1,0,dt,0],[0,1,0,dt],[0,0,1,0],[0,0,0,1]]
        // (F·P)[i][j] = P[i][j] + dt * P[i+2][j]  (for i=0,1)
        const FP = new Float64Array(16);
        for (let j = 0; j < 4; j++) {
            FP[0 * 4 + j] = P[0 * 4 + j] + dt * P[2 * 4 + j];
            FP[1 * 4 + j] = P[1 * 4 + j] + dt * P[3 * 4 + j];
            FP[2 * 4 + j] = P[2 * 4 + j];
            FP[3 * 4 + j] = P[3 * 4 + j];
        }

        // (F·P)·F^T: 列方向也受速度耦合
        // result[i][j] = FP[i][j] + dt * FP[i][j+2]  (for j=0,1)
        for (let i = 0; i < 4; i++) {
            P[i * 4 + 0] = FP[i * 4 + 0] + dt * FP[i * 4 + 2];
            P[i * 4 + 1] = FP[i * 4 + 1] + dt * FP[i * 4 + 3];
            P[i * 4 + 2] = FP[i * 4 + 2];
            P[i * 4 + 3] = FP[i * 4 + 3];
        }

        // 加过程噪声 Q (常加速度模型)
        P[0] += q * dt4 / 4;
        P[5] += q * dt4 / 4;
        P[10] += q * dt2;
        P[15] += q * dt2;
        P[0 * 4 + 2] += q * dt3 / 2;
        P[2 * 4 + 0] += q * dt3 / 2;
        P[1 * 4 + 3] += q * dt3 / 2;
        P[3 * 4 + 1] += q * dt3 / 2;

        return { x: this.state[0], y: this.state[1] };
    }

    /**
     * 获取当前预测位置（不修改状态）
     * 用于在 detectRings 之前提供搜索提示
     * 返回：当前位置 + 速度（即下一帧预测位置）
     */
    getPredictedCenter(): { x: number; y: number } | null {
        if (!this.initialized) return null;
        return { x: this.state[0] + this.state[2], y: this.state[1] + this.state[3] };
    }

    /**
     * 修正步骤：用检测结果更新状态
     * @param measX 测量圆心 X
     * @param measY 测量圆心 Y
     * @param confidence 检测置信度 [0,1]
     * @returns 修正后的圆心位置
     */
    correct(
        measX: number,
        measY: number,
        confidence: number,
    ): { x: number; y: number; isOutlier: boolean } {
        if (!this.initialized) {
            return { x: measX, y: measY, isOutlier: false };
        }

        const P = this.cov;

        // 自适应测量噪声：置信度越低，测量噪声越大
        const conf = Math.max(0.05, Math.min(1, confidence));
        const r = this.baseMeasurementNoise * (1 + (1 - conf) * 4);

        // 新息 (innovation): y = z - H·x_pred
        const innovX = measX - this.state[0];
        const innovY = measY - this.state[1];

        // 新息协方差 S = H·P·H^T + R  (2×2)
        const s00 = P[0] + r;
        const s01 = P[1];
        const s10 = P[4];
        const s11 = P[5] + r;

        // 归一化新息平方 (NIS): y^T · S^-1 · y
        const detS = s00 * s11 - s01 * s10;
        let nis = 0;
        if (Math.abs(detS) > 1e-10) {
            const invS00 = s11 / detS;
            const invS11 = s00 / detS;
            const invS01 = -s01 / detS;
            nis = innovX * innovX * invS00
                + innovY * innovY * invS11
                + 2 * innovX * innovY * invS01;
        }

        const isOutlier = nis > this.outlierThreshold;

        // 离群时增大测量噪声，降低卡尔曼增益（软剔除）
        const effectiveR = isOutlier ? r * 8 : r;
        const es00 = P[0] + effectiveR;
        const es01 = P[1];
        const es10 = P[4];
        const es11 = P[5] + effectiveR;
        const edetS = es00 * es11 - es01 * es10;

        if (Math.abs(edetS) < 1e-10) {
            return { x: this.state[0], y: this.state[1], isOutlier };
        }

        // S 逆
        const einvS00 = es11 / edetS;
        const einvS01 = -es01 / edetS;
        const einvS10 = -es10 / edetS;
        const einvS11 = es00 / edetS;

        // 卡尔曼增益 K = P·H^T·S^-1  (4×2)
        // K[i][0] = P[i][0]*einvS00 + P[i][1]*einvS10
        // K[i][1] = P[i][0]*einvS01 + P[i][1]*einvS11
        const K = new Float64Array(8);
        for (let i = 0; i < 4; i++) {
            K[i * 2 + 0] = P[i * 4 + 0] * einvS00 + P[i * 4 + 1] * einvS10;
            K[i * 2 + 1] = P[i * 4 + 0] * einvS01 + P[i * 4 + 1] * einvS11;
        }

        // 状态更新: x = x + K·y
        this.state[0] += K[0] * innovX + K[1] * innovY;
        this.state[1] += K[2] * innovX + K[3] * innovY;
        this.state[2] += K[4] * innovX + K[5] * innovY;
        this.state[3] += K[6] * innovX + K[7] * innovY;

        // 协方差更新: P = (I - K·H)·P
        // (K·H)[i][j] = K[i][0]·δ(j,0) + K[i][1]·δ(j,1)
        const newP = new Float64Array(16);
        for (let i = 0; i < 4; i++) {
            for (let j = 0; j < 4; j++) {
                newP[i * 4 + j] = P[i * 4 + j]
                    - K[i * 2 + 0] * P[0 * 4 + j]
                    - K[i * 2 + 1] * P[1 * 4 + j];
            }
        }
        this.cov.set(newP);

        return { x: this.state[0], y: this.state[1], isOutlier };
    }
}
