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

export type GazeOverlay = {
    leftOrbit: NormalizedBox | null;
    rightOrbit: NormalizedBox | null;
    leftIris: { x: number; y: number; radius: number } | null;
    rightIris: { x: number; y: number; radius: number } | null;
    origin: { x: number; y: number } | null;
    l2cs: L2csGaze | null;
    irisGazeX: number | null;
    irisGazeY: number | null;
};
