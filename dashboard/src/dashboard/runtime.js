import * as THREE_import from 'three';

// Live-binding lifecycle wrappers. Every dashboard module imports these instead
// of the real globals so listeners, frames, renderers and observers registered
// during a session are torn down when React unmounts the page.
export let signal;
export let document;
export let window;
export let requestAnimationFrame;
export let cancelAnimationFrame;
export let THREE;
export let MutationObserver;
export let setTimeout;
export let setInterval;
export let clearTimeout;
export let clearInterval;

let controller;
let activeAnimationFrames;
let activeRenderers;
let activeObservers;
let activeTimeouts;
let activeIntervals;
let originalRequestAnimationFrame;
let originalCancelAnimationFrame;
let originalClearTimeout;
let originalClearInterval;

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
      constructor(...args) {
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
    constructor(...args) {
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
        return (type, listener, options) => {
          if (type === 'DOMContentLoaded') {
            // Trigger immediately since DOM is already parsed/hydrated. Uses the
            // wrapped setTimeout above, so the pending tick is tracked and gets
            // cleared by disposeRuntime if React unmounts before it fires.
            if (!signal.aborted) setTimeout(listener, 0);
            return;
          }
          const opts = typeof options === 'object' ? { signal, ...options } : { signal };
          target.addEventListener(type, listener, opts);
        };
      }
      const val = target[prop];
      return typeof val === 'function' ? val.bind(target) : val;
    }
  });

  window = new Proxy(globalThis.window, {
    get(target, prop) {
      if (prop === 'addEventListener') {
        return (type, listener, options) => {
          const opts = typeof options === 'object' ? { signal, ...options } : { signal };
          target.addEventListener(type, listener, opts);
        };
      }
      const val = target[prop];
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
