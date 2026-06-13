import { document, window, requestAnimationFrame, THREE, MutationObserver } from './runtime.js';
import { gsap } from 'gsap';

// ==========================================
// CRYSTAL GLASS OVERDRIVE: DYNAMIC INTERACTIVE ANIMATIONS
// ==========================================
function initCrystalAnimations() {
  // 1. WebGL Fullscreen fluid background shader setup
  const canvas = document.getElementById('crystal-shader-canvas');
  if (canvas) {
    // Guard against multiple initializations on the same canvas (e.g. DOM/Vite rebuild events)
    if (canvas.dataset.initialized) return;
    canvas.dataset.initialized = 'true';

    try {
      const container = canvas.parentElement;
      const scene = new THREE.Scene();
      
      // Camera - Full screen plane OrthographicCamera (depth Z centered at -1 to 1 to prevent mesh clipping)
      const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1);
      camera.position.z = 1;
      
      // Renderer - initialize WebGL
      const renderer = new THREE.WebGLRenderer({
        canvas: canvas,
        antialias: true,
        alpha: true,
        powerPreference: "high-performance"
      });
      
      // Determine initial viewport dimensions safely via window metrics to prevent DOM size race conditions
      const viewWidth = window.innerWidth;
      const viewHeight = window.innerHeight;
      renderer.setSize(viewWidth, viewHeight);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
      
      // Simple full-screen quad vertex shader
      const vertexShader = `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position, 1.0);
        }
      `;
      
      // Fragment Shader: domain-warped fractal Brownian noise for a liquid fluid glass background
      const fragmentShader = `
        uniform float u_time;
        uniform vec2 u_resolution;
        uniform float u_theme; // 0.0 for dark (black/grey), 1.0 for light (off-white/grey)
        uniform vec2 u_mouse;
        
        varying vec2 vUv;
        
        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
        }
        
        float noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          vec2 u = f*f*(3.0-2.0*f);
          return mix(mix(hash(i + vec2(0.0,0.0)), hash(i + vec2(1.0,0.0)), u.x),
                     mix(hash(i + vec2(0.0,1.0)), hash(i + vec2(1.0,1.0)), u.x), u.y);
        }
        
        float fbm(vec2 p) {
          float value = 0.0;
          float amplitude = 0.5;
          float frequency = 1.0;
          for (int i = 0; i < 4; i++) {
            value += amplitude * noise(p * frequency);
            frequency *= 2.0;
            amplitude *= 0.5;
          }
          return value;
        }
        
        void main() {
          vec2 st = gl_FragCoord.xy / u_resolution.xy;
          
          float aspect = u_resolution.x / u_resolution.y;
          vec2 uv = st;
          uv.x *= aspect;
          
          // Organic drag displacement based on normalized mouse coords
          uv += u_mouse * 0.04;
          
          // Scale coordinates by 4.0 so the noise cycles across multiple cells and textures the screen
          vec2 p = uv * 4.0;
          
          // Warping Step 1
          vec2 q = vec2(0.0);
          q.x = fbm(p + 0.08 * u_time);
          q.y = fbm(p + vec2(1.0) + 0.06 * u_time);
          
          // Warping Step 2
          vec2 r = vec2(0.0);
          r.x = fbm(p + 1.2 * q + vec2(1.7, 9.2) + 0.12 * u_time);
          r.y = fbm(p + 1.2 * q + vec2(8.3, 2.8) + 0.09 * u_time);
          
          float f = fbm(p + 1.1 * r);
          
          // Theme 1 (Dark Mode): Blackish grey tones
          vec3 darkBg = vec3(0.0, 0.0, 0.0);
          vec3 darkGrey1 = vec3(0.06, 0.06, 0.07);
          vec3 darkGrey2 = vec3(0.04, 0.04, 0.045);
          vec3 darkGrey3 = vec3(0.08, 0.08, 0.085);

          vec3 darkColor = mix(darkBg, darkGrey1, f * 0.7);
          darkColor = mix(darkColor, darkGrey2, r.x * 0.5);
          darkColor = mix(darkColor, darkGrey3, q.y * 0.3);

          // Theme 2 (Light Mode): Off-white with subtle grey hues
          vec3 lightBg = vec3(0.98, 0.98, 0.975);
          vec3 lightGrey1 = vec3(0.94, 0.94, 0.935);
          vec3 lightGrey2 = vec3(0.96, 0.955, 0.95);
          vec3 lightGrey3 = vec3(0.92, 0.92, 0.915);

          vec3 lightColor = mix(lightBg, lightGrey1, f * 0.4);
          lightColor = mix(lightColor, lightGrey2, r.y * 0.3);
          lightColor = mix(lightColor, lightGrey3, q.x * 0.2);
          
          // Smooth crossfade based on active theme uniform (0.0 to 1.0)
          vec3 finalColor = mix(darkColor, lightColor, u_theme);
          
          gl_FragColor = vec4(finalColor, 1.0);
        }
      `;
      
      const geometry = new THREE.PlaneGeometry(2, 2);
      
      const themeState = {
        value: document.body.classList.contains('light-theme') ? 1.0 : 0.0
      };
      
      const uniforms = {
        u_time: { value: 0.0 },
        u_resolution: { value: new THREE.Vector2(viewWidth, viewHeight) },
        u_theme: { value: themeState.value },
        u_mouse: { value: new THREE.Vector2(0, 0) }
      };
      
      const material = new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms,
        depthWrite: false,
        depthTest: false,
        side: THREE.DoubleSide
      });
      
      const mesh = new THREE.Mesh(geometry, material);
      scene.add(mesh);
      
      // Mouse tracking interpolators
      let mouseX = 0, mouseY = 0;
      let targetMouseX = 0, targetMouseY = 0;
      
      window.addEventListener('mousemove', (e) => {
        mouseX = (e.clientX / window.innerWidth) * 2.0 - 1.0;
        mouseY = -(e.clientY / window.innerHeight) * 2.0 + 1.0;
      });
      
      // MutationObserver to animate theme uniform when light-theme class changes
      const themeObserver = new MutationObserver(() => {
        const isLight = document.body.classList.contains('light-theme');
        const targetTheme = isLight ? 1.0 : 0.0;
        if (themeState.value !== targetTheme) {
          gsap.to(themeState, {
            value: targetTheme,
            duration: 1.2,
            ease: "power2.out",
            onUpdate: () => {
              uniforms.u_theme.value = themeState.value;
            }
          });
        }
      });
      themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
      
      const clock = new THREE.Clock();
      
      function renderShader() {
        requestAnimationFrame(renderShader);
        
        uniforms.u_time.value = clock.getElapsedTime();
        
        // Easing interpolation for mouse slide inertia
        targetMouseX += (mouseX - targetMouseX) * 0.05;
        targetMouseY += (mouseY - targetMouseY) * 0.05;
        uniforms.u_mouse.value.set(targetMouseX, targetMouseY);
        
        renderer.render(scene, camera);
      }
      
      renderShader();
      
      window.addEventListener('resize', () => {
        const newWidth = window.innerWidth;
        const newHeight = window.innerHeight;
        renderer.setSize(newWidth, newHeight);
        if (uniforms.u_resolution) {
          uniforms.u_resolution.value.set(newWidth, newHeight);
        }
      });
      
      container.classList.add('has-shader');
      
    } catch (err) {
      console.warn("Crystal shader failed to initialize, falling back to CSS static orbs:", err);
      // Clean up initialization status on failure
      canvas.removeAttribute('data-initialized');
    }
  }

  // 1b. Fallback mouse-drifting background orbs (only runs if WebGL is disabled/failed)
  window.addEventListener('mousemove', (e) => {
    const { clientX, clientY } = e;
    const xPercent = (clientX / window.innerWidth - 0.5) * 60;
    const yPercent = (clientY / window.innerHeight - 0.5) * 60;
    
    const orbs = document.querySelectorAll('.orb');
    if (orbs.length > 0 && (!canvas || !canvas.parentElement.classList.contains('has-shader'))) {
      gsap.to('.orb-1', { x: xPercent * 0.9, y: yPercent * 0.9, duration: 1.8, ease: 'power2.out' });
      gsap.to('.orb-2', { x: -xPercent * 0.7, y: -yPercent * 0.7, duration: 2.2, ease: 'power2.out' });
      gsap.to('.orb-3', { x: xPercent * 0.6, y: -yPercent * 0.6, duration: 2.4, ease: 'power2.out' });
      gsap.to('.orb-4', { x: -xPercent * 0.5, y: yPercent * 0.5, duration: 2.6, ease: 'power2.out' });
    }
  });

  // 2. 3D Card Hover Tilt and Shine Spotlights
  const isCrystalTheme = !!document.getElementById('crystal-shader-canvas');

  function applyTactileTiltEffects() {
    if (isCrystalTheme) return;

    const cards = document.querySelectorAll(
      '.job-card, .card-metric, .panel-setting, .agent-card, .terminal-box, .table-card, .panel-preview, .sourcing-tab-card'
    );

    cards.forEach(card => {
      if (card.dataset.tiltInitialized) return;
      card.dataset.tiltInitialized = 'true';

      card.style.setProperty('--shine-x', '50%');
      card.style.setProperty('--shine-y', '50%');

      card.addEventListener('mousemove', (e) => {
        const rect = card.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        const xc = rect.width / 2;
        const yc = rect.height / 2;

        const angleX = -(y - yc) / (rect.height / 8);
        const angleY = (x - xc) / (rect.width / 8);

        gsap.to(card, {
          rotationX: angleX,
          rotationY: angleY,
          ease: 'power1.out',
          duration: 0.2,
          transformPerspective: 800,
          transformOrigin: 'center center'
        });

        card.style.setProperty('--shine-x', `${(x / rect.width) * 100}%`);
        card.style.setProperty('--shine-y', `${(y / rect.height) * 100}%`);
      });

      card.addEventListener('mouseleave', () => {
        gsap.to(card, {
          rotationX: 0,
          rotationY: 0,
          ease: 'power2.out',
          duration: 0.5
        });
        card.style.setProperty('--shine-x', '50%');
        card.style.setProperty('--shine-y', '50%');
      });
    });
  }

  applyTactileTiltEffects();

  const listObserver = new MutationObserver(() => {
    applyTactileTiltEffects();
  });
  const container = document.getElementById('jobs-list-container');
  if (container) {
    listObserver.observe(container, { childList: true, subtree: true });
  }

  // 3. SNAPPY SPRING TABS SWITCHING
  const views = document.querySelectorAll('.dashboard-view');
  const viewObserver = new MutationObserver((mutations) => {
    mutations.forEach(mutation => {
      if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
        const view = mutation.target;
        if (view.classList.contains('active-view')) {
          // snappier iOS scale-up and slide-up transition using GSAP Back ease
          gsap.fromTo(view, 
            { opacity: 0, scale: 0.96, y: 15 },
            { 
              opacity: 1, 
              scale: 1, 
              y: 0, 
              duration: 0.5, 
              ease: "back.out(1.1)", // snaps with overshoot nicely
              clearProps: "transform,scale,opacity"
            }
          );
        }
      }
    });
  });
  views.forEach(view => viewObserver.observe(view, { attributes: true, attributeFilter: ['class'] }));
}


export { initCrystalAnimations };
