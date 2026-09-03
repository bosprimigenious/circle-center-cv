export type HandPoint = {
    x: number;
    y: number;
    z: number;
};

export type DetectedHand = {
    landmarks: HandPoint[];
    handedness: string;
    score: number;
    palm: { x: number; y: number };
};

export type DetectedHands = {
    hands: DetectedHand[];
    engine: string;
    error?: string;
};

export const HAND_WRIST = 0;
export const HAND_INDEX_MCP = 5;
export const HAND_INDEX_TIP = 8;
export const HAND_MIDDLE_MCP = 9;
export const HAND_MIDDLE_TIP = 12;
export const HAND_RING_MCP = 13;
export const HAND_PINKY_MCP = 17;
export const HAND_PALM_INDICES = [HAND_WRIST, HAND_INDEX_MCP, HAND_MIDDLE_MCP, HAND_RING_MCP, HAND_PINKY_MCP] as const;
export const HAND_FACE_PROBE = [HAND_WRIST, HAND_INDEX_MCP, HAND_INDEX_TIP, HAND_MIDDLE_MCP, HAND_MIDDLE_TIP] as const;
