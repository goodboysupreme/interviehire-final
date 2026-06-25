import * as THREE_import from 'three';

// Live-binding lifecycle wrappers. Every dashboard module imports these instead
// of the real globals so listeners, frames, renderers and observers registered
// during a session are torn down when React unmounts the page.
export let signal: AbortSignal;
export let document: Document;
export let window: Window & typeof globalThis;
export let requestAnimationFrame: (callback: FrameRequestCallback) => number;
export let cancelAnimationFrame: (id: number) => void;
export let THREE: any;
export let MutationObserver: typeof globalThis.MutationObserver;
export let setTimeout: (callback: (...args: any[]) => void, delay?: number, ...args: any[]) => any;
export let setInterval: (callback: (...args: any[]) => void, delay?: number, ...args: any[]) => any;
export let clearTimeout: (id: any) => void;
export let clearInterval: (id: any) => void;

let controller: AbortController;
let activeAnimationFrames: Set<number>;
let activeRenderers: Set<any>;
let activeObservers: Set<MutationObserver>;
let activeTimeouts: Set<any>;
let activeIntervals: Set<any>;
let originalRequestAnimationFrame: (callback: FrameRequestCallback) => number;
let originalCancelAnimationFrame: (id: number) => void;
let originalClearTimeout: (id: any) => void;
let originalClearInterval: (id: any) => void;

export function initRuntime() {
  globalThis.window.THREE = THREE_import;

  controller = new AbortController();
  signal = controller.signal;

  activeAnimationFrames = new Set();
  originalRequestAnimationFrame = globalThis.requestAnimationFrame.bind(globalThis);
  originalCancelAnimationFrame = globalThis.cancelAnimationFrame.bind(globalThis);

  requestAnimationFrame = (callback) => {
    const id = originalRequestAnimationFrame((timestamp) => {
      activeAnimationFrames.delete(id);
      callback(timestamp);
    });
    activeAnimationFrames.add(id);
    return id;
  };

  cancelAnimationFrame = (id) => {
    activeAnimationFrames.delete(id);
    originalCancelAnimationFrame(id);
  };

  activeTimeouts = new Set();
  activeIntervals = new Set();
  const originalSetTimeout = globalThis.setTimeout.bind(globalThis);
  const originalSetInterval = globalThis.setInterval.bind(globalThis);
  originalClearTimeout = globalThis.clearTimeout.bind(globalThis);
  originalClearInterval = globalThis.clearInterval.bind(globalThis);

  setTimeout = (callback, delay, ...args) => {
    const id = originalSetTimeout((...cbArgs) => {
      activeTimeouts.delete(id);
      callback(...cbArgs);
    }, delay, ...args);
    activeTimeouts.add(id);
    return id;
  };

  clearTimeout = (id) => {
    activeTimeouts.delete(id);
    originalClearTimeout(id);
  };

  setInterval = (callback, delay, ...args) => {
    const id = originalSetInterval(callback, delay, ...args);
    activeIntervals.add(id);
    return id;
  };

  clearInterval = (id) => {
    activeIntervals.delete(id);
    originalClearInterval(id);
  };

  activeRenderers = new Set();
  THREE = {
    ...THREE_import,
    WebGLRenderer: class extends THREE_import.WebGLRenderer {
      constructor(...args: any[]) {
        super(...args);
        activeRenderers.add(this);
      }
      dispose() {
        activeRenderers.delete(this);
        super.dispose();
      }
    }
  };

  activeObservers = new Set();
  MutationObserver = class extends globalThis.MutationObserver {
    constructor(...args: [callback: MutationCallback]) {
      super(...args);
      activeObservers.add(this);
    }
    disconnect() {
      activeObservers.delete(this);
      super.disconnect();
    }
  };

  document = new Proxy(globalThis.document, {
    get(target, prop) {
      if (prop === 'addEventListener') {
        return (type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => {
          if (type === 'DOMContentLoaded') {
            // Trigger immediately since DOM is already parsed/hydrated. Uses the
            // wrapped setTimeout above, so the pending tick is tracked and gets
            // cleared by disposeRuntime if React unmounts before it fires.
            if (!signal.aborted) setTimeout(listener as (...args: any[]) => void, 0);
            return;
          }
          const opts = typeof options === 'object' ? { signal, ...options } : { signal };
          target.addEventListener(type, listener, opts);
        };
      }
      const val = (target as any)[prop];
      return typeof val === 'function' ? val.bind(target) : val;
    }
  });

  window = new Proxy(globalThis.window, {
    get(target, prop) {
      if (prop === 'addEventListener') {
        return (type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => {
          const opts = typeof options === 'object' ? { signal, ...options } : { signal };
          target.addEventListener(type, listener, opts);
        };
      }
      const val = (target as any)[prop];
      return typeof val === 'function' ? val.bind(target) : val;
    }
  });
}

export function disposeRuntime() {
  if (controller) controller.abort();

  if (activeAnimationFrames) {
    activeAnimationFrames.forEach(id => originalCancelAnimationFrame(id));
    activeAnimationFrames.clear();
  }

  if (activeTimeouts) {
    activeTimeouts.forEach(id => originalClearTimeout(id));
    activeTimeouts.clear();
  }

  if (activeIntervals) {
    activeIntervals.forEach(id => originalClearInterval(id));
    activeIntervals.clear();
  }

  if (activeRenderers) {
    activeRenderers.forEach(r => {
      try { r.dispose(); } catch (e) {}
    });
    activeRenderers.clear();
  }

  if (activeObservers) {
    activeObservers.forEach(obs => {
      try { obs.disconnect(); } catch (e) {}
    });
    activeObservers.clear();
  }
}
