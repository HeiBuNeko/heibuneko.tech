import { Float, useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { Euler, MathUtils, type Object3D, Quaternion, Vector2 } from "three";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";

const MODEL_URL = "/model/gura/scene.gltf";
/** 手臂下垂角度（模型原始姿势为双臂张开的 T 字） */
const ARM_DROP = MathUtils.degToRad(60);

/** 鼠标贴到窗口边缘时头部的最大转角（左右 / 上下） */
const MAX_YAW = MathUtils.degToRad(35);
const MAX_PITCH = MathUtils.degToRad(20);
/** 平滑系数，越大头追上鼠标越快 */
const DAMPING = 6;

/**
 * 参与转动的骨骼（自下而上：脊柱、胸、颈、头）及其分担的转动比例。
 * yaw、pitch 各自合计约为 1，越靠上占比越大，头转得最多。
 */
const FOLLOW_BONES = [
  { name: "Joint_0010", yaw: 0.08, pitch: 0.04 },
  { name: "Joint_0011", yaw: 0.12, pitch: 0.06 },
  { name: "Joint_0012", yaw: 0.25, pitch: 0.3 },
  { name: "Joint_0013", yaw: 0.55, pitch: 0.6 },
] as const;

type Follower = {
  bone: Object3D;
  /** 左右 / 上下转动比例，取自 FOLLOW_BONES */
  yaw: number;
  pitch: number;
  /** 骨骼的初始局部旋转，每帧在其基础上叠加转动 */
  rest: Quaternion;
  /** 父骨骼的初始世界朝向及其逆，用于把世界旋转换算到骨骼本地 */
  parentWorld: Quaternion;
  parentWorldInv: Quaternion;
};

// 每帧复用的临时对象，避免频繁创建触发 GC
const euler = new Euler(0, 0, 0, "YXZ");
const delta = new Quaternion();
const local = new Quaternion();

/** 放下手臂，并记录每根跟随骨骼的初始姿势和父骨骼朝向 */
const setupRig = (root: Object3D): Follower[] => {
  root.getObjectByName("Joint_0129R")?.rotation.set(ARM_DROP, 0, 0);
  root.getObjectByName("Joint_0164L")?.rotation.set(-ARM_DROP, 0, 0);
  // 先刷新世界矩阵，才能读到最新的父骨骼朝向
  root.updateWorldMatrix(true, true);

  return FOLLOW_BONES.flatMap(({ name, yaw, pitch }) => {
    const bone = root.getObjectByName(name);
    // 找不到的骨骼直接跳过
    if (!bone?.parent) return [];
    const parentWorld = bone.parent.getWorldQuaternion(new Quaternion());
    return {
      bone,
      yaw,
      pitch,
      rest: bone.quaternion.clone(),
      parentWorld,
      parentWorldInv: parentWorld.clone().invert(),
    };
  });
};

/**
 * 跟踪鼠标位置，输出归一化坐标：x、y 范围 -1 ~ 1，原点在窗口中心，右、上为正。
 * 鼠标移出页面后保持最后位置。
 * @returns ref 而非 state，鼠标移动不会触发重新渲染
 */
const usePointerTarget = () => {
  const target = useRef(new Vector2(0, 0));

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      // Math.max 防止窗口尺寸为 0 时除以零
      const x = (event.clientX / Math.max(window.innerWidth, 1)) * 2 - 1;
      // 屏幕 y 向下增大，取反后向上为正
      const y = 1 - (event.clientY / Math.max(window.innerHeight, 1)) * 2;
      target.current.set(MathUtils.clamp(x, -1, 1), MathUtils.clamp(y, -1, 1));
    };

    window.addEventListener("pointermove", onPointerMove, { passive: true });

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
    };
  }, []);

  return target;
};

export const Model = () => {
  const gltf = useGLTF(MODEL_URL);
  // 带骨骼的模型须用 SkeletonUtils 克隆，皮肤才会绑定到克隆出的骨骼；
  // 克隆与收集骨骼放在一起，保证记录的就是实际渲染的那一份
  const { scene, followers } = useMemo(() => {
    const scene = clone(gltf.scene);
    return { scene, followers: setupRig(scene) };
  }, [gltf.scene]);

  // 头当前朝向（-1 ~ 1），每帧向鼠标位置靠近，避免瞬间跳转
  const smooth = useRef({ x: 0, y: 0 });
  const pointer = usePointerTarget();

  useFrame((_, dt) => {
    const s = smooth.current;
    s.x = MathUtils.damp(s.x, pointer.current.x, DAMPING, dt);
    s.y = MathUtils.damp(s.y, pointer.current.y, DAMPING, dt);

    // 鼠标在右 → 绕 Y 轴向右转；鼠标在上 → 抬头（three.js 中为绕 X 轴负向）
    const yaw = s.x * MAX_YAW;
    const pitch = -s.y * MAX_PITCH;

    for (const f of followers) {
      // 世界空间中要多转的角度（YXZ：先俯仰、再偏航）
      delta.setFromEuler(euler.set(pitch * f.pitch, yaw * f.yaw, 0, "YXZ"));
      // 换算到骨骼本地：local = 父⁻¹ · delta · 父 · 初始旋转。
      // 导出的骨骼坐标轴是歪的，不能直接绕 X/Y 轴转，必须经过这层换算
      local
        .copy(f.parentWorldInv)
        .multiply(delta)
        .multiply(f.parentWorld)
        .multiply(f.rest);
      f.bone.quaternion.copy(local);
    }
  });

  return (
    <Float speed={5} rotationIntensity={0}>
      <primitive object={scene} />
    </Float>
  );
};
