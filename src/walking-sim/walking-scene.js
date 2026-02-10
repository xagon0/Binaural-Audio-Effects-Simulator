import * as THREE from 'three';

/**
 * WalkingScene — Three.js scene: hallway geometry, speaker models, lighting, camera, renderer.
 *
 * Hallway: 10 wide (X), 5 tall (Y), 320 long (Z, extending in -Z direction).
 * 10 ceiling speakers staggered left/right at 32-unit intervals.
 */

const HALL_LENGTH = 320;
const HALL_HALF = HALL_LENGTH / 2; // 160
const SPEAKER_COUNT = 10;
const SPEAKER_SPACING = 32; // 320 / 10

export class WalkingScene {
  constructor() {
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.speakerMeshes = [];
    this.glowRings = [];
    this.glowLights = [];
    this.speakerPositions = [];
    this.sodaMachinePosition = new THREE.Vector3(44, 1.0, -48);
    this._sodaMachineLight = null;
    this._sodaMachineIndicator = null;
    this._clock = new THREE.Clock();
  }

  init(container) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x111118);
    this.scene.fog = new THREE.Fog(0x111118, 60, 250);

    this.camera = new THREE.PerspectiveCamera(
      70,
      container.clientWidth / container.clientHeight,
      0.1,
      500
    );
    this.camera.position.set(0, 1.7, -2);
    this.camera.lookAt(0, 1.7, -10);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    container.appendChild(this.renderer.domElement);

    this._buildHallway();
    this._buildSideHallway();
    this._buildSodaMachine();
    this._buildSpeakers();
    this._buildLighting();

    this._onResize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
    };
    window.addEventListener('resize', this._onResize);
  }

  _buildHallway() {
    // Lighter materials so they actually show up under lighting
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0x3a3a5e,
      roughness: 0.8,
      metalness: 0.05,
    });
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x2a2a35,
      roughness: 0.85,
      metalness: 0.1,
    });
    const ceilingMat = new THREE.MeshStandardMaterial({
      color: 0x2e2e48,
      roughness: 0.8,
      metalness: 0.05,
    });

    // Floor
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(10, HALL_LENGTH),
      floorMat
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0, -HALL_HALF);
    this.scene.add(floor);

    // Ceiling
    const ceiling = new THREE.Mesh(
      new THREE.PlaneGeometry(10, HALL_LENGTH),
      ceilingMat
    );
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.set(0, 5, -HALL_HALF);
    this.scene.add(ceiling);

    // Left wall
    const leftWall = new THREE.Mesh(
      new THREE.PlaneGeometry(HALL_LENGTH, 5),
      wallMat
    );
    leftWall.rotation.y = Math.PI / 2;
    leftWall.position.set(-5, 2.5, -HALL_HALF);
    this.scene.add(leftWall);

    // Right wall — split into two segments with opening for side hallway (Z: -44 to -52)
    // Segment 1: Z=0 to Z=-44 (length 44)
    const rightWallA = new THREE.Mesh(
      new THREE.PlaneGeometry(44, 5),
      wallMat
    );
    rightWallA.rotation.y = -Math.PI / 2;
    rightWallA.position.set(5, 2.5, -22); // center of segment
    this.scene.add(rightWallA);

    // Segment 2: Z=-52 to Z=-320 (length 268)
    const rightWallB = new THREE.Mesh(
      new THREE.PlaneGeometry(268, 5),
      wallMat
    );
    rightWallB.rotation.y = -Math.PI / 2;
    rightWallB.position.set(5, 2.5, -186); // center: -52 - 268/2 = -186
    this.scene.add(rightWallB);

    // Back wall (far end)
    const backWall = new THREE.Mesh(
      new THREE.PlaneGeometry(10, 5),
      wallMat
    );
    backWall.position.set(0, 2.5, -HALL_LENGTH);
    this.scene.add(backWall);

    // Front wall (behind player start)
    const frontWall = new THREE.Mesh(
      new THREE.PlaneGeometry(10, 5),
      wallMat
    );
    frontWall.rotation.y = Math.PI;
    frontWall.position.set(0, 2.5, 0);
    this.scene.add(frontWall);

    // Floor stripes for depth perception
    const stripeMat = new THREE.MeshStandardMaterial({
      color: 0x4a4a60,
      roughness: 0.7,
      metalness: 0.1,
    });
    for (let z = -8; z >= -(HALL_LENGTH - 4); z -= 16) {
      const stripe = new THREE.Mesh(
        new THREE.PlaneGeometry(10, 0.2),
        stripeMat
      );
      stripe.rotation.x = -Math.PI / 2;
      stripe.position.set(0, 0.005, z);
      this.scene.add(stripe);
    }

    // Baseboard trim on walls for visual detail
    const trimMat = new THREE.MeshStandardMaterial({
      color: 0x252540,
      roughness: 0.6,
      metalness: 0.15,
    });
    const leftTrim = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 0.15, HALL_LENGTH),
      trimMat
    );
    leftTrim.position.set(-4.975, 0.075, -HALL_HALF);
    this.scene.add(leftTrim);

    // Right trim — split to match wall opening
    const rightTrimA = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 0.15, 44),
      trimMat
    );
    rightTrimA.position.set(4.975, 0.075, -22);
    this.scene.add(rightTrimA);

    const rightTrimB = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 0.15, 268),
      trimMat
    );
    rightTrimB.position.set(4.975, 0.075, -186);
    this.scene.add(rightTrimB);
  }

  _buildSideHallway() {
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0x3a3a5e, roughness: 0.8, metalness: 0.05,
    });
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x2a2a35, roughness: 0.85, metalness: 0.1,
    });
    const ceilingMat = new THREE.MeshStandardMaterial({
      color: 0x2e2e48, roughness: 0.8, metalness: 0.05,
    });

    // Side hallway: X=5 to X=45, Z=-44 to Z=-52, Y=0 to 5
    const sideLength = 40; // along X
    const sideWidth = 8;   // along Z

    // Floor
    const sideFloor = new THREE.Mesh(
      new THREE.PlaneGeometry(sideLength, sideWidth),
      floorMat
    );
    sideFloor.rotation.x = -Math.PI / 2;
    sideFloor.position.set(25, 0, -48); // center X=25, Z=-48
    this.scene.add(sideFloor);

    // Ceiling
    const sideCeiling = new THREE.Mesh(
      new THREE.PlaneGeometry(sideLength, sideWidth),
      ceilingMat
    );
    sideCeiling.rotation.x = Math.PI / 2;
    sideCeiling.position.set(25, 5, -48);
    this.scene.add(sideCeiling);

    // Front wall (Z=-44 side, facing -Z direction)
    const frontWall = new THREE.Mesh(
      new THREE.PlaneGeometry(sideLength, 5),
      wallMat
    );
    frontWall.rotation.y = Math.PI;
    frontWall.position.set(25, 2.5, -44);
    this.scene.add(frontWall);

    // Back wall (Z=-52 side, facing +Z direction)
    const backWall = new THREE.Mesh(
      new THREE.PlaneGeometry(sideLength, 5),
      wallMat
    );
    backWall.position.set(25, 2.5, -52);
    this.scene.add(backWall);

    // Dead-end wall (X=45, facing -X toward player)
    const deadEnd = new THREE.Mesh(
      new THREE.PlaneGeometry(sideWidth, 5),
      wallMat
    );
    deadEnd.rotation.y = -Math.PI / 2;
    deadEnd.position.set(45, 2.5, -48);
    this.scene.add(deadEnd);

    // Floor stripes along X axis for depth perception
    const stripeMat = new THREE.MeshStandardMaterial({
      color: 0x4a4a60, roughness: 0.7, metalness: 0.1,
    });
    for (let x = 9; x <= 43; x += 8) {
      const stripe = new THREE.Mesh(
        new THREE.PlaneGeometry(0.2, sideWidth),
        stripeMat
      );
      stripe.rotation.x = -Math.PI / 2;
      stripe.position.set(x, 0.005, -48);
      this.scene.add(stripe);
    }

    // Baseboard trim
    const trimMat = new THREE.MeshStandardMaterial({
      color: 0x252540, roughness: 0.6, metalness: 0.15,
    });
    // Front wall (Z=-44) trim
    const frontTrim = new THREE.Mesh(
      new THREE.BoxGeometry(sideLength, 0.15, 0.05),
      trimMat
    );
    frontTrim.position.set(25, 0.075, -44.025);
    this.scene.add(frontTrim);

    // Back wall (Z=-52) trim
    const backTrim = new THREE.Mesh(
      new THREE.BoxGeometry(sideLength, 0.15, 0.05),
      trimMat
    );
    backTrim.position.set(25, 0.075, -51.975);
    this.scene.add(backTrim);

    // Dead-end wall (X=45) trim
    const deadEndTrim = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 0.15, sideWidth),
      trimMat
    );
    deadEndTrim.position.set(44.975, 0.075, -48);
    this.scene.add(deadEndTrim);

    // Side hallway lighting — dimmer than main hall
    for (let x = 10; x <= 40; x += 10) {
      const light = new THREE.PointLight(0xccddff, 2.0, 20, 0);
      light.position.set(x, 4.7, -48);
      this.scene.add(light);

      const fixtureMat = new THREE.MeshBasicMaterial({
        color: 0xddeeff, transparent: true, opacity: 0.35,
      });
      const fixture = new THREE.Mesh(
        new THREE.PlaneGeometry(1.2, 0.2),
        fixtureMat
      );
      fixture.rotation.x = Math.PI / 2;
      fixture.position.set(x, 4.99, -48);
      this.scene.add(fixture);
    }
  }

  _buildSodaMachine() {
    // Red body
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0xcc2233, roughness: 0.6, metalness: 0.2,
    });
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.8, 2.0, 1.0),
      bodyMat
    );
    body.position.set(44, 1.0, -48);
    this.scene.add(body);

    // Dark display panel (front face)
    const panelMat = new THREE.MeshStandardMaterial({
      color: 0x111122, roughness: 0.4, metalness: 0.3,
    });
    const panel = new THREE.Mesh(
      new THREE.PlaneGeometry(0.5, 0.8),
      panelMat
    );
    panel.rotation.y = -Math.PI / 2;
    panel.position.set(43.6, 1.4, -48);
    this.scene.add(panel);

    // Dispensing slot
    const slotMat = new THREE.MeshStandardMaterial({
      color: 0x0a0a15, roughness: 0.9, metalness: 0.05,
    });
    const slot = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 0.25, 0.4),
      slotMat
    );
    slot.position.set(43.58, 0.5, -48);
    this.scene.add(slot);

    // Green indicator light
    const indicatorMat = new THREE.MeshBasicMaterial({
      color: 0x33ff66, transparent: true, opacity: 0.4,
    });
    this._sodaMachineIndicator = new THREE.Mesh(
      new THREE.CircleGeometry(0.06, 16),
      indicatorMat
    );
    this._sodaMachineIndicator.rotation.y = -Math.PI / 2;
    this._sodaMachineIndicator.position.set(43.59, 1.85, -48);
    this.scene.add(this._sodaMachineIndicator);

    // Green point light
    this._sodaMachineLight = new THREE.PointLight(0x33ff66, 0.5, 8, 0);
    this._sodaMachineLight.position.set(43.5, 1.5, -48);
    this.scene.add(this._sodaMachineLight);
  }

  _buildSpeakers() {
    this.speakerPositions = [];

    const housingMat = new THREE.MeshStandardMaterial({
      color: 0x2a2a44,
      roughness: 0.6,
      metalness: 0.3,
    });
    const coneMat = new THREE.MeshStandardMaterial({
      color: 0x1a1a30,
      roughness: 0.9,
      metalness: 0.05,
    });
    const bracketMat = new THREE.MeshStandardMaterial({
      color: 0x4a4a6a,
      roughness: 0.4,
      metalness: 0.5,
    });

    for (let i = 0; i < SPEAKER_COUNT; i++) {
      const x = (i % 2 === 0) ? -2 : 2;
      const y = 4.5;
      const z = -(i * SPEAKER_SPACING + SPEAKER_SPACING / 2);
      this.speakerPositions.push(new THREE.Vector3(x, y, z));

      // Speaker housing — box
      const housing = new THREE.Mesh(
        new THREE.BoxGeometry(0.6, 0.25, 0.6),
        housingMat
      );
      housing.position.set(x, y, z);
      this.scene.add(housing);
      this.speakerMeshes.push(housing);

      // Speaker cone face (bottom)
      const cone = new THREE.Mesh(
        new THREE.CircleGeometry(0.2, 20),
        coneMat
      );
      cone.rotation.x = Math.PI / 2;
      cone.position.set(x, y - 0.126, z);
      this.scene.add(cone);

      // Mounting bracket
      const vertBracket = new THREE.Mesh(
        new THREE.BoxGeometry(0.06, 0.35, 0.06),
        bracketMat
      );
      vertBracket.position.set(x, y + 0.3, z);
      this.scene.add(vertBracket);

      const horizBracket = new THREE.Mesh(
        new THREE.BoxGeometry(0.3, 0.06, 0.06),
        bracketMat
      );
      const bracketDir = (x < 0) ? 0.15 : -0.15;
      horizBracket.position.set(x + bracketDir, y + 0.47, z);
      this.scene.add(horizBracket);

      // Glow ring
      const glowMat = new THREE.MeshBasicMaterial({
        color: 0xe94560,
        transparent: true,
        opacity: 0.1,
      });
      const glowRing = new THREE.Mesh(
        new THREE.RingGeometry(0.22, 0.35, 24),
        glowMat
      );
      glowRing.rotation.x = Math.PI / 2;
      glowRing.position.set(x, y - 0.13, z);
      this.scene.add(glowRing);
      this.glowRings.push(glowRing);

      // Point light under speaker — starts off, ramps with proximity
      const speakerLight = new THREE.PointLight(0xe94560, 0, 12, 0);
      speakerLight.position.set(x, y - 0.3, z);
      this.scene.add(speakerLight);
      this.glowLights.push(speakerLight);
    }

    // 11th speaker at side hallway entrance
    {
      const x = 6, y = 4.5, z = -48;
      this.speakerPositions.push(new THREE.Vector3(x, y, z));

      const housing = new THREE.Mesh(
        new THREE.BoxGeometry(0.6, 0.25, 0.6),
        housingMat
      );
      housing.position.set(x, y, z);
      this.scene.add(housing);
      this.speakerMeshes.push(housing);

      const cone = new THREE.Mesh(
        new THREE.CircleGeometry(0.2, 20),
        coneMat
      );
      cone.rotation.x = Math.PI / 2;
      cone.position.set(x, y - 0.126, z);
      this.scene.add(cone);

      const vertBracket = new THREE.Mesh(
        new THREE.BoxGeometry(0.06, 0.35, 0.06),
        bracketMat
      );
      vertBracket.position.set(x, y + 0.3, z);
      this.scene.add(vertBracket);

      const horizBracket = new THREE.Mesh(
        new THREE.BoxGeometry(0.3, 0.06, 0.06),
        bracketMat
      );
      horizBracket.position.set(x - 0.15, y + 0.47, z);
      this.scene.add(horizBracket);

      const glowMat = new THREE.MeshBasicMaterial({
        color: 0xe94560, transparent: true, opacity: 0.1,
      });
      const glowRing = new THREE.Mesh(
        new THREE.RingGeometry(0.22, 0.35, 24),
        glowMat
      );
      glowRing.rotation.x = Math.PI / 2;
      glowRing.position.set(x, y - 0.13, z);
      this.scene.add(glowRing);
      this.glowRings.push(glowRing);

      const speakerLight = new THREE.PointLight(0xe94560, 0, 12, 0);
      speakerLight.position.set(x, y - 0.3, z);
      this.scene.add(speakerLight);
      this.glowLights.push(speakerLight);
    }
  }

  _buildLighting() {
    // Strong ambient so you can always see the hall
    const ambient = new THREE.AmbientLight(0x6677aa, 1.2);
    this.scene.add(ambient);

    // Hemisphere light — blue-ish ceiling, dark floor
    const hemi = new THREE.HemisphereLight(0x8899cc, 0x222233, 0.8);
    this.scene.add(hemi);

    // Overhead lights every 24 units — bright, no decay (constant within range)
    for (let z = -12; z >= -(HALL_LENGTH - 4); z -= 24) {
      const light = new THREE.PointLight(0xccddff, 3.0, 30, 0);
      light.position.set(0, 4.7, z);
      this.scene.add(light);

      // Visible fixture panel
      const fixtureMat = new THREE.MeshBasicMaterial({
        color: 0xddeeff,
        transparent: true,
        opacity: 0.5,
      });
      const fixture = new THREE.Mesh(
        new THREE.PlaneGeometry(1.2, 0.2),
        fixtureMat
      );
      fixture.rotation.x = Math.PI / 2;
      fixture.position.set(0, 4.99, z);
      this.scene.add(fixture);
    }

    // Extra bright entrance light
    const entryLight = new THREE.PointLight(0xddeeff, 4.0, 25, 0);
    entryLight.position.set(0, 4.5, -3);
    this.scene.add(entryLight);
  }

  updateSpeakerGlow(playerPos) {
    for (let i = 0; i < this.speakerPositions.length; i++) {
      const dist = playerPos.distanceTo(this.speakerPositions[i]);
      const intensity = Math.max(0, 1 - dist / 15);
      const ring = this.glowRings[i];
      ring.material.opacity = 0.05 + intensity * 0.8;
      const scale = 1 + intensity * 0.4;
      ring.scale.set(scale, scale, scale);

      this.glowLights[i].intensity = intensity * 3.0;
    }
  }

  updateSodaMachineGlow(playerPos) {
    const dist = playerPos.distanceTo(this.sodaMachinePosition);
    const intensity = Math.max(0, 1 - dist / 15);
    if (this._sodaMachineIndicator) {
      this._sodaMachineIndicator.material.opacity = 0.4 + intensity * 0.6;
    }
    if (this._sodaMachineLight) {
      this._sodaMachineLight.intensity = 0.5 + intensity * 3.0;
    }
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  getCanvas() {
    return this.renderer?.domElement;
  }

  dispose() {
    window.removeEventListener('resize', this._onResize);
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer.domElement.remove();
    }
  }
}
