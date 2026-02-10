/**
 * PitchShifterProcessor — FFT-based phase vocoder pitch shifter.
 *
 * Based on the Bernsee smbPitchShift algorithm. Shifts pitch in the frequency
 * domain without changing playback speed. Clean output with no comb filtering.
 *
 * Latency: FFT_SIZE - HOP samples (~32ms at 48kHz with current settings).
 */

const FFT_SIZE = 2048;
const HALF = FFT_SIZE / 2;
const OSAMP = 4;               // 75% overlap
const HOP = FFT_SIZE / OSAMP;  // 512
const LATENCY = FFT_SIZE - HOP; // 1536

class PitchShifterProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{
      name: 'pitchCents',
      defaultValue: 0,
      minValue: -1200,
      maxValue: 1200,
      automationRate: 'k-rate',
    }];
  }

  constructor() {
    super();

    // I/O FIFOs
    this.inFifo = new Float32Array(FFT_SIZE);
    this.outFifo = new Float32Array(FFT_SIZE);
    this.rover = LATENCY;

    // Overlap-add accumulator
    this.outAccum = new Float32Array(2 * FFT_SIZE);

    // FFT work arrays
    this.re = new Float32Array(FFT_SIZE);
    this.im = new Float32Array(FFT_SIZE);

    // Phase vocoder state (Float64 for long-playback precision)
    this.lastPhase = new Float64Array(HALF + 1);
    this.sumPhase = new Float64Array(HALF + 1);

    // Pre-allocated per-frame arrays
    this.anaMag = new Float32Array(HALF + 1);
    this.anaFreq = new Float32Array(HALF + 1);
    this.synMag = new Float32Array(HALF + 1);
    this.synFreq = new Float32Array(HALF + 1);

    // Hann window
    this.win = new Float32Array(FFT_SIZE);
    for (let i = 0; i < FFT_SIZE; i++) {
      this.win[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / FFT_SIZE));
    }
  }

  process(inputs, outputs, parameters) {
    if (!inputs[0]?.[0]?.length) {
      outputs[0]?.[0]?.fill(0);
      return true;
    }

    const inCh = inputs[0][0];
    const outCh = outputs[0][0];
    const cents = parameters.pitchCents[0];

    // Bypass at 0 cents (no latency, no CPU)
    if (cents === 0) {
      outCh.set(inCh);
      return true;
    }

    const shift = Math.pow(2, cents / 1200);

    for (let i = 0; i < inCh.length; i++) {
      this.inFifo[this.rover] = inCh[i];
      outCh[i] = this.outFifo[this.rover - LATENCY];
      this.rover++;

      if (this.rover >= FFT_SIZE) {
        this.rover = LATENCY;
        this._processFrame(shift);

        // Shift input FIFO: keep last LATENCY samples
        for (let k = 0; k < LATENCY; k++) {
          this.inFifo[k] = this.inFifo[k + HOP];
        }

        // Copy HOP output samples from accumulator
        for (let k = 0; k < HOP; k++) {
          this.outFifo[k] = this.outAccum[k];
        }

        // Shift accumulator left by HOP, zero the freed tail
        this.outAccum.copyWithin(0, HOP);
        this.outAccum.fill(0, FFT_SIZE);
      }
    }

    return true;
  }

  _processFrame(shift) {
    const re = this.re;
    const im = this.im;

    // Window input into FFT buffer
    for (let k = 0; k < FFT_SIZE; k++) {
      re[k] = this.inFifo[k] * this.win[k];
      im[k] = 0;
    }

    this._fft(re, im);

    // --- Analysis: extract magnitude + true frequency per bin ---
    const expct = 2 * Math.PI * HOP / FFT_SIZE;

    for (let k = 0; k <= HALF; k++) {
      const mag = 2 * Math.sqrt(re[k] * re[k] + im[k] * im[k]);
      const phase = Math.atan2(im[k], re[k]);

      // Phase difference from last frame
      let dp = phase - this.lastPhase[k];
      this.lastPhase[k] = phase;

      // Subtract expected phase advance for this bin
      dp -= k * expct;

      // Wrap to [-PI, PI]
      dp = dp - Math.round(dp / (2 * Math.PI)) * 2 * Math.PI;

      // True frequency of this bin (in bin units)
      this.anaFreq[k] = k + dp * OSAMP / (2 * Math.PI);
      this.anaMag[k] = mag;
    }

    // --- Pitch shift: remap bins ---
    this.synMag.fill(0);
    this.synFreq.fill(0);

    for (let k = 0; k <= HALF; k++) {
      const target = Math.round(k * shift);
      if (target <= HALF) {
        this.synMag[target] += this.anaMag[k];
        this.synFreq[target] = this.anaFreq[k] * shift;
      }
    }

    // --- Synthesis: rebuild complex spectrum from shifted bins ---
    for (let k = 0; k <= HALF; k++) {
      // Convert frequency back to phase increment
      let dp = this.synFreq[k] - k;
      dp = 2 * Math.PI * dp / OSAMP;
      dp += k * expct;

      this.sumPhase[k] += dp;
      const ph = this.sumPhase[k];

      re[k] = this.synMag[k] * Math.cos(ph);
      im[k] = this.synMag[k] * Math.sin(ph);
    }

    // Zero negative frequencies (Bernsee convention — take real part of IFFT)
    for (let k = HALF + 1; k < FFT_SIZE; k++) {
      re[k] = 0;
      im[k] = 0;
    }

    // Inverse FFT via conjugate trick (unnormalized)
    for (let k = 0; k < FFT_SIZE; k++) im[k] = -im[k];
    this._fft(re, im);

    // Window + normalize + overlap-add
    // 2 / (HALF * OSAMP) compensates for the 2x magnitude, analysis window,
    // and overlap. No 1/N — our FFT is unnormalized, matching Bernsee.
    for (let k = 0; k < FFT_SIZE; k++) {
      this.outAccum[k] += 2.0 * this.win[k] * re[k] / (HALF * OSAMP);
    }
  }

  /** In-place radix-2 Cooley-Tukey FFT. */
  _fft(re, im) {
    const n = re.length;

    // Bit-reversal permutation
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      while (j & bit) { j ^= bit; bit >>= 1; }
      j ^= bit;
      if (i < j) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }

    // Butterfly stages
    for (let len = 2; len <= n; len <<= 1) {
      const half = len >> 1;
      const ang = -2 * Math.PI / len;
      const wRe = Math.cos(ang);
      const wIm = Math.sin(ang);

      for (let i = 0; i < n; i += len) {
        let cRe = 1, cIm = 0;
        for (let j = 0; j < half; j++) {
          const a = i + j;
          const b = a + half;
          const tRe = re[b] * cRe - im[b] * cIm;
          const tIm = re[b] * cIm + im[b] * cRe;
          re[b] = re[a] - tRe;
          im[b] = im[a] - tIm;
          re[a] += tRe;
          im[a] += tIm;
          const nRe = cRe * wRe - cIm * wIm;
          cIm = cRe * wIm + cIm * wRe;
          cRe = nRe;
        }
      }
    }
  }
}

registerProcessor('pitch-shifter-processor', PitchShifterProcessor);
