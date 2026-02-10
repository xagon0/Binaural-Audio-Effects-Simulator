/**
 * Spatializer — HRTF binaural spatialization via PannerNode.
 *
 * Signal flow:
 *   Source_L ──┬── directGainL ──────────────────────────→ (output L)
 *              └── inputMerger(ch0) → Panner → splitter ─→ spatGainL → (output L)
 *   Source_R ──┬── directGainR ──────────────────────────→ (output R)
 *              └── inputMerger(ch1) ─┘           └──────→ spatGainR → (output R)
 */
export class Spatializer {
  constructor(ctx) {
    this.ctx = ctx;

    // Merge L+R mono sources into stereo for PannerNode
    this.inputMerger = ctx.createChannelMerger(2);

    // Note: PannerNode's internal stereo→mono downmix already applies
    // M = 0.5*(L+R), so no extra gain compensation is needed.

    // Use default listener orientation: forward = (0,0,-1), up = (0,1,0).
    // This gives right = +X, left = -X, front = -Z, back = +Z.

    // HRTF panner
    this.panner = new PannerNode(ctx, {
      panningModel: 'HRTF',
      distanceModel: 'inverse',
      refDistance: 1,
      maxDistance: 10000,
      rolloffFactor: 1,
      coneInnerAngle: 360,
      coneOuterAngle: 360,
      coneOuterGain: 0,
    });

    // Split HRTF stereo back to per-ear
    this.splitter = ctx.createChannelSplitter(2);

    // Wire merger → panner → splitter
    this.inputMerger.connect(this.panner);
    this.panner.connect(this.splitter);

    // Bypass path gains (default: ON = direct pass-through)
    this.directGainL = ctx.createGain();
    this.directGainR = ctx.createGain();
    this.directGainL.gain.value = 1;
    this.directGainR.gain.value = 1;

    // Spatial path gains (default: OFF)
    this.spatGainL = ctx.createGain();
    this.spatGainR = ctx.createGain();
    this.spatGainL.gain.value = 0;
    this.spatGainR.gain.value = 0;

    // Wire splitter → spatial gains
    this.splitter.connect(this.spatGainL, 0);
    this.splitter.connect(this.spatGainR, 1);

    this.active = false;
  }

  /**
   * Toggle between direct (stereo pass-through) and spatial (HRTF) paths.
   */
  setActive(on) {
    this.active = on;
    const t = this.ctx.currentTime;
    if (on) {
      this.directGainL.gain.setTargetAtTime(0, t, 0.02);
      this.directGainR.gain.setTargetAtTime(0, t, 0.02);
      this.spatGainL.gain.setTargetAtTime(1, t, 0.02);
      this.spatGainR.gain.setTargetAtTime(1, t, 0.02);
    } else {
      this.directGainL.gain.setTargetAtTime(1, t, 0.02);
      this.directGainR.gain.setTargetAtTime(1, t, 0.02);
      this.spatGainL.gain.setTargetAtTime(0, t, 0.02);
      this.spatGainR.gain.setTargetAtTime(0, t, 0.02);
    }
  }

  /**
   * Smoothly update 3D position of the virtual source.
   */
  setPosition(x, y, z) {
    const t = this.ctx.currentTime;
    this.panner.positionX.setTargetAtTime(x, t, 0.02);
    this.panner.positionY.setTargetAtTime(y, t, 0.02);
    this.panner.positionZ.setTargetAtTime(z, t, 0.02);
  }

  /**
   * Disconnect all nodes.
   */
  dispose() {
    this.inputMerger.disconnect();
    this.panner.disconnect();
    this.splitter.disconnect();
    this.directGainL.disconnect();
    this.directGainR.disconnect();
    this.spatGainL.disconnect();
    this.spatGainR.disconnect();
  }
}
