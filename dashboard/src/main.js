import * as THREE from 'three';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

// Register GSAP ScrollTrigger plugin
gsap.registerPlugin(ScrollTrigger);

class SoundEngine {
  constructor() {
    this.ctx = null;
    this.muted = true;
    this.lastSliderSoundTime = 0;
  }

  init() {
    if (this.ctx) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
  }

  setMute(muted) {
    this.muted = muted;
    if (!muted) {
      this.init();
      // Melodic unmute sound (Gold vibe)
      this.playChime([261.63, 329.63, 392.00, 523.25], 0.08, 0.12);
    } else {
      // Muted descending sweep
      this.playChime([392.00, 329.63, 261.63], 0.06, 0.08);
    }
  }

  playChime(notes, duration = 0.1, delayMultiplier = 0.15) {
    if (this.muted || !this.ctx) return;
    const now = this.ctx.currentTime;
    notes.forEach((freq, index) => {
      const osc = this.ctx.createOscillator();
      const gainNode = this.ctx.createGain();
      
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + index * delayMultiplier);
      
      gainNode.gain.setValueAtTime(0, now + index * delayMultiplier);
      gainNode.gain.linearRampToValueAtTime(0.06, now + index * delayMultiplier + 0.02);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, now + index * delayMultiplier + duration);
      
      osc.connect(gainNode);
      gainNode.connect(this.ctx.destination);
      
      osc.start(now + index * delayMultiplier);
      osc.stop(now + index * delayMultiplier + duration);
    });
  }

  playHover() {
    if (this.muted || !this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gainNode = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(987.77, now); // B5
    osc.frequency.exponentialRampToValueAtTime(587.33, now + 0.06); // D5

    gainNode.gain.setValueAtTime(0.012, now);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.06);

    osc.connect(gainNode);
    gainNode.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + 0.06);
  }

  playClick() {
    if (this.muted || !this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gainNode = this.ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(440, now);
    osc.frequency.setValueAtTime(880, now + 0.03);

    gainNode.gain.setValueAtTime(0.04, now);
    gainNode.gain.linearRampToValueAtTime(0.025, now + 0.03);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.1);

    osc.connect(gainNode);
    gainNode.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + 0.1);
  }

  playSlider(value, min = 0, max = 100) {
    if (this.muted || !this.ctx) return;
    
    // Throttle slider sound to prevent audio buffer overload
    const now = Date.now();
    if (now - this.lastSliderSoundTime < 60) return;
    this.lastSliderSoundTime = now;

    const audioNow = this.ctx.currentTime;
    const percent = (value - min) / (max - min);
    // Gold/Red range: 220Hz (Warm Gold) to 587Hz (Cyber Red)
    const freq = 220 + percent * 367;

    const osc = this.ctx.createOscillator();
    const gainNode = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, audioNow);

    gainNode.gain.setValueAtTime(0.015, audioNow);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, audioNow + 0.1);

    osc.connect(gainNode);
    gainNode.connect(this.ctx.destination);

    osc.start(audioNow);
    osc.stop(audioNow + 0.1);
  }
}
const soundEngine = new SoundEngine();

export function initLandingPage() {
  const controller = new AbortController();
  const { signal } = controller;

  let animationFrameId;
  let followerFrameId;

  // ==========================================
  // 1. THREE.JS 3D PARTICLE MORPHING SYSTEM
  // ==========================================

  const canvas = document.getElementById('canvas-3d');
  const container = document.getElementById('canvas-container');

  let renderer;
  let particleTexture;
  let pointsGeometry;
  let pointsMaterial;
  let lineGeometry;
  let lineMaterial;
  let particlePoints;
  let networkLines;

  if (canvas && container) {
    // Scene & Camera
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      60,
      container.clientWidth / container.clientHeight,
      0.1,
      100
    );
    camera.position.z = 10;

    // WebGL Renderer
    renderer = new THREE.WebGLRenderer({
      canvas: canvas,
      antialias: true,
      alpha: true // enables transparent canvas showing CSS background grids/gradients
    });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    // Glowing particle texture (Cyan and Indigo)
    function createParticleTexture() {
      const pCanvas = document.createElement('canvas');
      pCanvas.width = 32;
      pCanvas.height = 32;
      const ctx = pCanvas.getContext('2d');
      const gradient = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
      gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
      gradient.addColorStop(0.2, 'rgba(0, 242, 254, 0.85)'); // Pleasing cyan center
      gradient.addColorStop(0.5, 'rgba(99, 102, 241, 0.35)'); // Pleasing indigo ring
      gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 32, 32);
      return new THREE.CanvasTexture(pCanvas);
    }
    particleTexture = createParticleTexture();

    // Particle Generation Variables
    const numPoints = 600;
    const phi = Math.PI * (3 - Math.sqrt(5)); // Golden angle

    // Base colors mapped to pleasing cyan, blue, indigo, and violet
    const colorCyan = new THREE.Color('#00f2fe'); // Electric Cyan
    const colorIndigo = new THREE.Color('#4facfe'); // Sky Blue
    const colorPurple = new THREE.Color('#6366f1'); // Pleasing Indigo
    const colorPink = new THREE.Color('#a855f7'); // Soft Purple
    const colorGray = new THREE.Color('#1e293b'); // Dark Slate/Gray

    // Morph Target Arrays
    const spherePositions = new Float32Array(numPoints * 3);
    const sphereColors = new Float32Array(numPoints * 3);

    const chaosPositions = new Float32Array(numPoints * 3);
    const chaosColors = new Float32Array(numPoints * 3);

    const layeredPositions = new Float32Array(numPoints * 3);
    const layeredColors = new Float32Array(numPoints * 3);

    const gridPositions = new Float32Array(numPoints * 3);
    const gridColors = new Float32Array(numPoints * 3);

    const funnelPositions = new Float32Array(numPoints * 3);
    const funnelColors = new Float32Array(numPoints * 3);

    const helixPositions = new Float32Array(numPoints * 3);
    const helixColors = new Float32Array(numPoints * 3);

    // 1. SPHERE FORMATION (Hero)
    const sphereRadius = 4.5;
    for (let i = 0; i < numPoints; i++) {
      const y = 1 - (i / (numPoints - 1)) * 2;
      const r = Math.sqrt(1 - y * y);
      const theta = phi * i;
      spherePositions[i * 3] = Math.cos(theta) * r * sphereRadius;
      spherePositions[i * 3 + 1] = y * sphereRadius;
      spherePositions[i * 3 + 2] = Math.sin(theta) * r * sphereRadius;

      // Blend Colors: Cyan (top) -> Indigo (middle) -> Purple (bottom)
      let col = colorIndigo.clone();
      if (y > 0.3) col.lerp(colorCyan, (y - 0.3) / 0.7);
      else if (y < -0.3) col.lerp(colorPurple, Math.abs(y + 0.3) / 0.7);

      sphereColors[i * 3] = col.r;
      sphereColors[i * 3 + 1] = col.g;
      sphereColors[i * 3 + 2] = col.b;
    }

    // 2. CHAOS CLOUD FORMATION (Problem)
    for (let i = 0; i < numPoints; i++) {
      chaosPositions[i * 3] = (Math.random() - 0.5) * 14;
      chaosPositions[i * 3 + 1] = (Math.random() - 0.5) * 8;
      chaosPositions[i * 3 + 2] = (Math.random() - 0.5) * 8;

      // Drab, disorganized colors (grayish indigos)
      let col = colorIndigo.clone().lerp(colorGray, 0.7);
      chaosColors[i * 3] = col.r;
      chaosColors[i * 3 + 1] = col.g;
      chaosColors[i * 3 + 2] = col.b;
    }

    // 3. LAYERED RINGS FORMATION (Solution)
    for (let i = 0; i < numPoints; i++) {
      const layer = i % 3; // 0, 1, or 2
      const angle = (i / numPoints) * Math.PI * 2 * 3;
      const r = 3.8 + Math.sin(i * 12) * 0.15; // wavy circles

      layeredPositions[i * 3] = Math.cos(angle) * r;
      layeredPositions[i * 3 + 1] = (layer - 1) * 2.5; // spaced height
      layeredPositions[i * 3 + 2] = Math.sin(angle) * r;

      // Color by layer: Layer 1 = Cyan, Layer 2 = Purple, Layer 3 = Pink
      let col;
      if (layer === 0) col = colorCyan;
      else if (layer === 1) col = colorPurple;
      else col = colorPink;

      layeredColors[i * 3] = col.r;
      layeredColors[i * 3 + 1] = col.g;
      layeredColors[i * 3 + 2] = col.b;
    }

    // 4. GRID PLANE FORMATION (Matrix/Competition)
    const gridSize = Math.floor(Math.sqrt(numPoints)); // ~24
    for (let i = 0; i < numPoints; i++) {
      const row = Math.floor(i / gridSize);
      const col = i % gridSize;
      gridPositions[i * 3] = ((col / gridSize) - 0.5) * 11;
      gridPositions[i * 3 + 1] = ((row / gridSize) - 0.5) * 8;
      gridPositions[i * 3 + 2] = Math.sin(row * 0.4) * Math.cos(col * 0.4) * 0.6; // wave wave

      // Digital cyan-indigo grid colors
      let c = colorIndigo.clone().lerp(colorCyan, col / gridSize);
      gridColors[i * 3] = c.r;
      gridColors[i * 3 + 1] = c.g;
      gridColors[i * 3 + 2] = c.b;
    }

    // 5. FUNNEL VORTEX FORMATION (Calculator)
    for (let i = 0; i < numPoints; i++) {
      const t = i / numPoints;
      const y = (t - 0.5) * 10;
      const radius = (t * 4.0) + 0.4; // funnel opening
      const angle = t * Math.PI * 18;

      funnelPositions[i * 3] = Math.cos(angle) * radius;
      funnelPositions[i * 3 + 1] = y;
      funnelPositions[i * 3 + 2] = Math.sin(angle) * radius;

      // Glowing Cyan funnel
      funnelColors[i * 3] = colorCyan.r;
      funnelColors[i * 3 + 1] = colorCyan.g;
      funnelColors[i * 3 + 2] = colorCyan.b;
    }

    // 6. DNA HELIX FORMATION (Contact)
    for (let i = 0; i < numPoints; i++) {
      const t = i / numPoints;
      const y = (t - 0.5) * 10;
      const strand = i % 2;
      const angle = t * Math.PI * 8 + (strand * Math.PI);
      const radius = 2.4;

      helixPositions[i * 3] = Math.cos(angle) * radius;
      helixPositions[i * 3 + 1] = y;
      helixPositions[i * 3 + 2] = Math.sin(angle) * radius;

      // Alternate strands Cyan vs Indigo
      let col = (strand === 0) ? colorCyan : colorIndigo;
      helixColors[i * 3] = col.r;
      helixColors[i * 3 + 1] = col.g;
      helixColors[i * 3 + 2] = col.b;
    }

    // Active Pointers
    let activeTarget = spherePositions;
    let activeColorTarget = sphereColors;
    let linesOpacityTarget = 0.12;

    // Initialize Point Geometry
    pointsGeometry = new THREE.BufferGeometry();
    // Copy initial sphere positions and colors
    const runPositions = new Float32Array(spherePositions);
    const runColors = new Float32Array(sphereColors);

    pointsGeometry.setAttribute('position', new THREE.BufferAttribute(runPositions, 3));
    pointsGeometry.setAttribute('color', new THREE.BufferAttribute(runColors, 3));

    pointsMaterial = new THREE.PointsMaterial({
      size: 0.3,
      map: particleTexture,
      transparent: true,
      vertexColors: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    particlePoints = new THREE.Points(pointsGeometry, pointsMaterial);
    scene.add(particlePoints);

    // Network Lines (Only for Hero/Sphere state)
    const lineIndices = [];
    for (let i = 0; i < numPoints; i++) {
      const p1 = new THREE.Vector3(spherePositions[i * 3], spherePositions[i * 3 + 1], spherePositions[i * 3 + 2]);
      for (let j = i + 1; j < numPoints; j++) {
        const p2 = new THREE.Vector3(spherePositions[j * 3], spherePositions[j * 3 + 1], spherePositions[j * 3 + 2]);
        if (p1.distanceTo(p2) < 1.1) {
          lineIndices.push(i, j);
        }
      }
    }

    lineGeometry = new THREE.BufferGeometry();
    lineGeometry.setAttribute('position', new THREE.BufferAttribute(spherePositions, 3));
    lineGeometry.setIndex(lineIndices);

    lineMaterial = new THREE.LineBasicMaterial({
      color: 0x00f2fe, // Cyan/blue connecting lines
      transparent: true,
      opacity: 0.12,
      blending: THREE.AdditiveBlending
    });

    networkLines = new THREE.LineSegments(lineGeometry, lineMaterial);
    scene.add(networkLines);

    // Interaction variables
    let mouseX = 0;
    let mouseY = 0;
    let targetX = 0;
    let targetY = 0;

    window.addEventListener('mousemove', (event) => {
      mouseX = (event.clientX / window.innerWidth) * 2 - 1;
      mouseY = -(event.clientY / window.innerHeight) * 2 + 1;
    }, { signal });

    // Global scroll listener to rotate scene
    let scrollY = 0;
    window.addEventListener('scroll', () => {
      scrollY = window.scrollY;
    }, { signal });

    // Animation Frame Loop
    const clock = new THREE.Clock();

    function animate() {
      animationFrameId = requestAnimationFrame(animate);

      const elapsedTime = clock.getElapsedTime();

      // 1. SWARM LERP (Morph Positions & Colors)
      const currentPos = pointsGeometry.attributes.position.array;
      const currentCol = pointsGeometry.attributes.color.array;

      for (let i = 0; i < numPoints * 3; i++) {
        // Lerp position
        currentPos[i] += (activeTarget[i] - currentPos[i]) * 0.07;
        // Lerp color
        currentCol[i] += (activeColorTarget[i] - currentCol[i]) * 0.07;
      }
      pointsGeometry.attributes.position.needsUpdate = true;
      pointsGeometry.attributes.color.needsUpdate = true;

      // 2. LINE OPACITY LERP
      lineMaterial.opacity += (linesOpacityTarget - lineMaterial.opacity) * 0.07;
      // Lines positions follow the active particles
      const linePos = lineGeometry.attributes.position.array;
      for (let i = 0; i < numPoints * 3; i++) {
        linePos[i] = currentPos[i];
      }
      lineGeometry.attributes.position.needsUpdate = true;

      // 3. SCENE ROTATIONS & PARALLAX
      targetX = mouseX * 0.2;
      targetY = mouseY * 0.2;

      // Constant slow drift
      particlePoints.rotation.y = elapsedTime * 0.06;
      networkLines.rotation.y = elapsedTime * 0.06;

      // Mouse tilt interaction
      particlePoints.rotation.x += (targetY - particlePoints.rotation.x) * 0.05;
      particlePoints.rotation.y += (targetX - particlePoints.rotation.y) * 0.05;

      networkLines.rotation.x += (targetY - networkLines.rotation.x) * 0.05;
      networkLines.rotation.y += (targetX - networkLines.rotation.y) * 0.05;

      // Scroll interaction
      const scrollFactor = scrollY * 0.0006;
      particlePoints.rotation.z = scrollFactor;
      networkLines.rotation.z = scrollFactor;

      // Pulse size slightly
      const scalePulse = 1.0 + Math.sin(elapsedTime * 0.7) * 0.02;
      particlePoints.scale.set(scalePulse, scalePulse, scalePulse);
      networkLines.scale.set(scalePulse, scalePulse, scalePulse);

      renderer.render(scene, camera);
    }

    animate();

    // Resize Handler
    window.addEventListener('resize', () => {
      if (container && camera && renderer) {
        camera.aspect = container.clientWidth / container.clientHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(container.clientWidth, container.clientHeight);
      }
    }, { signal });

    // ==========================================
    // GSAP SCROLLTRIGGERS FOR 3D STATE MORPHING
    // ==========================================
    
    // State 0: Sphere (Hero)
    ScrollTrigger.create({
      trigger: '#hero',
      start: 'top 70%',
      end: 'bottom 30%',
      onToggle: (self) => {
        if (self.isActive) {
          activeTarget = spherePositions;
          activeColorTarget = sphereColors;
          linesOpacityTarget = 0.12; // fade lines in
          gsap.to(camera.position, { x: -2.5, duration: 1.2, ease: 'power2.out' });
        } else {
          gsap.to(camera.position, { x: 0, duration: 1.2, ease: 'power2.out' });
        }
      }
    });

    // State 1: Chaos Cloud (Problem)
    ScrollTrigger.create({
      trigger: '#problem',
      start: 'top 70%',
      end: 'bottom 30%',
      onToggle: (self) => {
        if (self.isActive) {
          activeTarget = chaosPositions;
          activeColorTarget = chaosColors;
          linesOpacityTarget = 0.0; // fade lines out
        }
      }
    });

    // State 2: Layered Rings (Solution)
    ScrollTrigger.create({
      trigger: '#solution',
      start: 'top 70%',
      end: 'bottom 30%',
      onToggle: (self) => {
        if (self.isActive) {
          activeTarget = layeredPositions;
          activeColorTarget = layeredColors;
          linesOpacityTarget = 0.0;
        }
      }
    });

    // State 3: Flat Grid (Matrix)
    ScrollTrigger.create({
      trigger: '#matrix',
      start: 'top 70%',
      end: 'bottom 30%',
      onToggle: (self) => {
        if (self.isActive) {
          activeTarget = gridPositions;
          activeColorTarget = gridColors;
          linesOpacityTarget = 0.0;
        }
      }
    });

    // State 4: Funnel (Calculator)
    ScrollTrigger.create({
      trigger: '#calculator',
      start: 'top 70%',
      end: 'bottom 30%',
      onToggle: (self) => {
        if (self.isActive) {
          activeTarget = funnelPositions;
          activeColorTarget = funnelColors;
          linesOpacityTarget = 0.0;
        }
      }
    });

    // State 5: Double Helix (Contact)
    ScrollTrigger.create({
      trigger: '#contact',
      start: 'top 70%',
      end: 'bottom bottom',
      onToggle: (self) => {
        if (self.isActive) {
          activeTarget = helixPositions;
          activeColorTarget = helixColors;
          linesOpacityTarget = 0.0;
        }
      }
    });
  }

  // ==========================================
  // 2. GSAP PAGE ANIMATIONS
  // ==========================================

  // Smooth fade navigation
  gsap.from('#nav-header', {
    y: -30,
    opacity: 0,
    duration: 1.2,
    ease: 'power3.out'
  });

  // Fade-in sections
  const sections = document.querySelectorAll('.container');
  sections.forEach((sec) => {
    gsap.from(sec, {
      opacity: 0,
      y: 40,
      duration: 0.8,
      ease: 'power2.out',
      scrollTrigger: {
        trigger: sec,
        start: 'top 80%',
        toggleActions: 'play none none none'
      }
    });
  });

  // Hero animations
  gsap.from('.hero-left h1', {
    y: 35,
    opacity: 0,
    duration: 1.3,
    delay: 0.2,
    ease: 'power4.out'
  });

  gsap.from('.hero-left p, .hero-left .badge', {
    y: 20,
    opacity: 0,
    duration: 1.0,
    delay: 0.5,
    ease: 'power3.out'
  });

  gsap.from('.hero-cta', {
    y: 20,
    opacity: 0,
    duration: 0.8,
    delay: 0.7,
    ease: 'power3.out'
  });

  // Animate progress bar fill to 98%
  const progressFill = document.getElementById('hero-progress-fill');
  if (progressFill) {
    gsap.to(progressFill, {
      width: '98%',
      duration: 2.0,
      delay: 1.0,
      ease: 'power2.out'
    });
  }

  // Idle floating animation for Hero Cards (using top/bottom to avoid transform collision)
  gsap.to('#card-match-3d', {
    top: '+=12px',
    duration: 3,
    repeat: -1,
    yoyo: true,
    ease: 'power1.inOut'
  });
  gsap.to('#card-review-3d', {
    top: '-=15px',
    duration: 3.5,
    repeat: -1,
    yoyo: true,
    ease: 'power1.inOut',
    delay: 0.4
  });
  gsap.to('#card-hired-3d', {
    bottom: '+=10px',
    duration: 2.8,
    repeat: -1,
    yoyo: true,
    ease: 'power1.inOut',
    delay: 0.8
  });

  // ==========================================
  // 3. DYNAMIC 3D CARD TILT & SPOTLIGHT
  // ==========================================

  const cards = document.querySelectorAll('.glass-card');
  cards.forEach((card) => {
    card.addEventListener('mousemove', (e) => {
      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      
      // Set spotlight variable
      card.style.setProperty('--mouse-x', `${x}px`);
      card.style.setProperty('--mouse-y', `${y}px`);
      
      // Angle Calculations for Perspective Rotation
      const xc = rect.width / 2;
      const yc = rect.height / 2;
      // Cap tilt angle to max 12 degrees
      const angleX = -(y - yc) / 10;
      const angleY = (x - xc) / 10;
      
      card.style.transform = `perspective(1000px) rotateX(${angleX}deg) rotateY(${angleY}deg)`;
    }, { signal });
    
    card.addEventListener('mouseleave', () => {
      card.style.transform = 'perspective(1000px) rotateX(0deg) rotateY(0deg)';
      card.style.removeProperty('--mouse-x');
      card.style.removeProperty('--mouse-y');
    }, { signal });
  });

  // ==========================================
  // 4. SOLUTION TABS SWITCHER
  // ==========================================

  const tabButtons = document.querySelectorAll('#solution-tabs-container .tab-btn');
  const layerCards = document.querySelectorAll('#solution-layers-stack .solution-card');

  const video = document.getElementById('pipeline-video');
  const statusText = document.getElementById('video-status-text');
  const statusDot = document.querySelector('.video-status-badge .status-dot');

  const videoRanges = {
    layer1: { min: 0.0, max: 4.2, label: "AI Screening & Filtering", color: "#d4af37" },
    layer2: { min: 4.2, max: 7.2, label: "Expert Human Vetting", color: "#ff0d3f" },
    layer3: { min: 7.2, max: 10.0, label: "Verified Decisive Hiring", color: "#ffc72c" }
  };

  let currentRange = videoRanges.layer1;

  if (video) {
    // Seek to the start of the default range
    video.currentTime = currentRange.min;
    
    // Custom looping constraints
    video.addEventListener('timeupdate', () => {
      if (video.currentTime >= currentRange.max) {
        video.currentTime = currentRange.min;
      } else if (video.currentTime < currentRange.min) {
        video.currentTime = currentRange.min;
      }
    }, { signal });

    // Attempt to play
    video.play().catch(err => {
      console.log("Autoplay was prevented, will play on user interaction:", err);
    });
  }

  const hotspots = document.querySelectorAll('.video-hotspot');

  function updatePipeline(tabId) {
    const range = videoRanges[tabId];
    if (!range) return;

    currentRange = range;

    if (statusText) {
      statusText.textContent = range.label;
    }

    if (statusDot) {
      statusDot.style.backgroundColor = range.color;
      statusDot.style.boxShadow = `0 0 10px ${range.color}`;
    }

    if (video) {
      // If the video current time is outside the target range, seek to the start of it
      if (video.currentTime < range.min || video.currentTime > range.max) {
        video.currentTime = range.min;
        video.play().catch(err => console.log("Play failed on range switch:", err));
      }
    }

    // Update active state on hotspots
    hotspots.forEach((hs) => {
      if (hs.getAttribute('data-tab') === tabId) {
        hs.classList.add('active');
      } else {
        hs.classList.remove('active');
      }
    });

    // Sound Engine chimes
    if (tabId === 'layer1') {
      soundEngine.playChime([261.63, 329.63], 0.12, 0.15); // C4 -> E4
    } else if (tabId === 'layer2') {
      soundEngine.playChime([261.63, 329.63, 392.00], 0.12, 0.15); // C4 -> E4 -> G4
    } else if (tabId === 'layer3') {
      soundEngine.playChime([261.63, 329.63, 392.00, 523.25], 0.15, 0.12); // C4 -> E4 -> G4 -> C5
    }
  }

  // Initial active setup
  updatePipeline('layer1');

  tabButtons.forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation(); // Avoid parent card event bubble issues
      tabButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const targetTab = btn.getAttribute('data-tab');
      layerCards.forEach((card) => {
        card.classList.remove('active');
        if (card.id === `card-${targetTab}`) {
          card.classList.add('active');
        }
      });

      updatePipeline(targetTab);
    }, { signal });
  });

  // Click listener routing for video hotspots
  hotspots.forEach((hs) => {
    hs.addEventListener('click', (e) => {
      e.stopPropagation(); // Prevent duplicate sound triggers from bubbling up to parent cards
      const targetTab = hs.getAttribute('data-tab');
      const matchingBtn = document.getElementById(`tab-${targetTab}`);
      if (matchingBtn) {
        matchingBtn.click();
      }
    }, { signal });
  });

  // ==========================================
  // 5. CALCULATOR
  // ==========================================

  const hiresSlider = document.getElementById('hires-slider');
  const salarySlider = document.getElementById('salary-slider');

  const valHiresDisplay = document.getElementById('val-hires');
  const valSalaryDisplay = document.getElementById('val-salary');

  const savedMoneyDisplay = document.getElementById('saved-money');
  const savedHoursDisplay = document.getElementById('saved-hours');

  function formatCurrency(num) {
    return '$' + num.toLocaleString('en-US');
  }

  function calculateSavings() {
    if (!hiresSlider || !salarySlider) return;

    const hires = parseInt(hiresSlider.value, 10);
    const salary = parseInt(salarySlider.value, 10);

    valHiresDisplay.textContent = hires;
    valSalaryDisplay.textContent = formatCurrency(salary);

    const recruitingCostSaved = hires * salary * 0.08; 
    const hoursSaved = hires * 35;

    savedMoneyDisplay.textContent = formatCurrency(Math.round(recruitingCostSaved));
    savedHoursDisplay.textContent = `${hoursSaved} hrs`;
  }

  if (hiresSlider && salarySlider) {
    hiresSlider.addEventListener('input', (e) => {
      calculateSavings();
      soundEngine.playSlider(parseFloat(e.target.value), parseFloat(hiresSlider.min), parseFloat(hiresSlider.max));
    }, { signal });
    salarySlider.addEventListener('input', (e) => {
      calculateSavings();
      soundEngine.playSlider(parseFloat(e.target.value), parseFloat(salarySlider.min), parseFloat(salarySlider.max));
    }, { signal });
    calculateSavings();
  }

  // ==========================================
  // 6. CONTACT FORM SUBMISSION
  // ==========================================

  const pilotForm = document.getElementById('pilot-form');
  const formSuccess = document.getElementById('form-success');

  if (pilotForm) {
    pilotForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const submitBtn = pilotForm.querySelector('button[type="submit"]');
      if (submitBtn) {
        submitBtn.textContent = 'Submitting...';
        submitBtn.disabled = true;
      }

      setTimeout(() => {
        pilotForm.reset();
        if (submitBtn) submitBtn.style.display = 'none';
        if (formSuccess) formSuccess.style.display = 'block';
      }, 1200);
    }, { signal });
  }

  // ==========================================
  // 7. INTERACTIVE WEB AUDIO SYNTHESIZER
  // ==========================================

  // Sound toggle button setup
  const soundToggleBtn = document.getElementById('sound-toggle-btn');
  if (soundToggleBtn) {
    soundToggleBtn.addEventListener('click', () => {
      const isMuted = soundToggleBtn.classList.toggle('muted');
      soundEngine.setMute(isMuted);
    }, { signal });
  }

  // ==========================================
  // 8. CUSTOM CURSOR TRAIL PHYSICS
  // ==========================================

  const cursorDot = document.getElementById('custom-cursor');
  const cursorFollower = document.getElementById('cursor-follower');

  let posX = 0, posY = 0;
  let cursorMouseX = 0, cursorMouseY = 0;

  window.addEventListener('mousemove', (e) => {
    cursorMouseX = e.clientX;
    cursorMouseY = e.clientY;

    if (cursorDot) {
      cursorDot.style.left = `${cursorMouseX}px`;
      cursorDot.style.top = `${cursorMouseY}px`;
    }
  }, { signal });

  function updateFollower() {
    const ease = 0.12; // Trail easing coefficient
    posX += (cursorMouseX - posX) * ease;
    posY += (cursorMouseY - posY) * ease;

    if (cursorFollower) {
      cursorFollower.style.left = `${posX}px`;
      cursorFollower.style.top = `${posY}px`;
    }

    followerFrameId = requestAnimationFrame(updateFollower);
  }
  updateFollower();

  // Hook cursor hover and click sounds for all interactive components
  const interactiveElements = document.querySelectorAll(
    'a, button, input, select, textarea, .btn, .tab-btn, .glass-card, #logo-link, footer .footer-logo, .pipeline-node'
  );

  interactiveElements.forEach((el) => {
    el.addEventListener('mouseenter', () => {
      document.body.classList.add('cursor-hovering');
      soundEngine.playHover();
    }, { signal });
    el.addEventListener('mouseleave', () => {
      document.body.classList.remove('cursor-hovering');
    }, { signal });
    el.addEventListener('click', () => {
      soundEngine.playClick();
    }, { signal });
  });

  // ==========================================
  // 9. SCROLL-DRIVEN TRANSITION MORPH TRIGGER
  // ==========================================
  if (document.querySelector('.transition-morph-section')) {
    // Set initial properties via GSAP to prevent flash
    gsap.set('#morph-text-1', { opacity: 1, scale: 1 });
    gsap.set('#morph-text-2', { opacity: 0, scale: 0.9 });
    gsap.set('#morph-text-3', { opacity: 0, scale: 0.9 });
    gsap.set('#morph-human-wrapper', { opacity: 1, zIndex: 2 });
    gsap.set('#morph-ai-wrapper', { opacity: 0, zIndex: 1 });
    gsap.set('#morph-scan-line', { opacity: 0, top: '-10%' });
    gsap.set('#morph-label-traditional', { opacity: 1 });
    gsap.set('#morph-label-agent', { opacity: 0 });
    gsap.set('#morph-scroll-hint', { opacity: 0.5 });
    
    // HUD Initial Positions
    gsap.set('.hud-left', { x: 0, opacity: 0.5 });
    gsap.set('.hud-right', { x: 0, opacity: 0.5 });

    // Web Audio frequency sweep function linked to scanning
    const playScanSweep = (freqProgress) => {
      if (soundEngine.muted || !soundEngine.ctx) return;
      const now = soundEngine.ctx.currentTime;
      const osc = soundEngine.ctx.createOscillator();
      const gainNode = soundEngine.ctx.createGain();
      
      osc.type = 'sine';
      // Frequency sweeps from 180Hz to 680Hz based on scroll progress
      const currentFreq = 180 + freqProgress * 500;
      osc.frequency.setValueAtTime(currentFreq, now);

      gainNode.gain.setValueAtTime(0.008, now);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);

      osc.connect(gainNode);
      gainNode.connect(soundEngine.ctx.destination);
      
      osc.start(now);
      osc.stop(now + 0.05);
    };

    const morphTL = gsap.timeline({
      scrollTrigger: {
        trigger: '.transition-morph-section',
        start: 'top top',
        end: '+=250%', // Pin for 2.5 viewports of scrolling
        scrub: 1.0,    // Eased scrub
        pin: true,     // GSAP Pinning handles stickiness
        pinSpacing: true,
        onUpdate: (self) => {
          // Trigger scanning sweeps based on scan timeline progress (between 0.35 and 0.7)
          if (self.progress > 0.35 && self.progress < 0.7) {
            const scanP = (self.progress - 0.35) / 0.35;
            playScanSweep(scanP);
          }

          // Dynamically update HUD text parameters based on progress
          const biasElement = document.getElementById('hud-val-bias');
          const objectivityElement = document.getElementById('hud-val-objectivity');
          const consistencyElement = document.getElementById('hud-val-consistency');
          const availabilityElement = document.getElementById('hud-val-availability');
          const modeElement = document.getElementById('hud-val-mode');

          if (self.progress < 0.45) {
            if (biasElement) biasElement.textContent = "84.2%";
            if (objectivityElement) objectivityElement.textContent = "N/A";
            if (modeElement) {
              modeElement.textContent = "TRADITIONAL";
              modeElement.className = "hud-glow-red";
            }
          } else if (self.progress >= 0.45 && self.progress < 0.7) {
            const biasDec = Math.max(0, Math.round(84.2 - (self.progress - 0.45) / 0.25 * 84.2));
            if (biasElement) biasElement.textContent = `${biasDec}%`;
            if (objectivityElement) objectivityElement.textContent = "CALCULATING...";
          } else {
            if (biasElement) {
              biasElement.textContent = "0.0%";
              biasElement.className = "hud-glow-gold";
            }
            if (objectivityElement) {
              objectivityElement.textContent = "100%";
              objectivityElement.className = "hud-glow-gold";
            }
            if (consistencyElement) consistencyElement.textContent = "MAXIMUM";
            if (availabilityElement) availabilityElement.textContent = "24/7/365";
            if (modeElement) {
              modeElement.textContent = "intervieHire AGENT";
              modeElement.className = "hud-glow-gold";
            }
          }
        }
      }
    });

    morphTL
      // 1. Text 1 fades out, HUD nodes reveal
      .to('#morph-scroll-hint', { opacity: 0, duration: 0.1 }, 0)
      .to('.hud-left', { x: 120, opacity: 1, duration: 0.2 }, 0)
      .to('.hud-right', { x: -120, opacity: 1, duration: 0.2 }, 0)
      .to('#morph-text-1', { opacity: 0, scale: 0.95, duration: 0.15 }, 0.1)
      
      // 2. Text 2 fades in
      .to('#morph-text-2', { opacity: 1, scale: 1, duration: 0.2 }, 0.25)
      
      // 3. Scan line sweep and cross-fade figures
      .to('#morph-scan-line', { opacity: 1, duration: 0.05 }, 0.35)
      .to('#morph-scan-line', { top: '110%', duration: 0.35 }, 0.35)
      .to('#morph-scan-line', { opacity: 0, duration: 0.05 }, 0.7)
      
      .to('#morph-human-wrapper', { opacity: 0, duration: 0.2 }, 0.4)
      .to('#morph-ai-wrapper', { opacity: 1, duration: 0.2 }, 0.4)
      .to('#morph-label-traditional', { opacity: 0, duration: 0.2 }, 0.4)
      .to('#morph-label-agent', { opacity: 1, duration: 0.2 }, 0.4)
      
      // 4. Text 2 fades out, Text 3 fades in
      .to('#morph-text-2', { opacity: 0, scale: 0.95, duration: 0.15 }, 0.55)
      .to('#morph-text-3', { opacity: 1, scale: 1, duration: 0.7 }, 0.7)
      
      // 5. HUD elements fly away and fade
      .to('.hud-left', { x: 0, opacity: 0.3, duration: 0.2 }, 0.8)
      .to('.hud-right', { x: 0, opacity: 0.3, duration: 0.2 }, 0.8);

    // Manage pulsing class trigger on AI wrapper based on scroll progress
    ScrollTrigger.create({
      trigger: '.transition-morph-section',
      start: 'top top',
      end: 'bottom bottom',
      onUpdate: (self) => {
        const aiWrap = document.getElementById('morph-ai-wrapper');
        if (aiWrap) {
          if (self.progress > 0.6) {
            aiWrap.classList.add('pulsing');
          } else {
            aiWrap.classList.remove('pulsing');
          }
        }
      }
    });
  }

  // Cleanup handler returning from initLandingPage
  return () => {
    controller.abort();
    cancelAnimationFrame(animationFrameId);
    cancelAnimationFrame(followerFrameId);

    // Tear down GSAP Triggers
    ScrollTrigger.getAll().forEach(t => t.kill());

    // Tear down Three.js renderer & memory allocations
    if (renderer) {
      renderer.dispose();
    }
    if (particleTexture) {
      particleTexture.dispose();
    }
    if (pointsGeometry) {
      pointsGeometry.dispose();
    }
    if (pointsMaterial) {
      pointsMaterial.dispose();
    }
    if (lineGeometry) {
      lineGeometry.dispose();
    }
    if (lineMaterial) {
      lineMaterial.dispose();
    }
  };
}
