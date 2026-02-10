/**
 * PhaseSmearProcessor — per-ear phase smear effect.
 * 3 cascaded DelayNodes with LFO-modulated delay times + trailing allpass filter.
 */
export class PhaseSmearProcessor {
  constructor(ctx) {
    this.ctx = ctx;

    // Input / output gain nodes for clean patching
    this.input = ctx.createGain();
    this.output = ctx.createGain();

    // Create 3 cascaded delay stages
    this.stages = [];
    let prev = this.input;

    for (let i = 0; i < 3; i++) {
      const delay = ctx.createDelay(0.06); // max 60ms (headroom)
      delay.delayTime.value = 0.030;       // center at 30ms

      // LFO → depth gain → delayTime
      const lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = 1.0;

      const depthGain = ctx.createGain();
      depthGain.gain.value = 0; // start with no modulation

      lfo.connect(depthGain);
      depthGain.connect(delay.delayTime);
      lfo.start();

      prev.connect(delay);
      prev = delay;

      this.stages.push({ delay, lfo, depthGain });
    }

    // Trailing allpass filter for additional phase dispersion
    this.allpass = ctx.createBiquadFilter();
    this.allpass.type = 'allpass';
    this.allpass.frequency.value = 1000;
    this.allpass.Q.value = 5;

    prev.connect(this.allpass);
    this.allpass.connect(this.output);
  }

  /**
   * Set modulation depth (0–1). Maps to 0–25ms of delay modulation.
   */
  setDepth(value) {
    const maxMod = 0.020; // 20ms — stays within [10ms, 50ms] range of 30ms center
    const t = this.ctx.currentTime;
    for (const stage of this.stages) {
      stage.depthGain.gain.setTargetAtTime(value * maxMod, t, 0.02);
    }
  }

  /**
   * Set LFO rate in Hz. Rates are offset per stage for decorrelation.
   */
  setRate(hz) {
    const t = this.ctx.currentTime;
    this.stages.forEach((stage, i) => {
      const stageRate = hz * (1 + i * 0.15);
      stage.lfo.frequency.setTargetAtTime(stageRate, t, 0.02);
    });
  }

  /**
   * Disconnect all internal nodes (cleanup).
   */
  dispose() {
    for (const stage of this.stages) {
      stage.lfo.stop();
      stage.lfo.disconnect();
      stage.depthGain.disconnect();
      stage.delay.disconnect();
    }
    this.allpass.disconnect();
    this.input.disconnect();
    this.output.disconnect();
  }
}
