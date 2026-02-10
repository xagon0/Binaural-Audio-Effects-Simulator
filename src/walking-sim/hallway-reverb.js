/**
 * HallwayReverb — early reflections + late convolution reverb for walking mode.
 *
 * Hallway dimensions: 10 wide (X: -5 to +5), 5 tall (Y: 0 to 5).
 * Player Y is fixed at ~1.7m (ear height).
 *
 * Signal chain:
 *   inputL/inputR → mono merge → early reflection taps (6) → earlyGainL/R
 *                                                           ↘
 *   inputL/inputR → dryL/dryR → outputL/outputR            late reverb (predelay → lowpass → convolver → lateGain)
 *                                  ↑                          ↓
 *                                  ← earlyGainL/R + lateGainL/R
 */

const SPEED_OF_SOUND = 343; // m/s
const HALL_WIDTH = 10;      // metres
const HALL_HEIGHT = 5;      // metres
const PLAYER_Y = 1.7;       // ear height

// Early reflection tap definitions
const TAPS = [
  { name: 'floor',    dist: PLAYER_Y,                     gain: 0.50, dynamic: false },
  { name: 'ceiling',  dist: HALL_HEIGHT - PLAYER_Y + HALL_HEIGHT, gain: 0.45, dynamic: false },
  // ceiling reflection path: up to ceiling (3.3m) then back down (3.3m) ≈ 6.6m → ~19ms
  { name: 'wallL',    dist: 0, gain: 0.55, dynamic: true },  // computed per-frame
  { name: 'wallR',    dist: 0, gain: 0.55, dynamic: true },  // computed per-frame
  { name: '2ndOrder', dist: 0, gain: 0.25, dynamic: true },  // double wall bounce
  { name: '3rdOrder', dist: 0, gain: 0.12, dynamic: true },  // triple wall bounce
];

export class HallwayReverb {
  /**
   * @param {AudioContext} ctx
   */
  constructor(ctx) {
    this.ctx = ctx;

    // Public I/O nodes
    this.inputL = ctx.createGain();
    this.inputR = ctx.createGain();
    this.outputL = ctx.createGain();
    this.outputR = ctx.createGain();

    // Internal
    this._dryL = ctx.createGain();
    this._dryR = ctx.createGain();
    this._lateGain = ctx.createGain();
    this._predelay = ctx.createDelay(0.1);
    this._predelay.delayTime.value = 0.03; // 30ms predelay
    this._absorption = ctx.createBiquadFilter();
    this._absorption.type = 'lowpass';
    this._absorption.frequency.value = 4000;
    this._absorption.Q.value = 0.7;
    this._convolver = ctx.createConvolver();

    // Mono merge of L+R for reflections
    this._monoMerge = ctx.createGain();
    this._monoMerge.gain.value = 0.5;

    // Early reflection delay taps
    this._taps = [];
    this._tapDelays = [];
    this._tapGainsL = [];
    this._tapGainsR = [];

    this._amount = 0.30;

    this._buildEarlyReflections();
    this._generateIR(2.5);
    this._wireGraph();

    // Set initial gains
    this.setAmount(this._amount);
  }

  _buildEarlyReflections() {
    const ctx = this.ctx;
    // Default player at center X=0
    const playerX = 0;
    const distToLeftWall = playerX + 5;   // distance to X=-5
    const distToRightWall = 5 - playerX;  // distance to X=+5

    const distances = [
      PLAYER_Y * 2,                                           // floor: down + back up
      (HALL_HEIGHT - PLAYER_Y) * 2,                           // ceiling: up + back down
      distToLeftWall * 2,                                      // left wall: there + back
      distToRightWall * 2,                                     // right wall: there + back
      distToLeftWall * 2 + distToRightWall * 2,               // 2nd order: L wall → R wall
      distToLeftWall * 2 + distToRightWall * 2 + distToLeftWall * 2, // 3rd order
    ];

    for (let i = 0; i < TAPS.length; i++) {
      const delay = ctx.createDelay(0.5);
      delay.delayTime.value = Math.min(distances[i] / SPEED_OF_SOUND, 0.49);

      const gainL = ctx.createGain();
      const gainR = ctx.createGain();
      gainL.gain.value = TAPS[i].gain;
      gainR.gain.value = TAPS[i].gain;

      // Stereo offset for wall taps — left wall slightly louder in left ear, etc.
      if (i === 2) { // left wall
        gainL.gain.value = TAPS[i].gain * 1.2;
        gainR.gain.value = TAPS[i].gain * 0.8;
      } else if (i === 3) { // right wall
        gainL.gain.value = TAPS[i].gain * 0.8;
        gainR.gain.value = TAPS[i].gain * 1.2;
      }

      this._tapDelays.push(delay);
      this._tapGainsL.push(gainL);
      this._tapGainsR.push(gainR);
    }
  }

  _generateIR(decayTime) {
    const sampleRate = this.ctx.sampleRate;
    const length = Math.ceil(decayTime * sampleRate);
    const buffer = this.ctx.createBuffer(2, length, sampleRate);
    const dataL = buffer.getChannelData(0);
    const dataR = buffer.getChannelData(1);

    // Exponential decay noise with slight stereo decorrelation
    const decayRate = -6.908 / (decayTime * sampleRate); // ln(0.001) / samples for -60dB
    for (let i = 0; i < length; i++) {
      const envelope = Math.exp(decayRate * i);
      // Shape: ramp up over first 10ms to avoid click, then exponential decay
      const rampUp = Math.min(1, i / (sampleRate * 0.01));
      const amp = envelope * rampUp;
      dataL[i] = (Math.random() * 2 - 1) * amp;
      dataR[i] = (Math.random() * 2 - 1) * amp;
    }

    this._convolver.buffer = buffer;
  }

  _wireGraph() {
    const ctx = this.ctx;

    // Dry path: input → dry → output
    this.inputL.connect(this._dryL);
    this.inputR.connect(this._dryR);
    this._dryL.connect(this.outputL);
    this._dryR.connect(this.outputR);

    // Mono merge for reflections
    this.inputL.connect(this._monoMerge);
    this.inputR.connect(this._monoMerge);

    // Early reflections: monoMerge → each tap delay → tap gains → output
    for (let i = 0; i < this._tapDelays.length; i++) {
      this._monoMerge.connect(this._tapDelays[i]);
      this._tapDelays[i].connect(this._tapGainsL[i]);
      this._tapDelays[i].connect(this._tapGainsR[i]);
      this._tapGainsL[i].connect(this.outputL);
      this._tapGainsR[i].connect(this.outputR);
    }

    // Late reverb: monoMerge → predelay → absorption → convolver → lateGain → output L+R
    this._monoMerge.connect(this._predelay);
    this._predelay.connect(this._absorption);
    this._absorption.connect(this._convolver);
    this._convolver.connect(this._lateGain);
    this._lateGain.connect(this.outputL);
    this._lateGain.connect(this.outputR);
  }

  /**
   * Set wet/dry amount (0 = fully dry, 1 = fully wet).
   * @param {number} value 0–1
   */
  setAmount(value) {
    this._amount = value;
    const t = this.ctx.currentTime;

    // Dry level decreases slightly as wet increases
    const dryLevel = 1.0;
    this._dryL.gain.setTargetAtTime(dryLevel, t, 0.02);
    this._dryR.gain.setTargetAtTime(dryLevel, t, 0.02);

    // Early reflections scale with amount
    for (let i = 0; i < TAPS.length; i++) {
      const baseL = this._getBaseTapGain(i, 'L');
      const baseR = this._getBaseTapGain(i, 'R');
      this._tapGainsL[i].gain.setTargetAtTime(baseL * value, t, 0.02);
      this._tapGainsR[i].gain.setTargetAtTime(baseR * value, t, 0.02);
    }

    // Late reverb scales with amount
    this._lateGain.gain.setTargetAtTime(value * 0.6, t, 0.02);
  }

  _getBaseTapGain(index, ear) {
    const base = TAPS[index].gain;
    if (index === 2) return ear === 'L' ? base * 1.2 : base * 0.8; // left wall
    if (index === 3) return ear === 'L' ? base * 0.8 : base * 1.2; // right wall
    return base;
  }

  /**
   * Set late reverb decay time (regenerates IR).
   * @param {number} seconds 0.5–5.0
   */
  setDecayTime(seconds) {
    // Fade out late gain, swap buffer, fade back in to avoid click
    const t = this.ctx.currentTime;
    const targetGain = this._amount * 0.6;
    this._lateGain.gain.setTargetAtTime(0, t, 0.015);
    setTimeout(() => {
      this._generateIR(seconds);
      this._lateGain.gain.setTargetAtTime(targetGain, this.ctx.currentTime, 0.015);
    }, 80);
  }

  /**
   * Set absorption filter frequency (lowpass cutoff on reverb path).
   * @param {number} hz 500–12000
   */
  setAbsorption(hz) {
    this._absorption.frequency.setTargetAtTime(hz, this.ctx.currentTime, 0.02);
  }

  /**
   * Update wall reflection delays based on player position.
   * In the side hallway (X>4.5, Z in [-51.5, -44.5]), reflect off Z walls instead of X walls.
   * @param {number} playerX  player's X position in world space
   * @param {number} [playerZ]  player's Z position in world space
   */
  updatePlayerPosition(playerX, playerZ) {
    let distToLeft, distToRight;

    const inSideHallway = playerX > 4.5 &&
      playerZ !== undefined && playerZ >= -51.5 && playerZ <= -44.5;

    if (inSideHallway) {
      // Side hallway: reflect off Z=-52 and Z=-44 walls
      distToLeft = Math.max(0.5, playerZ + 52);   // distance to Z=-52
      distToRight = Math.max(0.5, -44 - playerZ);  // distance to Z=-44
    } else {
      // Main hallway: reflect off X=-5 and X=+5 walls
      distToLeft = Math.max(0.5, playerX + 5);
      distToRight = Math.max(0.5, 5 - playerX);
    }

    const t = this.ctx.currentTime;

    // Tap 2: left/near wall reflection
    const leftDelay = Math.min((distToLeft * 2) / SPEED_OF_SOUND, 0.49);
    this._tapDelays[2].delayTime.setTargetAtTime(leftDelay, t, 0.005);

    // Tap 3: right/far wall reflection
    const rightDelay = Math.min((distToRight * 2) / SPEED_OF_SOUND, 0.49);
    this._tapDelays[3].delayTime.setTargetAtTime(rightDelay, t, 0.005);

    // Tap 4: 2nd order (wall-to-wall bounce)
    const secondOrder = Math.min((distToLeft * 2 + distToRight * 2) / SPEED_OF_SOUND, 0.49);
    this._tapDelays[4].delayTime.setTargetAtTime(secondOrder, t, 0.005);

    // Tap 5: 3rd order
    const thirdOrder = Math.min((distToLeft * 2 + distToRight * 2 + distToLeft * 2) / SPEED_OF_SOUND, 0.49);
    this._tapDelays[5].delayTime.setTargetAtTime(thirdOrder, t, 0.005);
  }

  /**
   * Disconnect and clean up all nodes.
   */
  dispose() {
    try {
      this.inputL.disconnect();
      this.inputR.disconnect();
      this._dryL.disconnect();
      this._dryR.disconnect();
      this._monoMerge.disconnect();
      this._predelay.disconnect();
      this._absorption.disconnect();
      this._convolver.disconnect();
      this._lateGain.disconnect();
      for (const d of this._tapDelays) d.disconnect();
      for (const g of this._tapGainsL) g.disconnect();
      for (const g of this._tapGainsR) g.disconnect();
      this.outputL.disconnect();
      this.outputR.disconnect();
    } catch (_) {}
  }
}
