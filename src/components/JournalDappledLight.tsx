import { useEffect, useRef } from "react";
import * as THREE from "three";

interface JournalDappledLightProps {
  reducedMotion: boolean;
}

type MovingLeaf = {
  basePosition: THREE.Vector3;
  baseRotation: number;
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  phase: number;
  strength: number;
};

type MovingCanopy = {
  basePosition: THREE.Vector3;
  baseRotation: number;
  group: THREE.Group;
  phase: number;
};

function seededRandom(seed: number) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let next = value;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

function makeLeafTexture() {
  const textureCanvas = document.createElement("canvas");
  textureCanvas.width = 128;
  textureCanvas.height = 128;
  const context = textureCanvas.getContext("2d");
  if (!context) return null;

  context.clearRect(0, 0, 128, 128);
  context.fillStyle = "#fff";
  context.beginPath();
  context.moveTo(63, 7);
  context.bezierCurveTo(102, 20, 119, 47, 106, 75);
  context.bezierCurveTo(95, 99, 72, 115, 63, 121);
  context.bezierCurveTo(49, 111, 26, 96, 18, 71);
  context.bezierCurveTo(9, 42, 30, 18, 63, 7);
  context.closePath();
  context.fill();

  const texture = new THREE.CanvasTexture(textureCanvas);
  texture.colorSpace = THREE.NoColorSpace;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

export function JournalDappledLight({ reducedMotion }: JournalDappledLightProps) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: false,
      powerPreference: "high-performance",
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
    });
    renderer.domElement.className = "journal-prompt__dappled-light-canvas";
    renderer.setClearColor(0x000000, 0);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-8, 8, 6, -6, 0.1, 40);
    camera.position.set(0, 0, 20);
    camera.lookAt(0, 0, 0);
    const receiverMaterial = new THREE.ShadowMaterial({
      // A darker, less opaque receiver keeps the shadow legible on charcoal
      // without making the same continuous field too heavy across the paper.
      color: 0x090807,
      opacity: 0.22,
      transparent: true,
      depthWrite: false,
    });
    const receiver = new THREE.Mesh(new THREE.PlaneGeometry(48, 36), receiverMaterial);
    receiver.position.z = 0;
    receiver.receiveShadow = true;
    scene.add(receiver);

    const sunlight = new THREE.DirectionalLight(0xfff3dd, 3.4);
    // The reference reads as daylight arriving almost perpendicular to the
    // surface. Keeping a small diagonal gives the branches direction without
    // throwing the whole canopy beyond the visible desk.
    sunlight.position.set(-2.4, 4.2, 18);
    sunlight.target.position.set(0, 0, 0);
    sunlight.castShadow = true;
    sunlight.shadow.mapSize.set(4096, 4096);
    sunlight.shadow.camera.left = -16;
    sunlight.shadow.camera.right = 16;
    sunlight.shadow.camera.top = 14;
    sunlight.shadow.camera.bottom = -14;
    sunlight.shadow.camera.near = 1;
    sunlight.shadow.camera.far = 44;
    sunlight.shadow.bias = -0.00035;
    sunlight.shadow.normalBias = 0.018;
    sunlight.shadow.radius = 26;
    scene.add(sunlight, sunlight.target);

    const leafTexture = makeLeafTexture();
    if (!leafTexture) {
      host.dataset.shaderFailed = "true";
      renderer.dispose();
      renderer.domElement.remove();
      return undefined;
    }

    const branchGeometry = new THREE.CylinderGeometry(1, 1, 1, 7, 1, false);
    const branchMaterial = new THREE.MeshBasicMaterial({ color: 0x15110e });
    branchMaterial.colorWrite = false;
    // These objects exist to cast into the shadow map only. If they write to
    // the main depth buffer, they punch transparent (paper-white) silhouettes
    // out of the receiving plane before it can draw the shadow beneath them.
    branchMaterial.depthWrite = false;

    const leafGeometry = new THREE.PlaneGeometry(1, 1);
    const leafMaterial = new THREE.MeshBasicMaterial({
      alphaMap: leafTexture,
      alphaTest: 0.28,
      color: 0x14110e,
      depthWrite: false,
      side: THREE.DoubleSide,
      transparent: true,
    });
    leafMaterial.colorWrite = false;

    const up = new THREE.Vector3(0, 1, 0);
    const random = seededRandom(8417);
    const movingLeaves: MovingLeaf[] = [];
    const movingCanopies: MovingCanopy[] = [];

    const addBranch = (
      parent: THREE.Group,
      start: THREE.Vector2,
      end: THREE.Vector2,
      radius: number,
      z: number,
    ) => {
      const direction = new THREE.Vector3(end.x - start.x, end.y - start.y, 0);
      const length = direction.length();
      const branch = new THREE.Mesh(branchGeometry, branchMaterial);
      branch.position.set((start.x + end.x) / 2, (start.y + end.y) / 2, z);
      branch.scale.set(radius, length, radius);
      branch.quaternion.setFromUnitVectors(up, direction.normalize());
      branch.castShadow = true;
      parent.add(branch);
    };

    const addLeafCluster = (
      parent: THREE.Group,
      point: THREE.Vector2,
      branchAngle: number,
      z: number,
      depth: number,
    ) => {
      const count = depth === 0 ? 5 : 3;
      for (let index = 0; index < count; index += 1) {
        const angle = branchAngle + (random() - 0.5) * 2.1;
        const distance = 0.16 + random() * 0.52;
        const width = 0.58 + random() * 0.48;
        const leaf = new THREE.Mesh(leafGeometry, leafMaterial);
        leaf.position.set(
          point.x + Math.cos(angle) * distance,
          point.y + Math.sin(angle) * distance,
          z + 0.08 + random() * 0.48,
        );
        leaf.scale.set(width, width * (0.38 + random() * 0.16), 1);
        leaf.rotation.z = angle + (random() - 0.5) * 0.55;
        leaf.castShadow = true;
        parent.add(leaf);
        movingLeaves.push({
          basePosition: leaf.position.clone(),
          baseRotation: leaf.rotation.z,
          mesh: leaf,
          phase: random() * Math.PI * 2,
          strength: 0.09 + random() * 0.065,
        });
      }
    };

    const growTree = (
      parent: THREE.Group,
      start: THREE.Vector2,
      angle: number,
      length: number,
      radius: number,
      depth: number,
      z: number,
    ) => {
      const end = new THREE.Vector2(
        start.x + Math.cos(angle) * length,
        start.y + Math.sin(angle) * length,
      );
      addBranch(parent, start, end, radius, z);

      if (depth <= 1 || random() > 0.6) addLeafCluster(parent, end, angle, z, depth);
      if (depth === 0) return;

      const branches = depth > 3 && random() > 0.76 ? 3 : 2;
      const spread = 0.42 + random() * 0.22;
      for (let branchIndex = 0; branchIndex < branches; branchIndex += 1) {
        const centered = branches === 2 ? branchIndex * 2 - 1 : branchIndex - 1;
        const childAngle = angle
          + centered * spread
          + (random() - 0.5) * 0.26
          + Math.sin(depth * 1.7) * 0.035;
        growTree(
          parent,
          end,
          childAngle,
          length * (0.67 + random() * 0.1),
          radius * 0.69,
          depth - 1,
          z + 0.05 + random() * 0.1,
        );
      }
    };

    const canopyDefinitions = [
      { angle: 1.05, length: 2.75, phase: 0.2, position: [-7.2, -6.4] as const, rotation: -0.06, scale: 1.2 },
      { angle: 1.58, length: 2.9, phase: 2.4, position: [-1.2, -6.9] as const, rotation: 0.04, scale: 1.16 },
      { angle: 2.06, length: 2.7, phase: 4.6, position: [6.6, -6.3] as const, rotation: 0.08, scale: 1.2 },
    ];

    canopyDefinitions.forEach((definition, index) => {
      const canopy = new THREE.Group();
      canopy.position.set(definition.position[0], definition.position[1], 0);
      canopy.rotation.z = definition.rotation;
      canopy.scale.setScalar(definition.scale);
      growTree(
        canopy,
        new THREE.Vector2(0, 0),
        definition.angle,
        definition.length,
        0.034,
        5,
        2.6 + index * 0.22,
      );
      movingCanopies.push({
        basePosition: canopy.position.clone(),
        baseRotation: definition.rotation,
        group: canopy,
        phase: definition.phase,
      });
      scene.add(canopy);
    });

    const startedAt = window.performance.now();
    let animationFrame = 0;
    let lastRender = -Infinity;
    let visible = !document.hidden;

    const render = (time: number) => {
      movingCanopies.forEach((canopy, index) => {
        const longBreeze = Math.sin(time * (0.72 + index * 0.045) + canopy.phase);
        const passingGust = Math.sin(time * 0.29 + canopy.phase * 0.7);
        const gustEnvelope = 0.76
          + (Math.sin(time * 0.13 + canopy.phase * 0.41) + 1) * 0.2;
        const gustArrival = Math.max(
          0,
          Math.sin(time * 0.37 + canopy.phase * 1.3),
        ) ** 3;
        const breeze = (longBreeze * 0.68 + passingGust * 0.32) * gustEnvelope
          + gustArrival * 0.18;
        canopy.group.rotation.z = canopy.baseRotation
          + breeze * 0.082;
        canopy.group.position.x = canopy.basePosition.x + breeze * (0.2 + index * 0.016);
        canopy.group.position.y = canopy.basePosition.y
          + Math.sin(time * 0.46 + canopy.phase) * 0.075
          + gustArrival * 0.035;
      });
      movingLeaves.forEach((leaf, index) => {
        const flutter = Math.sin(time * (1.32 + (index % 7) * 0.055) + leaf.phase);
        const tremble = Math.sin(time * 2.45 + leaf.phase * 1.31) * 0.28;
        const airPulse = 0.78
          + (Math.sin(time * 0.33 + leaf.phase * 0.19) + 1) * 0.24;
        leaf.mesh.rotation.z = leaf.baseRotation
          + (flutter + tremble) * leaf.strength * airPulse;
        leaf.mesh.position.x = leaf.basePosition.x + flutter * 0.042 * airPulse;
        leaf.mesh.position.y = leaf.basePosition.y + tremble * 0.03 * airPulse;
      });
      renderer.render(scene, camera);
    };

    const resize = () => {
      const width = Math.max(1, host.clientWidth);
      const height = Math.max(1, host.clientHeight);
      const aspect = width / height;
      const sceneHeight = 12.5;
      const sceneWidth = sceneHeight * aspect;
      camera.left = -sceneWidth / 2;
      camera.right = sceneWidth / 2;
      camera.top = sceneHeight / 2;
      camera.bottom = -sceneHeight / 2;
      camera.updateProjectionMatrix();
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
      renderer.setSize(width, height, false);
      render(reducedMotion ? 13 : (window.performance.now() - startedAt) / 1000);
    };

    const animate = (now: number) => {
      animationFrame = 0;
      if (!visible) return;
      if (now - lastRender >= 41) {
        lastRender = now;
        render((now - startedAt) / 1000);
      }
      animationFrame = window.requestAnimationFrame(animate);
    };

    const startAnimation = () => {
      if (reducedMotion || !visible || animationFrame) return;
      animationFrame = window.requestAnimationFrame(animate);
    };

    const onVisibilityChange = () => {
      visible = !document.hidden;
      if (!visible) {
        window.cancelAnimationFrame(animationFrame);
        animationFrame = 0;
        return;
      }
      render((window.performance.now() - startedAt) / 1000);
      startAnimation();
    };

    const onContextLost = (event: Event) => {
      event.preventDefault();
      host.dataset.shaderFailed = "true";
      window.cancelAnimationFrame(animationFrame);
      animationFrame = 0;
    };

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(host);
    renderer.domElement.addEventListener("webglcontextlost", onContextLost);
    document.addEventListener("visibilitychange", onVisibilityChange);
    resize();
    startAnimation();

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      renderer.domElement.removeEventListener("webglcontextlost", onContextLost);
      resizeObserver.disconnect();
      window.cancelAnimationFrame(animationFrame);
      scene.clear();
      receiver.geometry.dispose();
      receiverMaterial.dispose();
      branchGeometry.dispose();
      branchMaterial.dispose();
      leafGeometry.dispose();
      leafMaterial.dispose();
      leafTexture.dispose();
      sunlight.shadow.map?.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [reducedMotion]);

  return <div ref={hostRef} aria-hidden="true" className="journal-prompt__dappled-light" />;
}
