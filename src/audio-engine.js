import { PhaseSmearProcessor } from './phase-smear.js';
import { BinauralBeatGenerator } from './binaural-beat.js';
import { PitchShifter } from './pitch-shifter.js';
import { Spatializer } from './spatializer.js';
import { HallwayReverb } from './walking-sim/hallway-reverb.js';

/**
 * AudioEngine — manages the Web Audio context, node graph, file loading,
 * transport controls, and parameter updates.
 */
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.bufferL = null;
    this.bufferR = null;
    this.duration = 0;

    // Source nodes (recreated each play)
    this.sourceL = null;
    this.sourceR = null;

    // Transport state
    this.playing = false;
    this.startTime = 0;
    this.pauseOffset = 0;
    this.loop = false;

    // Stored parameter values
    this.detuneL = 0;
    this.detuneR = 0;
    this.dryWetMix = 0;
    this.compressorActive = true;

    // Persistent nodes (set in buildGraph)
    this.dryGainL = null;
    this.dryGainR = null;
    this.wetGainL = null;
    this.wetGainR = null;
    this.sumGainL = null;
    this.sumGainR = null;
    this.analyserL = null;
    this.analyserR = null;
    this.analyserMaster = null;
    this.merger = null;
    this.compressor = null;
    this.compressorBypass = null;
    this.safetyGain = null;
    this.masterGain = null;
    this.phaseSmearL = null;
    this.phaseSmearR = null;
    this.pitchShifterL = null;
    this.pitchShifterR = null;
    this.binauralBeat = null;
    this.spatializer = null;
    this.spatialActive = false;

    // Walking mode speaker array
    this._speakerArray = null;
    this._hallwayReverb = null;
  }

  /**
   * Initialize AudioContext (must be called from user gesture).
   */
  async init() {
    if (this.ctx) return;
    const ctx = new AudioContext();
    try {
      await PitchShifter.register(ctx);
    } catch (err) {
      await ctx.close();
      throw err;
    }
    this.ctx = ctx;
    this.buildGraph();
  }

  /**
   * Build the persistent node graph.
   */
  buildGraph() {
    const ctx = this.ctx;

    // Per-ear dry/wet gains
    this.dryGainL = ctx.createGain();
    this.dryGainR = ctx.createGain();
    this.wetGainL = ctx.createGain();
    this.wetGainR = ctx.createGain();

    // Start fully dry
    this.dryGainL.gain.value = 1;
    this.dryGainR.gain.value = 1;
    this.wetGainL.gain.value = 0;
    this.wetGainR.gain.value = 0;

    // Sum nodes per ear
    this.sumGainL = ctx.createGain();
    this.sumGainR = ctx.createGain();

    // Wire dry → sum
    this.dryGainL.connect(this.sumGainL);
    this.dryGainR.connect(this.sumGainR);

    // Spatializer (HRTF binaural positioning)
    this.spatializer = new Spatializer(ctx);

    // Pitch shifters (AudioWorklet granular)
    this.pitchShifterL = PitchShifter.create(ctx);
    this.pitchShifterR = PitchShifter.create(ctx);

    // Wire spatializer outputs → pitch shifter inputs
    this.spatializer.directGainL.connect(this.pitchShifterL.input);
    this.spatializer.directGainR.connect(this.pitchShifterR.input);
    this.spatializer.spatGainL.connect(this.pitchShifterL.input);
    this.spatializer.spatGainR.connect(this.pitchShifterR.input);

    // Phase smear processors
    this.phaseSmearL = new PhaseSmearProcessor(ctx);
    this.phaseSmearR = new PhaseSmearProcessor(ctx);

    // Wire persistent paths: pitchShifter output → dry + wet (phaseSmear)
    // Source → spatializer paths is connected at play time
    this.pitchShifterL.output.connect(this.dryGainL);
    this.pitchShifterL.output.connect(this.phaseSmearL.input);
    this.pitchShifterR.output.connect(this.dryGainR);
    this.pitchShifterR.output.connect(this.phaseSmearR.input);

    // PhaseSmear output → wetGain → sum
    this.phaseSmearL.output.connect(this.wetGainL);
    this.phaseSmearR.output.connect(this.wetGainR);
    this.wetGainL.connect(this.sumGainL);
    this.wetGainR.connect(this.sumGainR);

    // Analysers per ear
    this.analyserL = ctx.createAnalyser();
    this.analyserL.fftSize = 2048;
    this.analyserR = ctx.createAnalyser();
    this.analyserR.fftSize = 2048;

    this.sumGainL.connect(this.analyserL);
    this.sumGainR.connect(this.analyserR);

    // Channel merger (2 channels → stereo)
    this.merger = ctx.createChannelMerger(2);
    this.analyserL.connect(this.merger, 0, 0);
    this.analyserR.connect(this.merger, 0, 1);

    // Binaural beat generator
    this.binauralBeat = new BinauralBeatGenerator(ctx);
    this.binauralBeat.connectToMerger(this.merger);

    // Compressor (limiter settings)
    this.compressor = ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -3;
    this.compressor.knee.value = 0;
    this.compressor.ratio.value = 20;
    this.compressor.attack.value = 0.001;
    this.compressor.release.value = 0.05;

    // Compressor bypass gain
    this.compressorBypass = ctx.createGain();

    // Safety gain (never above 1.0)
    this.safetyGain = ctx.createGain();
    this.safetyGain.gain.value = 1.0;

    // Master gain
    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = 0.8;

    // Master analyser
    this.analyserMaster = ctx.createAnalyser();
    this.analyserMaster.fftSize = 2048;

    // Wire output chain
    this.merger.connect(this.compressor);
    this.compressor.connect(this.safetyGain);
    // Also connect bypass path (disabled by default)
    this.merger.connect(this.compressorBypass);
    this.compressorBypass.gain.value = 0;

    this.safetyGain.connect(this.masterGain);
    this.compressorBypass.connect(this.masterGain);
    this.masterGain.connect(this.analyserMaster);
    this.analyserMaster.connect(ctx.destination);
  }

  /**
   * Load and decode an audio file. Extracts mono L/R buffers.
   */
  async loadFile(file) {
    if (!this.ctx) await this.init();

    // Stop any current playback
    if (this.playing) this.stop();
    this.pauseOffset = 0;

    const arrayBuffer = await file.arrayBuffer();
    const audioBuffer = await this.ctx.decodeAudioData(arrayBuffer);

    this.duration = audioBuffer.duration;

    // Extract mono L and R buffers
    const length = audioBuffer.length;
    const sampleRate = audioBuffer.sampleRate;

    this.bufferL = this.ctx.createBuffer(1, length, sampleRate);
    this.bufferR = this.ctx.createBuffer(1, length, sampleRate);

    const sourceDataL = audioBuffer.getChannelData(0);
    // Use channel 1 if stereo, otherwise duplicate channel 0
    const sourceDataR = audioBuffer.numberOfChannels > 1
      ? audioBuffer.getChannelData(1)
      : sourceDataL;

    this.bufferL.copyToChannel(sourceDataL, 0);
    this.bufferR.copyToChannel(sourceDataR, 0);

    return {
      name: file.name,
      duration: audioBuffer.duration,
      channels: audioBuffer.numberOfChannels,
      sampleRate: audioBuffer.sampleRate,
    };
  }

  /**
   * Start or resume playback from a given offset.
   */
  play(offset = 0) {
    if (!this.bufferL || !this.bufferR) return;
    if (this.playing) return;

    // Resume context if suspended (autoplay policy)
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }

    // Create fresh source nodes (no detune — pitch shifter handles it)
    this.sourceL = this.ctx.createBufferSource();
    this.sourceL.buffer = this.bufferL;
    this.sourceL.loop = this.loop;

    this.sourceR = this.ctx.createBufferSource();
    this.sourceR.buffer = this.bufferR;
    this.sourceR.loop = this.loop;

    // Connect sources to spatializer paths (both direct and spatial always wired)
    this.sourceL.connect(this.spatializer.directGainL);
    this.sourceR.connect(this.spatializer.directGainR);
    this.sourceL.connect(this.spatializer.inputMerger, 0, 0);
    this.sourceR.connect(this.spatializer.inputMerger, 0, 1);

    // When walking mode is active, also connect sources to speaker array
    if (this._speakerArray) {
      this.sourceL.connect(this._speakerArray.getInputMerger(), 0, 0);
      this.sourceR.connect(this._speakerArray.getInputMerger(), 0, 1);
    }

    // Handle end of playback — fire when either source ends
    const onEnded = () => {
      if (this.playing && !this.loop) {
        this._stopSources();
        this.playing = false;
        this.pauseOffset = 0;
        if (this.onPlaybackEnded) this.onPlaybackEnded();
      }
    };
    this.sourceL.onended = onEnded;
    this.sourceR.onended = onEnded;

    // Start both sources at the same time
    const now = this.ctx.currentTime;
    this.sourceL.start(now, offset);
    this.sourceR.start(now, offset);

    this.startTime = now;
    this.pauseOffset = offset;
    this.playing = true;
  }

  /**
   * Pause playback, saving current position.
   */
  pause() {
    if (!this.playing) return;

    this.pauseOffset = this.getCurrentTime();
    this._stopSources();
    this.playing = false;
  }

  /**
   * Resume from paused position.
   */
  resume() {
    if (this.playing) return;
    this.play(this.pauseOffset);
  }

  /**
   * Stop playback and reset to beginning.
   */
  stop() {
    this._stopSources();
    this.playing = false;
    this.pauseOffset = 0;
  }

  /**
   * Seek to a specific time.
   */
  seek(time) {
    time = Math.max(0, Math.min(time, this.duration));
    if (this.playing) {
      this._stopSources();
      this.playing = false;
      this.play(time);
    } else {
      this.pauseOffset = time;
    }
  }

  /**
   * Get current playback time.
   */
  getCurrentTime() {
    if (!this.playing) return this.pauseOffset;
    let elapsed = this.pauseOffset + (this.ctx.currentTime - this.startTime);
    if (this.loop && this.duration > 0) {
      elapsed = elapsed % this.duration;
    }
    return Math.min(elapsed, this.duration);
  }

  /**
   * Set detune for a specific ear.
   * @param {'L'|'R'} ear
   * @param {number} cents
   */
  setDetune(ear, cents) {
    if (ear === 'L') {
      this.detuneL = cents;
      if (this.pitchShifterL) this.pitchShifterL.setCents(cents);
    } else {
      this.detuneR = cents;
      if (this.pitchShifterR) this.pitchShifterR.setCents(cents);
    }
  }

  /**
   * Set dry/wet mix with equal-power crossfade.
   * @param {number} value 0 (fully dry) to 1 (fully wet)
   */
  setDryWetMix(value) {
    this.dryWetMix = value;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const dryLevel = Math.cos(value * Math.PI / 2);
    const wetLevel = Math.sin(value * Math.PI / 2);

    this.dryGainL.gain.setTargetAtTime(dryLevel, t, 0.02);
    this.dryGainR.gain.setTargetAtTime(dryLevel, t, 0.02);
    this.wetGainL.gain.setTargetAtTime(wetLevel, t, 0.02);
    this.wetGainR.gain.setTargetAtTime(wetLevel, t, 0.02);
  }

  /**
   * Set master volume (0–1).
   */
  setMasterVolume(value) {
    if (!this.ctx) return;
    this.masterGain.gain.setTargetAtTime(value, this.ctx.currentTime, 0.02);
  }

  /**
   * Set loop mode.
   */
  setLoop(enabled) {
    this.loop = enabled;
    if (this.sourceL) this.sourceL.loop = enabled;
    if (this.sourceR) this.sourceR.loop = enabled;
  }

  /**
   * Enable/disable compressor (limiter).
   */
  setCompressorActive(active) {
    this.compressorActive = active;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (active) {
      this.safetyGain.gain.setTargetAtTime(1, t, 0.02);
      this.compressorBypass.gain.setTargetAtTime(0, t, 0.02);
    } else {
      this.safetyGain.gain.setTargetAtTime(0, t, 0.02);
      this.compressorBypass.gain.setTargetAtTime(1, t, 0.02);
    }
  }

  /**
   * Enable/disable HRTF spatial positioning.
   */
  setSpatialActive(active) {
    this.spatialActive = active;
    if (this.spatializer) this.spatializer.setActive(active);
  }

  /**
   * Set 3D position for spatial audio source.
   */
  setSpatialPosition(x, y, z) {
    if (this.spatializer) this.spatializer.setPosition(x, y, z);
  }

  /**
   * Expose AudioContext for walking mode.
   */
  getContext() {
    return this.ctx;
  }

  /**
   * Get the hallway reverb processor (only exists when walking mode is active).
   */
  getHallwayReverb() {
    return this._hallwayReverb;
  }

  /**
   * Connect a SpeakerArray for walking mode.
   * Mutes existing spatializer and routes speaker array output into pitch shifters.
   */
  connectSpeakerArray(speakerArray) {
    this._speakerArray = speakerArray;
    if (!this.ctx) return;

    const t = this.ctx.currentTime;

    // Mute existing spatializer paths (both direct and spatial)
    this.spatializer.directGainL.gain.setTargetAtTime(0, t, 0.02);
    this.spatializer.directGainR.gain.setTargetAtTime(0, t, 0.02);
    this.spatializer.spatGainL.gain.setTargetAtTime(0, t, 0.02);
    this.spatializer.spatGainR.gain.setTargetAtTime(0, t, 0.02);

    // Create hallway reverb and insert between speaker array and pitch shifters
    this._hallwayReverb = new HallwayReverb(this.ctx);
    speakerArray.getOutputL().connect(this._hallwayReverb.inputL);
    speakerArray.getOutputR().connect(this._hallwayReverb.inputR);
    this._hallwayReverb.outputL.connect(this.pitchShifterL.input);
    this._hallwayReverb.outputR.connect(this.pitchShifterR.input);

    // If currently playing, also connect sources to speaker array input
    if (this.sourceL && this.sourceR) {
      this.sourceL.connect(speakerArray.getInputMerger(), 0, 0);
      this.sourceR.connect(speakerArray.getInputMerger(), 0, 1);
    }
  }

  /**
   * Disconnect speaker array and restore normal spatializer routing.
   */
  disconnectSpeakerArray() {
    if (!this._speakerArray) return;
    const t = this.ctx.currentTime;

    // Disconnect hallway reverb
    if (this._hallwayReverb) {
      try { this._speakerArray.getOutputL().disconnect(this._hallwayReverb.inputL); } catch (_) {}
      try { this._speakerArray.getOutputR().disconnect(this._hallwayReverb.inputR); } catch (_) {}
      try { this._hallwayReverb.outputL.disconnect(this.pitchShifterL.input); } catch (_) {}
      try { this._hallwayReverb.outputR.disconnect(this.pitchShifterR.input); } catch (_) {}
      this._hallwayReverb.dispose();
      this._hallwayReverb = null;
    }

    // Disconnect sources from speaker array input merger
    if (this.sourceL) {
      try { this.sourceL.disconnect(this._speakerArray.getInputMerger()); } catch (_) {}
    }
    if (this.sourceR) {
      try { this.sourceR.disconnect(this._speakerArray.getInputMerger()); } catch (_) {}
    }

    this._speakerArray = null;

    // Restore spatializer gains based on current spatial active state
    if (this.spatialActive) {
      this.spatializer.directGainL.gain.setTargetAtTime(0, t, 0.02);
      this.spatializer.directGainR.gain.setTargetAtTime(0, t, 0.02);
      this.spatializer.spatGainL.gain.setTargetAtTime(1, t, 0.02);
      this.spatializer.spatGainR.gain.setTargetAtTime(1, t, 0.02);
    } else {
      this.spatializer.directGainL.gain.setTargetAtTime(1, t, 0.02);
      this.spatializer.directGainR.gain.setTargetAtTime(1, t, 0.02);
      this.spatializer.spatGainL.gain.setTargetAtTime(0, t, 0.02);
      this.spatializer.spatGainR.gain.setTargetAtTime(0, t, 0.02);
    }

    // Reset listener to default position/orientation
    const listener = this.ctx.listener;
    if (listener.positionX) {
      listener.positionX.setValueAtTime(0, t);
      listener.positionY.setValueAtTime(0, t);
      listener.positionZ.setValueAtTime(0, t);
      listener.forwardX.setValueAtTime(0, t);
      listener.forwardY.setValueAtTime(0, t);
      listener.forwardZ.setValueAtTime(-1, t);
      listener.upX.setValueAtTime(0, t);
      listener.upY.setValueAtTime(1, t);
      listener.upZ.setValueAtTime(0, t);
    } else {
      listener.setPosition(0, 0, 0);
      listener.setOrientation(0, 0, -1, 0, 1, 0);
    }
  }

  /**
   * Internal: stop and disconnect source nodes.
   */
  _stopSources() {
    if (this.sourceL) {
      this.sourceL.onended = null;
      try { this.sourceL.stop(); } catch (_) {}
      this.sourceL.disconnect();
      this.sourceL = null;
    }
    if (this.sourceR) {
      this.sourceR.onended = null;
      try { this.sourceR.stop(); } catch (_) {}
      this.sourceR.disconnect();
      this.sourceR = null;
    }
  }
}
