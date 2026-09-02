export type NormalizedBox = {
    x: number;
    y: number;
    width: number;
    height: number;
};

export type IrisEyeMeasure = {
    gazeX: number;
    gazeY: number | null;
    center: { x: number; y: number };
    radius: number;
    orbit: NormalizedBox;
};

export type IrisGaze = {
    left: IrisEyeMeasure | null;
    right: IrisEyeMeasure | null;
    gazeX: number | null;
    gazeY: number | null;
};

export type L2csGaze = {
    yaw: number;
    pitch: number;
};

export type GazeRay = {
    x: number;
    y: number;
    dx: number;
    dy: number;
};

export type GazeOverlay = {
    leftOrbit: NormalizedBox | null;
    rightOrbit: NormalizedBox | null;
    leftIris: { x: number; y: number; radius: number } | null;
    rightIris: { x: number; y: number; radius: number } | null;
    origin: { x: number; y: number } | null;
    l2cs: L2csGaze | null;
    irisGazeX: number | null;
    irisGazeY: number | null;
    leftRay: GazeRay | null;
    rightRay: GazeRay | null;
    irisRay: GazeRay | null;
    l2csRay: GazeRay | null;
    geometricRay: GazeRay | null;
    fusedRay: GazeRay | null;
    look: string;
    blurry: boolean;
    fused: L2csGaze | null;
    head: { yaw: number; pitch: number; roll: number } | null;
};
