import * as THREE from 'three';

/**
 * PlayerController — first-person movement (Arrow/WASD), pointer-lock mouse look,
 * collision clamping to hallway bounds.
 *
 * Hallway bounds: X: [-4.5, 4.5], Y: fixed 1.7, Z: [-79, -1]
 */
export class PlayerController {
  constructor(camera) {
    this.camera = camera;

    // Euler for pitch/yaw — order YXZ prevents gimbal issues for FPS
    this.euler = new THREE.Euler(0, 0, 0, 'YXZ');

    // Movement state
    this.keys = { forward: false, backward: false, left: false, right: false, sprint: false };
    this.walkSpeed = 3;
    this.sprintSpeed = 6;
    this.mouseSensitivity = 0.002;
    this.pitchLimit = (85 * Math.PI) / 180; // ±85 degrees

    // Camera bob
    this._bobPhase = 0;
    this._bobAmount = 0.03;
    this._bobFreq = 8;

    // Pointer lock state
    this.pointerLocked = false;

    // L-shaped corridor zones
    this.zones = [
      { minX: -4.5, maxX: 4.5, minZ: -319, maxZ: -1 },     // main hallway
      { minX: 4.5, maxX: 44.5, minZ: -51.5, maxZ: -44.5 },  // side hallway
    ];
    this.playerY = 1.7;

    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._onMouseMove = this._onMouseMove.bind(this);
    this._onPointerLockChange = this._onPointerLockChange.bind(this);
  }

  /**
   * Activate input listeners.
   * @param {HTMLCanvasElement} canvas — click target for pointer lock
   */
  activate(canvas) {
    this._canvas = canvas;
    document.addEventListener('keydown', this._onKeyDown);
    document.addEventListener('keyup', this._onKeyUp);
    document.addEventListener('mousemove', this._onMouseMove);
    document.addEventListener('pointerlockchange', this._onPointerLockChange);

    canvas.addEventListener('click', () => {
      if (!this.pointerLocked) {
        canvas.requestPointerLock();
      }
    });

    // Initialize euler from current camera rotation
    this.euler.setFromQuaternion(this.camera.quaternion);
  }

  /**
   * Deactivate input listeners and release pointer lock.
   */
  deactivate() {
    document.removeEventListener('keydown', this._onKeyDown);
    document.removeEventListener('keyup', this._onKeyUp);
    document.removeEventListener('mousemove', this._onMouseMove);
    document.removeEventListener('pointerlockchange', this._onPointerLockChange);

    if (this.pointerLocked) {
      document.exitPointerLock();
    }

    // Reset keys
    this.keys = { forward: false, backward: false, left: false, right: false, sprint: false };
  }

  /**
   * Update player position based on held keys. Call each frame.
   * @param {number} dt — delta time in seconds
   */
  update(dt) {
    const speed = this.keys.sprint ? this.sprintSpeed : this.walkSpeed;
    const moveZ = ((this.keys.forward ? 1 : 0) - (this.keys.backward ? 1 : 0)) * speed * dt;
    const moveX = ((this.keys.right ? 1 : 0) - (this.keys.left ? 1 : 0)) * speed * dt;

    if (moveZ === 0 && moveX === 0) {
      this._bobPhase = 0;
      this.camera.position.y = this.playerY;
      return;
    }

    // Movement in camera-relative direction (only yaw, no pitch)
    const forward = new THREE.Vector3(0, 0, -1);
    forward.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.euler.y);

    const right = new THREE.Vector3(1, 0, 0);
    right.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.euler.y);

    const pos = this.camera.position;
    pos.x += forward.x * moveZ + right.x * moveX;
    pos.z += forward.z * moveZ + right.z * moveX;

    // Clamp to corridor zones
    this._clampToZones(pos);

    // Camera bob
    this._bobPhase += dt * this._bobFreq;
    pos.y = this.playerY + Math.sin(this._bobPhase) * this._bobAmount;
  }

  /**
   * Get player position as THREE.Vector3.
   */
  getPosition() {
    return this.camera.position.clone();
  }

  /**
   * Clamp position to the nearest valid zone in the L-shaped corridor.
   */
  _clampToZones(pos) {
    // Check if already inside any zone
    for (const z of this.zones) {
      if (pos.x >= z.minX && pos.x <= z.maxX &&
          pos.z >= z.minZ && pos.z <= z.maxZ) {
        return; // inside a valid zone, no clamping needed
      }
    }

    // Outside all zones — clamp to each zone, pick nearest result
    let bestX = pos.x, bestZ = pos.z, bestDist = Infinity;
    for (const z of this.zones) {
      const cx = Math.max(z.minX, Math.min(z.maxX, pos.x));
      const cz = Math.max(z.minZ, Math.min(z.maxZ, pos.z));
      const dx = pos.x - cx;
      const dz = pos.z - cz;
      const dist = dx * dx + dz * dz;
      if (dist < bestDist) {
        bestDist = dist;
        bestX = cx;
        bestZ = cz;
      }
    }
    pos.x = bestX;
    pos.z = bestZ;
  }

  // ─── Input handlers ───

  _onKeyDown(e) {
    // Prevent arrow keys / space from scrolling the sidebar
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
      e.preventDefault();
    }
    this._updateKey(e.code, true);
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
      this.keys.sprint = true;
    }
  }

  _onKeyUp(e) {
    this._updateKey(e.code, false);
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
      this.keys.sprint = false;
    }
  }

  _updateKey(code, pressed) {
    switch (code) {
      case 'KeyW': case 'ArrowUp':
        this.keys.forward = pressed;
        break;
      case 'KeyS': case 'ArrowDown':
        this.keys.backward = pressed;
        break;
      case 'KeyA': case 'ArrowLeft':
        this.keys.left = pressed;
        break;
      case 'KeyD': case 'ArrowRight':
        this.keys.right = pressed;
        break;
    }
  }

  _onMouseMove(e) {
    if (!this.pointerLocked) return;

    this.euler.y -= e.movementX * this.mouseSensitivity;
    this.euler.x -= e.movementY * this.mouseSensitivity;
    this.euler.x = Math.max(-this.pitchLimit, Math.min(this.pitchLimit, this.euler.x));

    this.camera.quaternion.setFromEuler(this.euler);
  }

  _onPointerLockChange() {
    this.pointerLocked = document.pointerLockElement === this._canvas;
  }
}
