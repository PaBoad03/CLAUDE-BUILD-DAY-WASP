/**
 * FaceScene — a procedural 3D WASP mask (Three.js, no assets, no third-party artwork).
 *
 * A faceted low-poly mask floats in front of a dark "magic mirror" disc, lit by its agent's phosphor.
 * It looks around on its own, turns toward whoever it is talking to, blinks, narrows its eyes to think,
 * and glitches (RGB shift + block glitch) on every state change — CRT/Zola-inspired, original geometry.
 *
 * Pure Three.js class; React wraps it in AgentFace3D.tsx.
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { GlitchPass } from 'three/examples/jsm/postprocessing/GlitchPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RGBShiftShader } from 'three/examples/jsm/shaders/RGBShiftShader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { FaceState } from '@wasp/shared-types';
import maskUrl from '../../assets/mask.glb?url';

/**
 * The mask model: packages/ui/assets/mask.glb (Pablo's). Loaded, centered, scaled to MASK_HEIGHT.
 * Eyes and mouth are WASP's own glowing parts, placed relative to the model's bounding box —
 * tune the fractions below if they do not sit where the model's features are.
 */
const MASK_HEIGHT = 2.4;
/** eye x as a fraction of the mask width (from center), y as a fraction of height (from center), z offset in front of the surface */
const EYE_X = 0.2;
const EYE_Y = 0.1;
const EYE_Z = 0.02;
const EYE_RADIUS = 0.13;
/** mouth y as a fraction of height (from center, negative = below) */
const MOUTH_Y = -0.28;
const SHOW_MOUTH = true;
/** keep the model's own texture (true) or paint it in phosphor white (false) */
const KEEP_TEXTURE = true;

export type LookTarget = 'center' | 'left' | 'right' | 'up' | 'human' | 'away';

interface StateParams {
  /** 0..1 how open the eyes are (1 = wide) */
  eyeOpen: number;
  /** emissive tint override (null = agent color) */
  tint: number | null;
  /** emissive intensity of eyes / mouth / edges */
  glow: number;
  bloom: number;
  /** 0 none, 1 rare bursts, 2 continuous, 3 wild */
  glitch: number;
  /** ring spin speed */
  spin: number;
  /** eye scan amplitude (RESEARCHING) */
  scan: number;
  /** mouth activity when not speaking */
  mouthIdle: number;
  /** overall mask brightness 0..1 */
  power: number;
  /** slight head tilt (radians) */
  tilt: number;
}

const AMBER = 0xffc857;
const RED = 0xff3b5c;
const GREEN_OK = 0x7dffb3;

const STATES: Record<FaceState, StateParams> = {
  IDLE: { eyeOpen: 1, tint: null, glow: 1, bloom: 0.9, glitch: 1, spin: 0.15, scan: 0, mouthIdle: 0.15, power: 1, tilt: 0 },
  LISTENING: { eyeOpen: 1.25, tint: null, glow: 1.4, bloom: 1.2, glitch: 0, spin: 0.4, scan: 0, mouthIdle: 0.05, power: 1, tilt: 0.12 },
  THINKING: { eyeOpen: 0.45, tint: null, glow: 0.8, bloom: 0.8, glitch: 0, spin: -0.3, scan: 0, mouthIdle: 0.05, power: 0.9, tilt: -0.08 },
  RESEARCHING: { eyeOpen: 0.9, tint: null, glow: 1.3, bloom: 1.1, glitch: 1, spin: 1.6, scan: 1, mouthIdle: 0.1, power: 1, tilt: 0 },
  ANALYZING: { eyeOpen: 0.5, tint: null, glow: 1, bloom: 0.9, glitch: 0, spin: -0.8, scan: 0.4, mouthIdle: 0.05, power: 0.95, tilt: -0.05 },
  PREPARING: { eyeOpen: 0.9, tint: null, glow: 1.2, bloom: 1, glitch: 1, spin: 1, scan: 0.6, mouthIdle: 0.1, power: 1, tilt: 0 },
  COMMUNICATING: { eyeOpen: 1, tint: null, glow: 1.4, bloom: 1.2, glitch: 0, spin: 0.3, scan: 0, mouthIdle: 0.9, power: 1, tilt: 0.05 },
  SENDING: { eyeOpen: 1, tint: null, glow: 1.4, bloom: 1.2, glitch: 0, spin: 0.6, scan: 0, mouthIdle: 0.9, power: 1, tilt: 0.05 },
  MONITORING: { eyeOpen: 1, tint: null, glow: 1, bloom: 0.9, glitch: 1, spin: 0.3, scan: 0.7, mouthIdle: 0.1, power: 1, tilt: 0 },
  REVIEWING: { eyeOpen: 0.55, tint: null, glow: 1.1, bloom: 1, glitch: 0, spin: -0.5, scan: 0.3, mouthIdle: 0.05, power: 1, tilt: -0.1 },
  WAITING_FOR_PERMISSION: { eyeOpen: 1, tint: AMBER, glow: 1.6, bloom: 1.4, glitch: 1, spin: 0.8, scan: 0, mouthIdle: 0.05, power: 1, tilt: 0.1 },
  PERMISSION_REQUIRED: { eyeOpen: 1.1, tint: AMBER, glow: 1.8, bloom: 1.6, glitch: 1, spin: 1.2, scan: 0, mouthIdle: 0.05, power: 1, tilt: 0.1 },
  AUTHORIZED: { eyeOpen: 0.7, tint: GREEN_OK, glow: 1.8, bloom: 1.6, glitch: 0, spin: 0.5, scan: 0, mouthIdle: 0.3, power: 1, tilt: 0 },
  DENIED: { eyeOpen: 0.6, tint: RED, glow: 1.6, bloom: 1.3, glitch: 2, spin: 0, scan: 0, mouthIdle: 0, power: 0.9, tilt: -0.1 },
  BLOCKED: { eyeOpen: 0.5, tint: RED, glow: 1.8, bloom: 1.4, glitch: 3, spin: 0, scan: 0, mouthIdle: 0, power: 0.9, tilt: -0.12 },
  EXECUTING: { eyeOpen: 0.9, tint: null, glow: 1.4, bloom: 1.2, glitch: 1, spin: 2.2, scan: 1, mouthIdle: 0.2, power: 1, tilt: 0 },
  SUCCESS: { eyeOpen: 0.7, tint: GREEN_OK, glow: 1.9, bloom: 1.8, glitch: 0, spin: 0.6, scan: 0, mouthIdle: 0.3, power: 1, tilt: 0.06 },
  COMPLETE: { eyeOpen: 0.7, tint: null, glow: 1.6, bloom: 1.5, glitch: 0, spin: 0.4, scan: 0, mouthIdle: 0.3, power: 1, tilt: 0.06 },
  WARNING: { eyeOpen: 1, tint: AMBER, glow: 1.5, bloom: 1.3, glitch: 2, spin: 0.2, scan: 0, mouthIdle: 0.1, power: 0.95, tilt: -0.05 },
  ERROR: { eyeOpen: 0.8, tint: RED, glow: 1.6, bloom: 1.2, glitch: 3, spin: 0, scan: 0, mouthIdle: 0, power: 0.85, tilt: -0.15 },
  OFFLINE: { eyeOpen: 0.05, tint: 0x555a66, glow: 0.15, bloom: 0.3, glitch: 2, spin: 0, scan: 0, mouthIdle: 0, power: 0.25, tilt: 0.2 },
};

const LOOK: Record<LookTarget, [number, number]> = {
  center: [0, 0.05],
  left: [-1.1, 0.15],
  right: [1.1, 0.15],
  up: [0, 0.9],
  human: [0, -0.15],
  away: [0.9, 0.5],
};

/** Smooth pseudo-noise from summed sines (deterministic, no deps). */
function wander(t: number, seed: number): number {
  return (Math.sin(t * 0.61 + seed) + Math.sin(t * 0.23 + seed * 1.7) * 0.6 + Math.sin(t * 1.31 + seed * 0.4) * 0.25) / 1.85;
}

export class FaceScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private glitch: GlitchPass;
  private rgb: ShaderPass;

  private head = new THREE.Group();
  private maskGroup: THREE.Group;
  private maskMat: THREE.MeshStandardMaterial;
  private edgeMat: THREE.LineBasicMaterial;
  private maskMats: THREE.MeshStandardMaterial[] = [];
  private eyeMats: THREE.MeshStandardMaterial[] = [];
  private eyes: THREE.Group[] = [];
  private eyeLids: THREE.Group[] = [];
  private mouthBars: THREE.Mesh[] = [];
  private mouthMat: THREE.MeshStandardMaterial;
  private ring: THREE.Mesh;
  private ringMat: THREE.MeshBasicMaterial;
  private particles: THREE.Points;
  private keyLight: THREE.PointLight;

  private agent = new THREE.Color();
  private params: StateParams = STATES.OFFLINE;
  private target: StateParams = STATES.OFFLINE;
  private look: LookTarget = 'center';
  private speaking = false;
  private speakEnergy = 0;
  private blinkAt = 2;
  private blink = 0;
  private glitchUntil = 0;
  private wild = false;
  private tintColor = new THREE.Color();
  private raf = 0;
  private clock = new THREE.Clock();
  private observer: ResizeObserver;
  private lookVec = new THREE.Vector2(0, 0);
  private disposed = false;
  private started = false;

  constructor(
    private readonly host: HTMLElement,
    color: string,
  ) {
    this.agent.set(color);
    this.tintColor.copy(this.agent);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    host.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
    this.camera.position.set(0, 0.05, 8.2);

    // ---- lights
    this.scene.add(new THREE.AmbientLight(0x22262e, 0.9));
    // key light off to the side and above: facets read as light/shadow, not as a flat white blob
    this.keyLight = new THREE.PointLight(this.agent, 14, 20, 2);
    this.keyLight.position.set(2.4, 2.6, 2.4);
    this.scene.add(this.keyLight);
    const fill = new THREE.DirectionalLight(0xc9d3e6, 0.45);
    fill.position.set(-3, 0.5, 3);
    this.scene.add(fill);
    const rim = new THREE.DirectionalLight(this.agent, 1.2);
    rim.position.set(-1, -2, -3);
    this.scene.add(rim);

    // ---- mirror disc + ring (the "magic mirror" the mask emerges from)
    const disc = new THREE.Mesh(new THREE.CircleGeometry(1.95, 64), new THREE.MeshStandardMaterial({ color: 0x05070b, roughness: 0.25, metalness: 0.9, transparent: true, opacity: 0.9 }));
    disc.position.z = -0.9;
    this.scene.add(disc);
    this.ringMat = new THREE.MeshBasicMaterial({ color: this.agent, transparent: true, opacity: 0.55 });
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(1.98, 0.018, 8, 160), this.ringMat);
    this.ring.position.z = -0.85;
    this.scene.add(this.ring);
    const ring2 = new THREE.Mesh(new THREE.TorusGeometry(2.12, 0.006, 6, 160), new THREE.MeshBasicMaterial({ color: this.agent, transparent: true, opacity: 0.25 }));
    ring2.position.z = -0.9;
    this.scene.add(ring2);

    // ---- mask: Pablo's model, with the procedural one as fallback if the file cannot be loaded
    this.maskMat = new THREE.MeshStandardMaterial({ color: 0xb9c0cc, roughness: 0.62, metalness: 0.12, emissive: this.agent, emissiveIntensity: 0.04 });
    this.edgeMat = new THREE.LineBasicMaterial({ color: this.agent, transparent: true, opacity: 0.28 });
    this.maskGroup = new THREE.Group();
    this.head.add(this.maskGroup);

    // ---- eyes: plain glowing orbs, no pupils. Placed once the model's size is known.
    for (const sx of [-1, 1]) {
      const lid = new THREE.Group();
      lid.position.set(sx * 0.35, 0.25, 0.6);
      const eye = new THREE.Group();
      const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: this.agent, emissiveIntensity: 1.2, roughness: 0.2 });
      this.eyeMats.push(mat);
      eye.add(new THREE.Mesh(new THREE.SphereGeometry(EYE_RADIUS, 24, 18), mat));
      lid.add(eye);
      this.eyes.push(eye);
      this.eyeLids.push(lid);
      this.head.add(lid);
    }

    // ---- mouth: equaliser bars
    this.mouthMat = new THREE.MeshStandardMaterial({ color: 0x111318, emissive: this.agent, emissiveIntensity: 1.3, roughness: 0.4 });
    for (let i = 0; i < 7; i++) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.12, 0.06), this.mouthMat);
      bar.position.set((i - 3) * 0.13, -0.5, 0.74);
      bar.visible = SHOW_MOUTH;
      this.mouthBars.push(bar);
      this.head.add(bar);
    }

    this.scene.add(this.head);
    this.loadMask();

    // ---- drifting phosphor dust
    const count = 420;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 7;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 5;
      pos[i * 3 + 2] = -2 + Math.random() * 3.5;
    }
    const pgeo = new THREE.BufferGeometry();
    pgeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.particles = new THREE.Points(pgeo, new THREE.PointsMaterial({ color: this.agent, size: 0.022, transparent: true, opacity: 0.55, depthWrite: false }));
    this.scene.add(this.particles);

    // ---- post-processing
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    // high threshold: only the emissive parts (eyes, mouth, ring, dust) bloom, never the mask itself
    this.bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.9, 0.55, 0.82);
    this.composer.addPass(this.bloom);
    this.rgb = new ShaderPass(RGBShiftShader);
    (this.rgb.uniforms as Record<string, { value: number }>).amount.value = 0.0012;
    this.composer.addPass(this.rgb);
    this.glitch = new GlitchPass(64);
    this.glitch.enabled = false;
    this.composer.addPass(this.glitch);
    this.composer.addPass(new OutputPass());

    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.resize();
    this.animate();
  }

  // ---------------------------------------------------------------- mask model

  private loadMask(): void {
    new GLTFLoader().load(
      maskUrl,
      (gltf) => {
        if (this.disposed) return;
        const model = gltf.scene;
        // normalize: center at origin, MASK_HEIGHT tall, front toward the camera (+Z)
        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        const scale = MASK_HEIGHT / Math.max(size.y, 1e-6);
        model.position.sub(center).multiplyScalar(scale);
        model.scale.setScalar(scale);
        model.traverse((o) => {
          if (!(o as THREE.Mesh).isMesh) return;
          const mesh = o as THREE.Mesh;
          const src = mesh.material as THREE.MeshStandardMaterial;
          if (KEEP_TEXTURE && src && 'map' in src && src.map) {
            const m = new THREE.MeshStandardMaterial({ map: src.map, roughness: src.roughness ?? 0.7, metalness: Math.min(src.metalness ?? 0.2, 0.35), emissive: this.agent, emissiveIntensity: 0.04 });
            mesh.material = m;
            this.maskMats.push(m);
          } else {
            mesh.material = this.maskMat;
            this.maskMats.push(this.maskMat);
          }
        });
        this.maskGroup.clear();
        this.maskGroup.add(model);
        // phosphor edge lines on hard angles, in the agent color, under the same transform as the model
        const edges = new THREE.Group();
        model.updateMatrixWorld(true);
        model.traverse((o) => {
          if (!(o as THREE.Mesh).isMesh) return;
          const mesh = o as THREE.Mesh;
          const lines = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, 40), this.edgeMat);
          lines.applyMatrix4(mesh.matrixWorld);
          edges.add(lines);
        });
        this.maskGroup.add(edges);
        this.placeFeatures(new THREE.Box3().setFromObject(model));
      },
      undefined,
      (err) => {
        console.warn('[FaceScene] mask.glb not available, using the procedural mask', err);
        const geo = buildMaskGeometry();
        this.maskMat.flatShading = true;
        this.maskMat.needsUpdate = true;
        this.maskMats.push(this.maskMat);
        this.maskGroup.add(new THREE.Mesh(geo, this.maskMat));
        this.maskGroup.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 18), this.edgeMat));
        this.placeFeatures(new THREE.Box3().setFromBufferAttribute(geo.getAttribute('position') as THREE.BufferAttribute));
      },
    );
  }

  /** Put WASP's eyes and mouth on the front of whatever mask is loaded. */
  private placeFeatures(box: THREE.Box3): void {
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const front = box.max.z + EYE_Z;
    this.eyeLids[0].position.set(center.x - size.x * EYE_X, center.y + size.y * EYE_Y, front);
    this.eyeLids[1].position.set(center.x + size.x * EYE_X, center.y + size.y * EYE_Y, front);
    const spacing = Math.min(0.13, (size.x * 0.5) / 7);
    this.mouthBars.forEach((bar, i) => bar.position.set(center.x + (i - 3) * spacing, center.y + size.y * MOUTH_Y, front));
  }

  // ---------------------------------------------------------------- public

  setState(state: FaceState): void {
    const next = STATES[state] ?? STATES.IDLE;
    if (next === this.target) return;
    if (!this.started) {
      // first real state: snap, do not fade in from OFFLINE
      this.started = true;
      this.target = next;
      this.params = { ...next };
      this.tintColor.set(next.tint ?? this.agent.getHex());
      return;
    }
    this.target = next;
    // glitch burst on every state change; harder for bad states
    const now = this.clock.getElapsedTime();
    this.glitchUntil = now + (next.glitch >= 2 ? 0.7 : 0.35);
    this.wild = next.glitch === 3;
  }

  setLook(look: LookTarget): void {
    this.look = look;
  }

  setSpeaking(speaking: boolean): void {
    this.speaking = speaking;
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.observer.disconnect();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  // ---------------------------------------------------------------- loop

  private resize(): void {
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private animate = (): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.animate);
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const t = this.clock.getElapsedTime();

    // ease params toward the target state
    const p = this.params;
    const q = this.target;
    const k = 1 - Math.exp(-dt * 4);
    this.params = {
      eyeOpen: p.eyeOpen + (q.eyeOpen - p.eyeOpen) * k,
      tint: q.tint,
      glow: p.glow + (q.glow - p.glow) * k,
      bloom: p.bloom + (q.bloom - p.bloom) * k,
      glitch: q.glitch,
      spin: p.spin + (q.spin - p.spin) * k,
      scan: p.scan + (q.scan - p.scan) * k,
      mouthIdle: p.mouthIdle + (q.mouthIdle - p.mouthIdle) * k,
      power: p.power + (q.power - p.power) * k,
      tilt: p.tilt + (q.tilt - p.tilt) * k,
    };
    const s = this.params;

    // tint: agent color or state override
    const want = s.tint === null ? this.agent : new THREE.Color(s.tint);
    this.tintColor.lerp(want, k);
    for (const m of this.eyeMats) {
      m.emissive.copy(this.tintColor);
      m.emissiveIntensity = 1.2 * s.glow * s.power;
    }
    this.mouthMat.emissive.copy(this.tintColor);
    this.mouthMat.emissiveIntensity = 1.3 * s.glow * s.power;
    for (const m of this.maskMats) {
      m.emissive.copy(this.tintColor);
      m.emissiveIntensity = 0.04 * s.glow * s.power;
      // dim the whole mask when powered down (OFFLINE); textured or not
      m.color.setScalar(0.3 + 0.7 * s.power);
    }
    this.edgeMat.color.copy(this.tintColor);
    this.edgeMat.opacity = 0.32 * s.power;
    this.ringMat.color.copy(this.tintColor);
    this.ringMat.opacity = (0.35 + 0.25 * Math.sin(t * 2.2)) * s.power;
    this.keyLight.color.copy(this.tintColor);
    this.keyLight.intensity = 14 * s.power;
    this.bloom.strength = s.bloom * 0.8;

    // where to look: base target + wander + scan
    const [lx, ly] = LOOK[this.look];
    const wx = wander(t, 1.3) * 0.35 + s.scan * Math.sin(t * 3.1) * 0.9;
    const wy = wander(t, 4.7) * 0.2;
    this.lookVec.x += (lx + wx - this.lookVec.x) * (1 - Math.exp(-dt * 3));
    this.lookVec.y += (ly + wy - this.lookVec.y) * (1 - Math.exp(-dt * 3));
    // head follows a little, eyes follow a lot
    this.head.rotation.y += (this.lookVec.x * 0.32 - this.head.rotation.y) * (1 - Math.exp(-dt * 2.5));
    this.head.rotation.x += (-this.lookVec.y * 0.22 - this.head.rotation.x) * (1 - Math.exp(-dt * 2.5));
    this.head.rotation.z += (s.tilt + Math.sin(t * 0.8) * 0.02 - this.head.rotation.z) * (1 - Math.exp(-dt * 2));
    this.head.position.y = Math.sin(t * 0.9) * 0.04;
    const focus = new THREE.Vector3(this.lookVec.x * 2.2, this.lookVec.y * 1.6, 4);
    for (const eye of this.eyes) {
      const world = new THREE.Vector3();
      eye.getWorldPosition(world);
      eye.lookAt(focus.clone().add(world).sub(this.head.position));
    }

    // blink + eye openness
    if (t > this.blinkAt) {
      this.blink = 1;
      this.blinkAt = t + 2.5 + Math.random() * 4;
    }
    this.blink = Math.max(0, this.blink - dt * 9);
    const lidY = Math.max(0.04, s.eyeOpen * (1 - Math.min(1, this.blink * 1.6)));
    for (const lid of this.eyeLids) lid.scale.set(Math.min(1.15, 0.85 + s.eyeOpen * 0.2), lidY, 1);

    // mouth
    const targetEnergy = this.speaking ? 1 : s.mouthIdle;
    this.speakEnergy += (targetEnergy - this.speakEnergy) * (1 - Math.exp(-dt * 8));
    for (let i = 0; i < this.mouthBars.length; i++) {
      const bar = this.mouthBars[i];
      const talk = 0.5 + Math.abs(Math.sin(t * 14 + i * 1.7) * Math.sin(t * 5.3 + i)) * 2.4;
      const idle = 0.5 + Math.sin(t * 2 + i * 0.9) * 0.25;
      bar.scale.y = (idle * (1 - this.speakEnergy) + talk * this.speakEnergy) * (0.3 + 0.7 * s.power);
    }

    // ring + dust
    this.ring.rotation.z += dt * s.spin;
    this.particles.rotation.y += dt * 0.02;
    const pp = this.particles.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pp.count; i++) {
      let y = pp.getY(i) + dt * 0.08;
      if (y > 2.6) y = -2.6;
      pp.setY(i, y);
    }
    pp.needsUpdate = true;
    (this.particles.material as THREE.PointsMaterial).opacity = 0.55 * s.power;
    (this.particles.material as THREE.PointsMaterial).color.copy(this.tintColor);

    // glitch: burst after a state change, rare flickers in level 1, continuous in 2, wild in 3
    const burst = t < this.glitchUntil;
    const flicker = s.glitch === 1 && Math.random() < 0.004;
    this.glitch.enabled = burst || flicker || s.glitch >= 2;
    this.glitch.goWild = this.wild && burst;
    (this.rgb.uniforms as Record<string, { value: number }>).amount.value = burst ? 0.006 : 0.0012 + (s.glitch >= 2 ? 0.002 : 0);

    this.composer.render();
  };
}

/**
 * The mask: a squashed sphere, flattened at the back, sculpted with a brow, nose, eye sockets,
 * cheekbones and a chin, then made faceted (non-indexed + flat normals). Original geometry.
 */
function buildMaskGeometry(): THREE.BufferGeometry {
  const geo = new THREE.SphereGeometry(1, 48, 36);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const bump = (d: number, r: number) => (d >= r ? 0 : Math.cos((d / r) * Math.PI * 0.5) ** 2);
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i) * 0.84;
    let y = pos.getY(i) * 1.12;
    let z = pos.getZ(i) * 0.72;
    if (z < -0.12) z = -0.12 - (z + 0.12) * 0.15; // hollow back: a shell, not a ball
    if (z > 0) {
      const ax = Math.abs(x);
      // brow ridge, soft and wide, slightly angled toward the nose
      z += 0.045 * bump(Math.abs(y - (0.46 - ax * 0.06)), 0.2) * bump(ax, 0.8);
      // eye sockets
      for (const sx of [-1, 1]) z -= 0.11 * bump(Math.hypot(x - sx * 0.4, (y - 0.27) * 1.3), 0.27);
      // nose: a soft ridge that widens toward the tip (smooth falloff, no prism)
      const noseW = 0.1 + 0.1 * Math.max(0, Math.min(1, (0.2 - y) / 0.5));
      z += 0.075 * bump(ax, noseW) * bump(Math.abs(y + 0.02), 0.38);
      z += 0.035 * bump(Math.hypot(x * 0.9, y + 0.24), 0.16);
      // cheekbones
      for (const sx of [-1, 1]) z += 0.07 * bump(Math.hypot((x - sx * 0.6) * 1.1, y + 0.02), 0.3);
      // mouth recess + chin
      z -= 0.05 * bump(Math.hypot(x * 0.8, y + 0.5), 0.3);
      z += 0.06 * bump(Math.hypot(x * 1.2, y + 0.85), 0.28);
      // temples pulled back a little for a helmet-like silhouette
      z -= 0.05 * bump(Math.abs(ax - 0.78), 0.12) * bump(Math.abs(y - 0.3), 0.5);
    }
    pos.setXYZ(i, x, y, z);
  }
  // flatShading facets the sculpted surface: at 48x36 segments the facets read as a polished
  // low-poly finish rather than as blocky chunks.
  const faceted = geo.toNonIndexed();
  faceted.computeVertexNormals();
  geo.dispose();
  return faceted;
}
