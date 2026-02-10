/**
 * Visualizer — renders waveform and spectrum canvases for L/R channels.
 */
export class Visualizer {
  constructor() {
    this.waveCanvas = document.getElementById('canvas-waveform');
    this.specCanvas = document.getElementById('canvas-spectrum');
    this.waveCtx = this.waveCanvas.getContext('2d');
    this.specCtx = this.specCanvas.getContext('2d');

    this.analyserL = null;
    this.analyserR = null;
    this.analyserMaster = null;

    this.running = false;
    this.animId = null;

    // Colors
    this.colorL = '#e94560';
    this.colorR = '#4ecca3';
    this.colorBg = '#1a1a2e';
    this.colorGrid = '#2a2a4a';

    // Defer initial resize until start() when canvases are visible
    window.addEventListener('resize', () => {
      if (this.running) this._resizeCanvases();
    });
  }

  /**
   * Set analyser nodes from the audio engine.
   */
  setAnalysers(l, r, master) {
    this.analyserL = l;
    this.analyserR = r;
    this.analyserMaster = master;
  }

  /**
   * Start the animation loop.
   */
  start() {
    if (this.running) return;
    this.running = true;
    this._resizeCanvases();
    this._draw();
  }

  /**
   * Stop the animation loop.
   */
  stop() {
    this.running = false;
    if (this.animId) {
      cancelAnimationFrame(this.animId);
      this.animId = null;
    }
  }

  /**
   * DPI-aware canvas resize.
   */
  _resizeCanvases() {
    const dpr = window.devicePixelRatio || 1;

    for (const canvas of [this.waveCanvas, this.specCanvas]) {
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // reset + scale in one call
    }
  }

  /**
   * Main draw loop.
   */
  _draw() {
    if (!this.running) return;

    this._drawWaveform();
    this._drawSpectrum();

    this.animId = requestAnimationFrame(() => this._draw());
  }

  /**
   * Draw waveform: L channel above center (red), R channel below center (teal).
   */
  _drawWaveform() {
    const ctx = this.waveCtx;
    const canvas = this.waveCanvas;
    const w = canvas.getBoundingClientRect().width;
    const h = canvas.getBoundingClientRect().height;

    ctx.fillStyle = this.colorBg;
    ctx.fillRect(0, 0, w, h);

    // Center line
    ctx.strokeStyle = this.colorGrid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();

    if (!this.analyserL || !this.analyserR) return;

    const bufferLength = this.analyserL.fftSize;
    const dataL = new Float32Array(bufferLength);
    const dataR = new Float32Array(bufferLength);
    this.analyserL.getFloatTimeDomainData(dataL);
    this.analyserR.getFloatTimeDomainData(dataR);

    const sliceWidth = w / bufferLength;

    // Draw L channel (slightly above center)
    ctx.strokeStyle = this.colorL;
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    for (let i = 0; i < bufferLength; i++) {
      const x = i * sliceWidth;
      const y = (h / 2) - dataL[i] * (h / 2) * 0.85;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Draw R channel (slightly below center, inverted to mirror)
    ctx.strokeStyle = this.colorR;
    ctx.beginPath();
    for (let i = 0; i < bufferLength; i++) {
      const x = i * sliceWidth;
      const y = (h / 2) + dataR[i] * (h / 2) * 0.85;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  /**
   * Draw spectrum: L bars grow up from center, R bars grow down.
   */
  _drawSpectrum() {
    const ctx = this.specCtx;
    const canvas = this.specCanvas;
    const w = canvas.getBoundingClientRect().width;
    const h = canvas.getBoundingClientRect().height;

    ctx.fillStyle = this.colorBg;
    ctx.fillRect(0, 0, w, h);

    // Center line
    ctx.strokeStyle = this.colorGrid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();

    if (!this.analyserL || !this.analyserR) return;

    const bufferLength = this.analyserL.frequencyBinCount;
    const dataL = new Uint8Array(bufferLength);
    const dataR = new Uint8Array(bufferLength);
    this.analyserL.getByteFrequencyData(dataL);
    this.analyserR.getByteFrequencyData(dataR);

    // Use a subset of bins for visual clarity
    const barCount = Math.min(128, bufferLength);
    const step = Math.floor(bufferLength / barCount);
    const barWidth = (w / barCount) * 0.8;
    const gap = (w / barCount) * 0.2;
    const halfH = h / 2;

    for (let i = 0; i < barCount; i++) {
      const idx = i * step;
      const x = i * (barWidth + gap);

      // L bars (upward from center)
      const heightL = (dataL[idx] / 255) * halfH * 0.9;
      ctx.fillStyle = this.colorL;
      ctx.globalAlpha = 0.8;
      ctx.fillRect(x, halfH - heightL, barWidth, heightL);

      // R bars (downward from center)
      const heightR = (dataR[idx] / 255) * halfH * 0.9;
      ctx.fillStyle = this.colorR;
      ctx.fillRect(x, halfH, barWidth, heightR);
    }
    ctx.globalAlpha = 1;
  }
}
