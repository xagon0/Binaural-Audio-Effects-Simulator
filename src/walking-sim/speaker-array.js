/**
 * SpeakerArray — creates N speaker channels, each with DelayNode (propagation delay)
 * → PannerNode (HRTF, inverse distance). Updates AudioListener and per-speaker delay each frame.
 *
 * Signal flow:
 *   inputBus (mono merge of L+R) → DelayNode[i] → PannerNode[i] → shared sumNode → splitter → outputL / outputR
 */
export class SpeakerArray {
  /**
   * @param {AudioContext} ctx
   * @param {Array<{x:number, y:number, z:number}>} speakerPositions
   */
  constructor(ctx, speakerPositions) {
    this.ctx = ctx;
    this.speakers = [];
    this.activationDistance = 50; // Only process speakers within this range
    this.perSpeakerGain = 0.6;
    this.volume = 1.0;

    // Input bus: merge L+R sources into mono
    this.inputMerger = ctx.createChannelMerger(2);
    this.inputBus = ctx.createGain();
    this.inputBus.gain.value = 1;
    this.inputMerger.connect(this.inputBus);

    // Shared sum node that all panners feed into
    this.sumNode = ctx.createGain();
    this.sumNode.gain.value = 1;
    this.sumNode.channelCount = 2;
    this.sumNode.channelCountMode = 'explicit';
    this.sumNode.channelInterpretation = 'speakers';

    // Splitter to separate stereo sum into L/R
    this.splitter = ctx.createChannelSplitter(2);
    this.sumNode.connect(this.splitter);

    // Output gains for L and R
    this.outputL = ctx.createGain();
    this.outputR = ctx.createGain();
    this.outputL.gain.value = 1;
    this.outputR.gain.value = 1;
    this.splitter.connect(this.outputL, 0);
    this.splitter.connect(this.outputR, 1);

    // Create per-speaker channels
    for (let i = 0; i < speakerPositions.length; i++) {
      const pos = speakerPositions[i];
      this._createSpeakerChannel(pos, i);
    }
  }

  _createSpeakerChannel(pos, index) {
    const ctx = this.ctx;

    // Per-speaker gain (for activation/muting distant speakers)
    const gain = ctx.createGain();
    gain.gain.value = this.perSpeakerGain;

    // Propagation delay: distance / 343 m/s
    const delay = ctx.createDelay(1.0); // Max 1.0s covers ~343m (full hall diagonal)
    delay.delayTime.value = 0;

    // HRTF panner for this speaker
    const panner = new PannerNode(ctx, {
      panningModel: 'HRTF',
      distanceModel: 'inverse',
      refDistance: 1,
      maxDistance: 100,
      rolloffFactor: 1.5,
      coneInnerAngle: 120,
      coneOuterAngle: 180,
      coneOuterGain: 0.3,
    });

    // Speaker points downward (cone faces down)
    panner.orientationX.value = 0;
    panner.orientationY.value = -1;
    panner.orientationZ.value = 0;

    // Set speaker position
    panner.positionX.value = pos.x;
    panner.positionY.value = pos.y;
    panner.positionZ.value = pos.z;

    // Wire: inputBus → gain → delay → panner → sumNode
    this.inputBus.connect(gain);
    gain.connect(delay);
    delay.connect(panner);
    panner.connect(this.sumNode);

    this.speakers.push({
      position: { x: pos.x, y: pos.y, z: pos.z },
      gain,
      delay,
      panner,
      active: true,
      index,
    });
  }

  /**
   * Get input merger node for connecting sources.
   * Connect sourceL → inputMerger channel 0, sourceR → channel 1.
   */
  getInputMerger() {
    return this.inputMerger;
  }

  /**
   * Get the L output gain node.
   */
  getOutputL() {
    return this.outputL;
  }

  /**
   * Get the R output gain node.
   */
  getOutputR() {
    return this.outputR;
  }

  /**
   * Set master volume for all speakers (0–3 range).
   * @param {number} value
   */
  setVolume(value) {
    this.volume = value;
    const t = this.ctx.currentTime;
    this.sumNode.gain.setTargetAtTime(value, t, 0.02);
  }

  /**
   * Update listener position/orientation and per-speaker delays.
   * Call each frame from the animation loop.
   * @param {{x:number, y:number, z:number}} playerPos
   * @param {{x:number, y:number, z:number}} forward — normalized forward direction
   * @param {{x:number, y:number, z:number}} up — normalized up direction
   */
  updateListener(playerPos, forward, up) {
    const listener = this.ctx.listener;
    const t = this.ctx.currentTime;

    // Feature-detect AudioParam API vs deprecated methods
    if (listener.positionX) {
      listener.positionX.setValueAtTime(playerPos.x, t);
      listener.positionY.setValueAtTime(playerPos.y, t);
      listener.positionZ.setValueAtTime(playerPos.z, t);
      listener.forwardX.setValueAtTime(forward.x, t);
      listener.forwardY.setValueAtTime(forward.y, t);
      listener.forwardZ.setValueAtTime(forward.z, t);
      listener.upX.setValueAtTime(up.x, t);
      listener.upY.setValueAtTime(up.y, t);
      listener.upZ.setValueAtTime(up.z, t);
    } else {
      listener.setPosition(playerPos.x, playerPos.y, playerPos.z);
      listener.setOrientation(forward.x, forward.y, forward.z, up.x, up.y, up.z);
    }
  }

  /**
   * Update per-speaker propagation delays and activation.
   * @param {{x:number, y:number, z:number}} playerPos
   * @returns {number[]} distances for each speaker (useful for glow feedback)
   */
  updateSpeakers(playerPos) {
    const t = this.ctx.currentTime;
    const distances = [];

    for (const speaker of this.speakers) {
      const dx = playerPos.x - speaker.position.x;
      const dy = playerPos.y - speaker.position.y;
      const dz = playerPos.z - speaker.position.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      distances.push(dist);

      // Propagation delay: distance / speed of sound
      const propDelay = dist / 343;
      speaker.delay.delayTime.setTargetAtTime(propDelay, t, 0.02);

      // Activation: mute speakers beyond activation distance to save CPU
      const shouldBeActive = dist <= this.activationDistance;
      if (shouldBeActive && !speaker.active) {
        speaker.gain.gain.setTargetAtTime(this.perSpeakerGain, t, 0.02);
        speaker.active = true;
      } else if (!shouldBeActive && speaker.active) {
        speaker.gain.gain.setTargetAtTime(0, t, 0.02);
        speaker.active = false;
      }
    }

    return distances;
  }

  /**
   * Disconnect all nodes for cleanup.
   */
  dispose() {
    this.inputBus.disconnect();
    this.inputMerger.disconnect();
    this.sumNode.disconnect();
    this.splitter.disconnect();
    this.outputL.disconnect();
    this.outputR.disconnect();
    for (const s of this.speakers) {
      s.gain.disconnect();
      s.delay.disconnect();
      s.panner.disconnect();
    }
  }
}
