import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import {
  type ArchiveCell,
  type ArchiveNavigation,
  BANGUMI_LOOP_ROWS,
  cellKey,
  fileAtCell,
  LOOP_COLUMNS,
  poolCell,
  ROW_SPACING,
  sameCell,
  selectionCell,
  visibleCell,
} from "../archive/archive-loop";
import { BangumiArchiveMotion } from "../archive/bangumi-archive-motion";
import {
  BANGUMI_OVERVIEW_PICK_EXTENT,
  BangumiOverviewMotion,
  bangumiOverviewColumnExtent,
  type OverviewColumn,
  overviewFraming,
} from "../archive/bangumi-overview";
import { CoverAtlas } from "../archive/cover-atlas";
import {
  archiveColumns,
  columnFiles,
  fileAtSlot,
  fileLocation,
  records,
} from "../data/data";
import {
  BangumiCameraMotion,
  BangumiPlacementMotion,
  BangumiPresentation,
  bangumiArchiveOffset,
  bangumiArchiveTracksSettled,
  bangumiCinematicPose,
  bangumiExtractionAnchor,
} from "../motion/bangumi-camera";
import {
  bangumiIntroLaneSettle,
  bangumiIntroPose,
  bangumiIntroWave,
} from "../motion/bangumi-intro-motion";
import { getBangumiMotionSpeed } from "../motion/bangumi-motion";
import { DecryptionController } from "../motion/decryption";
import {
  archiveWave,
  bangumiSelectionWave,
  cinematicField,
  columnStrength,
  damp,
  extraction,
  idleWave,
  returnStep,
  settlingWave,
  smooth,
} from "../motion/motion";
import { archiveFraming, swipeDirection } from "../motion/viewport-layout";
import { CardAppearance } from "./appearance";
import { createArchiveEnvironment } from "./archive-lighting";
import { assetUrl as publicAsset } from "./asset-url";
import { bangumiFogDistances } from "./bangumi-atmosphere";
import { BANGUMI_CASE_ASSET } from "./bangumi-case-asset";
import { BangumiSelectionLighting } from "./bangumi-lighting";
import {
  BANGUMI_COLUMN_SPACING,
  BANGUMI_MODEL,
  configureBangumiGlass,
  normalizeBangumiGeometry,
} from "./bangumi-model";
import { configureInternalOptics } from "./internal-optics";
import { createPostprocessing } from "./postprocessing";
import { applyTextureQuality, RENDER_QUALITY } from "./render-quality";

export const BANGUMI_PREVIEW_LIFT = 0.9;
export const BANGUMI_INSPECTION_LIFT = BANGUMI_MODEL.height + 0.12;
const BANGUMI_DETAIL_ELEVATION = THREE.MathUtils.degToRad(20);
const BANGUMI_ALBUM_SWITCH_RATE = 9;
/**
 * 协调番剧阵列、镜头、封面与后处理的生命周期。
 *
 * R3F 持有渲染器和帧循环；本类管理手动创建的图集、材质副本、环境贴图和后处理资源。
 */
export class ArchiveScene {
  private readonly columnSpacing = BANGUMI_COLUMN_SPACING;
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly content: THREE.Group;
  readonly camera: THREE.PerspectiveCamera;
  private pipeline: ReturnType<typeof createPostprocessing>;
  private instances: THREE.InstancedMesh[] = [];
  private model = new THREE.Group();
  private appearance = new CardAppearance();
  private decryption = new DecryptionController();
  private cursor = new THREE.Vector2();
  private raycaster = new THREE.Raycaster();
  private dummy = new THREE.Object3D();
  private columnExtentOffset = new THREE.Vector3();
  private positions: THREE.Vector3[] = [];
  private poolRows = BANGUMI_LOOP_ROWS;
  private cells: ArchiveCell[] = [];
  private selectedCell: ArchiveCell = { lane: 2, row: 12 };
  private looping = false;
  private coordinateOrigin: ArchiveCell = { lane: 0, row: 0 };
  private lift = { value: 0, velocity: 0 };
  private rail = { value: 0, velocity: 0 };
  private shoulder = { value: 12, velocity: 0 };
  private laneFocus = { value: 2, velocity: 0 };
  private columnCamera = { value: 0, velocity: 0 };
  private returnY: number | null = null;
  private canInspect = false;
  private clearance = 0;
  private pulseGain = 1;
  private idleGain = 0;
  private lastInteraction = 0;
  private scanTime = 29.1;
  private scanBlend = 0;
  private cameraAim = new THREE.Vector3();
  private bangumiCamera = new BangumiCameraMotion();
  private bangumiOverview = new BangumiOverviewMotion();
  private bangumiOverviewCopies = new Map<number, number>();
  private bangumiPresentation = new BangumiPresentation();
  private bangumiPlacement = new BangumiPlacementMotion();
  private bangumiArchiveMotion = new BangumiArchiveMotion();
  private bangumiNavigationLift = false;
  private outgoing: {
    group: THREE.Group;
    slot: number;
    cell: ArchiveCell;
    lift: { value: number; velocity: number };
    returnY: number | null;
    clarity: number;
  }[] = [];
  private pulses: { row: number; lane: number; time: number }[] = [];
  private selectedSlot = 76;
  private detail = 0;
  private targetDetail = 0;
  private reveal = 0;
  private targetReveal = 0;
  private last = 0;
  private pointer = new THREE.Vector2();
  private dragging = false;
  private rotation = 0;
  private targetRotation = 0;
  private light: THREE.DirectionalLight;
  private environmentTarget: THREE.WebGLRenderTarget;
  private floor: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
  private stars?: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private covers?: CoverAtlas;
  private selectionLighting?: BangumiSelectionLighting;
  private clock = 0;
  private loaded = false;
  private reduced = false;
  private disposed = false;
  private readonly pointerEvents = new AbortController();
  private displayHeight = 0;
  private layoutKind = "";
  onSelect?: (index: number, cell?: ArchiveCell) => void;
  onNavigate?: (axis: "row" | "lane", direction: number) => void;
  /**
   * 连接 R3F 场景对象并初始化命令式资源。
   *
   * 配置模型、环境和后处理；手动创建的 GPU 资源由 dispose 释放。
   *
   * @param container 承载当前界面或场景的 DOM 容器。
   * @param runtime R3F 创建并交给场景控制器的对象引用。
   */
  constructor(
    private container: HTMLElement,
    runtime: {
      renderer: THREE.WebGLRenderer;
      scene: THREE.Scene;
      camera: THREE.PerspectiveCamera;
      content: THREE.Group;
      key: THREE.DirectionalLight;
      floor: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
      stars: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
      setDpr: (ratio: number) => void;
    },
  ) {
    this.renderer = runtime.renderer;
    this.scene = runtime.scene;
    this.camera = runtime.camera;
    this.content = runtime.content;
    this.renderer.setPixelRatio(
      Math.min(devicePixelRatio, 1.5) *
        Math.min(innerWidth / 1920, innerHeight / 1080),
    );
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.info.autoReset = false;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.domElement.setAttribute(
      "aria-label",
      "三维研究档案阵列，可点击选择档案",
    );
    this.scene.background = new THREE.Color("#eae5e1");
    this.scene.fog = new THREE.Fog("#eae5e1", 22, 47);
    this.environmentTarget = createArchiveEnvironment(
      this.renderer,
      this.scene,
    );
    this.light = runtime.key;
    Object.assign(this.light.shadow.camera, {
      left: -16,
      right: 16,
      top: 15,
      bottom: -15,
      near: 0.1,
      far: 45,
    });
    this.light.shadow.mapSize.set(2048, 2048);
    this.light.shadow.normalBias = 0.035;
    this.light.shadow.bias = -0.0003;
    this.light.shadow.radius = 4;
    this.floor = runtime.floor;
    this.stars = runtime.stars;
    this.camera.position.set(-62.26, 35.98, 43.28);
    this.cameraAim.set(-0.5, 1.1, 0.4);
    this.camera.fov = 6.15;
    this.camera.lookAt(this.cameraAim);
    this.pipeline = createPostprocessing(
      this.renderer,
      this.scene,
      this.camera,
      container.clientWidth,
      container.clientHeight,
      runtime.setDpr,
    );
    this.bindPointer();
  }
  /**
   * 异步加载盒体模型与首屏封面。
   *
   * 模型就绪后建立阵列和封面图集；加载失败会向调用方传播异常。
   *
   * @param assetUrl 盒体模型的可选资源地址。
   * @param selectedIndex 初始选中的番剧索引。
   * @throws 模型请求或解析失败时传播加载异常。
   */
  async load(assetUrl = publicAsset(BANGUMI_CASE_ASSET), selectedIndex = 0) {
    const gltf = await new GLTFLoader().loadAsync(assetUrl);
    if (this.disposed) return;
    gltf.scene.updateMatrixWorld(true);
    const meshes: THREE.Mesh[] = [];
    gltf.scene.traverse((o) => {
      if (o instanceof THREE.Mesh) meshes.push(o);
    });
    const count = LOOP_COLUMNS * this.poolRows;
    for (let index = 0; index < count; index++) {
      const cell = poolCell(index, this.poolRows);
      this.cells.push(cell);
      this.positions.push(this.cellPosition(cell));
    }
    for (const mesh of meshes) {
      const geom = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
      normalizeBangumiGeometry(geom);
      const source = mesh.material as THREE.MeshStandardMaterial;
      const name = source.name.replace(/\.\d+$/, "");
      const mat = new THREE.MeshPhysicalMaterial({
        name: source.name,
        side: source.side,
      });
      mat.envMapIntensity = 0.6;
      if (name === "Frosted_Polymer") {
        mat.color.set("#fffdfa");
        mat.transmission = 0.9;
        mat.thickness = 0.12;
        mat.roughness = 0.21;
        mat.ior = 1.46;
        mat.attenuationColor = new THREE.Color("#eee6df");
        mat.attenuationDistance = 2;
      }
      if (name === "Internal_Ceramic") {
        mat.color.set("#c7beb6");
        mat.roughness = 0.6;
      }
      if (name === "Printed_Label") mat.color.set("#eae5dc");
      if (name === "Ivory_Edges") {
        mat.color.set("#f0e7df");
        mat.roughness = 0.31;
        mat.transmission = 0.65;
        mat.thickness = 0.04;
      }
      if (name === "Optical_Diffuser") {
        mat.color.set("#e2dad4");
        mat.transmission = 0;
        mat.roughness = 0.7;
      }
      if (name === "Subsurface_Optics") {
        mat.color.set("#b9aba1");
        mat.roughness = 0.48;
        mat.metalness = 0.05;
      }
      if (name === "Optical_Edges") {
        mat.transmission = 0;
        mat.color.set("#d4c7be");
        mat.roughness = 0.26;
        mat.metalness = 0.08;
      }
      configureBangumiGlass(name, mat);
      configureInternalOptics(name, mat);
      if (name === "Carbon_Ink") continue;
      const selectedMesh = new THREE.Mesh(geom, mat);
      selectedMesh.userData.surface = name;
      selectedMesh.castShadow = name === "Optical_Diffuser";
      selectedMesh.receiveShadow = true;
      this.model.add(selectedMesh);
      if (
        ![
          "Frosted_Polymer",
          "Ivory_Edges",
          "Titanium_Fasteners",
          "Index_Inlay",
          "Optical_Diffuser",
        ].includes(name)
      ) {
        this.appearance.register(name, mat);
        continue;
      }
      const arrayMat = mat.clone();
      if (name === "Frosted_Polymer") {
        arrayMat.transmission = 0.78;
        arrayMat.color.set("#fff7ed");
        arrayMat.roughness = 0.28;
        arrayMat.clearcoat = 0.3;
        arrayMat.clearcoatRoughness = 0.25;
      }
      if (name === "Optical_Diffuser") arrayMat.color.set("#cbb69c");
      if (name === "Ivory_Edges") {
        arrayMat.transmission = 0;
        arrayMat.color.set("#fff5e9");
        arrayMat.roughness = 0.38;
      }
      if (name === "Index_Inlay") {
        arrayMat.color.set("#e4d6c5");
        arrayMat.metalness = 0.05;
      }
      configureBangumiGlass(name, arrayMat);
      const baseCompile = arrayMat.onBeforeCompile;
      arrayMat.onBeforeCompile = (shader, renderer) => {
        baseCompile.call(arrayMat, shader, renderer);
        this.selectionLighting?.shade(shader, name);
      };
      arrayMat.customProgramCacheKey = () => `bangumi-guided-glass-${name}`;
      this.appearance.register(name, mat, arrayMat);
      const inst = new THREE.InstancedMesh(geom, arrayMat, count);
      inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      inst.castShadow = name === "Optical_Diffuser";
      inst.receiveShadow = true;
      inst.frustumCulled = false;
      this.instances.push(inst);
      this.content.add(inst);
    }
    this.covers = new CoverAtlas(
      count,
      this.renderer.capabilities.maxTextureSize,
      this.renderer.capabilities.getMaxAnisotropy(),
      this.selectionLighting,
    );
    this.content.add(this.covers.array);
    this.model.add(this.covers.selected);
    this.appearance.prepare(this.model);
    this.appearance.apply(this.model, 0);
    this.content.add(this.model);
    this.model.position.copy(this.cellPosition(this.selectedCell));
    this.loaded = true;
    await this.initializeLibrary(selectedIndex);
    if (this.disposed) return;
    this.applyNightTheme();
  }

  /**
   * 在模型和图集就绪后安装固定曲库。
   *
   * 重建阵列槽位及选择状态，并清理之前持有的实例资源。
   *
   * @param selectedIndex 初始选中的番剧索引。
   */
  private async initializeLibrary(selectedIndex: number) {
    this.bangumiOverviewCopies.clear();
    if (!this.loaded || !this.covers) return;
    this.bangumiPresentation.request("hidden");
    this.bangumiCamera = new BangumiCameraMotion();
    this.bangumiPlacement = new BangumiPlacementMotion();
    this.bangumiArchiveMotion = new BangumiArchiveMotion();
    this.bangumiNavigationLift = false;
    this.targetDetail = this.detail = 0;
    for (const old of this.outgoing) {
      this.content.remove(old.group);
      this.appearance.dispose(old.group);
    }
    this.outgoing = [];
    this.covers.reset();
    this.covers.array.visible = records.length > 0;
    this.covers.selected.visible = records.length > 0;
    this.model.visible = records.length > 0;
    for (const inst of this.instances) inst.visible = records.length > 0;
    for (const child of this.model.children) {
      if (child.userData.surface)
        child.visible = child.userData.surface !== "Printed_Label";
    }
    const index = Math.max(0, Math.min(records.length - 1, selectedIndex));
    const location = fileLocation(index);
    this.selectedSlot = location.slot;
    this.selectedCell = { lane: location.lane, row: location.row };
    this.coordinateOrigin = { lane: 0, row: 0 };
    this.selectionLighting?.resetRowMotion();
    this.lift = { value: 0, velocity: 0 };
    this.rotation = this.targetRotation = 0;
    this.returnY = null;
    this.pulses = [];
    this.shoulder = { value: location.row, velocity: 0 };
    this.laneFocus = { value: location.lane, velocity: 0 };
    this.columnCamera = {
      value: (location.lane - 2) * this.columnSpacing,
      velocity: 0,
    };
    await this.covers.select(records[index]);
  }

  enableSelectionLighting() {
    this.selectionLighting ??= new BangumiSelectionLighting(
      this.scene,
      this.content,
    );
    this.appearance.bangumiLighting = this.selectionLighting;
    this.softenBangumiContactShadows();
    this.applyNightTheme();
  }

  private softenBangumiContactShadows() {
    this.light.shadow.intensity = 0.32;
    this.pipeline.softenContactShadows();
  }

  /**
   * 安装当前档案唯一使用的深色视觉设置。
   *
   * 同步场景、雾、材质与灯光，保持加载前后的曝光配置一致。
   */
  private applyNightTheme() {
    (this.scene.background as THREE.Color).set("#07111f");
    (this.scene.fog as THREE.Fog).color.set("#07111f");
    this.floor.material.color.set("#0b1828");
    this.renderer.toneMappingExposure = 1.08;
    this.scene.environmentIntensity = 0.68;
    this.light.color.set("#e5f0ff");
    this.light.intensity = 1.7;
    for (const child of this.scene.children) {
      if (!(child instanceof THREE.HemisphereLight)) continue;
      child.color.set("#e2eeff");
      child.groundColor.set("#56708c");
      child.intensity = 0.9;
    }
    if (this.stars) {
      this.stars.material.opacity = 0.6;
      this.stars.visible = true;
    }
    this.appearance.setNight();
    this.selectionLighting?.setNight(this.light);
  }

  /**
   * 切换隐藏、浏览和详情展示状态。
   *
   * 同步盒体归位、旋转目标及总览开关，不直接创建新场景。
   *
   * @param mode 目标场景或过渡模式。
   */
  setMode(mode: "hidden" | "archive" | "detail") {
    if (mode !== "archive") this.bangumiOverview.active = false;
    if (mode === "hidden") this.bangumiOverview.reset();
    this.bangumiPresentation.request(mode);
    if (mode === "hidden") {
      this.bangumiCamera = new BangumiCameraMotion();
      this.bangumiPlacement = new BangumiPlacementMotion();
      this.bangumiArchiveMotion = new BangumiArchiveMotion();
      this.bangumiNavigationLift = false;
    }
    if (mode === "detail")
      this.decryption.enter(
        this.scanBlend > 0.9 && this.decryption.clarity > 0.999,
      );
    else this.decryption.leave();
    if (mode === "hidden") this.decryption.select();
    this.looping = mode !== "hidden";
    if (!this.looping) {
      const canonical = fileLocation(fileAtSlot(this.selectedSlot));
      this.selectedCell = { lane: canonical.lane, row: canonical.row };
      this.coordinateOrigin = { lane: 0, row: 0 };
      for (const old of this.outgoing) {
        this.content.remove(old.group);
        this.appearance.dispose(old.group);
      }
      this.outgoing = [];
    }
    this.lastInteraction = this.clock;
    this.targetReveal = mode === "hidden" ? 0 : 1;
    this.targetDetail = Number(this.bangumiPresentation.holdsDetail);
    this.dragging = false;
    if (mode !== "detail") {
      this.targetRotation = 0;
      if (this.rotation !== 0) this.returnY = this.model.position.y;
    } else this.returnY = null;
  }
  setReduced(value: boolean) {
    this.reduced = value;
  }
  setBangumiOverview(active: boolean) {
    this.bangumiOverview.active = active;
    this.pointer.set(0, 0);
  }
  private bangumiColumnExtent(lane: number) {
    return !this.looping
      ? 1
      : bangumiOverviewColumnExtent(
          lane,
          this.columnCamera.value / this.columnSpacing + 2,
          this.bangumiOverview.value,
        );
  }
  private pickableCell(cell: ArchiveCell) {
    return this.bangumiColumnExtent(cell.lane) >= BANGUMI_OVERVIEW_PICK_EXTENT;
  }
  /**
   * 把总览边缘列的展开比例应用到盒体。
   *
   * 缩放高度时补偿底边位置，避免盒体悬空。
   *
   * @param object 需要调整列高的 Three.js 对象。
   * @param extent 总览中当前列的高度比例。
   */
  private applyBangumiColumnExtent(object: THREE.Object3D, extent: number) {
    if (extent <= 0) {
      object.scale.setScalar(0);
      return;
    }
    object.scale.set(1, extent, 1);
    if (extent === 1) return;
    const bottom = BANGUMI_MODEL.center.y - BANGUMI_MODEL.height / 2;
    object.position.add(
      this.columnExtentOffset
        .set(0, bottom * (1 - extent), 0)
        .applyQuaternion(object.quaternion),
    );
  }
  get bangumiOverviewProgress() {
    return this.bangumiOverview.value;
  }
  /**
   * 投影可见月份列供总览名牌使用。
   *
   * 追踪循环阵列中的实体副本身份，并将三维锚点转换为视口坐标。
   * @returns 当前可投影的月份列。
   */
  getOverviewColumns(): OverviewColumn[] {
    if (!this.loaded || !archiveColumns.length) {
      this.bangumiOverviewCopies.clear();
      return [];
    }
    const copies = this.bangumiOverviewCopies;
    const width = this.container.clientWidth,
      height = this.container.clientHeight;
    const centerLane = this.columnCamera.value / this.columnSpacing + 2;
    const selectedLane =
      ((this.selectedCell.lane % archiveColumns.length) +
        archiveColumns.length) %
      archiveColumns.length;
    return archiveColumns.flatMap((name, lane) => {
      const nearest =
        lane +
        Math.round((centerLane - lane) / archiveColumns.length) *
          archiveColumns.length;
      const previous = copies.get(lane);
      const physical =
        previous !== undefined &&
        Math.abs(previous - centerLane) - Math.abs(nearest - centerLane) <=
          0.3 + 1e-9
          ? previous
          : nearest;
      copies.set(lane, physical);
      if (Math.abs(physical - centerLane) > 4.5) return [];
      const count = columnFiles(lane).length;
      if (!count) return [];
      const extent = this.bangumiColumnExtent(physical);
      const point = new THREE.Vector3(
        (physical - 2) * this.columnSpacing - this.columnCamera.value,
        -4.6 +
          BANGUMI_MODEL.center.y -
          BANGUMI_MODEL.height / 2 +
          (BANGUMI_MODEL.height + 0.65) * extent,
        -2.17,
      ).project(this.camera);
      if (point.z < -1 || point.z > 1) return [];
      return [
        {
          lane,
          physicalLane: physical + this.coordinateOrigin.lane,
          name,
          count,
          extent,
          x: ((point.x + 1) * width) / 2,
          y: ((1 - point.y) * height) / 2,
          selected: lane === selectedLane,
        },
      ];
    });
  }
  /**
   * 把已渲染的开场末帧交接给浏览状态。
   *
   * 沿用当前镜头和阵列运动状态，避免交接帧跳变。
   *
   * @param nowSeconds 当前时间，单位为秒。
   */
  finishBangumiIntro(nowSeconds: number) {
    if (!this.loaded) return;
    this.bangumiNavigationLift = false;
    this.clock = this.last = nowSeconds;
    this.setMode("archive");
    this.lastInteraction = -Infinity;
    this.reveal = this.targetReveal = 1;
    this.detail = this.targetDetail = 0;
    this.rotation = this.targetRotation = 0;
    this.returnY = null;
    this.dragging = this.canInspect = false;
    this.scanTime = 29.1;
    this.scanBlend = 0;
    this.pulses = [];
    this.pointer.set(0, 0);
    this.bangumiCamera = new BangumiCameraMotion();
    this.bangumiCamera.observe(this.camera, this.cameraAim, 0);
    this.bangumiPresentation.update(0, true, true, true);
  }
  /**
   * 跳过开场并建立浏览初始姿态。
   *
   * 重置开场运动控制器，再把场景定位到可交互的档案状态。
   *
   * @param nowSeconds 当前时间，单位为秒。
   */
  showBangumiArchiveImmediately(nowSeconds: number) {
    if (!this.loaded) return;
    this.bangumiPresentation = new BangumiPresentation();
    this.bangumiCamera = new BangumiCameraMotion();
    this.bangumiPlacement = new BangumiPlacementMotion();
    this.bangumiArchiveMotion = new BangumiArchiveMotion();
    this.bangumiNavigationLift = false;
    this.clock = this.last = this.lastInteraction = nowSeconds;
    this.setMode("archive");
    this.lastInteraction = -Infinity;
    this.reveal = this.targetReveal = 1;
    this.detail = this.targetDetail = 0;
    this.rotation = this.targetRotation = 0;
    this.returnY = null;
    this.dragging = this.canInspect = false;
    this.pointer.set(0, 0);
    this.lift = { value: BANGUMI_PREVIEW_LIFT, velocity: 0 };
    const chosen = this.cellPosition(this.selectedCell);
    this.rail = { value: -2.17 - chosen.z, velocity: 0 };
    this.columnCamera = { value: chosen.x, velocity: 0 };
    this.shoulder = { value: this.selectedCell.row, velocity: 0 };
    this.laneFocus = { value: this.selectedCell.lane, velocity: 0 };
    this.scanTime = 29.1;
    this.scanBlend = this.idleGain = 0;
    this.pulseGain = 1;
    this.pulses = [];
    for (const old of this.outgoing) {
      this.content.remove(old.group);
      this.appearance.dispose(old.group);
    }
    this.outgoing = [];
    this.decryption.select();
    const reduced = this.reduced;
    try {
      this.reduced = true;
      this.update(nowSeconds);
    } finally {
      this.reduced = reduced;
    }
  }
  /**
   * 按固定画质配置调整渲染资源。
   *
   * 更换阴影贴图尺寸时先释放旧目标，并更新纹理过滤。
   */
  prepareRenderQuality() {
    if (this.disposed) return;
    const size = Math.min(
      RENDER_QUALITY.shadows,
      this.renderer.capabilities.maxTextureSize,
    );
    if (this.light.shadow.mapSize.x !== size) {
      this.light.shadow.map?.dispose();
      this.light.shadow.map = null;
      this.light.shadow.mapSize.set(size, size);
    }
    this.light.shadow.needsUpdate = true;
    applyTextureQuality(this.scene, this.renderer);
    this.resize();
  }
  private cellPosition(cell: ArchiveCell) {
    return new THREE.Vector3(
      (cell.lane - 2) * this.columnSpacing,
      -4.6,
      (cell.row - 15.5) * ROW_SPACING,
    );
  }
  /**
   * 周期性重置循环阵列的逻辑坐标原点。
   *
   * 平移选择、波纹与运动状态，保持相对位置及速度不变。
   */
  private rebaseCoordinates() {
    const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
    const rowPeriod = archiveColumns.reduce((period, _, lane) => {
      const count = columnFiles(lane).length || 1;
      const next = (period / gcd(period, count)) * count;
      return next > 1e6 ? Infinity : next;
    }, 1);
    const lanePeriod = Math.max(1, archiveColumns.length);
    const shift = {
      lane:
        Math.abs(this.selectedCell.lane) > 2048
          ? Math.round((this.selectedCell.lane - 2) / lanePeriod) * lanePeriod
          : 0,
      row:
        Math.abs(this.selectedCell.row) > Math.max(2048, rowPeriod * 2)
          ? Math.floor((this.selectedCell.row - 12) / rowPeriod) * rowPeriod
          : 0,
    };
    if (!shift.lane && !shift.row) return;
    this.selectedCell.lane -= shift.lane;
    this.selectedCell.row -= shift.row;
    this.coordinateOrigin.lane += shift.lane;
    this.coordinateOrigin.row += shift.row;
    this.laneFocus.value -= shift.lane;
    this.shoulder.value -= shift.row;
    this.columnCamera.value -= shift.lane * this.columnSpacing;
    if (shift.lane) {
      for (const [lane, physical] of this.bangumiOverviewCopies)
        this.bangumiOverviewCopies.set(lane, physical - shift.lane);
    }
    this.rail.value += shift.row * ROW_SPACING;
    this.bangumiArchiveMotion.translate({
      column: -shift.lane * this.columnSpacing,
      rail: shift.row * ROW_SPACING,
      lane: -shift.lane,
      shoulder: -shift.row,
    });
    for (const old of this.outgoing) {
      old.cell.lane -= shift.lane;
      old.cell.row -= shift.row;
    }
    for (const pulse of this.pulses) {
      pulse.lane -= shift.lane;
      pulse.row -= shift.row;
    }
  }
  switchBangumiAlbum(index: number, navigation?: ArchiveNavigation) {
    if (!this.loaded || !records[index] || !this.bangumiPresentation.placed)
      return;
    this.bangumiNavigationLift = true;
    this.dragging = this.canInspect = false;
    this.select(index, navigation);
    this.decryption.enter(this.decryption.clarity > 0.999);
  }
  /**
   * 选择番剧并重定向阵列轨迹。
   *
   * 更新实体单元、封面、归位副本与光效，远距离选择沿用搜索节奏。
   *
   * @param index 目标番剧在档案中的索引。
   * @param navigation 本次选片的导航上下文。
   */
  select(index: number, navigation?: ArchiveNavigation) {
    if (!records[index]) return;
    if (!this.bangumiPresentation.placed) this.bangumiNavigationLift = false;
    this.lastInteraction = this.clock;
    const next = fileLocation(index).slot;
    const canonical = fileLocation(index);
    const cell = this.looping
      ? selectionCell(index, this.selectedCell, navigation)
      : { lane: canonical.lane, row: canonical.row };
    const distantColumnSelection =
      cell.lane !== this.selectedCell.lane &&
      Math.abs(cell.row - this.selectedCell.row) > 1;
    const changed = !sameCell(cell, this.selectedCell);
    if (changed) this.bangumiPresentation.selectionChanged();
    if (this.looping && changed && this.loaded && this.lift.value > 0.0001) {
      const group = this.model.clone(true);
      this.appearance.prepare(group);
      const cover = group.children.find((child) => child.userData.albumCover) as
        | THREE.Mesh
        | undefined;
      if (cover) this.covers?.snapshot(cover);
      this.appearance.apply(group, smooth(this.lift.value / 0.4));
      this.appearance.setClarity(group, this.decryption.clarity);
      this.content.add(group);
      this.outgoing.push({
        group,
        slot: this.selectedSlot,
        cell: { ...this.selectedCell },
        lift: { ...this.lift },
        returnY: group.rotation.y !== 0 ? group.position.y : null,
        clarity: this.decryption.clarity,
      });
      this.lift.value = 0;
      this.lift.velocity = 0;
    }
    this.selectedSlot = next;
    this.selectedCell = cell;
    if (
      changed &&
      this.loaded &&
      !this.bangumiPresentation.placed &&
      (!navigation ||
        ("cell" in navigation && navigation.guided) ||
        distantColumnSelection ||
        this.bangumiArchiveMotion.active)
    ) {
      const chosen = this.cellPosition(cell);
      this.bangumiArchiveMotion.retarget(
        {
          rail: this.rail,
          column: this.columnCamera,
          shoulder: this.shoulder,
          lane: this.laneFocus,
        },
        {
          rail: -2.17 - chosen.z,
          column: chosen.x,
          shoulder: cell.row,
          lane: cell.lane,
        },
      );
    }
    if (changed) {
      this.decryption.select();
      this.rotation = 0;
      this.returnY = null;
    }
    const returning = this.outgoing.findIndex((o) => sameCell(o.cell, cell));
    if (returning >= 0) {
      const o = this.outgoing[returning];
      this.lift = { ...o.lift };
      this.rotation = o.group.rotation.y;
      this.returnY = o.returnY;
      this.decryption.select(o.clarity);
      this.content.remove(o.group);
      this.appearance.dispose(o.group);
      this.outgoing.splice(returning, 1);
    }
    if (this.bangumiNavigationLift && this.bangumiPresentation.placed) {
    } else this.emitPulse(cell);
    this.targetRotation = 0;
    void this.covers?.select(records[index]);
  }
  private emitPulse(cell: ArchiveCell) {
    this.pulses.push({ ...cell, time: this.clock });
    this.pulses = this.pulses.slice(-6);
  }
  /**
   * 根据舞台容器尺寸更新镜头和后处理。
   *
   * 在布局切换时保留当前画面尺度，再同步渲染目标。
   */
  resize() {
    if (this.disposed) return;
    const w = this.container.clientWidth,
      h = this.container.clientHeight;
    const kind =
      this.container.closest<HTMLElement>("[data-layout]")?.dataset.layout ??
      "";
    const displayHeight = this.container.getBoundingClientRect().height;
    if (
      this.layoutKind === "cinematic" &&
      kind !== "cinematic" &&
      this.displayHeight > 0
    ) {
      this.camera.fov = THREE.MathUtils.radToDeg(
        2 *
          Math.atan(
            (Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) *
              displayHeight) /
              this.displayHeight,
          ),
      );
    }
    this.displayHeight = displayHeight;
    this.layoutKind = kind;
    this.pipeline.resize(this.container);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
  /**
   * 安装画布指针和触摸交互。
   *
   * 负责拾取、拖动与滑动导航；所有监听由 AbortController 在 dispose 中解绑。
   */
  private bindPointer() {
    const canvas = this.renderer.domElement;
    let startX = 0,
      startY = 0;
    let activePointer: number | null = null,
      previousX = 0,
      started = 0,
      cancelled = false;
    const pointers = new Set<number>();
    canvas.addEventListener(
      "pointerdown",
      (e) => {
        if (e.pointerType === "mouse" && e.button !== 0) return;
        pointers.add(e.pointerId);
        if (pointers.size > 1) {
          cancelled = true;
          this.dragging = false;
          return;
        }
        activePointer = e.pointerId;
        cancelled = false;
        previousX = e.clientX;
        started = performance.now();
        startX = e.clientX;
        startY = e.clientY;
        canvas.setPointerCapture(e.pointerId);
        if (this.canInspect) {
          this.dragging = true;
        }
      },
      { signal: this.pointerEvents.signal },
    );
    canvas.addEventListener(
      "pointermove",
      (e) => {
        if (activePointer !== null && e.pointerId !== activePointer) return;
        if (cancelled) return;
        const r = canvas.getBoundingClientRect();
        if (e.pointerType === "mouse")
          this.pointer.set(
            (e.clientX - r.left) / r.width - 0.5,
            (e.clientY - r.top) / r.height - 0.5,
          );
        if (this.dragging) {
          if (!this.canInspect) {
            this.dragging = false;
            return;
          }
          this.targetRotation = THREE.MathUtils.clamp(
            this.targetRotation + (e.clientX - previousX) * 0.004,
            -0.8,
            0.8,
          );
          previousX = e.clientX;
          return;
        }
        if (e.pointerType !== "mouse") return;
        if (
          this.reveal < 0.8 ||
          this.detail > 0.2 ||
          !this.loaded ||
          !records.length
        )
          return;
        this.cursor.set(
          ((e.clientX - r.left) / r.width) * 2 - 1,
          (-(e.clientY - r.top) / r.height) * 2 + 1,
        );
        this.raycaster.setFromCamera(this.cursor, this.camera);
        const hit = this.raycaster
          .intersectObjects([this.instances[0], this.model], true)
          .find((hit) =>
            this.pickableCell(
              hit.instanceId === undefined
                ? this.selectedCell
                : this.cells[hit.instanceId],
            ),
          );
        canvas.style.cursor = hit ? "pointer" : "default";
      },
      { signal: this.pointerEvents.signal },
    );
    canvas.addEventListener(
      "pointerup",
      (e) => {
        pointers.delete(e.pointerId);
        if (e.pointerId !== activePointer) return;
        activePointer = null;
        this.dragging = false;
        if (cancelled) return;
        if (
          e.pointerType !== "mouse" &&
          this.detail < 0.2 &&
          this.reveal >= 0.8 &&
          this.loaded
        ) {
          const swipe = swipeDirection(
            e.clientX - startX,
            e.clientY - startY,
            performance.now() - started,
          );
          if (swipe) {
            this.onNavigate?.(swipe.axis, swipe.direction);
            return;
          }
        }
        if (
          Math.hypot(e.clientX - startX, e.clientY - startY) > 6 ||
          this.detail > 0.2 ||
          this.reveal < 0.8 ||
          !this.loaded ||
          !records.length
        )
          return;
        const r = canvas.getBoundingClientRect();
        this.cursor.set(
          ((e.clientX - r.left) / r.width) * 2 - 1,
          (-(e.clientY - r.top) / r.height) * 2 + 1,
        );
        this.raycaster.setFromCamera(this.cursor, this.camera);
        const hit = this.raycaster
          .intersectObjects([this.instances[0], this.model], true)
          .find((hit) =>
            this.pickableCell(
              hit.instanceId === undefined
                ? this.selectedCell
                : this.cells[hit.instanceId],
            ),
          );
        if (hit)
          this.onSelect?.(
            hit.instanceId !== undefined
              ? fileAtCell(this.cells[hit.instanceId])
              : fileAtSlot(this.selectedSlot),
            hit.instanceId !== undefined
              ? { ...this.cells[hit.instanceId] }
              : { ...this.selectedCell },
          );
      },
      { signal: this.pointerEvents.signal },
    );
    canvas.addEventListener(
      "pointercancel",
      (e) => {
        pointers.delete(e.pointerId);
        if (e.pointerId === activePointer) {
          activePointer = null;
          cancelled = true;
          this.dragging = false;
        }
      },
      { signal: this.pointerEvents.signal },
    );
    canvas.addEventListener(
      "lostpointercapture",
      (e) => {
        pointers.delete(e.pointerId);
        if (e.pointerId === activePointer) {
          activePointer = null;
          this.dragging = false;
        }
      },
      { signal: this.pointerEvents.signal },
    );
    canvas.addEventListener(
      "pointerleave",
      () => {
        this.pointer.set(0, 0);
      },
      { signal: this.pointerEvents.signal },
    );
  }
  /**
   * 推进场景一帧并提交渲染。
   *
   * 统一更新开场、阵列、镜头、灯光、封面上传及后处理，直接修改 Three.js 对象以避免逐帧 React 状态更新。
   *
   * @param time 当前动画时间，单位为秒。
   * @param cinematic 当前开场影片的渲染状态。
   * @param render 本次更新后是否立即提交渲染。
   */
  update(
    time: number,
    cinematic?: {
      reveal: number;
      lift: number;
      time: number;
      bangumiIntro?: boolean;
    },
    render = true,
  ) {
    if (this.disposed) return;
    const realDt = Math.max(0, Math.min(time - this.last, 0.05));
    const speed = !cinematic && !this.reduced ? getBangumiMotionSpeed() : 1;
    const dt = realDt * speed;
    this.last = time;
    this.clock = !cinematic ? this.clock + dt : time;
    const motionTime = this.clock;
    if (!this.loaded) return;
    const previewLift = BANGUMI_PREVIEW_LIFT;
    const overview = !cinematic
      ? this.bangumiOverview.update(dt, this.reduced)
      : 0;
    const extractionScale = !cinematic ? 1 - overview : 1;
    const blend = 1 - Math.exp(-dt * (this.reduced ? 35 : 2.8));
    this.reveal = cinematic
      ? cinematic.reveal
      : this.reduced
        ? this.targetReveal
        : THREE.MathUtils.lerp(this.reveal, this.targetReveal, blend);
    const inspecting = this.targetDetail && this.bangumiPresentation.placed;
    const aligningSelection =
      this.bangumiNavigationLift && this.returnY !== null;
    this.rotation = this.reduced
      ? inspecting
        ? this.targetRotation
        : 0
      : inspecting && !aligningSelection
        ? THREE.MathUtils.lerp(this.rotation, this.targetRotation, blend)
        : returnStep(this.rotation, dt, this.reduced);
    if (!cinematic) {
      this.bangumiPresentation.returnWhenAligned(this.rotation === 0);
      this.targetDetail = Number(this.bangumiPresentation.holdsDetail);
    }
    const presentationProgress = !cinematic
      ? THREE.MathUtils.clamp(
          this.bangumiPlacement.update(this.targetDetail, dt, this.reduced),
          0,
          1,
        )
      : 0;
    const bangumiIntro = Boolean(cinematic?.bangumiIntro);
    const shot =
      bangumiIntro && cinematic
        ? Math.min(cinematic.time, 27.12)
        : (cinematic?.time ?? 29.1);
    const introPose =
      bangumiIntro && cinematic ? bangumiIntroPose(shot) : undefined;
    const introSettle = introPose?.settle ?? 0;
    if (cinematic) {
      this.scanTime = shot;
      this.scanBlend = 1;
    } else {
      this.scanTime += dt;
      this.scanBlend *= Math.exp(-dt * 3);
    }
    if (this.looping && !cinematic) this.rebaseCoordinates();
    const chosen = this.cellPosition(this.selectedCell);
    const selectedRow = this.selectedCell.row;
    const selectedLane = this.selectedCell.lane;
    const navigationLift = !cinematic && this.bangumiNavigationLift;
    const detailNavigation = navigationLift && this.bangumiPresentation.placed;
    const archiveTracks = {
      rail: this.rail,
      column: this.columnCamera,
      shoulder: this.shoulder,
      lane: this.laneFocus,
    };
    const archiveTargets = {
      rail: cinematic ? 0 : -2.17 - chosen.z,
      column: chosen.x,
      shoulder: selectedRow,
      lane: selectedLane,
    };
    const archiveRates = {
      rail: this.reduced
        ? 35
        : detailNavigation
          ? BANGUMI_ALBUM_SWITCH_RATE
          : 3.7,
      column: this.reduced
        ? 35
        : detailNavigation
          ? BANGUMI_ALBUM_SWITCH_RATE
          : 3.7,
      shoulder: this.reduced
        ? 35
        : detailNavigation
          ? BANGUMI_ALBUM_SWITCH_RATE
          : 5,
      lane: this.reduced
        ? 35
        : detailNavigation
          ? BANGUMI_ALBUM_SWITCH_RATE
          : 4,
    };
    if (!cinematic && !detailNavigation && this.bangumiArchiveMotion.active) {
      this.bangumiArchiveMotion.update(archiveTracks, dt, this.reduced);
    } else {
      damp(this.shoulder, archiveTargets.shoulder, archiveRates.shoulder, dt);
      damp(this.laneFocus, archiveTargets.lane, archiveRates.lane, dt);
      damp(this.columnCamera, archiveTargets.column, archiveRates.column, dt);
      damp(this.rail, archiveTargets.rail, archiveRates.rail, dt);
      this.bangumiArchiveMotion.observe(
        archiveTracks,
        archiveTargets,
        archiveRates,
      );
    }
    if (!cinematic && this.reduced) {
      this.shoulder = { value: selectedRow, velocity: 0 };
      this.laneFocus = { value: selectedLane, velocity: 0 };
      this.columnCamera = { value: chosen.x, velocity: 0 };
      this.rail = { value: -2.17 - chosen.z, velocity: 0 };
    }
    if (cinematic) {
      this.rail.value = bangumiIntro ? -2.17 - chosen.z : 0;
      this.rail.velocity = 0;
      this.lift.value = introPose ? introPose.lift : extraction(shot);
      this.lift.velocity = 0;
      this.shoulder.value = selectedRow;
      if (bangumiIntro) this.shoulder.velocity = 0;
      this.laneFocus.value = selectedLane;
      this.laneFocus.velocity = 0;
      this.columnCamera.value = chosen.x;
      this.columnCamera.velocity = 0;
    }
    const trackX = cinematic && !bangumiIntro ? 0 : this.columnCamera.value;
    const center = {
      lane: this.columnCamera.value / this.columnSpacing + 2,
      row: (-this.rail.value - 2.17) / ROW_SPACING + 15.5,
    };
    for (let i = 0; i < this.positions.length; i++) {
      this.cells[i] =
        !bangumiIntro && (cinematic || !this.looping)
          ? poolCell(i, this.poolRows)
          : visibleCell(i, center, this.poolRows);
      this.positions[i].set(
        (this.cells[i].lane - 2) * this.columnSpacing,
        -4.6,
        (this.cells[i].row - 15.5) * ROW_SPACING,
      );
    }
    this.pulses = this.pulses.filter((p) => motionTime - p.time < 3.2);
    const aligningCopy = this.outgoing.some((o) => o.returnY !== null);
    const idle =
      !cinematic &&
      !this.reduced &&
      this.targetReveal > 0 &&
      !this.targetDetail &&
      this.detail < 0.01 &&
      this.returnY === null &&
      !aligningCopy &&
      motionTime - this.lastInteraction > 2.5;
    this.idleGain = this.reduced
      ? 0
      : bangumiIntro
        ? 1
        : cinematic
          ? 0
          : THREE.MathUtils.lerp(
              this.idleGain,
              idle ? 1 : 0,
              1 - Math.exp(-dt * (idle ? 0.8 : 4)),
            );
    this.pulseGain = THREE.MathUtils.lerp(
      this.pulseGain,
      this.targetDetail || this.returnY !== null || aligningCopy ? 0 : 1,
      1 - Math.exp(-dt * 8),
    );
    /**
     * 计算当前帧阵列单元的竖向位移。
     *
     * 开场波场、影片姿态和普通浏览共用一处采样；普通浏览再叠加有限幅度的选择波纹。
     *
     * @param row 目标单元在循环阵列中的行坐标。
     * @param lane 目标单元在循环阵列中的列坐标。
     * @returns 当前帧该单元相对静止位置的竖向位移。
     */
    const field = (row: number, lane: number) => {
      if (bangumiIntro) {
        const relativeLane = lane - selectedLane;
        const depth = row - selectedRow;
        const opening = bangumiIntroWave(depth, relativeLane, shot);
        const resting =
          settlingWave(row - selectedRow, 26.56) *
            columnStrength(lane, selectedLane) +
          idleWave(
            row + this.coordinateOrigin.row,
            lane + this.coordinateOrigin.lane,
            motionTime,
          ) *
            this.idleGain;
        return THREE.MathUtils.lerp(
          opening,
          resting,
          bangumiIntroLaneSettle(relativeLane, shot),
        );
      }
      if (cinematic)
        return cinematicField(
          row,
          lane,
          shot,
          this.shoulder.value,
          this.laneFocus.value,
        );
      let height =
        archiveWave(
          row + this.coordinateOrigin.row,
          lane + this.coordinateOrigin.lane,
          this.scanTime,
        ) *
          this.scanBlend +
        idleWave(
          row + this.coordinateOrigin.row,
          lane + this.coordinateOrigin.lane,
          motionTime,
        ) *
          this.idleGain;
      if (!cinematic && !this.reduced) {
        let ripple = 0;
        for (const p of this.pulses) {
          const distance = Math.hypot(row - p.row, (lane - p.lane) * 2.2);
          const age = motionTime - p.time;
          ripple += bangumiSelectionWave(distance, age);
        }
        height += THREE.MathUtils.clamp(ripple, -0.24, 0.24) * this.pulseGain;
      }
      const distance = row - this.shoulder.value;
      return (
        height +
        settlingWave(distance, 26.56) *
          columnStrength(lane, this.laneFocus.value)
      );
    };
    const selectedBase = chosen.y + field(selectedRow, selectedLane);
    if (!cinematic) {
      if (this.returnY !== null && this.rotation !== 0) {
        this.lift.value = this.returnY - selectedBase;
        this.lift.velocity = 0;
      } else {
        this.returnY = null;
        if (navigationLift) {
          const aligningNeighbor = this.outgoing.some(
            (o) =>
              o.returnY !== null &&
              o.cell.lane === selectedLane &&
              Math.abs(o.cell.row - selectedRow) < 5,
          );
          const liftTarget = this.bangumiPresentation.placed
            ? !this.reduced && aligningNeighbor
              ? 0
              : BANGUMI_INSPECTION_LIFT
            : previewLift * this.targetReveal;
          if (this.reduced) this.lift = { value: liftTarget, velocity: 0 };
          else
            damp(
              this.lift,
              liftTarget,
              detailNavigation ? BANGUMI_ALBUM_SWITCH_RATE : 4.2,
              dt,
            );
        } else if (
          presentationProgress > 0 ||
          !this.bangumiPlacement.settled ||
          this.targetDetail
        ) {
          const restingLift = previewLift * this.targetReveal;
          this.lift.value = THREE.MathUtils.lerp(
            restingLift,
            BANGUMI_INSPECTION_LIFT,
            presentationProgress,
          );
          this.lift.velocity =
            this.bangumiPlacement.value === presentationProgress
              ? (BANGUMI_INSPECTION_LIFT - restingLift) *
                this.bangumiPlacement.velocity
              : 0;
        } else
          damp(
            this.lift,
            this.outgoing.some(
              (o) =>
                o.returnY !== null &&
                o.cell.lane === selectedLane &&
                Math.abs(o.cell.row - selectedRow) < 5,
            )
              ? 0
              : previewLift * this.targetReveal,
            this.reduced ? 35 : 4.2,
            dt,
          );
      }
    }
    this.detail = cinematic
      ? bangumiIntro
        ? 0
        : bangumiCinematicPose(shot).detail
      : presentationProgress;
    const detail = this.detail;
    this.decryption.update(
      dt,
      detail > 0.78 && this.lift.value > 3.3,
      this.reduced,
      cinematic ? shot + 5 : undefined,
    );
    this.appearance.apply(
      this.model,
      smooth((this.lift.value * extractionScale) / 0.4),
    );
    this.appearance.setClarity(this.model, this.decryption.clarity);
    const entry = cinematic ? smooth((shot - 21.9) / 0.86) : this.reveal;
    const entranceTime = THREE.MathUtils.clamp((shot - 21.92) / 0.75, 0, 1);
    const entryZ = bangumiIntro
      ? 0
      : cinematic
        ? -23 * (1 - entranceTime) ** 2
        : -28 * (1 - entry);
    for (let i = this.outgoing.length - 1; i >= 0; i--) {
      const o = this.outgoing[i];
      const p = this.cellPosition(o.cell);
      const baseY = p.y + field(o.cell.row, o.cell.lane);
      o.group.rotation.y = this.reduced
        ? 0
        : returnStep(o.group.rotation.y, dt, this.reduced);
      if (this.reduced) {
        o.returnY = null;
        o.lift = { value: 0, velocity: 0 };
      } else if (o.returnY !== null) {
        o.lift.value = o.returnY - baseY;
        o.lift.velocity = 0;
        if (o.group.rotation.y === 0) o.returnY = null;
      } else
        damp(
          o.lift,
          0,
          this.reduced
            ? 35
            : detailNavigation
              ? BANGUMI_ALBUM_SWITCH_RATE
              : 4.5,
          dt,
        );
      o.group.position.set(
        p.x - trackX,
        baseY + o.lift.value * extractionScale,
        p.z + entryZ + this.rail.value,
      );
      const quality = smooth((o.lift.value * extractionScale) / 0.4);
      this.appearance.apply(o.group, quality);
      o.clarity = this.reduced ? 0 : o.clarity * Math.exp(-dt * 9);
      this.appearance.setClarity(o.group, o.clarity);
      const { row, lane } = o.cell;
      o.group.rotation.x =
        (field(row + 0.5, lane) - field(row - 0.5, lane)) *
        0.024 *
        (1 - detail) *
        (1 - quality);
      this.applyBangumiColumnExtent(
        o.group,
        cinematic ? 1 : this.bangumiColumnExtent(o.cell.lane),
      );
      if (o.lift.value < 0.0001 && Math.abs(o.group.rotation.y) < 0.0001) {
        this.content.remove(o.group);
        this.appearance.dispose(o.group);
        this.outgoing.splice(i, 1);
      }
    }
    const hidden = new Set(this.outgoing.map((o) => cellKey(o.cell)));
    hidden.add(cellKey(this.selectedCell));
    for (let i = 0; i < this.positions.length; i++) {
      const p = this.positions[i];
      const { row, lane } = this.cells[i];
      const slope = field(row + 0.5, lane) - field(row - 0.5, lane);
      this.dummy.position.set(
        p.x - trackX,
        p.y + field(row, lane),
        p.z + entryZ + this.rail.value,
      );
      this.dummy.rotation.set(slope * 0.024 * (1 - detail), 0, 0);
      const hiddenCell =
        hidden.has(cellKey(this.cells[i])) ||
        (!bangumiIntro &&
          (cinematic || !this.looping) &&
          i >= 5 * this.poolRows);
      this.applyBangumiColumnExtent(
        this.dummy,
        hiddenCell ? 0 : cinematic ? 1 : this.bangumiColumnExtent(lane),
      );
      this.dummy.updateMatrix();
      for (const inst of this.instances) inst.setMatrixAt(i, this.dummy.matrix);
      if (this.covers) {
        this.covers.array.setMatrixAt(i, this.dummy.matrix);
        this.covers.setSlot(i, records[fileAtCell(this.cells[i])]);
      }
    }
    for (const inst of this.instances) inst.instanceMatrix.needsUpdate = true;
    if (this.covers) this.covers.array.instanceMatrix.needsUpdate = true;
    this.model.position.set(
      chosen.x - trackX,
      chosen.y +
        field(selectedRow, selectedLane) +
        this.lift.value * extractionScale,
      chosen.z + entryZ + this.rail.value,
    );
    this.model.rotation.set(
      (field(selectedRow + 0.5, selectedLane) -
        field(selectedRow - 0.5, selectedLane)) *
        0.024 *
        (1 - detail) *
        (1 - smooth((this.lift.value * extractionScale) / 0.4)),
      cinematic ? 0 : this.rotation,
      0,
    );
    this.applyBangumiColumnExtent(
      this.model,
      cinematic ? 1 : this.bangumiColumnExtent(selectedLane),
    );
    const orbit = smooth((shot - 22.6) / 1.6);
    const settle = smooth((shot - 24.25) / 2.25);
    const navigationElevation = !cinematic
      ? this.bangumiCamera.navigationElevation(
          this.rail.velocity / ROW_SPACING,
          detail,
          dt,
          this.reduced,
        )
      : 0;
    const yaw = THREE.MathUtils.degToRad(
      introPose?.yaw ?? 89 - 22 * orbit - 8 * settle,
    );
    const elevation =
      THREE.MathUtils.degToRad(
        introPose?.elevation ??
          3 +
            40 * smooth((shot - 21.96) / 0.22) -
            8 * orbit -
            16 * settle +
            (!cinematic ? 6 : 0),
      ) + navigationElevation;
    const span =
      introPose?.span ??
      THREE.MathUtils.lerp(
        THREE.MathUtils.lerp(10.8, 10.3, orbit),
        7.33,
        settle,
      );
    const distance =
      introPose?.distance ??
      THREE.MathUtils.lerp(
        THREE.MathUtils.lerp(28 + 7 * orbit, 140, settle),
        72,
        detail,
      );
    const arrayAim = new THREE.Vector3(
      -1.091,
      THREE.MathUtils.lerp(-2.55 + 0.4 * orbit, -0.045, settle),
      THREE.MathUtils.lerp(2.48, 0.481, settle),
    );
    if (introPose) arrayAim.set(introPose.aimX, introPose.aimY, introPose.aimZ);
    const cameraAim = arrayAim.clone();
    const viewDirection = new THREE.Vector3(
      -Math.sin(yaw) * Math.cos(elevation),
      Math.sin(elevation),
      Math.cos(yaw) * Math.cos(elevation),
    );
    if (cinematic && !bangumiIntro) {
      const bangumiPose = bangumiCinematicPose(
        shot,
        THREE.MathUtils.radToDeg(yaw),
        THREE.MathUtils.radToDeg(elevation),
      );
      const shotYaw = THREE.MathUtils.degToRad(bangumiPose.yaw);
      const shotElevation = THREE.MathUtils.degToRad(bangumiPose.elevation);
      viewDirection.set(
        -Math.sin(shotYaw) * Math.cos(shotElevation),
        Math.sin(shotElevation),
        Math.cos(shotYaw) * Math.cos(shotElevation),
      );
    } else {
      const detailYaw = THREE.MathUtils.degToRad(8);
      const inspectionYaw = THREE.MathUtils.lerp(yaw, detailYaw, detail);
      const inspectionElevation = THREE.MathUtils.lerp(
        elevation,
        BANGUMI_DETAIL_ELEVATION,
        detail,
      );
      viewDirection.set(
        -Math.sin(inspectionYaw) * Math.cos(inspectionElevation),
        Math.sin(inspectionElevation),
        Math.cos(inspectionYaw) * Math.cos(inspectionElevation),
      );
    }
    if (cinematic && !bangumiIntro) {
      const pan = smooth((shot - 25.4) / 0.95);
      const right = new THREE.Vector3()
        .crossVectors(new THREE.Vector3(0, 1, 0), viewDirection)
        .normalize();
      cameraAim.addScaledVector(
        right,
        -2.05 * (1 - pan) * smooth((shot - 24.2) / 0.8),
      );
    }
    if (cinematic && !bangumiIntro && shot >= 25.05 && shot <= 27.3) {
      const pan = smooth((shot - 25.4) / 1.05);
      const right = new THREE.Vector3()
        .crossVectors(new THREE.Vector3(0, 1, 0), viewDirection)
        .normalize();
      const up = new THREE.Vector3()
        .crossVectors(viewDirection, right)
        .normalize();
      const pixelScale = 1080 / span;
      const anchorAim = this.model.position
        .clone()
        .add(
          new THREE.Vector3(
            -BANGUMI_MODEL.width / 2,
            BANGUMI_MODEL.center.y + BANGUMI_MODEL.height / 2,
            0,
          ),
        );
      anchorAim.addScaledVector(
        right,
        -(THREE.MathUtils.lerp(840, 518, pan) - 960) / pixelScale,
      );
      anchorAim.addScaledVector(
        up,
        -(540 - THREE.MathUtils.lerp(340, 288, pan)) / pixelScale,
      );
      cameraAim.lerp(anchorAim, smooth((shot - 25.05) / 0.35));
    }
    if (cinematic && !bangumiIntro && shot > 27.3) {
      const bangumiAnchor = bangumiExtractionAnchor(shot);
      const screenX = bangumiAnchor.x;
      const screenY = bangumiAnchor.y;
      const pixelScale = 1080 / THREE.MathUtils.lerp(span, 5.9, detail);
      const right = new THREE.Vector3()
        .crossVectors(new THREE.Vector3(0, 1, 0), viewDirection)
        .normalize();
      const up = new THREE.Vector3()
        .crossVectors(viewDirection, right)
        .normalize();
      const anchorAim = this.model.position
        .clone()
        .add(
          new THREE.Vector3(
            -BANGUMI_MODEL.width / 2,
            BANGUMI_MODEL.center.y + BANGUMI_MODEL.height / 2,
            0,
          ),
        );
      anchorAim.addScaledVector(right, -(screenX - 960) / pixelScale);
      anchorAim.addScaledVector(up, -(540 - screenY) / pixelScale);
      cameraAim.copy(anchorAim);
      const centerAim = this.model.position
        .clone()
        .add(new THREE.Vector3().copy(BANGUMI_MODEL.center));
      cameraAim.lerp(centerAim, bangumiCinematicPose(shot).centered);
    }
    const width = this.container.clientWidth,
      height = this.container.clientHeight;
    const framing = archiveFraming(
      width,
      height,
      span,
      detail,
      this.container.closest<HTMLElement>("[data-layout]")?.dataset.layout ===
        "compact",
    );
    const right = new THREE.Vector3()
      .crossVectors(new THREE.Vector3(0, 1, 0), viewDirection)
      .normalize();
    const up = new THREE.Vector3()
      .crossVectors(viewDirection, right)
      .normalize();
    const previewShift = new THREE.Vector3();
    const offset = bangumiArchiveOffset(width, height);
    previewShift.addScaledVector(
      right,
      (offset.x * framing.span * width) / Math.max(1, height),
    );
    previewShift.addScaledVector(up, offset.y * framing.span);
    if (bangumiIntro) {
      const previewAim = new THREE.Vector3(-1.091, -0.045, 0.481);
      if (framing.portrait) {
        previewAim.set(0, -4.6 + settlingWave(0, 26.56) + 0.4 + 1.85, -2.17);
        previewAim.addScaledVector(up, (framing.previewY - 0.5) * framing.span);
      }
      previewAim.add(previewShift);
      cameraAim.lerp(previewAim, introSettle);
    }
    if (!cinematic) {
      const pixelScale = height / framing.span;
      if (framing.portrait) {
        const previewAim = new THREE.Vector3(
          0,
          -4.6 + settlingWave(0, 26.56) + 0.4 + 1.85,
          -2.17,
        );
        previewAim.addScaledVector(
          up,
          ((framing.previewY - 0.5) * height) / pixelScale,
        );
        cameraAim.copy(previewAim);
      }
      cameraAim.add(previewShift);
      const detailAim = new THREE.Vector3(
        0,
        -4.6 +
          settlingWave(0, 26.56) +
          BANGUMI_INSPECTION_LIFT +
          BANGUMI_MODEL.center.y,
        -2.17,
      );
      const detailX = framing.portrait ? 0.5 : 0.25;
      detailAim.addScaledVector(right, ((0.5 - detailX) * width) / pixelScale);
      detailAim.addScaledVector(
        up,
        ((framing.detailY - 0.5) * height) / pixelScale,
      );
      cameraAim.lerp(detailAim, detail);
    }
    if (overview > 0) {
      const wide = overviewFraming(width, height);
      const yaw = THREE.MathUtils.degToRad(wide.yaw),
        elevation = THREE.MathUtils.degToRad(wide.elevation);
      viewDirection
        .lerp(
          new THREE.Vector3(
            -Math.sin(yaw) * Math.cos(elevation),
            Math.sin(elevation),
            Math.cos(yaw) * Math.cos(elevation),
          ),
          overview,
        )
        .normalize();
      cameraAim.lerp(
        new THREE.Vector3(wide.aimColumns * this.columnSpacing, -1.8, -1.5),
        overview,
      );
      framing.span = THREE.MathUtils.lerp(framing.span, wide.span, overview);
    }
    const cameraPosition = cameraAim
      .clone()
      .addScaledVector(
        viewDirection,
        THREE.MathUtils.lerp(
          distance,
          overviewFraming(width, height).distance,
          overview,
        ),
      );
    if (!cinematic && !this.reduced && !this.bangumiPresentation.holdsDetail) {
      cameraPosition.x += this.pointer.x * 0.12;
      cameraPosition.y -= this.pointer.y * 0.12;
    }
    if (!cinematic) {
      this.bangumiCamera.update(
        this.camera,
        this.cameraAim,
        cameraPosition,
        cameraAim,
        framing.span,
        dt,
        this.reduced,
      );
      const detailTarget = this.bangumiPresentation.holdsDetail ? 1 : 0;
      const liftTarget = this.bangumiPresentation.holdsDetail
        ? BANGUMI_INSPECTION_LIFT
        : previewLift * this.targetReveal;
      const tracksSettled = bangumiArchiveTracksSettled(
        {
          rail: this.rail,
          column: this.columnCamera,
          shoulder: this.shoulder,
          lane: this.laneFocus,
        },
        {
          rail: -2.17 - chosen.z,
          column: chosen.x,
          shoulder: selectedRow,
          lane: selectedLane,
        },
      );
      this.bangumiPresentation.update(
        dt,
        this.bangumiCamera.isSettled(
          this.camera,
          this.cameraAim,
          cameraPosition,
          cameraAim,
          framing.span,
        ),
        this.bangumiPlacement.settled &&
          this.bangumiArchiveMotion.settled &&
          tracksSettled &&
          Math.abs(this.detail - detailTarget) < 0.001 &&
          Math.abs(this.lift.value - liftTarget) < 0.008 &&
          Math.abs(this.rotation) < 0.001 &&
          Math.abs(this.lift.velocity) < 0.025,
        this.reduced,
      );
      this.targetDetail = Number(this.bangumiPresentation.holdsDetail);
      if (this.bangumiPresentation.phase === "archive")
        this.bangumiNavigationLift = false;
    } else {
      const cameraBlend = cinematic ? 1 : 1 - Math.exp(-dt * 5);
      this.camera.position.lerp(cameraPosition, cameraBlend);
      this.cameraAim.lerp(cameraAim, cameraBlend);
      this.camera.lookAt(this.cameraAim);
      this.camera.fov = THREE.MathUtils.lerp(
        this.camera.fov,
        THREE.MathUtils.radToDeg(
          2 *
            Math.atan(
              (cinematic && !bangumiIntro
                ? THREE.MathUtils.lerp(span, 5.9, detail)
                : framing.span) /
                (2 * distance),
            ),
        ),
        cameraBlend,
      );
      this.bangumiCamera.observe(this.camera, this.cameraAim, dt);
    }
    const fog = this.scene.fog as THREE.Fog;
    const renderedDistance = this.camera.position.distanceTo(this.cameraAim);
    const atmosphere = bangumiFogDistances(renderedDistance, detail);
    fog.near = atmosphere.near;
    fog.far = atmosphere.far;
    if (this.stars?.visible) {
      const depth = renderedDistance + 38;
      this.stars.position
        .copy(this.camera.position)
        .addScaledVector(
          this.camera.getWorldDirection(new THREE.Vector3()),
          depth,
        );
      this.stars.quaternion.copy(this.camera.quaternion);
      const halfHeight =
        Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * depth;
      this.stars.scale.set(halfHeight * this.camera.aspect, halfHeight, 1);
    }

    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    let neighborTop = -Infinity;
    const boxTop = BANGUMI_MODEL.center.y + BANGUMI_MODEL.height / 2;
    const boxBottom = BANGUMI_MODEL.center.y - BANGUMI_MODEL.height / 2;
    const lane = selectedLane,
      row = selectedRow;
    for (let r = row - 5; r <= row + 5; r++) {
      if (r !== row)
        neighborTop = Math.max(neighborTop, -4.6 + field(r, lane) + boxTop);
    }
    for (const o of this.outgoing) {
      if (o.cell.lane === lane && Math.abs(o.cell.row - row) <= 5) {
        neighborTop = Math.max(neighborTop, o.group.position.y + boxTop);
      }
    }
    this.clearance = this.model.position.y + boxBottom - neighborTop;
    this.canInspect =
      !cinematic &&
      this.bangumiPresentation.phase === "presented" &&
      Boolean(this.targetDetail) &&
      detail > 0.9 &&
      this.pulseGain < 0.01 &&
      this.clearance > 0.05;
    const focalPoint = this.model.position
      .clone()
      .add(new THREE.Vector3(0, 2, 0))
      .applyMatrix4(this.camera.matrixWorldInverse);
    this.pipeline.setFocus(-focalPoint.z, detail);
    this.renderer.info.reset();
    this.selectionLighting?.update(
      this.model,
      this.camera,
      dt,
      records.length > 0 && this.model.visible,
      this.reduced,
      Boolean(cinematic),
      this.detail,
      {
        row: selectedRow + this.coordinateOrigin.row,
        lane: selectedLane + this.coordinateOrigin.lane,
        introTime: bangumiIntro ? shot : undefined,
      },
    );
    this.renderer.shadowMap.autoUpdate = false;
    if (this.renderer.shadowMap.enabled)
      this.renderer.shadowMap.needsUpdate = true;
    if (render) {
      this.covers?.flushUploads(this.renderer);
      this.pipeline.render();
    }
  }
  /**
   * 在开场开始前预热真实渲染管线。
   *
   * 异步准备可见封面并执行有限帧绘制，初始化透射、阴影、AO 与景深目标。
   */
  async prepareBangumiRenderer() {
    if (!this.loaded || this.disposed) return;
    const started = performance.now();
    const nextFrame = () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const settled = {
      reveal: 1,
      lift: 0,
      time: 27.12,
      bangumiIntro: true,
    };
    this.update(started / 1000, settled, false);
    const visible = this.model.visible;
    this.model.visible = true;
    try {
      await this.renderer.compileAsync(this.scene, this.camera);
    } finally {
      this.model.visible = visible;
    }
    if (this.disposed) return;
    await this.covers?.prepareVisible(1200);
    for (
      let i = 0;
      i < 12 && this.covers && this.covers.getStats().dirtyTiles;
      i++
    ) {
      if (this.disposed) return;
      this.covers.flushUploads(this.renderer, 64);
      await nextFrame();
    }
    for (let i = 0; i < 2; i++) {
      if (this.disposed) return;
      this.update(performance.now() / 1000, settled);
      await nextFrame();
    }
    if (this.disposed) return;
    this.setMode("hidden");
  }
  /**
   * 释放命令式场景拥有的资源。
   *
   * 取消事件、封面任务及图集，销毁实例几何体、材质、纹理、环境目标与后处理；R3F 继续负责 Canvas 本身。
   */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.pointerEvents.abort();
    this.loaded = false;
    const covers = this.covers;
    covers?.dispose();
    this.covers = undefined;
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>();
    this.content.traverse((object) => {
      if (object === covers?.array || object === covers?.selected) return;
      if (object instanceof THREE.Mesh || object instanceof THREE.Points) {
        geometries.add(object.geometry);
        for (const material of Array.isArray(object.material)
          ? object.material
          : [object.material]) {
          materials.add(material);
          for (const value of Object.values(material))
            if (value instanceof THREE.Texture && !value.isRenderTargetTexture)
              textures.add(value);
        }
      }
    });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    for (const texture of textures) texture.dispose();
    this.scene.environment = null;
    this.environmentTarget.dispose();
    this.pipeline.dispose();
    this.content.clear();
    this.outgoing = [];
    this.renderer.info.autoReset = true;
  }
  get bangumiArchiveReady() {
    return this.loaded && this.bangumiPresentation.phase === "archive";
  }
  get bangumiPresentationPhase() {
    return this.bangumiPresentation.phase;
  }
}
