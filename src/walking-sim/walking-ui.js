/**
 * WalkingUI — DOM layout transitions for walking mode.
 * On activate: switches to side-by-side (3D viewport left ~65%, controls sidebar right ~35%),
 * hides 2D spatial pad, adds HUD overlay.
 * On deactivate: restores original layout.
 */
export class WalkingUI {
  constructor() {
    this._viewport = null;
    this._hud = null;
    this._onPointerLockChange = this._onPointerLockChange.bind(this);
    this.onVolumeChange = null; // callback(value)
    this.onReverbChange = null; // callback({ amount, decay, damping })
  }

  /**
   * Activate walking mode layout.
   */
  activate() {
    const appLayout = document.getElementById('app-layout');
    const viewport = document.getElementById('walking-viewport');

    appLayout.classList.add('walking-active');
    viewport.hidden = false;

    // Hide the 2D spatial panel
    const spatialPanel = document.getElementById('panel-spatial');
    if (spatialPanel) spatialPanel.hidden = true;

    // Hide drop zone (keep transport + controls visible in sidebar)
    const dropZone = document.getElementById('drop-zone');
    if (dropZone) dropZone.hidden = true;

    // Create HUD overlay
    this._createHUD(viewport);

    // Listen for pointer lock changes
    document.addEventListener('pointerlockchange', this._onPointerLockChange);

    // Update mode toggle button text
    const toggle = document.getElementById('mode-toggle');
    if (toggle) {
      toggle.textContent = 'Standard Mode';
      toggle.classList.add('active');
    }

    this._viewport = viewport;
  }

  /**
   * Deactivate walking mode, restore original layout.
   */
  deactivate() {
    const appLayout = document.getElementById('app-layout');
    const viewport = document.getElementById('walking-viewport');

    appLayout.classList.remove('walking-active');
    viewport.hidden = true;

    // Remove pointer lock listener
    document.removeEventListener('pointerlockchange', this._onPointerLockChange);

    // Clear viewport contents (Three.js canvas + HUD)
    while (viewport.firstChild) {
      viewport.firstChild.remove();
    }

    // Restore spatial panel
    const spatialPanel = document.getElementById('panel-spatial');
    if (spatialPanel) spatialPanel.hidden = false;

    // Restore drop zone (only if no file loaded — check if transport is visible)
    const transport = document.getElementById('transport');
    const dropZone = document.getElementById('drop-zone');
    if (dropZone && transport && transport.hidden) {
      dropZone.hidden = false;
    }

    // Update mode toggle button text
    const toggle = document.getElementById('mode-toggle');
    if (toggle) {
      toggle.textContent = '3D Walk Mode';
      toggle.classList.remove('active');
    }

    this._viewport = null;
    this._hud = null;
  }

  /**
   * Get the viewport container for Three.js renderer.
   */
  getViewport() {
    return document.getElementById('walking-viewport');
  }

  /**
   * Create HUD overlay with crosshair and pointer lock prompt.
   */
  _createHUD(container) {
    const hud = document.createElement('div');
    hud.className = 'walking-hud';
    hud.innerHTML = `
      <div class="walking-crosshair">+</div>
      <div class="walking-prompt" id="walking-prompt">Click to look around</div>
      <div class="walking-hud-controls">
        <div class="walking-vol-control">
          <label>Speaker Vol <span id="walking-vol-val" class="val-badge">1.00</span></label>
          <input type="range" id="walking-vol" min="0" max="3" step="0.01" value="1.00" />
        </div>
        <div class="walking-reverb-control">
          <label>Reverb <span id="walking-reverb-val" class="val-badge">0.30</span></label>
          <input type="range" id="walking-reverb" min="0" max="1" step="0.01" value="0.30" />
        </div>
        <div class="walking-reverb-control">
          <label>Decay <span id="walking-decay-val" class="val-badge">2.5s</span></label>
          <input type="range" id="walking-decay" min="0.5" max="5.0" step="0.1" value="2.5" />
        </div>
        <div class="walking-reverb-control">
          <label>Damping <span id="walking-damping-val" class="val-badge">4000</span></label>
          <input type="range" id="walking-damping" min="500" max="12000" step="100" value="4000" />
        </div>
      </div>
      <div class="walking-controls-hint">WASD / Arrows to move &middot; Shift to sprint &middot; Esc to release mouse</div>
    `;
    container.appendChild(hud);
    this._hud = hud;

    // Volume slider
    const volSlider = hud.querySelector('#walking-vol');
    const volVal = hud.querySelector('#walking-vol-val');
    volSlider.addEventListener('input', () => {
      const v = parseFloat(volSlider.value);
      volVal.textContent = v.toFixed(2);
      if (this.onVolumeChange) this.onVolumeChange(v);
    });

    // Reverb sliders
    const reverbSlider = hud.querySelector('#walking-reverb');
    const reverbVal = hud.querySelector('#walking-reverb-val');
    const decaySlider = hud.querySelector('#walking-decay');
    const decayVal = hud.querySelector('#walking-decay-val');
    const dampingSlider = hud.querySelector('#walking-damping');
    const dampingVal = hud.querySelector('#walking-damping-val');

    reverbSlider.addEventListener('input', () => {
      const v = parseFloat(reverbSlider.value);
      reverbVal.textContent = v.toFixed(2);
      if (this.onReverbChange) this.onReverbChange({ amount: v });
    });

    decaySlider.addEventListener('input', () => {
      const v = parseFloat(decaySlider.value);
      decayVal.textContent = v.toFixed(1) + 's';
      if (this.onReverbChange) this.onReverbChange({ decay: v });
    });

    dampingSlider.addEventListener('input', () => {
      const v = parseFloat(dampingSlider.value);
      dampingVal.textContent = v >= 1000 ? (v / 1000).toFixed(1) + 'k' : v.toString();
      if (this.onReverbChange) this.onReverbChange({ damping: v });
    });
  }

  _onPointerLockChange() {
    const prompt = document.getElementById('walking-prompt');
    if (prompt) {
      prompt.style.opacity = document.pointerLockElement ? '0' : '1';
    }
  }
}
