import { window } from './runtime';

// ==========================================
// AUDIO SYNTHESIZER ENGINE
// ==========================================
class SoundEngine {
  ctx: AudioContext | null;
  muted: boolean;
  lastSliderSoundTime: number;

  constructor() {
    this.ctx = null;
    this.muted = true;
    this.lastSliderSoundTime = 0;
  }

  init() {
    if (this.ctx) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
  }

  playChime(notes: number[], duration = 0.1, delayMultiplier = 0.15) {
    if (this.muted) return;
    this.init();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    notes.forEach((freq: number, index: number) => {
      const osc = this.ctx!.createOscillator();
      const gainNode = this.ctx!.createGain();
      
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + index * delayMultiplier);
      
      gainNode.gain.setValueAtTime(0, now + index * delayMultiplier);
      gainNode.gain.linearRampToValueAtTime(0.05, now + index * delayMultiplier + 0.02);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, now + index * delayMultiplier + duration);
      
      osc.connect(gainNode);
      gainNode.connect(this.ctx!.destination);

      osc.start(now + index * delayMultiplier);
      osc.stop(now + index * delayMultiplier + duration);
    });
  }

  playClick() {
    if (this.muted) return;
    this.init();
    if (!this.ctx) return;
    
    const now = this.ctx.currentTime;
    const osc = this.ctx!.createOscillator();
    const gainNode = this.ctx!.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(320, now);
    osc.frequency.setValueAtTime(640, now + 0.03);

    gainNode.gain.setValueAtTime(0.03, now);
    gainNode.gain.linearRampToValueAtTime(0.015, now + 0.03);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);

    osc.connect(gainNode);
    gainNode.connect(this.ctx!.destination);

    osc.start(now);
    osc.stop(now + 0.08);
  }
}

const soundEngine = new SoundEngine();


export { soundEngine, SoundEngine };
