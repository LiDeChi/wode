import * as THREE from 'three';
import { createRender } from '../game/render.js';
import { createWorld } from '../game/world.js';
import { createActor } from '../game/actors.js';

const LOOKS = {
  daliang: { sky: '#22232c', fog: .025 }, yimen: { sky: '#17252e', fog: .023 },
  night: { sky: '#0a152c', fog: .027 }, ye: { sky: '#34303b', fog: .022 },
  granary: { sky: '#272a32', fog: .028 },
};

export function createFilmStage(canvas) {
  const render = createRender(canvas);
  const world = createWorld(render.scene);
  const extras = new Map();
  let actors = [], currentScene = '', frame, perspective = 'xinling', end = false;
  const desired = new THREE.Vector3(9, 6, 13), look = new THREE.Vector3(0, 1.2, 0);
  const eye = new THREE.Vector3(0, 1.2, 0), player = new THREE.Vector3(0, 0, 4);
  const box = (parent, color, size, pos) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), new THREE.MeshStandardMaterial({ color, roughness: .92 }));
    mesh.position.set(...pos); mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
  };
  function extraScene(id) {
    if (extras.has(id)) return extras.get(id);
    const g = new THREE.Group();
    box(g, id === 'night' ? '#33384b' : '#6c6254', [48, .3, 44], [0, -.18, 0]);
    if (id === 'night') {
      for (const x of [-7, 7]) {
        box(g, '#424656', [2, 6, 28], [x, 3, -6]);
        for (const z of [-10, -4, 2, 8]) {
          box(g, '#5f4e4a', [.6, 5, .6], [x + (x < 0 ? 1.2 : -1.2), 2.5, z]);
          const lamp = new THREE.PointLight('#ffad66', 15, 13, 2);
          lamp.position.set(x + (x < 0 ? 1.8 : -1.8), 3.2, z); g.add(lamp);
          const lantern = new THREE.Mesh(new THREE.SphereGeometry(.28, 12, 8), new THREE.MeshStandardMaterial({ color: '#ffce8a', emissive: '#ff9944', emissiveIntensity: 2 }));
          lantern.position.copy(lamp.position); g.add(lantern);
        }
      }
      box(g, '#292a37', [14, 8, 1], [0, 4, -18]);
      box(g, '#966d40', [1.6, .6, .8], [0, .7, -9]);
    } else if (id === 'ye') {
      for (const x of [-9, 9]) for (const z of [-8, 0, 8]) {
        const tent = new THREE.Mesh(new THREE.ConeGeometry(3.6, 5, 4), new THREE.MeshStandardMaterial({ color: '#56534c', roughness: 1 }));
        tent.position.set(x, 2.5, z); tent.rotation.y = Math.PI / 4; tent.castShadow = true; g.add(tent);
        box(g, '#493a35', [.2, 7, .2], [x + 4, 3.5, z]);
        box(g, '#735056', [1.5, 2, .1], [x + 4.7, 5.6, z]);
      }
      box(g, '#554436', [3, 1, 1.5], [0, .5, -3]);
    } else {
      box(g, '#454239', [24, 7, 1], [0, 3.5, -9]);
      box(g, '#6f5137', [4, 1.3, 2], [0, .65, -1]);
      for (const x of [-7, -5, 5, 7]) for (const z of [-5, -2, 1]) {
        const sack = new THREE.Mesh(new THREE.SphereGeometry(.9, 10, 8), new THREE.MeshStandardMaterial({ color: '#a08759', roughness: 1 }));
        sack.scale.y = 1.2; sack.position.set(x, 1, z); sack.castShadow = true; g.add(sack);
      }
    }
    render.scene.add(g); extras.set(id, g); return g;
  }
  function show(nextFrame, nextPerspective) {
    frame = nextFrame; perspective = nextPerspective; end = frame.ending;
    const id = frame.scene;
    if (id !== currentScene) {
      if (world.current) world.current.visible = false;
      for (const g of extras.values()) g.visible = false;
      if (id === 'daliang' || id === 'yimen') world.show(id); else extraScene(id).visible = true;
      render.setSceneEnvironment(LOOKS[id] || LOOKS.daliang);
      render.key.intensity = id === 'night' ? .35 : 1.25;
      render.key.color.set(id === 'night' ? '#7b9dbb' : '#f4d7b4');
      currentScene = id;
    }
    const people = frame.view.people || actors.map(a => ({ id: a.def.id }));
    const ids = people.length ? people.map(p => p.id) : ['xinling', 'zhaoshi', 'zhuhai'];
    if (ids.join() !== actors.map(a => a.def.id).join()) {
      for (const actor of actors) {
        render.scene.remove(actor.group);
        actor.group.traverse(node => { node.geometry?.dispose(); if (node.material) node.material.dispose(); });
      }
      actors = ids.map((id, i) => createActor(id, { x: (i - (ids.length - 1) / 2) * 3.1, z: i % 2 ? -2.2 : 0, facing: 150 }));
      actors.forEach(actor => render.scene.add(actor.group));
    }
    const speaker = actors.find(a => a.def.id === frame.focus) || actors[0];
    const follow = actors.find(a => a.def.id === perspective);
    if (perspective === 'xinling') {
      look.set(speaker?.x || 0, 1.5, speaker?.z || 0);
      desired.set(look.x + 7, 5, look.z + 10);
    } else if (follow) {
      look.set(speaker?.x ?? follow.x, 1.4, speaker?.z ?? follow.z);
      desired.set(follow.x - 5, 3.8, follow.z + 8);
    } else {
      look.set(0, 1.3, -1); desired.set(12, 7, 15);
    }
    if (end) { look.set(0, .8, -1); desired.set(18, 12, 25); }
  }
  let last = performance.now();
  function animate(now) {
    const dt = Math.min((now - last) / 1000, .06); last = now;
    for (const actor of actors) actor.update(now / 1000, dt, player);
    world.update(now / 1000, dt);
    const k = 1 - Math.exp(-dt * (end ? .65 : 1.8));
    render.camera.position.lerp(desired, k); eye.lerp(look, k); render.camera.lookAt(eye);
    render.render(); requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);
  return { show, get camera() { return render.camera; } };
}
