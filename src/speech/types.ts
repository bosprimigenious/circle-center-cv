export type SpeechUtterance = {
    index: number;
    start: number;
    end: number;
    duration: number;
    peakMar: number;
};

export type SpeechTick = {
    t: number;
    mar: number | null;
    jawOpen: number | null;
    speaking: boolean;
};

export type SpeechLive = {
    speaking: boolean;
    onset: boolean;
    utterSec: number;
    count: number;
    totalSpeakSec: number;
    lastUtterance: SpeechUtterance | null;
    utterances: SpeechUtterance[];
    envelope: SpeechTick[];
    mar: number | null;
    marBaseline: number | null;
    marStd: number | null;
    yawnHold: boolean;
    label: string;
};

export type SpeechFrameInput = {
    tSec: number;
    mar: number | null;
    jawOpen: number | null;
};
