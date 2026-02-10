/**
 * BinauralTone — a single binaural beat oscillator pair (L + R).
 */
class BinauralTone {
  constructor(ctx, id, baseFreq = 200, beatDiff = 10, volume = 0.15) {
    this.ctx = ctx;
    this.id = id;
    this.active = false;
    this.baseFreq = baseFreq;
    this.beatDiff = beatDiff;
    this.volume = volume;
    this._distanceGain = 1.0;

    this.oscL = ctx.createOscillator();
    this.oscL.type = 'sine';
    this.oscL.frequency.value = baseFreq;
    this.gainL = ctx.createGain();
    this.gainL.gain.value = 0;
    this.oscL.connect(this.gainL);
    this.oscL.start();

    this.oscR = ctx.createOscillator();
    this.oscR.type = 'sine';
    this.oscR.frequency.value = baseFreq + beatDiff;
    this.gainR = ctx.createGain();
    this.gainR.gain.value = 0;
    this.oscR.connect(this.gainR);
    this.oscR.start();
  }

  connectToMerger(merger) {
    this.gainL.connect(merger, 0, 0);
    this.gainR.connect(merger, 0, 1);
  }

  setActive(on) {
    this.active = on;
    const t = this.ctx.currentTime;
    const vol = on ? this.volume * this._distanceGain : 0;
    this.gainL.gain.setTargetAtTime(vol, t, 0.02);
    this.gainR.gain.setTargetAtTime(vol, t, 0.02);
  }

  setBaseFrequency(hz) {
    this.baseFreq = hz;
    const t = this.ctx.currentTime;
    this.oscL.frequency.setTargetAtTime(hz, t, 0.02);
    this.oscR.frequency.setTargetAtTime(hz + this.beatDiff, t, 0.02);
  }

  setBeatDifference(hz) {
    this.beatDiff = hz;
    const t = this.ctx.currentTime;
    this.oscR.frequency.setTargetAtTime(this.baseFreq + hz, t, 0.02);
  }

  setVolume(val) {
    this.volume = val;
    if (this.active) {
      const t = this.ctx.currentTime;
      const effective = val * this._distanceGain;
      this.gainL.gain.setTargetAtTime(effective, t, 0.02);
      this.gainR.gain.setTargetAtTime(effective, t, 0.02);
    }
  }

  setDistanceAttenuation(gain) {
    this._distanceGain = gain;
    if (this.active) {
      const t = this.ctx.currentTime;
      const effective = this.volume * gain;
      this.gainL.gain.setTargetAtTime(effective, t, 0.05);
      this.gainR.gain.setTargetAtTime(effective, t, 0.05);
    }
  }

  dispose() {
    try { this.oscL.stop(); } catch (_) {}
    try { this.oscR.stop(); } catch (_) {}
    this.oscL.disconnect();
    this.oscR.disconnect();
    this.gainL.disconnect();
    this.gainR.disconnect();
  }
}

/**
 * BinauralBeatGenerator — manages multiple binaural beat tones.
 * Each tone is an independent L/R oscillator pair routed to the stereo merger.
 */
export class BinauralBeatGenerator {
  constructor(ctx) {
    this.ctx = ctx;
    this.merger = null;
    this.tones = new Map();
    this.nextId = 0;
  }

  connectToMerger(merger) {
    this.merger = merger;
  }

  addTone({ baseFreq = 200, beatDiff = 10, volume = 0.15, active = false } = {}) {
    const id = this.nextId++;
    const tone = new BinauralTone(this.ctx, id, baseFreq, beatDiff, volume);
    if (this.merger) tone.connectToMerger(this.merger);
    if (active) tone.setActive(true);
    this.tones.set(id, tone);
    return id;
  }

  removeTone(id) {
    const tone = this.tones.get(id);
    if (tone) {
      tone.setActive(false);
      tone.dispose();
      this.tones.delete(id);
    }
  }

  getTone(id) {
    return this.tones.get(id);
  }

  removeAllTones() {
    for (const tone of this.tones.values()) {
      tone.setActive(false);
      tone.dispose();
    }
    this.tones.clear();
  }

  updateDistanceAttenuation(gain) {
    for (const tone of this.tones.values()) {
      tone.setDistanceAttenuation(gain);
    }
  }

  dispose() {
    this.removeAllTones();
  }
}
