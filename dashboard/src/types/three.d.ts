// `three` ships no bundled type declarations and `@types/three` is not installed.
// This GLOBAL ambient module declaration (this file has no top-level import/export,
// so it is a script, not a module) makes `import * as THREE from 'three'` resolve
// to `any` instead of erroring with TS7016. Types-only; emits no runtime JS.
declare module 'three' {
  const THREE: any;
  export = THREE;
}
