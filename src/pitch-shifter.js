/**
 * PitchShifter — wrapper around the pitch-shifter AudioWorklet.
 * Provides input/output GainNodes for clean patching into the signal graph.
 */
export class PitchShifter {
  constructor(ctx, workletNode) {
    this.ctx = ctx;
    this.workletNode = workletNode;

    // Input / output gain nodes for clean patching
    this.input = ctx.createGain();
    this.output = ctx.createGain();

    // Wire: input → worklet → output
    this.input.connect(this.workletNode);
    this.workletNode.connect(this.output);

    // Keep a reference to the pitchCents AudioParam
    this.centsParam = this.workletNode.parameters.get('pitchCents');
  }

  /**
   * Register the worklet module with the given AudioContext.
   * Call once before creating any PitchShifter instances.
   */
  static async register(ctx) {
    const url = new URL('./pitch-shifter-worklet.js', import.meta.url);
    await ctx.audioWorklet.addModule(url);
  }

  /**
   * Create a new PitchShifter instance.
   */
  static create(ctx) {
    const workletNode = new AudioWorkletNode(ctx, 'pitch-shifter-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    return new PitchShifter(ctx, workletNode);
  }

  /**
   * Set the pitch shift in cents with a smooth ramp.
   */
  setCents(cents) {
    this.centsParam.setTargetAtTime(cents, this.ctx.currentTime, 0.02);
  }

  /**
   * Disconnect all internal nodes.
   */
  dispose() {
    this.input.disconnect();
    this.workletNode.disconnect();
    this.output.disconnect();
  }
}
