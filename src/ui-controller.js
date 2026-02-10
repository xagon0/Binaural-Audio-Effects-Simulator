/**
 * UIController — bridges DOM controls to AudioEngine and Visualizer.
 */
export class UIController {
  constructor(engine, visualizer) {
    this.engine = engine;
    this.vis = visualizer;
    this.isSeeking = false;
    this.updateInterval = null;
    this.fileLoaded = false;
    this.binauralInitialized = false;
    this.spatialDragging = false;
    this.spatialNormX = 0;
    this.spatialNormY = 0;
    this.spatialElevation = 0;

    // Walking mode
    this.walkingMode = null;

    this._cacheElements();
    this._bindFileHandling();
    this._bindTransport();
    this._bindDetune();
    this._bindPhaseSmear();
    this._bindBinauralBeat();
    this._bindSpatial();
    this._bindOutput();
    this._bindPresets();
    this._bindKeyboard();
    this._bindModeToggle();
  }

  /**
   * Set walking mode instance (called from main.js).
   */
  setWalkingMode(walkingMode) {
    this.walkingMode = walkingMode;
  }

  // ─── Element caching ───

  _cacheElements() {
    this.el = {
      dropZone: document.getElementById('drop-zone'),
      dropError: document.getElementById('drop-zone-error'),
      fileInput: document.getElementById('file-input'),
      filePickBtn: document.getElementById('file-pick-btn'),
      fileInfo: document.getElementById('file-info'),
      fileName: document.getElementById('file-name'),
      fileDuration: document.getElementById('file-duration'),
      transport: document.getElementById('transport'),
      btnPlay: document.getElementById('btn-play'),
      btnPause: document.getElementById('btn-pause'),
      btnStop: document.getElementById('btn-stop'),
      seekBar: document.getElementById('seek-bar'),
      timeDisplay: document.getElementById('time-display'),
      btnLoop: document.getElementById('btn-loop'),
      controls: document.getElementById('controls'),
      presets: document.getElementById('presets'),
      visualization: document.getElementById('visualization'),
      smearIndicator: document.getElementById('smear-indicator'),
      // Detune
      detuneL: document.getElementById('detune-l'),
      detuneR: document.getElementById('detune-r'),
      detuneLVal: document.getElementById('detune-l-val'),
      detuneRVal: document.getElementById('detune-r-val'),
      detuneLink: document.getElementById('detune-link'),
      detuneLinkMode: document.getElementById('detune-link-mode'),
      // Smear
      smearDepth: document.getElementById('smear-depth'),
      smearDepthVal: document.getElementById('smear-depth-val'),
      smearRate: document.getElementById('smear-rate'),
      smearRateVal: document.getElementById('smear-rate-val'),
      smearIndependent: document.getElementById('smear-independent'),
      smearIndependentControls: document.getElementById('smear-independent-controls'),
      smearRateL: document.getElementById('smear-rate-l'),
      smearRateLVal: document.getElementById('smear-rate-l-val'),
      smearRateR: document.getElementById('smear-rate-r'),
      smearRateRVal: document.getElementById('smear-rate-r-val'),
      // Binaural
      binauralTones: document.getElementById('binaural-tones'),
      binauralAddTone: document.getElementById('binaural-add-tone'),
      // Spatial
      spatialActive: document.getElementById('spatial-active'),
      spatialPad: document.getElementById('spatial-pad'),
      spatialAzimuth: document.getElementById('spatial-azimuth'),
      spatialDistance: document.getElementById('spatial-distance'),
      spatialElevSlider: document.getElementById('spatial-elev'),
      spatialElevVal: document.getElementById('spatial-elev-val'),
      spatialX: document.getElementById('spatial-x'),
      spatialZ: document.getElementById('spatial-z'),
      // Output
      masterVol: document.getElementById('master-vol'),
      masterVolVal: document.getElementById('master-vol-val'),
      dryWet: document.getElementById('dry-wet'),
      dryWetVal: document.getElementById('dry-wet-val'),
      compressorActive: document.getElementById('compressor-active'),
    };
  }

  // ─── File handling ───

  _bindFileHandling() {
    const dz = this.el.dropZone;

    // Click to pick
    this.el.filePickBtn.addEventListener('click', () => this.el.fileInput.click());
    this.el.fileInput.addEventListener('change', (e) => {
      if (e.target.files.length) this._handleFile(e.target.files[0]);
    });

    // Drag and drop
    dz.addEventListener('dragover', (e) => {
      e.preventDefault();
      dz.classList.add('drag-over');
    });
    dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
    dz.addEventListener('drop', (e) => {
      e.preventDefault();
      dz.classList.remove('drag-over');
      const file = e.dataTransfer.files[0];
      if (file) this._handleFile(file);
    });
  }

  async _handleFile(file) {
    // Validate audio MIME (fall back to extension if type is empty)
    const audioExts = ['.mp3', '.wav', '.ogg', '.flac', '.aac', '.m4a', '.webm'];
    const hasAudioType = file.type && file.type.startsWith('audio/');
    const hasAudioExt = audioExts.some((ext) => file.name.toLowerCase().endsWith(ext));
    if (!hasAudioType && !hasAudioExt) {
      this._showError('Please drop an audio file (MP3, WAV, OGG, FLAC).');
      return;
    }

    // Size warning (shown but does not block loading)
    if (file.size > 50 * 1024 * 1024) {
      this._showError('Large file (>50MB). Loading may take a moment...');
    } else {
      this._showError('');
    }

    try {
      // Init engine on first interaction (autoplay policy)
      await this.engine.init();

      const info = await this.engine.loadFile(file);

      // Setup visualizer
      this.vis.setAnalysers(
        this.engine.analyserL,
        this.engine.analyserR,
        this.engine.analyserMaster
      );

      // Show file info
      this.el.fileName.textContent = info.name;
      this.el.fileDuration.textContent =
        `${this._formatTime(info.duration)} | ${info.channels}ch | ${info.sampleRate}Hz`;

      // Reveal hidden sections
      this.el.fileInfo.hidden = false;
      this.el.transport.hidden = false;
      this.el.controls.hidden = false;
      this.el.presets.hidden = false;
      this.el.visualization.hidden = false;

      // Reset transport UI
      this.el.seekBar.max = info.duration;
      this.el.seekBar.value = 0;
      this._updateTimeDisplay();

      // Set engine callback for playback end
      this.engine.onPlaybackEnded = () => this._onPlaybackEnded();

      this.fileLoaded = true;

      // Add default binaural tone on first file load
      if (!this.binauralInitialized) {
        this._addBinauralToneRow();
        this.binauralInitialized = true;
      }

      // Redraw spatial pad now that controls are visible
      requestAnimationFrame(() => this._drawSpatialPad());

      // Start visualizer
      this.vis.start();
    } catch (err) {
      this._showError(`Error decoding audio: ${err.message}`);
    }
  }

  _showError(msg) {
    this.el.dropError.textContent = msg;
    this.el.dropError.hidden = !msg;
  }

  // ─── Transport ───

  _bindTransport() {
    this.el.btnPlay.addEventListener('click', () => this._play());
    this.el.btnPause.addEventListener('click', () => this._pause());
    this.el.btnStop.addEventListener('click', () => this._stop());

    // Seek bar — isSeeking prevents update interval from fighting with user drag
    this.el.seekBar.addEventListener('mousedown', () => { this.isSeeking = true; });
    this.el.seekBar.addEventListener('touchstart', () => { this.isSeeking = true; });
    document.addEventListener('mouseup', () => { this.isSeeking = false; });
    document.addEventListener('touchend', () => { this.isSeeking = false; });
    this.el.seekBar.addEventListener('input', () => {
      this._updateTimeDisplay();
    });
    this.el.seekBar.addEventListener('change', () => {
      this.isSeeking = false;
      this.engine.seek(parseFloat(this.el.seekBar.value));
    });

    // Loop
    this.el.btnLoop.addEventListener('click', () => this._toggleLoop());
  }

  _play() {
    if (!this.fileLoaded) return;
    if (this.engine.playing) return;
    this.engine.resume();
    this.el.btnPlay.hidden = true;
    this.el.btnPause.hidden = false;
    this._startUpdateInterval();
  }

  _pause() {
    this.engine.pause();
    this.el.btnPlay.hidden = false;
    this.el.btnPause.hidden = true;
    this._stopUpdateInterval();
  }

  _stop() {
    this.engine.stop();
    this.el.btnPlay.hidden = false;
    this.el.btnPause.hidden = true;
    this.el.seekBar.value = 0;
    this._updateTimeDisplay();
    this._stopUpdateInterval();
  }

  _toggleLoop() {
    const active = !this.engine.loop;
    this.engine.setLoop(active);
    this.el.btnLoop.classList.toggle('active', active);
  }

  _onPlaybackEnded() {
    this.el.btnPlay.hidden = false;
    this.el.btnPause.hidden = true;
    this.el.seekBar.value = 0;
    this._updateTimeDisplay();
    this._stopUpdateInterval();
  }

  _startUpdateInterval() {
    this._stopUpdateInterval();
    this.updateInterval = setInterval(() => {
      if (!this.isSeeking) {
        this.el.seekBar.value = this.engine.getCurrentTime();
        this._updateTimeDisplay();
      }
    }, 50);
  }

  _stopUpdateInterval() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }

  _updateTimeDisplay() {
    const current = this.isSeeking
      ? parseFloat(this.el.seekBar.value)
      : this.engine.getCurrentTime();
    this.el.timeDisplay.textContent =
      `${this._formatTime(current)} / ${this._formatTime(this.engine.duration)}`;
  }

  _formatTime(sec) {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  // ─── Detune ───

  _bindDetune() {
    this.el.detuneL.addEventListener('input', () => {
      const val = parseInt(this.el.detuneL.value);
      this.el.detuneLVal.textContent = val;
      this.engine.setDetune('L', val);

      if (this.el.detuneLink.checked) {
        this._applyLinkedDetune(val, 'L');
      }
    });

    this.el.detuneR.addEventListener('input', () => {
      const val = parseInt(this.el.detuneR.value);
      this.el.detuneRVal.textContent = val;
      this.engine.setDetune('R', val);

      if (this.el.detuneLink.checked) {
        this._applyLinkedDetune(val, 'R');
      }
    });

    this.el.detuneLink.addEventListener('change', () => {
      this.el.detuneLinkMode.disabled = !this.el.detuneLink.checked;
    });

    this.el.detuneLinkMode.addEventListener('change', () => {
      // Re-apply linking when mode changes
      if (this.el.detuneLink.checked) {
        this._applyLinkedDetune(parseInt(this.el.detuneL.value), 'L');
      }
    });
  }

  _applyLinkedDetune(val, source) {
    const mode = this.el.detuneLinkMode.value;
    if (mode === 'mirror') {
      if (source === 'L') {
        this.el.detuneR.value = -val;
        this.el.detuneRVal.textContent = -val;
        this.engine.setDetune('R', -val);
      } else {
        this.el.detuneL.value = -val;
        this.el.detuneLVal.textContent = -val;
        this.engine.setDetune('L', -val);
      }
    } else {
      // parallel
      if (source === 'L') {
        this.el.detuneR.value = val;
        this.el.detuneRVal.textContent = val;
        this.engine.setDetune('R', val);
      } else {
        this.el.detuneL.value = val;
        this.el.detuneLVal.textContent = val;
        this.engine.setDetune('L', val);
      }
    }
  }

  // ─── Phase Smear ───

  _bindPhaseSmear() {
    this.el.smearDepth.addEventListener('input', () => {
      const val = parseFloat(this.el.smearDepth.value);
      this.el.smearDepthVal.textContent = val.toFixed(2);
      this.engine.phaseSmearL.setDepth(val);
      this.engine.phaseSmearR.setDepth(val);
      // Show/hide smear indicator
      this.el.smearIndicator.hidden = val === 0;
    });

    this.el.smearRate.addEventListener('input', () => {
      const val = parseFloat(this.el.smearRate.value);
      this.el.smearRateVal.textContent = val.toFixed(1);
      if (!this.el.smearIndependent.checked) {
        this.engine.phaseSmearL.setRate(val);
        this.engine.phaseSmearR.setRate(val);
      }
    });

    this.el.smearIndependent.addEventListener('change', () => {
      const on = this.el.smearIndependent.checked;
      this.el.smearIndependentControls.hidden = !on;
      if (!on) {
        // Sync both to main rate
        const val = parseFloat(this.el.smearRate.value);
        this.engine.phaseSmearL.setRate(val);
        this.engine.phaseSmearR.setRate(val);
      }
    });

    this.el.smearRateL.addEventListener('input', () => {
      const val = parseFloat(this.el.smearRateL.value);
      this.el.smearRateLVal.textContent = val.toFixed(1);
      this.engine.phaseSmearL.setRate(val);
    });

    this.el.smearRateR.addEventListener('input', () => {
      const val = parseFloat(this.el.smearRateR.value);
      this.el.smearRateRVal.textContent = val.toFixed(1);
      this.engine.phaseSmearR.setRate(val);
    });
  }

  // ─── Binaural Beat ───

  _bindBinauralBeat() {
    this.el.binauralAddTone.addEventListener('click', () => {
      this._addBinauralToneRow({ active: true });
    });
  }

  // Log-scale mapping: slider 0–1000 → 10–10000 Hz
  _baseFreqFromSlider(val) {
    return Math.round(10 * Math.pow(10, (val / 1000) * 3));
  }

  _baseFreqToSlider(hz) {
    return Math.round(Math.log10(Math.max(hz, 10) / 10) * (1000 / 3));
  }

  // Log-scale mapping: slider 0–1000 → 0.1–100 Hz
  _beatDiffFromSlider(val) {
    return parseFloat((0.1 * Math.pow(10, (val / 1000) * 3)).toFixed(1));
  }

  _beatDiffToSlider(hz) {
    return Math.round(Math.log10(Math.max(hz, 0.1) / 0.1) * (1000 / 3));
  }

  _addBinauralToneRow(config = {}) {
    if (!this.engine.binauralBeat) return null;

    const { baseFreq = 200, beatDiff = 10, volume = 0.15, active = false } = config;

    // Compute slider positions and round-trip values so display matches engine
    const baseSlider = this._baseFreqToSlider(baseFreq);
    const diffSlider = this._beatDiffToSlider(beatDiff);
    const displayBase = this._baseFreqFromSlider(baseSlider);
    const displayDiff = this._beatDiffFromSlider(diffSlider);

    const toneId = this.engine.binauralBeat.addTone({
      baseFreq: displayBase, beatDiff: displayDiff, volume, active,
    });

    const row = document.createElement('div');
    row.className = 'binaural-tone';
    row.dataset.toneId = toneId;

    row.innerHTML = `
      <div class="tone-header">
        <label class="toggle-label">
          <input type="checkbox" class="tone-active" ${active ? 'checked' : ''} />
          <span class="tone-label">Tone</span>
        </label>
        <button class="btn btn-tone-remove" title="Remove tone">&times;</button>
      </div>
      <div class="control-row">
        <label>Base <span class="tone-base-val val-badge">${displayBase}</span> Hz</label>
        <input type="range" class="tone-base" min="0" max="1000" step="1" value="${baseSlider}" />
      </div>
      <div class="control-row">
        <label>Diff <span class="tone-diff-val val-badge">${displayDiff.toFixed(1)}</span> Hz</label>
        <input type="range" class="tone-diff" min="0" max="1000" step="1" value="${diffSlider}" />
      </div>
      <div class="control-row">
        <label>Vol <span class="tone-vol-val val-badge">${volume.toFixed(2)}</span></label>
        <input type="range" class="tone-vol" min="0" max="1" step="0.01" value="${volume}" />
      </div>
    `;

    const activeCheckbox = row.querySelector('.tone-active');
    const baseInput = row.querySelector('.tone-base');
    const baseVal = row.querySelector('.tone-base-val');
    const diffInput = row.querySelector('.tone-diff');
    const diffVal = row.querySelector('.tone-diff-val');
    const volInput = row.querySelector('.tone-vol');
    const volVal = row.querySelector('.tone-vol-val');
    const removeBtn = row.querySelector('.btn-tone-remove');

    activeCheckbox.addEventListener('change', () => {
      const tone = this.engine.binauralBeat.getTone(toneId);
      if (tone) tone.setActive(activeCheckbox.checked);
    });

    baseInput.addEventListener('input', () => {
      const hz = this._baseFreqFromSlider(parseInt(baseInput.value));
      baseVal.textContent = hz;
      const tone = this.engine.binauralBeat.getTone(toneId);
      if (tone) tone.setBaseFrequency(hz);
    });

    diffInput.addEventListener('input', () => {
      const hz = this._beatDiffFromSlider(parseInt(diffInput.value));
      diffVal.textContent = hz.toFixed(1);
      const tone = this.engine.binauralBeat.getTone(toneId);
      if (tone) tone.setBeatDifference(hz);
    });

    volInput.addEventListener('input', () => {
      const val = parseFloat(volInput.value);
      volVal.textContent = val.toFixed(2);
      const tone = this.engine.binauralBeat.getTone(toneId);
      if (tone) tone.setVolume(val);
    });

    removeBtn.addEventListener('click', () => {
      this.engine.binauralBeat.removeTone(toneId);
      row.remove();
      this._updateToneLabels();
    });

    this.el.binauralTones.appendChild(row);
    this._updateToneLabels();

    return toneId;
  }

  _clearBinauralTones() {
    if (this.engine.binauralBeat) {
      this.engine.binauralBeat.removeAllTones();
    }
    this.el.binauralTones.innerHTML = '';
  }

  _updateToneLabels() {
    const rows = this.el.binauralTones.querySelectorAll('.binaural-tone');
    rows.forEach((row, i) => {
      row.querySelector('.tone-label').textContent = `Tone ${i + 1}`;
    });
  }

  // ─── Spatial ───

  _bindSpatial() {
    this.el.spatialActive.addEventListener('change', () => {
      this.engine.setSpatialActive(this.el.spatialActive.checked);
      this._drawSpatialPad();
    });

    const pad = this.el.spatialPad;
    pad.addEventListener('pointerdown', (e) => {
      this.spatialDragging = true;
      pad.setPointerCapture(e.pointerId);
      this._handleSpatialPointer(e);
    });
    pad.addEventListener('pointermove', (e) => {
      if (!this.spatialDragging) return;
      this._handleSpatialPointer(e);
    });
    pad.addEventListener('pointerup', (e) => {
      this.spatialDragging = false;
      pad.releasePointerCapture(e.pointerId);
    });
    pad.addEventListener('pointercancel', (e) => {
      this.spatialDragging = false;
      try { pad.releasePointerCapture(e.pointerId); } catch (_) {}
    });

    // Elevation slider
    this.el.spatialElevSlider.addEventListener('input', () => {
      const val = parseFloat(this.el.spatialElevSlider.value);
      const sign = Math.sign(val);
      this.spatialElevation = sign * (Math.abs(val) ** 3) * 10;

      // Recompute current wx/wz from pad state
      const pixelDist = Math.sqrt(this.spatialNormX ** 2 + this.spatialNormY ** 2);
      const worldDist = (pixelDist ** 3) * 10;
      let wx = 0, wz = 0;
      if (pixelDist > 0.001) {
        wx = (this.spatialNormX / pixelDist) * worldDist;
        wz = (this.spatialNormY / pixelDist) * worldDist;
      }

      this.engine.setSpatialPosition(wx, this.spatialElevation, wz);
      this._updateSpatialReadout(wx, wz, worldDist);
    });

    // Initial draw
    this._drawSpatialPad();
  }

  _handleSpatialPointer(e) {
    const pad = this.el.spatialPad;
    const rect = pad.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    // Normalize to [-1, 1] from center
    const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const ny = ((e.clientY - rect.top) / rect.height) * 2 - 1;

    // Clamp to unit circle
    const len = Math.sqrt(nx * nx + ny * ny);
    if (len > 1) {
      this.spatialNormX = nx / len;
      this.spatialNormY = ny / len;
    } else {
      this.spatialNormX = nx;
      this.spatialNormY = ny;
    }

    // Power-curve distance mapping: fine control near center
    const pixelDist = Math.sqrt(this.spatialNormX ** 2 + this.spatialNormY ** 2);
    const worldDist = (pixelDist ** 3) * 10;

    // Direction: normalize to unit vector, scale by worldDist
    let wx = 0, wz = 0;
    if (pixelDist > 0.001) {
      wx = (this.spatialNormX / pixelDist) * worldDist;
      wz = (this.spatialNormY / pixelDist) * worldDist; // canvas up (neg Y) → -Z (front for default listener)
    }

    this.engine.setSpatialPosition(wx, this.spatialElevation, wz);
    this._drawSpatialPad();
    this._updateSpatialReadout(wx, wz, worldDist);
  }

  _drawSpatialPad() {
    const canvas = this.el.spatialPad;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const dpr = window.devicePixelRatio || 1;
    const w = rect.width;
    const h = rect.height;
    canvas.width = w * dpr;
    canvas.height = h * dpr;

    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const cx = w / 2;
    const cy = h / 2;
    const maxR = Math.min(cx, cy) - 8;

    // Background
    ctx.fillStyle = '#0d0d0f';
    ctx.fillRect(0, 0, w, h);

    const active = this.el.spatialActive.checked;
    const ringColor = active ? 'rgba(233,69,96,0.2)' : 'rgba(136,136,136,0.15)';
    const lineColor = active ? 'rgba(233,69,96,0.15)' : 'rgba(136,136,136,0.1)';
    const labelColor = active ? 'rgba(224,224,224,0.5)' : 'rgba(136,136,136,0.4)';

    // Distance rings
    ctx.strokeStyle = ringColor;
    ctx.lineWidth = 1;
    for (let i = 1; i <= 4; i++) {
      ctx.beginPath();
      ctx.arc(cx, cy, maxR * (i / 4), 0, Math.PI * 2);
      ctx.stroke();
    }

    // Crosshair
    ctx.strokeStyle = lineColor;
    ctx.beginPath();
    ctx.moveTo(cx, cy - maxR); ctx.lineTo(cx, cy + maxR);
    ctx.moveTo(cx - maxR, cy); ctx.lineTo(cx + maxR, cy);
    ctx.stroke();

    // Direction labels
    ctx.fillStyle = labelColor;
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Front', cx, cy - maxR - 4);
    ctx.fillText('Back', cx, cy + maxR + 13);
    ctx.textAlign = 'left';
    ctx.fillText('L', cx - maxR - 4, cy + 4);
    ctx.textAlign = 'right';
    ctx.fillText('R', cx + maxR + 4, cy + 4);

    // Head icon (small circle at center)
    ctx.fillStyle = active ? 'rgba(233,69,96,0.4)' : 'rgba(136,136,136,0.3)';
    ctx.beginPath();
    ctx.arc(cx, cy, 6, 0, Math.PI * 2);
    ctx.fill();
    // Nose indicator (small triangle pointing up = front)
    ctx.fillStyle = active ? 'rgba(233,69,96,0.6)' : 'rgba(136,136,136,0.4)';
    ctx.beginPath();
    ctx.moveTo(cx, cy - 10);
    ctx.lineTo(cx - 3, cy - 6);
    ctx.lineTo(cx + 3, cy - 6);
    ctx.closePath();
    ctx.fill();

    // Source dot
    const dotX = cx + this.spatialNormX * maxR;
    const dotY = cy + this.spatialNormY * maxR;

    // Connecting line
    ctx.strokeStyle = active ? 'rgba(233,69,96,0.3)' : 'rgba(136,136,136,0.2)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(dotX, dotY);
    ctx.stroke();

    // Dot
    ctx.fillStyle = active ? '#e94560' : '#888';
    ctx.beginPath();
    ctx.arc(dotX, dotY, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = active ? 'rgba(233,69,96,0.5)' : 'rgba(136,136,136,0.3)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(dotX, dotY, 11, 0, Math.PI * 2);
    ctx.stroke();
  }

  _updateSpatialReadout(wx, wz, dist) {
    const azimuth = Math.round(Math.atan2(wx, wz) * (180 / Math.PI));
    this.el.spatialAzimuth.textContent = azimuth;
    this.el.spatialDistance.textContent = dist.toFixed(1);
    this.el.spatialElevVal.textContent = this.spatialElevation.toFixed(1);
    this.el.spatialX.textContent = wx.toFixed(1);
    this.el.spatialZ.textContent = wz.toFixed(1);
  }

  // ─── Output ───

  _bindOutput() {
    this.el.masterVol.addEventListener('input', () => {
      const val = parseFloat(this.el.masterVol.value);
      this.el.masterVolVal.textContent = val.toFixed(2);
      this.engine.setMasterVolume(val);
    });

    this.el.dryWet.addEventListener('input', () => {
      const val = parseFloat(this.el.dryWet.value);
      this.el.dryWetVal.textContent = val.toFixed(2);
      this.engine.setDryWetMix(val);
    });

    this.el.compressorActive.addEventListener('change', () => {
      this.engine.setCompressorActive(this.el.compressorActive.checked);
    });
  }

  // ─── Presets ───

  _bindPresets() {
    const presets = {
      subtle: {
        detuneL: 8, detuneR: -8, detuneLink: true, detuneLinkMode: 'mirror',
        smearDepth: 0.2, smearRate: 1.5, smearIndependent: false,
        binauralTones: [],
        spatialActive: false,
        masterVol: 0.8, dryWet: 0.4, compressorActive: true,
      },
      full: {
        detuneL: 30, detuneR: -45, detuneLink: false, detuneLinkMode: 'mirror',
        smearDepth: 0.7, smearRate: 3.5, smearIndependent: true,
        smearRateL: 3.5, smearRateR: 5.0,
        binauralTones: [],
        spatialActive: false,
        masterVol: 0.8, dryWet: 0.8, compressorActive: true,
      },
      focus: {
        detuneL: 0, detuneR: 0, detuneLink: false, detuneLinkMode: 'mirror',
        smearDepth: 0, smearRate: 1.0, smearIndependent: false,
        binauralTones: [{ baseFreq: 200, beatDiff: 10, volume: 0.15, active: true }],
        spatialActive: false,
        masterVol: 0.8, dryWet: 0, compressorActive: true,
      },
    };

    document.querySelectorAll('.btn-preset').forEach((btn) => {
      btn.addEventListener('click', () => {
        const p = presets[btn.dataset.preset];
        if (p) this._applyPreset(p);
      });
    });
  }

  _applyPreset(p) {
    // Detune
    this.el.detuneL.value = p.detuneL;
    this.el.detuneR.value = p.detuneR;
    this.el.detuneLVal.textContent = p.detuneL;
    this.el.detuneRVal.textContent = p.detuneR;
    this.engine.setDetune('L', p.detuneL);
    this.engine.setDetune('R', p.detuneR);
    this.el.detuneLink.checked = p.detuneLink;
    this.el.detuneLinkMode.value = p.detuneLinkMode;
    this.el.detuneLinkMode.disabled = !p.detuneLink;

    // Smear
    this.el.smearDepth.value = p.smearDepth;
    this.el.smearDepthVal.textContent = p.smearDepth.toFixed(2);
    this.engine.phaseSmearL.setDepth(p.smearDepth);
    this.engine.phaseSmearR.setDepth(p.smearDepth);
    this.el.smearIndicator.hidden = p.smearDepth === 0;

    this.el.smearRate.value = p.smearRate;
    this.el.smearRateVal.textContent = p.smearRate.toFixed(1);

    this.el.smearIndependent.checked = p.smearIndependent;
    this.el.smearIndependentControls.hidden = !p.smearIndependent;

    if (p.smearIndependent) {
      const rateL = p.smearRateL || p.smearRate;
      const rateR = p.smearRateR || p.smearRate;
      this.el.smearRateL.value = rateL;
      this.el.smearRateLVal.textContent = rateL.toFixed(1);
      this.el.smearRateR.value = rateR;
      this.el.smearRateRVal.textContent = rateR.toFixed(1);
      this.engine.phaseSmearL.setRate(rateL);
      this.engine.phaseSmearR.setRate(rateR);
    } else {
      this.engine.phaseSmearL.setRate(p.smearRate);
      this.engine.phaseSmearR.setRate(p.smearRate);
    }

    // Binaural
    this._clearBinauralTones();
    if (p.binauralTones) {
      for (const t of p.binauralTones) {
        this._addBinauralToneRow(t);
      }
    }

    // Spatial
    if (p.spatialActive !== undefined) {
      this.el.spatialActive.checked = p.spatialActive;
      this.engine.setSpatialActive(p.spatialActive);
      if (!p.spatialActive) {
        this.spatialNormX = 0;
        this.spatialNormY = 0;
        this.spatialElevation = 0;
        this.el.spatialElevSlider.value = 0;
        this.engine.setSpatialPosition(0, 0, 0);
        this._updateSpatialReadout(0, 0, 0);
      }
      this._drawSpatialPad();
    }

    // Output
    this.el.masterVol.value = p.masterVol;
    this.el.masterVolVal.textContent = p.masterVol.toFixed(2);
    this.engine.setMasterVolume(p.masterVol);

    this.el.dryWet.value = p.dryWet;
    this.el.dryWetVal.textContent = p.dryWet.toFixed(2);
    this.engine.setDryWetMix(p.dryWet);

    this.el.compressorActive.checked = p.compressorActive;
    this.engine.setCompressorActive(p.compressorActive);
  }

  // ─── Keyboard shortcuts ───

  _bindKeyboard() {
    document.addEventListener('keydown', (e) => {
      // Don't trigger shortcuts when typing in inputs
      if (e.target.tagName === 'INPUT' && e.target.type !== 'range') return;
      if (e.target.tagName === 'SELECT') return;

      // In walking mode, skip keys that PlayerController handles
      if (this.walkingMode && this.walkingMode.active) {
        const walkingKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
          'KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft', 'ShiftRight'];
        if (walkingKeys.includes(e.code)) return;

        // Only allow L for loop toggle in walking mode
        if (e.code === 'KeyL') {
          this._toggleLoop();
          return;
        }
        return;
      }

      switch (e.code) {
        case 'Space':
          e.preventDefault();
          if (this.engine.playing) this._pause();
          else this._play();
          break;
        case 'KeyS':
          this._stop();
          break;
        case 'KeyL':
          this._toggleLoop();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          this.engine.seek(this.engine.getCurrentTime() - 5);
          this.el.seekBar.value = this.engine.getCurrentTime();
          this._updateTimeDisplay();
          break;
        case 'ArrowRight':
          e.preventDefault();
          this.engine.seek(this.engine.getCurrentTime() + 5);
          this.el.seekBar.value = this.engine.getCurrentTime();
          this._updateTimeDisplay();
          break;
      }
    });
  }

  // ─── Mode Toggle ───

  _bindModeToggle() {
    const btn = document.getElementById('mode-toggle');
    if (!btn) return;

    btn.addEventListener('click', () => {
      if (!this.walkingMode) return;

      if (this.walkingMode.active) {
        this.walkingMode.deactivate();
      } else {
        this.walkingMode.activate();
      }
    });
  }
}
