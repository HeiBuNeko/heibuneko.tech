import * as THREE from "three";
import { BokehPass } from "three/addons/postprocessing/BokehPass.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { SSAOPass } from "three/addons/postprocessing/SSAOPass.js";
import { resizeQuality } from "./render-quality";

/**
 * 创建场景后处理管线。
 *
 * 持有 AO、景深和输出通道，并提供尺寸更新、渲染及释放方法。
 *
 * @param renderer 场景使用的 WebGL 渲染器。
 * @param scene 需要绘制或配置的 Three.js 场景。
 * @param camera 需要读取或更新姿态的相机。
 * @param width 视口或渲染区域的宽度。
 * @param height 视口或渲染区域的高度。
 * @param setDpr 更新 R3F 画布像素比的回调。
 * @returns 后处理控制句柄；调用方负责调用 dispose。
 */
export function createPostprocessing(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  width: number,
  height: number,
  setDpr: (ratio: number) => void,
) {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const ao = new SSAOPass(scene, camera, width, height);
  ao.kernelRadius = 0.38;
  ao.minDistance = 0.001;
  ao.maxDistance = 0.09;
  composer.addPass(ao);
  const bokeh = new BokehPass(scene, camera, {
    focus: 25,
    aperture: 0.0018,
    maxblur: 0.011,
  });
  composer.addPass(bokeh);
  composer.addPass(new OutputPass());

  const softenContactShadows = () => {
    ao.kernelRadius = 0.18;
    ao.maxDistance = 0.035;
    ao.copyMaterial.fragmentShader = ao.copyMaterial.fragmentShader.replace(
      "gl_FragColor = opacity * texel;",
      "gl_FragColor = vec4(mix(vec3(1.0), texel.rgb, 0.22), texel.a);",
    );
    ao.copyMaterial.needsUpdate = true;
  };

  return {
    softenContactShadows,
    resize(host: HTMLElement) {
      const dimensions = resizeQuality(renderer, composer, host, setDpr);
      ao.setSize(dimensions.width, dimensions.height);
    },
    setFocus(depth: number, detail: number) {
      const uniforms = bokeh.uniforms as Record<string, { value: number }>;
      uniforms.focus.value = depth;
      uniforms.aperture.value = THREE.MathUtils.lerp(0.0003, 0.0008, detail);
    },
    render() {
      composer.render();
    },
    dispose() {
      for (const pass of composer.passes) pass.dispose();
      composer.dispose();
    },
  };
}
