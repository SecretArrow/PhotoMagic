/**
 * Optional WebGPU DISPLAY backend for the canvas stage.
 *
 * Honest scope (v1): the document is still COMPOSED by the Canvas2D engine
 * (engine/render.ts). This module only presents the already-composed
 * composite to the screen as a textured quad:
 *
 *   1. checkerboard quad — drawn over the document's screen bounding box,
 *      parity computed in the fragment shader from CSS-pixel coordinates
 *      (bit-identical to engine/raster.ts paintChecker: a cell at
 *      (floor(x/cell), floor(y/cell)) is dark when the sum is even);
 *   2. composite quad — the shared composite canvas uploaded once per
 *      content revision (copyExternalImageToTexture) and re-presented on
 *      pan/zoom/resize with a mat3 view transform, no re-upload.
 *
 * Everything here degrades silently: if `navigator.gpu` is missing, the
 * adapter/device request fails, or the device is lost, callers fall back
 * to the Canvas2D display path. All GPU-touching code is behind runtime
 * guards so importing this module in Node/tests is safe; only the pure
 * matrix/parity helpers below are exercised by unit tests.
 *
 * WebGL/WebGPU types: the repo does not depend on @webgpu/types, so the
 * API surface is described with minimal structural types below.
 */

import type { ViewState } from '../engine/types';
import type { AnyCanvas } from '../engine/raster';

/* ------------------------------------------------------------------ */
/* pure math (unit-tested in tests/unit/gpu-math.test.ts)              */
/* ------------------------------------------------------------------ */

/** Row-major 3×3 affine matrix [a b tx; c d ty; 0 0 1]. */
export type Mat3 = number[];

/**
 * The doc→screen(CSS px) matrix of the stage view, matching
 * CanvasStage's applyViewTransform exactly:
 *   screen = F(flip) · R(rotation) · T(pan) · S(zoom) · doc
 * which is the same transform docToScreen() (pointerContract) computes
 * step by step.
 */
export function viewToMat3(view: ViewState): Mat3 {
  const z = view.zoom;
  const cos = view.rotation !== 0 ? Math.cos(view.rotation) : 1;
  const sin = view.rotation !== 0 ? Math.sin(view.rotation) : 0;
  const fx = view.flipX ? -1 : 1;
  const fy = view.flipY ? -1 : 1;
  // M = F·R·T(pan)·S(zoom): zoom+translate first, then the whole point
  // (content + pan) rotates, then flips — exactly CanvasStage's canvas
  // sequence scale(flip) → rotate → translate → scale and exactly
  // pointerContract.docToScreen(). Expanded:
  //   row x: fx·[cos·z  −sin·z  cos·panX − sin·panY]
  //   row y: fy·[sin·z   cos·z  sin·panX + cos·panY]
  return [
    fx * cos * z, fx * -sin * z, fx * (cos * view.panX - sin * view.panY),
    fy * sin * z, fy * cos * z, fy * (sin * view.panX + cos * view.panY),
    0, 0, 1,
  ];
}

/** Standard 3×3 matrix product a·b (row-major). */
export function mat3Multiply(a: Mat3, b: Mat3): Mat3 {
  return [
    a[0] * b[0] + a[1] * b[3] + a[2] * b[6],
    a[0] * b[1] + a[1] * b[4] + a[2] * b[7],
    a[0] * b[2] + a[1] * b[5] + a[2] * b[8],
    a[3] * b[0] + a[4] * b[3] + a[5] * b[6],
    a[3] * b[1] + a[4] * b[4] + a[5] * b[7],
    a[3] * b[2] + a[4] * b[5] + a[5] * b[8],
    a[6] * b[0] + a[7] * b[3] + a[8] * b[6],
    a[6] * b[1] + a[7] * b[4] + a[8] * b[7],
    a[6] * b[2] + a[7] * b[5] + a[8] * b[8],
  ];
}

/** Applies a row-major Mat3 to a point: [x y 1]ᵀ → M·[x y 1]ᵀ. */
export function mat3Apply(m: Mat3, x: number, y: number): { x: number; y: number } {
  return { x: m[0] * x + m[1] * y + m[2], y: m[3] * x + m[4] * y + m[5] };
}

/** Inverse of a 2D affine Mat3 (linear part must be non-singular). */
export function mat3Inverse(m: Mat3): Mat3 {
  const a = m[0], b = m[1], tx = m[2];
  const c = m[3], d = m[4], ty = m[5];
  const det = a * d - b * c;
  const ia = d / det;
  const ib = -b / det;
  const ic = -c / det;
  const id = a / det;
  return [
    ia, ib, -(ia * tx + ib * ty),
    ic, id, -(ic * tx + id * ty),
    0, 0, 1,
  ];
}

/**
 * CSS-pixel → NDC matrix for a viewport of `width × height` CSS px
 * (y flips: canvas y grows downward, NDC y grows upward).
 */
export function ndcFromCss(width: number, height: number): Mat3 {
  return [2 / width, 0, -1, 0, -2 / height, 1, 0, 0, 1];
}

/**
 * Reference semantics for the GPU checkerboard shader — identical parity
 * rule to engine/raster.ts buildCheckerTile/paintChecker (the tile is
 * anchored at multiples of `cell`, dark cells on even (i+j) parity).
 * Exported so tests pin the shader contract without a GPU.
 */
export function checkerCellIsDark(cssX: number, cssY: number, cell: number): boolean {
  const c = Math.max(1, Math.round(cell));
  return (Math.floor(cssX / c) + Math.floor(cssY / c)) % 2 === 0;
}

/* ------------------------------------------------------------------ */
/* backend registry (StatusBar chip reads the ACTIVE backend)          */
/* ------------------------------------------------------------------ */

export type DisplayBackend = 'canvas2d' | 'webgpu';

let activeBackend: DisplayBackend = 'canvas2d';
const backendListeners = new Set<(backend: DisplayBackend) => void>();

/** Stage calls this when the display path actually changes. */
export function setDisplayBackend(backend: DisplayBackend): void {
  if (activeBackend === backend) return;
  activeBackend = backend;
  for (const fn of backendListeners) fn(backend);
}

export function getDisplayBackend(): DisplayBackend {
  return activeBackend;
}

export function subscribeDisplayBackend(fn: (backend: DisplayBackend) => void): () => void {
  backendListeners.add(fn);
  return () => backendListeners.delete(fn);
}

/**
 * Pure wiring policy for the `settings.renderer` control:
 * 'canvas2d' always wins, 'auto' uses WebGPU only when available and not
 * previously failed on this stage mount (permanent fallback, same spirit
 * as the filterRunner fallback).
 */
export function resolveDisplayBackend(
  setting: 'auto' | 'canvas2d',
  webgpuAvailable: boolean,
  previouslyFailed: boolean,
): DisplayBackend {
  if (setting === 'canvas2d' || previouslyFailed || !webgpuAvailable) return 'canvas2d';
  return 'webgpu';
}

/** Feature detect only — never throws, SSR/test safe. */
export function isWebGPUAvailable(): boolean {
  return typeof navigator !== 'undefined' && navigator !== null && 'gpu' in navigator;
}

/* ------------------------------------------------------------------ */
/* minimal structural WebGPU types (no @webgpu/types dependency)       */
/* ------------------------------------------------------------------ */

interface GpuBufferLike {
  destroy(): void;
}
type GpuTextureViewLike = object;
interface GpuTextureLike {
  createView(): GpuTextureViewLike;
  destroy(): void;
}
type GpuSamplerLike = object;
type GpuBindGroupLike = object;
type GpuBindGroupLayoutLike = object;
type GpuShaderModuleLike = object;
interface GpuRenderPipelineLike {
  getBindGroupLayout(index: number): GpuBindGroupLayoutLike;
}
interface GpuRenderPassEncoderLike {
  setPipeline(pipeline: GpuRenderPipelineLike): void;
  setBindGroup(index: number, group: GpuBindGroupLike): void;
  draw(vertexCount: number): void;
  end(): void;
}
interface GpuCommandEncoderLike {
  beginRenderPass(desc: {
    colorAttachments: {
      view: GpuTextureViewLike;
      clearValue: { r: number; g: number; b: number; a: number };
      loadOp: 'clear';
      storeOp: 'store';
    }[];
  }): GpuRenderPassEncoderLike;
  finish(): unknown;
}
interface GpuDeviceLostInfoLike {
  reason?: string;
  message?: string;
}
interface GpuQueueLike {
  writeBuffer(buffer: GpuBufferLike, bufferOffset: number, data: ArrayBufferView): void;
  copyExternalImageToTexture(
    source: { source: unknown },
    destination: { texture: GpuTextureLike; premultipliedAlpha?: boolean },
    size: [number, number],
  ): void;
  submit(commandBuffer: unknown): void;
}
interface GpuDeviceLike {
  lost: Promise<GpuDeviceLostInfoLike>;
  queue: GpuQueueLike;
  destroy(): void;
  createCommandEncoder(): GpuCommandEncoderLike;
  createShaderModule(desc: { code: string }): GpuShaderModuleLike;
  createRenderPipeline(desc: {
    layout: 'auto';
    vertex: { module: GpuShaderModuleLike; entryPoint: string };
    fragment: {
      module: GpuShaderModuleLike;
      entryPoint: string;
      targets: {
        format: string;
        blend: {
          color: { srcFactor: string; dstFactor: string; operation: string };
          alpha: { srcFactor: string; dstFactor: string; operation: string };
        };
      }[];
    };
    primitive: { topology: string };
  }): GpuRenderPipelineLike;
  createTexture(desc: { size: [number, number]; format: string; usage: number }): GpuTextureLike;
  createSampler(desc: { magFilter: string; minFilter: string; addressMode: string }): GpuSamplerLike;
  createBuffer(desc: { size: number; usage: number }): GpuBufferLike;
  createBindGroup(desc: {
    layout: GpuBindGroupLayoutLike;
    entries: { binding: number; resource: unknown }[];
  }): GpuBindGroupLike;
}
interface GpuAdapterLike {
  requestDevice(): Promise<GpuDeviceLike>;
}
interface GpuCanvasContextLike {
  configure(config: { device: GpuDeviceLike; format: string; alphaMode: 'premultiplied' | 'opaque' }): void;
  unconfigure(): void;
  getCurrentTexture(): GpuTextureLike;
}
interface GpuLike {
  requestAdapter(): Promise<GpuAdapterLike | null>;
  getPreferredCanvasFormat(): string;
}

/* numeric usage/stage constants (values from the WebGPU spec) */
const TEXTURE_USAGE_TEXTURE_BINDING = 0x4;
const TEXTURE_USAGE_COPY_DST = 0x8;
const BUFFER_USAGE_COPY_DST = 0x8;
const BUFFER_USAGE_UNIFORM = 0x40;

/* ------------------------------------------------------------------ */
/* shaders                                                             */
/* ------------------------------------------------------------------ */

const SHADER_CODE = /* wgsl */ `
// shared quad corners (unit UV, expanded by vertex_index — no vertex buffers)
var<private> QUAD: array<vec2<f32>, 6> = array<vec2<f32>, 6>(
  vec2<f32>(0.0, 0.0),
  vec2<f32>(1.0, 0.0),
  vec2<f32>(1.0, 1.0),
  vec2<f32>(0.0, 0.0),
  vec2<f32>(1.0, 1.0),
  vec2<f32>(0.0, 1.0),
);

struct VOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

// checkerboard — parity anchored to the CSS-pixel grid, mirroring
// engine/raster.ts paintChecker exactly (see checkerCellIsDark()).
struct CheckerUniforms {
  ndcFromCss: mat3x3<f32>,
  bbox: vec4<f32>, // css x, y, w, h of the clipped doc bounding box
  cell: f32,
  pad: vec3<f32>,
}
@group(0) @binding(0) var<uniform> chk: CheckerUniforms;

@vertex
fn vs_checker(@builtin(vertex_index) vi: u32) -> VOut {
  let uv = QUAD[vi];
  let css = chk.bbox.xy + uv * chk.bbox.zw;
  let p = chk.ndcFromCss * vec3<f32>(css, 1.0);
  var out: VOut;
  out.pos = vec4<f32>(p.xy, 0.0, 1.0);
  out.uv = uv;
  return out;
}

@fragment
fn fs_checker(in: VOut) -> @location(0) vec4<f32> {
  let css = chk.bbox.xy + in.uv * chk.bbox.zw;
  let parity = floor(css.x / chk.cell) + floor(css.y / chk.cell);
  let dark = parity % 2.0 == 0.0;
  // #c8c8cd dark / #e3e3e6 light — same colors as paintChecker defaults
  let rgb = select(vec3<f32>(0.8902, 0.8902, 0.902), vec3<f32>(0.7843, 0.7843, 0.8039), dark);
  return vec4<f32>(rgb, 1.0);
}

// composite quad — the composed document as a texture under the view matrix
struct TexUniforms {
  ndcFromDoc: mat3x3<f32>, // doc px → NDC (view matrix composed with viewport)
  docSize: vec4<f32>,      // doc width, height
}
@group(0) @binding(0) var<uniform> tex: TexUniforms;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var docTex: texture_2d<f32>;

@vertex
fn vs_tex(@builtin(vertex_index) vi: u32) -> VOut {
  let uv = QUAD[vi];
  let docPos = uv * tex.docSize.xy;
  let p = tex.ndcFromDoc * vec3<f32>(docPos, 1.0);
  var out: VOut;
  out.pos = vec4<f32>(p.xy, 0.0, 1.0);
  out.uv = uv;
  return out;
}

@fragment
fn fs_tex(in: VOut) -> @location(0) vec4<f32> {
  return textureSample(docTex, samp, in.uv);
}
`;

/** Packs a row-major Mat3 into WGSL's padded column-major mat3x3 layout. */
function mat3ToWgsl(m: Mat3, out: Float32Array, offset: number): void {
  out[offset + 0] = m[0]; out[offset + 1] = m[3]; out[offset + 2] = m[6]; out[offset + 3] = 0;
  out[offset + 4] = m[1]; out[offset + 5] = m[4]; out[offset + 6] = m[7]; out[offset + 7] = 0;
  out[offset + 8] = m[2]; out[offset + 9] = m[5]; out[offset + 10] = m[8]; out[offset + 11] = 0;
}

/* ------------------------------------------------------------------ */
/* renderer                                                            */
/* ------------------------------------------------------------------ */

export interface GpuCheckerBBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface GpuRenderParams {
  view: ViewState;
  /** viewport size in CSS px */
  width: number;
  height: number;
  dpr: number;
  /** checker cell in CSS px (settings.checkerSize) */
  checkerCell: number;
  /** screen bbox of the document rect, clamped to the viewport (CSS px) */
  checkerBBox: GpuCheckerBBox;
  docWidth: number;
  docHeight: number;
  /**
   * Bump to force a texture re-upload (CanvasStage passes the store
   * revision, which changes exactly when the composite is rebuilt).
   */
  contentVersion: number;
}

export interface GpuRenderer {
  readonly backend: 'webgpu';
  /** Presents the composite; re-uploads only when contentVersion/dims change. */
  render(source: AnyCanvas, params: GpuRenderParams): void;
  /** Syncs the canvas backing store with the CSS viewport (reconfigures). */
  resize(width: number, height: number, dpr: number): void;
  /** Releases every GPU resource; the renderer must not be used afterwards. */
  destroy(): void;
}

export interface GpuRendererOptions {
  /** Fired when the device is lost — the stage falls back to Canvas2D. */
  onDeviceLost?: (reason: string) => void;
}

/**
 * Creates a WebGPU display renderer for `canvas`, or null when WebGPU is
 * unavailable/fails to initialize (adapter, device, context or configure).
 * All failures are silent — the stage keeps its Canvas2D path.
 *
 * alphaMode is 'premultiplied': the pass clears to transparent outside the
 * document and the composite is uploaded premultiplied, so the browser can
 * composite the canvas over the page correctly ('opaque' would black out
 * the viewport around the document).
 */
export async function createGpuRenderer(
  canvas: HTMLCanvasElement,
  options: GpuRendererOptions = {},
): Promise<GpuRenderer | null> {
  try {
    if (!isWebGPUAvailable()) return null;
    const gpu = (navigator as Navigator & { gpu?: GpuLike }).gpu;
    if (!gpu) return null;

    const adapter = await gpu.requestAdapter();
    if (!adapter) return null;
    const device = await adapter.requestDevice();

    const context = canvas.getContext('webgpu') as GpuCanvasContextLike | null;
    if (!context) {
      device.destroy();
      return null;
    }

    const format = gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: 'premultiplied' });

    const shaderModule = device.createShaderModule({ code: SHADER_CODE });

    // premultiplied source-over: texture is uploaded premultiplied
    const blend = {
      color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
    };
    const checkerPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: shaderModule, entryPoint: 'vs_checker' },
      fragment: { module: shaderModule, entryPoint: 'fs_checker', targets: [{ format, blend }] },
      primitive: { topology: 'triangle-list' },
    });
    const texPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: shaderModule, entryPoint: 'vs_tex' },
      fragment: { module: shaderModule, entryPoint: 'fs_tex', targets: [{ format, blend }] },
      primitive: { topology: 'triangle-list' },
    });

    const checkerUniforms = device.createBuffer({
      size: 80, // mat3x3 (48) + vec4 bbox (16) + f32 cell (4) + pad (12)
      usage: BUFFER_USAGE_COPY_DST | BUFFER_USAGE_UNIFORM,
    });
    const texUniforms = device.createBuffer({
      size: 64, // mat3x3 (48) + vec4 docSize (16)
      usage: BUFFER_USAGE_COPY_DST | BUFFER_USAGE_UNIFORM,
    });

    // bilinear when zoomed out, nearest at ≥3 zoom — mirrors the Canvas2D
    // path's `imageSmoothingEnabled = view.zoom < 3` for crisp pixels
    const linearSampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressMode: 'clamp-to-edge' });
    const nearestSampler = device.createSampler({ magFilter: 'nearest', minFilter: 'nearest', addressMode: 'clamp-to-edge' });

    const renderer = new WebGpuDisplayRenderer(
      canvas,
      context,
      device,
      format,
      checkerPipeline,
      texPipeline,
      checkerUniforms,
      texUniforms,
      linearSampler,
      nearestSampler,
    );

    device.lost.then((info) => {
      if (renderer.isDestroyed()) return;
      options.onDeviceLost?.(info?.reason ?? 'unknown');
    });

    return renderer;
  } catch {
    return null;
  }
}

class WebGpuDisplayRenderer implements GpuRenderer {
  readonly backend = 'webgpu' as const;

  private texture: GpuTextureLike | null = null;
  private textureView: GpuTextureViewLike | null = null;
  private bindLinear: GpuBindGroupLike | null = null;
  private bindNearest: GpuBindGroupLike | null = null;
  /** identity of the last uploaded composite canvas */
  private uploadedSource: AnyCanvas | null = null;
  private uploadedVersion = -1;
  private uploadedWidth = 0;
  private uploadedHeight = 0;
  private dead = false;

  constructor(
    private canvas: HTMLCanvasElement,
    private context: GpuCanvasContextLike,
    private device: GpuDeviceLike,
    private format: string,
    private checkerPipeline: GpuRenderPipelineLike,
    private texPipeline: GpuRenderPipelineLike,
    private checkerUniforms: GpuBufferLike,
    private texUniforms: GpuBufferLike,
    private linearSampler: GpuSamplerLike,
    private nearestSampler: GpuSamplerLike,
  ) {}

  isDestroyed(): boolean {
    return this.dead;
  }

  resize(width: number, height: number, dpr: number): void {
    if (this.dead) return;
    const bw = Math.max(1, Math.round(width * dpr));
    const bh = Math.max(1, Math.round(height * dpr));
    if (this.canvas.width !== bw || this.canvas.height !== bh) {
      this.canvas.width = bw;
      this.canvas.height = bh;
      this.configure(); // re-present the (new-size) drawing buffer
    }
  }

  render(source: AnyCanvas, params: GpuRenderParams): void {
    if (this.dead) return;
    try {
      const bw = Math.max(1, Math.round(params.width * params.dpr));
      const bh = Math.max(1, Math.round(params.height * params.dpr));
      if (this.canvas.width !== bw || this.canvas.height !== bh) {
        this.canvas.width = bw;
        this.canvas.height = bh;
        this.configure();
      }

      this.ensureTexture(source, params);
      if (!this.texture) return;

      const ndc = ndcFromCss(params.width, params.height);
      const encoder = this.device.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: this.context.getCurrentTexture().createView(),
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            loadOp: 'clear',
            storeOp: 'store',
          },
        ],
      });

      // 1. checkerboard over the document's screen bbox
      if (params.checkerBBox.w > 0 && params.checkerBBox.h > 0) {
        const u = new Float32Array(20);
        mat3ToWgsl(ndc, u, 0); // css → NDC directly (bbox is in CSS px)
        u[12] = params.checkerBBox.x;
        u[13] = params.checkerBBox.y;
        u[14] = params.checkerBBox.w;
        u[15] = params.checkerBBox.h;
        u[16] = Math.max(1, params.checkerCell);
        this.device.queue.writeBuffer(this.checkerUniforms, 0, u);
        pass.setPipeline(this.checkerPipeline);
        pass.setBindGroup(0, this.checkerBindGroup());
        pass.draw(6);
      }

      // 2. composite quad under the doc→screen→NDC transform
      if (params.docWidth > 0 && params.docHeight > 0) {
        const m = mat3Multiply(ndc, viewToMat3(params.view));
        const u = new Float32Array(16);
        mat3ToWgsl(m, u, 0);
        u[12] = params.docWidth;
        u[13] = params.docHeight;
        this.device.queue.writeBuffer(this.texUniforms, 0, u);
        pass.setPipeline(this.texPipeline);
        pass.setBindGroup(0, this.texBindGroup(params.view.zoom < 3));
        pass.draw(6);
      }

      pass.end();
      this.device.queue.submit([encoder.finish()]);
    } catch {
      // frame lost (context torn down / device lost) — device.lost (or the
      // stage's fallback) takes over; never let one bad frame crash the loop
    }
  }

  destroy(): void {
    if (this.dead) return;
    this.dead = true;
    try {
      this.texture?.destroy();
    } catch { /* already destroyed */ }
    try {
      this.checkerUniforms.destroy();
      this.texUniforms.destroy();
    } catch { /* already destroyed */ }
    try {
      this.context.unconfigure();
    } catch { /* already unconfigured */ }
    try {
      this.device.destroy();
    } catch { /* already lost */ }
  }

  private configure(): void {
    this.context.configure({ device: this.device, format: this.format, alphaMode: 'premultiplied' });
  }

  /** Re-uploads the composite only when it is new, resized or revised. */
  private ensureTexture(source: AnyCanvas, params: GpuRenderParams): void {
    const dimsChanged =
      !this.texture || this.uploadedWidth !== params.docWidth || this.uploadedHeight !== params.docHeight;
    const contentChanged =
      this.uploadedSource !== source || this.uploadedVersion !== params.contentVersion;
    if (!dimsChanged && !contentChanged) return;

    if (dimsChanged) {
      try {
        this.texture?.destroy();
      } catch { /* already destroyed */ }
      this.texture = this.device.createTexture({
        size: [Math.max(1, params.docWidth), Math.max(1, params.docHeight)],
        format: 'rgba8unorm',
        usage: TEXTURE_USAGE_TEXTURE_BINDING | TEXTURE_USAGE_COPY_DST,
      });
      this.textureView = this.texture.createView();
      this.bindLinear = null;
      this.bindNearest = null;
    }

    this.uploadedWidth = params.docWidth;
    this.uploadedHeight = params.docHeight;
    this.uploadedSource = source;
    this.uploadedVersion = params.contentVersion;
    const texture = this.texture;
    if (!texture) return;
    this.device.queue.copyExternalImageToTexture(
      { source: source as unknown },
      { texture, premultipliedAlpha: true },
      [Math.max(1, params.docWidth), Math.max(1, params.docHeight)],
    );
  }

  private checkerBindGroup(): GpuBindGroupLike {
    return this.device.createBindGroup({
      layout: this.checkerPipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.checkerUniforms } }],
    });
  }

  private texBindGroup(nearest: boolean): GpuBindGroupLike {
    const cached = nearest ? this.bindNearest : this.bindLinear;
    if (cached) return cached;
    const group = this.device.createBindGroup({
      layout: this.texPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.texUniforms } },
        { binding: 1, resource: nearest ? this.nearestSampler : this.linearSampler },
        { binding: 2, resource: this.textureView },
      ],
    });
    if (nearest) this.bindNearest = group;
    else this.bindLinear = group;
    return group;
  }
}
