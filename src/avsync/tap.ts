import { rmsFromTimeDomain } from './energy.ts';

type AudioContextCtor = typeof AudioContext;

const AudioCtx = (): AudioContextCtor | null => {
    if (typeof window === 'undefined') return null;
    const extra = window as unknown as { webkitAudioContext?: AudioContextCtor };
    return window.AudioContext ?? extra.webkitAudioContext ?? null;
};

/**
 * 本机 AnalyserNode 取时域 RMS。摄像头走 MediaStream（video 仍 muted，避免回声）；
 * 本地 MP4 走 MediaElementSource，再接到 destination 才能出声。
 */
export class AudioTap {
    private ctx: AudioContext | null = null;
    private analyser: AnalyserNode | null = null;
    private source: AudioNode | null = null;
    private buf: Float32Array<ArrayBuffer> | null = null;
    private attached: 'stream' | 'element' | null = null;
    private hasAudio = false;

    async attachStream(stream: MediaStream) {
        this.hasAudio = stream.getAudioTracks().some((track) => track.readyState === 'live');
        if (!this.hasAudio) {
            this.detachSource();
            return;
        }
        await this.ensureGraph();
        if (!this.ctx || !this.analyser) return;
        this.detachSource();
        const node = this.ctx.createMediaStreamSource(stream);
        node.connect(this.analyser);
        this.source = node;
        this.attached = 'stream';
        await this.ctx.resume().catch(() => undefined);
    }

    async attachElement(element: HTMLMediaElement) {
        this.hasAudio = true;
        await this.ensureGraph();
        if (!this.ctx || !this.analyser) return;
        if (this.attached === 'element' && this.source) {
            await this.ctx.resume().catch(() => undefined);
            return;
        }
        this.detachSource();
        const node = this.ctx.createMediaElementSource(element);
        node.connect(this.analyser);
        node.connect(this.ctx.destination);
        this.source = node;
        this.attached = 'element';
        await this.ctx.resume().catch(() => undefined);
    }

    rms() {
        if (!this.hasAudio || !this.analyser || !this.buf) return null;
        this.analyser.getFloatTimeDomainData(this.buf);
        return rmsFromTimeDomain(this.buf);
    }

    close() {
        this.detachSource();
        this.hasAudio = false;
        this.analyser = null;
        this.buf = null;
        if (this.ctx) {
            void this.ctx.close().catch(() => undefined);
            this.ctx = null;
        }
    }

    private async ensureGraph() {
        const Ctor = AudioCtx();
        if (!Ctor) return;
        if (!this.ctx || this.ctx.state === 'closed') {
            this.ctx = new Ctor();
            this.analyser = this.ctx.createAnalyser();
            this.analyser.fftSize = 2048;
            this.analyser.smoothingTimeConstant = 0.3;
            this.buf = new Float32Array(new ArrayBuffer(this.analyser.fftSize * 4));
        }
        await this.ctx.resume().catch(() => undefined);
    }

    private detachSource() {
        if (this.source) {
            try {
                this.source.disconnect();
            } catch {
                // already disconnected
            }
            this.source = null;
        }
        this.attached = null;
    }
}
