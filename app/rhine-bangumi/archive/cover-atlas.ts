import * as THREE from "three";
import type { ArchiveRecord } from "../data/data";
import type { MusicSelectionLighting } from "../rendering/music-lighting";
import {
  createAlbumPrintMaterial,
  MUSIC_COVER,
} from "../rendering/music-model";

export const COVER_SIZE = MUSIC_COVER;
export type CoverImage = {
  source: CanvasImageSource;
  width: number;
  height: number;
};
type DecodedCoverImage = CoverImage & { decodedSize: number; pixels: number };
type DecodeJob = {
  url: string;
  generation: number;
  size: number;
  resolve: (image: DecodedCoverImage | undefined) => void;
  image?: HTMLImageElement;
};
export const COVER_PAINT_SIZE = 1024;
export const COVER_INSET = 1 / 64;
const COVER_PAINT_MARGIN = COVER_PAINT_SIZE * COVER_INSET;

export function containCover(
  width: number,
  height: number,
  boxWidth: number,
  boxHeight: number,
) {
  const scale = Math.min(
    boxWidth / Math.max(1, width),
    boxHeight / Math.max(1, height),
  );
  const drawnWidth = width * scale,
    drawnHeight = height * scale;
  return {
    x: (boxWidth - drawnWidth) / 2,
    y: (boxHeight - drawnHeight) / 2,
    width: drawnWidth,
    height: drawnHeight,
  };
}

/**
 * 将封面绘制到图集瓦片。
 *
 * 先清空瓦片，再将可用封面按比例缩放并居中绘制；缺失时保持空瓦片。
 *
 * @param canvas 承载封面绘制的画布。
 * @param image 可选的已解码封面；缺失时只清空瓦片。
 */
export function paintCover(canvas: HTMLCanvasElement, image?: CoverImage) {
  const context = canvas.getContext("2d");
  if (!context) return;
  const width = COVER_PAINT_SIZE,
    height = COVER_PAINT_SIZE,
    margin = COVER_PAINT_MARGIN;
  context.setTransform(
    canvas.width / width,
    0,
    0,
    canvas.height / height,
    0,
    0,
  );
  context.clearRect(0, 0, width, height);
  if (!image) return;
  const box = containCover(
    image.width,
    image.height,
    width - margin * 2,
    height - margin * 2,
  );
  context.drawImage(
    image.source,
    box.x + margin,
    box.y + margin,
    box.width,
    box.height,
  );
}

/**
 * 管理番剧封面图集与选中封面的 GPU 资源。
 *
 * 负责图片解码队列、瓦片上传、选中封面替换和卸载时释放。
 */
export class CoverAtlas {
  readonly array: THREE.InstancedMesh;
  readonly selected: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshLambertMaterial>;
  private readonly atlasCanvas = document.createElement("canvas");
  private readonly selectedCanvas = document.createElement("canvas");
  private readonly tileCanvas = document.createElement("canvas");
  private readonly uploadCanvas = document.createElement("canvas");
  private readonly uploadTexture: THREE.Texture;
  private readonly atlas: THREE.CanvasTexture;
  private readonly selectedTexture: THREE.CanvasTexture;
  private readonly pendingImages = new Map<
    string,
    Promise<DecodedCoverImage | undefined>
  >();
  private readonly decodedImages = new Map<
    string,
    DecodedCoverImage | undefined
  >();
  private readonly decodeJobs = new Map<string, DecodeJob>();
  private readonly decodeQueue: DecodeJob[] = [];
  private readonly activeJobs = new Set<DecodeJob>();
  private readonly dirtySlots = new Set<number>();
  private readonly coverReady: THREE.InstancedBufferAttribute;
  private gpuInitialized = false;
  private uploadedBytes = 0;
  private uploadBatches = 0;
  private uploadedTiles = 0;
  private peakDecodes = 0;
  private decodedPixels = 0;
  private readonly maxDecodeConcurrency = 3;
  private readonly maxDecodedPixels = 4 * 1024 * 1024;
  private readonly slotKeys: (string | undefined)[];
  private readonly recordKeys = new WeakMap<ArchiveRecord, string>();
  private selectedRecord?: ArchiveRecord;
  private selectedKey?: string;
  private generation = 0;
  private disposed = false;
  private readonly columns: number;
  private readonly rows: number;
  private readonly tileWidth: number;
  private readonly tileHeight: number;

  /**
   * 建立图集画布、纹理和封面实例。
   *
   * 资源由当前 CoverAtlas 持有，调用 dispose 时统一释放。
   *
   * @param count 可用单元或记录的数量。
   * @param maxTextureSize 设备支持的最大纹理尺寸。
   * @param anisotropy 设备允许的纹理各向异性上限。
   * @param lighting 用于封面印刷层的动态照明控制器。
   */
  constructor(
    count: number,
    maxTextureSize: number,
    anisotropy: number,
    lighting?: MusicSelectionLighting,
  ) {
    this.columns = count > 512 ? 24 : 16;
    this.rows = Math.ceil(count / this.columns);
    this.tileWidth = Math.min(
      256,
      Math.floor(maxTextureSize / this.columns),
      Math.floor(maxTextureSize / this.rows),
    );
    this.tileHeight = this.tileWidth;
    this.atlasCanvas.width = this.columns * this.tileWidth;
    this.atlasCanvas.height = this.rows * this.tileHeight;
    this.tileCanvas.width = this.tileWidth;
    this.tileCanvas.height = this.tileHeight;
    this.uploadCanvas.width = this.tileWidth;
    this.uploadCanvas.height = this.tileHeight;
    this.uploadTexture = new THREE.Texture(this.uploadCanvas);
    this.uploadTexture.colorSpace = THREE.SRGBColorSpace;
    this.uploadTexture.generateMipmaps = false;
    this.selectedCanvas.width = COVER_PAINT_SIZE;
    this.selectedCanvas.height = COVER_PAINT_SIZE;
    this.slotKeys = Array(count);
    this.atlas = new THREE.CanvasTexture(this.atlasCanvas);
    this.atlas.colorSpace = THREE.SRGBColorSpace;
    this.atlas.generateMipmaps = false;
    this.atlas.minFilter = THREE.LinearFilter;
    this.atlas.anisotropy = 1;
    this.atlas.userData.maxAnisotropy = 1;
    this.selectedTexture = new THREE.CanvasTexture(this.selectedCanvas);
    this.selectedTexture.colorSpace = THREE.SRGBColorSpace;
    this.selectedTexture.anisotropy = Math.min(8, anisotropy);
    this.selectedTexture.userData.maxAnisotropy = 8;
    const geometry = new THREE.PlaneGeometry(
      COVER_SIZE.width,
      COVER_SIZE.height,
    ).translate(COVER_SIZE.x, COVER_SIZE.y, COVER_SIZE.z);
    const tileOffsets = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      tileOffsets.set(
        [
          (i % this.columns) / this.columns,
          1 - (Math.floor(i / this.columns) + 1) / this.rows,
          1 / this.columns,
          1 / this.rows,
        ],
        i * 4,
      );
    }
    geometry.setAttribute(
      "coverTile",
      new THREE.InstancedBufferAttribute(tileOffsets, 4),
    );
    this.coverReady = new THREE.InstancedBufferAttribute(
      new Float32Array(count),
      1,
    );
    this.coverReady.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute("coverReady", this.coverReady);
    const makePrint = (texture: THREE.Texture) => {
      const print = createAlbumPrintMaterial(texture);
      const compile = print.onBeforeCompile;
      print.onBeforeCompile = (shader, renderer) => {
        compile.call(print, shader, renderer);
        lighting?.shadePrint(shader);
      };
      print.customProgramCacheKey = () =>
        `album-diffuse-print-${Boolean(lighting)}-v4`;
      return print;
    };
    const material = makePrint(this.atlas);
    const compileAtlas = material.onBeforeCompile;
    material.onBeforeCompile = (shader, renderer) => {
      compileAtlas.call(material, shader, renderer);
      shader.vertexShader =
        "attribute vec4 coverTile;\nattribute float coverReady;\nvarying float vCoverReady;\nvarying vec4 vCoverTile;\n" +
        shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        "#include <uv_vertex>",
        "#include <uv_vertex>\nvCoverReady = coverReady;\nvCoverTile = coverTile;\nvMapUv = coverTile.xy + uv * coverTile.zw;",
      );
      shader.uniforms.coverAtlasTexel = {
        value: new THREE.Vector2(
          1 / this.atlasCanvas.width,
          1 / this.atlasCanvas.height,
        ),
      };
      shader.fragmentShader =
        "varying float vCoverReady;\nvarying vec4 vCoverTile;\nuniform vec2 coverAtlasTexel;\n" +
        shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <map_fragment>",
        "if (vCoverReady < 0.5) discard;\n" +
          THREE.ShaderChunk.map_fragment.replace(
            "texture2D( map, vMapUv )",
            "texture2D( map, clamp(vMapUv, vCoverTile.xy + coverAtlasTexel * 0.5, vCoverTile.xy + vCoverTile.zw - coverAtlasTexel * 0.5) )",
          ),
      );
    };
    material.customProgramCacheKey = () =>
      `album-diffuse-atlas-${Boolean(lighting)}-v4`;
    this.array = new THREE.InstancedMesh(geometry, material, count);
    this.array.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.array.frustumCulled = false;
    this.array.visible = false;
    this.array.name = "Album cover atlas";
    this.array.receiveShadow = true;
    this.selected = new THREE.Mesh(
      new THREE.PlaneGeometry(COVER_SIZE.width, COVER_SIZE.height).translate(
        COVER_SIZE.x,
        COVER_SIZE.y,
        COVER_SIZE.z,
      ),
      makePrint(this.selectedTexture),
    );
    this.selected.userData.albumCover = true;
    this.selected.visible = false;
    this.selected.name = "Selected album cover";
    this.selected.receiveShadow = true;
  }

  private cachedImage(url?: string) {
    if (!url || !this.decodedImages.has(url)) return undefined;
    const image = this.decodedImages.get(url);
    this.decodedImages.delete(url);
    this.decodedImages.set(url, image);
    return image;
  }

  /**
   * 异步解码单张封面图片。
   *
   * 复用已缓存结果；无地址、加载失败或图集已释放时返回 undefined。
   *
   * @param url 封面图片的请求地址。
   * @param priority 本次封面请求在解码队列中的优先级。
   * @returns 解码后的封面，或不可用时的 undefined。
   */
  private loadImage(url?: string, priority = false) {
    if (!url) return Promise.resolve(undefined);
    if (this.disposed) return Promise.resolve(undefined);
    const size = priority ? COVER_PAINT_SIZE : this.tileWidth;
    if (this.decodedImages.has(url)) {
      const cached = this.cachedImage(url);
      if (
        !cached ||
        cached.decodedSize >=
          Math.min(size, Math.max(cached.width, cached.height))
      )
        return Promise.resolve(cached);
    }
    let pending = this.pendingImages.get(url);
    if (pending) {
      const job = this.decodeJobs.get(url);
      if (job && priority) {
        job.size = Math.max(job.size, size);
        const index = this.decodeQueue.indexOf(job);
        if (index > 0) {
          this.decodeQueue.splice(index, 1);
          this.decodeQueue.unshift(job);
        }
      }
      return pending;
    }
    let resolve!: DecodeJob["resolve"];
    pending = new Promise<DecodedCoverImage | undefined>((done) => {
      resolve = done;
    });
    const job: DecodeJob = { url, generation: this.generation, size, resolve };
    this.pendingImages.set(url, pending);
    this.decodeJobs.set(url, job);
    if (priority) this.decodeQueue.unshift(job);
    else this.decodeQueue.push(job);
    this.pumpDecodes();
    return pending;
  }

  /**
   * 按并发预算推进封面解码队列。
   *
   * 完成的图片会进入待绘制队列，避免同时解码过多封面。
   */
  private pumpDecodes() {
    while (
      !this.disposed &&
      this.activeJobs.size < this.maxDecodeConcurrency &&
      this.decodeQueue.length
    ) {
      const job = this.decodeQueue.shift();
      if (!job) break;
      const image = new Image();
      job.image = image;
      this.activeJobs.add(job);
      this.peakDecodes = Math.max(this.peakDecodes, this.activeJobs.size);
      image.crossOrigin = "anonymous";
      image.src = job.url;
      void image
        .decode()
        .then(() => {
          if (this.disposed || job.generation !== this.generation)
            return undefined;
          const width = image.naturalWidth,
            height = image.naturalHeight;
          const scale = Math.min(1, job.size / Math.max(width, height));
          const source = document.createElement("canvas");
          source.width = Math.max(1, Math.round(width * scale));
          source.height = Math.max(1, Math.round(height * scale));
          source
            .getContext("2d")
            ?.drawImage(image, 0, 0, source.width, source.height);
          return {
            source,
            width,
            height,
            decodedSize: Math.max(source.width, source.height),
            pixels: source.width * source.height,
          };
        })
        .catch(() => undefined)
        .then((decoded) => {
          image.src = "";
          this.activeJobs.delete(job);
          if (!this.disposed && job.generation === this.generation) {
            this.decodedPixels -= this.decodedImages.get(job.url)?.pixels ?? 0;
            this.decodedImages.delete(job.url);
            this.decodedImages.set(job.url, decoded);
            this.decodedPixels += decoded?.pixels ?? 0;
            while (
              this.decodedImages.size > 48 ||
              this.decodedPixels > this.maxDecodedPixels
            ) {
              const first = this.decodedImages.keys().next().value;
              if (first === undefined) break;
              this.decodedPixels -= this.decodedImages.get(first)?.pixels ?? 0;
              this.decodedImages.delete(first);
            }
          }
          if (this.decodeJobs.get(job.url) === job) {
            this.decodeJobs.delete(job.url);
            this.pendingImages.delete(job.url);
          }
          job.resolve(
            this.disposed || job.generation !== this.generation
              ? undefined
              : decoded,
          );
          this.pumpDecodes();
        });
    }
  }

  /**
   * 生成封面请求的稳定缓存键。
   *
   * 把记录标识和封面地址组合，避免不同记录共用错误图片。
   *
   * @param record 当前选择的番剧记录。
   * @returns 可用于缓存查询的键。
   */
  private recordKey(record: ArchiveRecord | undefined) {
    if (!record) return "";
    let key = this.recordKeys.get(record);
    if (key === undefined) {
      key = JSON.stringify([
        record.id,
        record.coverUrl,
        record.title,
        record.bangumi.name_cn,
      ]);
      this.recordKeys.set(record, key);
    }
    return key;
  }

  /**
   * 把现有封面复制到目标画布。
   *
   * 只有仍与当前槽位或选中记录匹配的封面才会被复制。
   *
   * @param canvas 承载封面绘制的画布。
   * @param key 待复制封面的稳定缓存键。
   * @returns 找到匹配封面并完成复制时返回真。
   */
  private copyCover(canvas: HTMLCanvasElement, key: string) {
    const selected = this.selectedKey === key && canvas !== this.selectedCanvas;
    const slot = selected ? -1 : this.slotKeys.indexOf(key);
    if (!selected && slot < 0) return false;
    const context = canvas.getContext("2d");
    if (!context) return false;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (selected)
      context.drawImage(this.selectedCanvas, 0, 0, canvas.width, canvas.height);
    else
      context.drawImage(
        this.atlasCanvas,
        (slot % this.columns) * this.tileWidth,
        Math.floor(slot / this.columns) * this.tileHeight,
        this.tileWidth,
        this.tileHeight,
        0,
        0,
        canvas.width,
        canvas.height,
      );
    return true;
  }

  /**
   * 更新阵列槽位关联的番剧封面。
   *
   * 异步结果仅写回仍匹配当前记录的槽位，防止旧请求覆盖新选择。
   *
   * @param slot 图集或阵列中的目标槽位。
   * @param record 当前选择的番剧记录。
   */
  setSlot(slot: number, record: ArchiveRecord | undefined) {
    const key = this.recordKey(record);
    if (this.slotKeys[slot] === key) return;
    const image = this.cachedImage(record?.coverUrl);
    if (image) paintCover(this.tileCanvas, image);
    else if (!this.copyCover(this.tileCanvas, key)) paintCover(this.tileCanvas);
    this.slotKeys[slot] = key;
    this.coverReady.setX(slot, 0);
    this.coverReady.needsUpdate = true;
    const generation = this.generation;
    /**
     * 将当前槽位的异步封面结果写入图集画布。
     *
     * 仅接受与当前图集版本和槽位记录匹配的结果，并标记待上传瓦片。
     *
     * @param image 已完成解码的封面；缺失时保留当前占位画面。
     */
    const draw = (image?: CoverImage) => {
      if (
        this.disposed ||
        generation !== this.generation ||
        this.slotKeys[slot] !== key
      )
        return;
      if (image) paintCover(this.tileCanvas, image);
      const x = (slot % this.columns) * this.tileWidth,
        y = Math.floor(slot / this.columns) * this.tileHeight;
      const context = this.atlasCanvas.getContext("2d");
      if (!context) return;
      context.clearRect(x, y, this.tileWidth, this.tileHeight);
      context.drawImage(this.tileCanvas, x, y);
      this.dirtySlots.add(slot);
    };
    draw();
    if (!image)
      void this.loadImage(record?.coverUrl).then((loaded) => {
        if (loaded) draw(loaded);
      });
  }

  /**
   * 切换抽出盒体的独立封面。
   *
   * 解码完成后更新选中纹理，过期选择的结果不写入当前材质。
   *
   * @param record 当前选择的番剧记录。
   */
  async select(record: ArchiveRecord | undefined) {
    this.selectedRecord = record;
    const key = this.recordKey(record);
    if (this.selectedKey === key) return;
    const generation = this.generation;
    const cached = this.cachedImage(record?.coverUrl);
    const coverUrl = record?.coverUrl;
    if (!coverUrl || (this.decodedImages.has(coverUrl) && !cached))
      paintCover(this.selectedCanvas);
    else if (cached) paintCover(this.selectedCanvas, cached);
    else if (!this.copyCover(this.selectedCanvas, key))
      paintCover(this.selectedCanvas);
    this.selectedKey = key;
    this.selectedTexture.needsUpdate = true;
    if (
      cached &&
      cached.decodedSize >=
        Math.min(COVER_PAINT_SIZE, Math.max(cached.width, cached.height))
    )
      return;
    const image = await this.loadImage(record?.coverUrl, true);
    if (
      this.disposed ||
      generation !== this.generation ||
      this.selectedKey !== key
    )
      return;
    paintCover(this.selectedCanvas, image);
    this.selectedTexture.needsUpdate = true;
  }

  /**
   * 为归位副本保存当前封面外观。
   *
   * 复制必要材质或纹理状态，使副本不受后续选择变化影响。
   *
   * @param mesh 需要保存外观的封面网格。
   */
  snapshot(mesh: THREE.Mesh) {
    const canvas = document.createElement("canvas");
    canvas.width = this.selectedCanvas.width;
    canvas.height = this.selectedCanvas.height;
    canvas.getContext("2d")?.drawImage(this.selectedCanvas, 0, 0);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = this.selectedTexture.anisotropy;
    mesh.material = this.selected.material.clone();
    mesh.material.onBeforeCompile = this.selected.material.onBeforeCompile;
    mesh.material.customProgramCacheKey =
      this.selected.material.customProgramCacheKey;
    (mesh.material as THREE.MeshLambertMaterial).map = texture;
    const record = this.selectedRecord;
    mesh.userData.coverDisposed = false;
    void this.loadImage(record?.coverUrl, true).then((image) => {
      if (mesh.userData.coverDisposed || this.disposed) return;
      paintCover(canvas, image);
      texture.needsUpdate = true;
    });
  }

  /**
   * 在单帧上传预算内提交图集更新。
   *
   * 限制 CPU 到 GPU 的瓦片传输量，剩余更新留到后续帧。
   *
   * @param renderer 场景使用的 WebGL 渲染器。
   * @param maxTiles 本帧允许上传的最大瓦片数。
   * @returns 本次实际上传的瓦片数量。
   */
  flushUploads(renderer: THREE.WebGLRenderer, maxTiles = 8) {
    if (this.disposed || !this.dirtySlots.size) return 0;
    if (!this.gpuInitialized) {
      this.atlas.source.dataReady = false;
      try {
        renderer.initTexture(this.atlas);
        this.gpuInitialized = true;
      } finally {
        this.atlas.source.dataReady = true;
      }
    }
    const context = this.uploadCanvas.getContext("2d");
    if (!context) return 0;
    const destination = new THREE.Vector2();
    let uploaded = 0;
    const limit = Math.max(1, Math.min(64, Math.floor(maxTiles) || 8));
    for (const slot of this.dirtySlots) {
      const x = (slot % this.columns) * this.tileWidth;
      const y = Math.floor(slot / this.columns) * this.tileHeight;
      context.clearRect(0, 0, this.tileWidth, this.tileHeight);
      context.drawImage(
        this.atlasCanvas,
        x,
        y,
        this.tileWidth,
        this.tileHeight,
        0,
        0,
        this.tileWidth,
        this.tileHeight,
      );
      destination.set(x, this.atlasCanvas.height - y - this.tileHeight);
      renderer.copyTextureToTexture(
        this.uploadTexture,
        this.atlas,
        null,
        destination,
      );
      this.dirtySlots.delete(slot);
      this.coverReady.setX(slot, 1);
      this.uploadedBytes += this.tileWidth * this.tileHeight * 4;
      this.uploadedTiles++;
      if (++uploaded >= limit) break;
    }
    if (uploaded) {
      this.coverReady.needsUpdate = true;
      this.uploadBatches++;
    }
    return uploaded;
  }

  /**
   * 等待首屏所需封面达到可显示状态。
   *
   * 等待时间受上限约束，失败的图片沿用占位封面。
   *
   * @param timeoutMs 等待首屏封面的最长时间，单位为毫秒。
   * @returns 等待是否完成及当前图集统计。
   */
  async prepareVisible(timeoutMs = 1200) {
    const pending = [...this.pendingImages.values()];
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settled =
      !pending.length ||
      (await Promise.race([
        Promise.all(pending).then(() => true),
        new Promise<false>((resolve) => {
          timer = setTimeout(
            () => resolve(false),
            Math.max(0, Math.min(3000, timeoutMs)),
          );
        }),
      ]));
    if (timer !== undefined) clearTimeout(timer);
    return { settled, ...this.getStats() };
  }

  /**
   * 汇总封面图集的加载与上传状态。
   *
   * 读取当前队列和缓存计数，不触发新的解码或 GPU 上传。
   * @returns 当前图集的统计快照。
   */
  getStats() {
    return {
      atlasWidth: this.atlasCanvas.width,
      atlasHeight: this.atlasCanvas.height,
      atlasBytes: this.atlasCanvas.width * this.atlasCanvas.height * 4,
      tileWidth: this.tileWidth,
      tileHeight: this.tileHeight,
      activeDecodes: this.activeJobs.size,
      queuedDecodes: this.decodeQueue.length,
      pendingImages: this.pendingImages.size,
      peakDecodes: this.peakDecodes,
      cachedImages: this.decodedImages.size,
      cachedBytes: this.decodedPixels * 4,
      dirtyTiles: this.dirtySlots.size,
      uploadedTiles: this.uploadedTiles,
      uploadedBytes: this.uploadedBytes,
      uploadBatches: this.uploadBatches,
      gpuInitialized: this.gpuInitialized,
    };
  }

  /**
   * 取消当前图集的待处理图片解码。
   *
   * 终止排队和进行中的请求，并清空解码缓存以释放内存。
   */
  private cancelDecodes() {
    for (const job of this.decodeQueue.splice(0)) job.resolve(undefined);
    for (const job of this.activeJobs) {
      job.resolve(undefined);
      if (job.image) job.image.src = "";
    }
    this.pendingImages.clear();
    this.decodeJobs.clear();
    this.decodedImages.clear();
    this.decodedPixels = 0;
  }

  /**
   * 为新一轮图集内容重置状态。
   *
   * 递增请求版本、取消旧解码并使所有封面槽位重新等待上传。
   */
  reset() {
    this.generation++;
    this.slotKeys.fill(undefined);
    this.selectedRecord = undefined;
    this.selectedKey = undefined;
    this.cancelDecodes();
    this.dirtySlots.clear();
    this.coverReady.array.fill(0);
    this.coverReady.needsUpdate = true;
  }
  /**
   * 释放图集持有的异步任务和 GPU 资源。
   *
   * 取消待处理解码，并销毁纹理、材质及实例几何体。
   */
  dispose() {
    this.disposed = true;
    this.generation++;
    this.cancelDecodes();
    this.dirtySlots.clear();
    this.uploadTexture.dispose();
    this.atlas.dispose();
    this.selectedTexture.dispose();
    this.array.geometry.dispose();
    (this.array.material as THREE.Material).dispose();
    this.selected.geometry.dispose();
    this.selected.material.dispose();
    this.atlasCanvas.width = this.atlasCanvas.height = 1;
    this.selectedCanvas.width = this.selectedCanvas.height = 1;
    this.tileCanvas.width = this.tileCanvas.height = 1;
    this.uploadCanvas.width = this.uploadCanvas.height = 1;
  }
}
