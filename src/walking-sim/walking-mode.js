import * as THREE from 'three';
import { WalkingScene } from './walking-scene.js';
import { PlayerController } from './player-controller.js';
import { SpeakerArray } from './speaker-array.js';
import { WalkingUI } from './walking-ui.js';

/**
 * WalkingMode — orchestrator that ties scene + player + speaker array + UI.
 * Runs animation loop, handles activate/deactivate, rewires audio graph.
 */
export class WalkingMode {
  /**
   * @param {import('../audio-engine.js').AudioEngine} engine
   */
  constructor(engine) {
    this.engine = engine;
    this.active = false;

    this.scene = null;
    this.player = null;
    this.speakerArray = null;
    this.ui = new WalkingUI();

    this._animId = null;
    this._clock = new THREE.Clock();
    this._tmpForward = new THREE.Vector3();
    this._tmpUp = new THREE.Vector3(0, 1, 0);
    this.sodaMachinePos = null;
  }

  /**
   * Activate walking mode: create 3D scene, player, speaker array, rewire audio.
   */
  activate() {
    if (this.active) return;
    this.active = true;

    // Switch DOM layout
    this.ui.onVolumeChange = (val) => {
      if (this.speakerArray) this.speakerArray.setVolume(val);
    };
    this.ui.onReverbChange = ({ amount, decay, damping }) => {
      const reverb = this.engine.getHallwayReverb();
      if (!reverb) return;
      if (amount !== undefined) reverb.setAmount(amount);
      if (decay !== undefined) reverb.setDecayTime(decay);
      if (damping !== undefined) reverb.setAbsorption(damping);
    };
    this.ui.activate();

    // Create 3D scene
    this.scene = new WalkingScene();
    this.scene.init(this.ui.getViewport());

    // Store soda machine position for distance attenuation
    this.sodaMachinePos = this.scene.sodaMachinePosition;

    // Create player controller
    this.player = new PlayerController(this.scene.camera);
    this.player.activate(this.scene.getCanvas());

    // Create speaker array (audio) — requires AudioContext
    this._initSpeakerArray();

    // Start animation loop
    this._clock.start();
    this._animate();
  }

  /**
   * Deactivate walking mode: stop loop, clean up, restore original layout.
   */
  deactivate() {
    if (!this.active) return;
    this.active = false;

    // Restore binaural beat to normal volume
    if (this.engine.binauralBeat) {
      this.engine.binauralBeat.updateDistanceAttenuation(1.0);
    }

    // Stop animation loop
    if (this._animId) {
      cancelAnimationFrame(this._animId);
      this._animId = null;
    }

    // Disconnect speaker array from audio engine
    if (this.speakerArray) {
      this.engine.disconnectSpeakerArray();
      this.speakerArray.dispose();
      this.speakerArray = null;
    }

    // Clean up player
    if (this.player) {
      this.player.deactivate();
      this.player = null;
    }

    // Clean up scene
    if (this.scene) {
      this.scene.dispose();
      this.scene = null;
    }

    // Restore DOM layout
    this.ui.deactivate();
  }

  /**
   * Toggle walking mode.
   */
  toggle() {
    if (this.active) {
      this.deactivate();
    } else {
      this.activate();
    }
  }

  /**
   * Initialize speaker array if AudioContext is available.
   * Called on activate and lazily from animation loop if context wasn't ready initially.
   */
  _initSpeakerArray() {
    if (this.speakerArray) return; // Already initialized
    const ctx = this.engine.getContext();
    if (!ctx || !this.scene) return;

    const positions = this.scene.speakerPositions.map(v => ({
      x: v.x, y: v.y, z: v.z,
    }));
    this.speakerArray = new SpeakerArray(ctx, positions);
    this.engine.connectSpeakerArray(this.speakerArray);
  }

  /**
   * Animation loop: update player → update listener → compute distances → highlight speakers → render.
   */
  _animate() {
    if (!this.active) return;

    const dt = this._clock.getDelta();

    // Lazily init speaker array if AudioContext became available
    if (!this.speakerArray) this._initSpeakerArray();

    // Update player position
    this.player.update(dt);

    // Get player position and forward direction from camera
    const playerPos = this.player.getPosition();

    // Forward direction: camera's -Z in world space
    this.scene.camera.getWorldDirection(this._tmpForward);

    // Update speaker array audio (listener + delays)
    if (this.speakerArray) {
      this.speakerArray.updateListener(
        { x: playerPos.x, y: playerPos.y, z: playerPos.z },
        { x: this._tmpForward.x, y: this._tmpForward.y, z: this._tmpForward.z },
        { x: 0, y: 1, z: 0 }
      );
      this.speakerArray.updateSpeakers(
        { x: playerPos.x, y: playerPos.y, z: playerPos.z }
      );
    }

    // Update hallway reverb wall reflections based on player position
    const reverb = this.engine.getHallwayReverb();
    if (reverb) reverb.updatePlayerPosition(playerPos.x, playerPos.z);

    // Update binaural beat distance attenuation from soda machine
    if (this.sodaMachinePos && this.engine.binauralBeat) {
      const dx = playerPos.x - this.sodaMachinePos.x;
      const dy = playerPos.y - this.sodaMachinePos.y;
      const dz = playerPos.z - this.sodaMachinePos.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const refDist = 2;
      const rolloff = 1.5;
      const gain = dist <= refDist ? 1.0 : Math.pow(refDist / dist, rolloff);
      this.engine.binauralBeat.updateDistanceAttenuation(gain);
    }

    // Update speaker glow based on proximity
    this.scene.updateSpeakerGlow(playerPos);

    // Update soda machine glow based on proximity
    this.scene.updateSodaMachineGlow(playerPos);

    // Render
    this.scene.render();

    this._animId = requestAnimationFrame(() => this._animate());
  }
}
