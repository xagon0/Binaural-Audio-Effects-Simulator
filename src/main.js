import './style.css';
import { AudioEngine } from './audio-engine.js';
import { Visualizer } from './visualizer.js';
import { UIController } from './ui-controller.js';
import { WalkingMode } from './walking-sim/walking-mode.js';

document.addEventListener('DOMContentLoaded', () => {
  const engine = new AudioEngine();
  const visualizer = new Visualizer();
  const ui = new UIController(engine, visualizer);

  const walkingMode = new WalkingMode(engine);
  ui.setWalkingMode(walkingMode);

  // Expose for console debugging during prototyping
  window.__debug = { engine, visualizer, ui, walkingMode };
});
