import type { WeaponKind } from '../types/game';

/**
 * Синтезатор звуков на Web Audio API: выстрелы разных классов, утилиты, интерфейс,
 * события матча. Никаких аудиофайлов. Троттлинг защищает от перегрузки при массовой стрельбе.
 */

type Shot = 'sniper' | 'rifle' | 'smg' | 'pistol' | 'shotgun' | 'lmg';

const WEAPON_SHOT: Record<WeaponKind, Shot> = {
  pistol: 'pistol',
  deagle: 'pistol',
  smg: 'smg',
  shotgun: 'shotgun',
  rifle: 'rifle',
  carbine: 'rifle',
  lmg: 'lmg',
  scout: 'sniper',
  sniper: 'sniper',
  autoSniper: 'sniper',
};

export class SoundFX {
  muted = false;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private last = new Map<string, number>();
  private holds = new Set<string>();
  private droneOsc: OscillatorNode | null = null;
  private droneGain: GainNode | null = null;

  /** Создаёт AudioContext по первому жесту пользователя */
  ensure(): boolean {
    if (this.ctx) {
      if (this.ctx.state === 'suspended' && this.holds.size === 0) void this.ctx.resume();
      return true;
    }
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return false;
      this.ctx = new Ctor();
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 6;
      comp.connect(this.ctx.destination);
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.5;
      this.master.connect(comp);
      const len = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      // Звук уже удержан (реклама, скрытая вкладка, настройка портала) — контекст сразу на паузу
      if (this.holds.size > 0) void this.ctx.suspend();
      return true;
    } catch {
      this.ctx = null;
      return false;
    }
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.5, this.ctx.currentTime, 0.02);
  }

  toggleMute(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  /** Приостановка звука (реклама, скрытая вкладка). reason — ключ удержания */
  suspend(reason: string): void {
    this.holds.add(reason);
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend();
  }

  resume(reason: string): void {
    this.holds.delete(reason);
    if (this.ctx && this.holds.size === 0 && this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private ok(key: string, minMs: number): boolean {
    if (!this.ctx || !this.master || this.muted || this.ctx.state !== 'running') return false;
    const now = performance.now();
    const prev = this.last.get(key) ?? 0;
    if (now - prev < minMs) return false;
    this.last.set(key, now);
    return true;
  }

  /* ----------------------------- Примитивы ------------------------------ */

  private noiseBurst(dur: number, type: BiquadFilterType, f0: number, f1: number, gain: number, q = 0.8, delay = 0): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const filt = ctx.createBiquadFilter();
    filt.type = type;
    filt.Q.value = q;
    filt.frequency.setValueAtTime(f0, t);
    filt.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filt).connect(g).connect(this.master!);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  private tone(type: OscillatorType, f0: number, f1: number, dur: number, gain: number, delay = 0, attack = 0.004): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.master!);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  /* ------------------------------ Выстрелы ------------------------------- */

  shot(weapon: WeaponKind): void {
    const kind = WEAPON_SHOT[weapon];
    const gaps: Record<Shot, number> = { sniper: 70, rifle: 45, smg: 40, pistol: 45, shotgun: 80, lmg: 40 };
    if (!this.ok('shot-' + kind, gaps[kind])) return;
    switch (kind) {
      case 'sniper':
        this.tone('sine', 140, 38, 0.4, 0.7);
        this.noiseBurst(0.32, 'lowpass', 3200, 300, 0.75);
        this.noiseBurst(0.045, 'highpass', 4000, 3000, 0.5);
        this.tone('square', 2100, 1900, 0.018, 0.06, 0.28);
        this.tone('square', 1500, 1300, 0.02, 0.06, 0.36);
        break;
      case 'rifle':
        this.noiseBurst(0.13, 'bandpass', 1500, 500, 0.5, 0.7);
        this.tone('sine', 190, 60, 0.09, 0.32);
        break;
      case 'smg':
        this.noiseBurst(0.07, 'bandpass', 2200, 900, 0.38, 0.9);
        this.tone('sine', 240, 90, 0.05, 0.2);
        break;
      case 'pistol':
        this.noiseBurst(0.09, 'bandpass', 2600, 900, 0.4, 0.9);
        this.tone('triangle', 420, 140, 0.05, 0.18);
        break;
      case 'shotgun':
        this.noiseBurst(0.28, 'lowpass', 2400, 250, 0.8);
        this.tone('sine', 110, 40, 0.25, 0.5);
        this.tone('square', 900, 700, 0.03, 0.05, 0.3);
        break;
      case 'lmg':
        this.noiseBurst(0.11, 'bandpass', 1200, 400, 0.48, 0.7);
        this.tone('sine', 160, 55, 0.08, 0.3);
        break;
    }
  }

  /* ------------------------------ Утилиты -------------------------------- */

  molotov(): void {
    if (!this.ok('molotov', 120)) return;
    this.noiseBurst(0.09, 'highpass', 5000, 3500, 0.35);
    for (let i = 0; i < 4; i++) this.tone('sine', 3000 + Math.random() * 2500, 2500, 0.05, 0.05, 0.02 + i * 0.025);
    this.noiseBurst(0.7, 'bandpass', 300, 1400, 0.45, 0.6, 0.05);
  }

  flash(): void {
    if (!this.ok('flash', 120)) return;
    this.noiseBurst(0.06, 'highpass', 3000, 2000, 0.4);
    this.tone('sine', 3600, 3300, 0.7, 0.12, 0.02, 0.01);
  }

  grenade(): void {
    if (!this.ok('grenade', 120)) return;
    this.tone('sine', 95, 28, 0.6, 0.85);
    this.noiseBurst(0.55, 'lowpass', 1200, 120, 0.85);
  }

  trap(): void {
    if (!this.ok('trap', 120)) return;
    this.tone('square', 1250, 1250, 0.06, 0.08);
    this.tone('square', 1250, 1250, 0.06, 0.08, 0.1);
  }

  /* ---------------------------- Интерфейс -------------------------------- */

  click(): void {
    if (!this.ok('click', 30)) return;
    this.tone('sine', 950, 700, 0.04, 0.12);
  }

  coin(): void {
    if (!this.ok('coin', 60)) return;
    this.tone('sine', 1320, 1320, 0.07, 0.12);
    this.tone('sine', 1760, 1760, 0.12, 0.12, 0.06);
  }

  place(): void {
    if (!this.ok('place', 60)) return;
    this.tone('sine', 220, 110, 0.12, 0.4);
    this.noiseBurst(0.05, 'highpass', 2500, 2000, 0.2);
    this.tone('triangle', 880, 880, 0.06, 0.08, 0.08);
  }

  sell(): void {
    if (!this.ok('sell', 60)) return;
    this.tone('sine', 1760, 1760, 0.06, 0.1);
    this.tone('sine', 1320, 1320, 0.1, 0.1, 0.06);
  }

  upgrade(): void {
    if (!this.ok('upgrade', 80)) return;
    [523, 659, 784, 1047].forEach((f, i) => this.tone('triangle', f, f, 0.14, 0.16, i * 0.06));
    this.noiseBurst(0.1, 'highpass', 6000, 4000, 0.08, 0.8, 0.22);
  }

  error(): void {
    if (!this.ok('error', 120)) return;
    this.tone('square', 190, 170, 0.09, 0.08);
    this.tone('square', 150, 140, 0.12, 0.08, 0.1);
  }

  kill(): void {
    if (!this.ok('kill', 35)) return;
    this.tone('sine', 1500, 1100, 0.03, 0.05);
  }

  crit(): void {
    if (!this.ok('crit', 90)) return;
    this.tone('sine', 2300, 2100, 0.09, 0.09);
  }

  baseHit(): void {
    if (!this.ok('baseHit', 150)) return;
    this.tone('sine', 80, 40, 0.35, 0.8);
    this.noiseBurst(0.25, 'lowpass', 700, 100, 0.5);
    this.tone('sawtooth', 220, 110, 0.25, 0.06);
  }

  lag(): void {
    if (!this.ok('lag', 300)) return;
    for (let i = 0; i < 5; i++) {
      const f = 200 + Math.random() * 1600;
      this.tone('square', f, f * 0.8, 0.03, 0.05, i * 0.035);
    }
  }

  waveStart(): void {
    if (!this.ok('waveStart', 500)) return;
    this.tone('sawtooth', 220, 220, 0.55, 0.12, 0, 0.05);
    this.tone('sawtooth', 330, 330, 0.55, 0.09, 0, 0.05);
    this.tone('sawtooth', 440, 440, 0.4, 0.08, 0.3, 0.03);
  }

  waveClear(): void {
    if (!this.ok('waveClear', 500)) return;
    [392, 523, 659, 784].forEach((f, i) => this.tone('triangle', f, f, 0.18, 0.14, i * 0.08));
  }

  victory(): void {
    if (!this.ok('victory', 1000)) return;
    const seq = [523, 659, 784, 1047, 784, 1047];
    seq.forEach((f, i) => {
      this.tone('triangle', f, f, 0.26, 0.18, i * 0.13);
      this.tone('sine', f / 2, f / 2, 0.26, 0.1, i * 0.13);
    });
  }

  defeat(): void {
    if (!this.ok('defeat', 1000)) return;
    [392, 349, 311, 262].forEach((f, i) => this.tone('sawtooth', f, f * 0.98, 0.32, 0.08, i * 0.22, 0.02));
  }

  boss(): void {
    if (!this.ok('boss', 1500)) return;
    this.tone('sawtooth', 55, 50, 1.4, 0.25, 0, 0.1);
    this.tone('sawtooth', 82, 78, 1.4, 0.15, 0.05, 0.1);
    this.noiseBurst(1.2, 'lowpass', 400, 80, 0.25);
  }

  /** Тихий гул во время волны босса (вкл/выкл) */
  bossDrone(on: boolean): void {
    if (!this.ctx || !this.master) return;
    if (on && !this.droneOsc) {
      const osc = this.ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = 46;
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 180;
      const g = this.ctx.createGain();
      g.gain.value = 0.0001;
      g.gain.setTargetAtTime(0.05, this.ctx.currentTime, 0.5);
      osc.connect(lp).connect(g).connect(this.master);
      osc.start();
      this.droneOsc = osc;
      this.droneGain = g;
    } else if (!on && this.droneOsc && this.droneGain) {
      const osc = this.droneOsc;
      this.droneGain.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.3);
      window.setTimeout(() => {
        try {
          osc.stop();
        } catch {
          /* уже остановлен */
        }
      }, 1500);
      this.droneOsc = null;
      this.droneGain = null;
    }
  }
}
