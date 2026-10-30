import * as THREE from "three";
import { BokehPass } from "three/addons/postprocessing/BokehPass.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { SMAAPass } from "three/addons/postprocessing/SMAAPass.js";
import { SSAOPass } from "three/addons/postprocessing/SSAOPass.js";
import { type RenderQuality, resizeQuality } from "./render-quality";

export function createPostprocessing(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  width: number,
  height: number,
  refined: boolean,
  setDpr: (ratio: number) => void,
) {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  let ao = new SSAOPass(scene, camera, width, height);
  ao.kernelRadius = refined ? 0.44 : 0.38;
  ao.minDistance = 0.001;
  ao.maxDistance = 0.09;
  composer.addPass(ao);
  const bokeh = new BokehPass(scene, camera, {
    focus: 25,
    aperture: 0.0018,
    maxblur: 0.011,
  });
  composer.addPass(bokeh);
  const smaa = new SMAAPass();
  smaa.enabled = false;
  composer.addPass(smaa);
  composer.addPass(new OutputPass());
  let aoKernelSize = 32;

  const softenContactShadows = () => {
    ao.kernelRadius = 0.18;
    ao.maxDistance = 0.035;
    // Thin transmitting cases need a soft contact cue, not opaque black AO.
    ao.copyMaterial.fragmentShader = ao.copyMaterial.fragmentShader.replace(
      "gl_FragColor = opacity * texel;",
      "gl_FragColor = vec4(mix(vec3(1.0), texel.rgb, 0.22), texel.a);",
    );
    ao.copyMaterial.needsUpdate = true;
  };

  return {
    softenContactShadows,
    setQuality(quality: RenderQuality, soften: boolean) {
      if (quality.aoSamples && quality.aoSamples !== aoKernelSize) {
        const old = ao;
        ao = new SSAOPass(scene, camera, 1, 1, quality.aoSamples);
        ao.kernelRadius = old.kernelRadius;
        ao.minDistance = old.minDistance;
        ao.maxDistance = old.maxDistance;
        const index = composer.passes.indexOf(old);
        composer.removePass(old);
        composer.insertPass(ao, index);
        old.dispose();
        aoKernelSize = quality.aoSamples;
        if (soften) softenContactShadows();
      }
      ao.enabled = quality.aoSamples > 0;
      bokeh.enabled = quality.depthOfField > 0;
      smaa.enabled = quality.antialias === "smaa";
    },
    resize(host: HTMLElement, quality: RenderQuality) {
      const dimensions = resizeQuality(
        renderer,
        composer,
        host,
        quality,
        setDpr,
      );
      ao.setSize(
        Math.max(1, Math.floor(dimensions.width * quality.aoResolution)),
        Math.max(1, Math.floor(dimensions.height * quality.aoResolution)),
      );
    },
    setFocus(depth: number, detail: number, depthOfField: number) {
      const uniforms = bokeh.uniforms as Record<string, { value: number }>;
      uniforms.focus.value = depth;
      uniforms.aperture.value =
        (THREE.MathUtils.lerp(0.0003, 0.0008, detail) * depthOfField) / 100;
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
