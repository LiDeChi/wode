// 竹简与封泥：选择记录从案边滑进来，封泥按下去就抄走一份链接。
import * as THREE from 'three';
import { makePlate } from './labels.js';

const FRONT_Z = 4.85;

export function createSlip(bench, { onSeal } = {}) {
  const group = new THREE.Group();
  bench.scene.add(group);

  /* ---------------- 竹简 ---------------- */
  const slip = new THREE.Group();
  const restAt = new THREE.Vector3(2.15, 1.5, 5.55);
  const awayAt = new THREE.Vector3(7.4, 1.9, 5.2);
  slip.position.copy(awayAt);
  slip.rotation.set(-.28, -1.05, .05);
  group.add(slip);
  {
    const bamboo = new THREE.MeshStandardMaterial({ color: '#c8ae6f', roughness: .62, metalness: .04 });
    for (let i = 0; i < 11; i++) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(.175, 1.42, .045), bamboo);
      s.position.x = (i - 5) * .19;
      s.castShadow = true; s.receiveShadow = true;
      slip.add(s);
    }
    const cord = new THREE.MeshStandardMaterial({ color: '#5b3f20', roughness: .9 });
    for (const y of [-.5, .5]) {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(.013, .013, 2.16, 8), cord);
      c.rotation.z = Math.PI / 2;
      c.position.set(0, y, .028);
      slip.add(c);
    }
    const plate = makePlate({
      width: 2.0, height: 1.22, px: 960, py: 586, maxFont: 74, ink: '#3a2410',
      bg: null, border: null, at: [0, 0, .034], lines: [''],
    });
    slip.add(plate.mesh);
    slip.userData.plate = plate;
  }
  let want = 0, at = 0, life = 0;

  /* ---------------- 封泥 ---------------- */
  const seal = { press: 0, sealed: false };
  {
    const g = new THREE.Group();
    g.position.set(2.5, 0, FRONT_Z);
    group.add(g);
    const tray = new THREE.Mesh(new THREE.BoxGeometry(.72, .05, .72),
      new THREE.MeshStandardMaterial({ color: '#2a2018', roughness: .9 }));
    tray.position.y = .025; tray.receiveShadow = true; tray.castShadow = true; g.add(tray);
    const clayMat = new THREE.MeshStandardMaterial({ color: '#a8342c', roughness: .88, emissive: '#000000' });
    const clay = new THREE.Mesh(new THREE.SphereGeometry(.21, 20, 14), clayMat);
    clay.scale.set(1, .48, 1);
    clay.position.y = .12; clay.castShadow = true; g.add(clay);
    const stamp = new THREE.Group();
    stamp.position.y = .34;
    const knob = new THREE.Mesh(new THREE.BoxGeometry(.2, .1, .2),
      new THREE.MeshStandardMaterial({ color: '#b6904f', metalness: .85, roughness: .32 }));
    knob.position.y = .12; knob.castShadow = true; stamp.add(knob);
    const face = new THREE.Mesh(new THREE.BoxGeometry(.14, .1, .14),
      new THREE.MeshStandardMaterial({ color: '#7a6134', metalness: .8, roughness: .45 }));
    face.position.y = .02; stamp.add(face);
    g.add(stamp);
    const tag = makePlate({ width: 1.75, height: .3, px: 768, py: 132, maxFont: 56, at: [2.5, .34, FRONT_Z + .44], lines: ['封泥 · 抄一份链接'] });
    group.add(tag.mesh);
    seal.node = g; seal.stamp = stamp; seal.clay = clayMat; seal.tag = tag;
    bench.register(g, 'seal', {
      pad: [.95, .6, .7],
      onHoverStart: () => { seal.hot = true; },
      onHoverEnd: () => { seal.hot = false; },
      onClick: () => { seal.press = 1; onSeal?.(); },
    });
  }

  bench.addUpdater((dt, clock) => {
    life -= dt;
    if (life <= 0 && at < .01) want = 0;
    at += (want - at) * (1 - Math.exp(-dt * 5.5));
    slip.position.lerpVectors(awayAt, restAt, at);
    slip.position.y += Math.sin(clock * 1.1) * .022 * at;
    slip.rotation.y = -1.05 + at * .78;
    slip.rotation.x = -.28 + Math.sin(clock * .7) * .015 * at;
    slip.visible = at > .01;

    seal.press = Math.max(0, seal.press - dt * 2.6);
    const dip = seal.press > .55 ? (1 - seal.press) / .45 : seal.press / .55;
    seal.stamp.position.y = .34 - Math.max(0, Math.min(1, dip)) * .13 * (seal.press > 0 ? 1 : 0);
    seal.clay.emissiveIntensity = Math.max(0, seal.clay.emissiveIntensity - dt * 1.5);
    seal.node.scale.setScalar(1 + (seal.hot ? .03 : 0));
  });

  return {
    group, slip,
    /** 让竹简滑进来，写这几行字。 */
    show(lines, seconds = 7) {
      slip.userData.plate.setText(lines);
      want = 1; life = seconds;
    },
    hide() { want = 0; },
    /** 封泥按下去之后：烧一下，牌子改成已抄。 */
    sealed(text = '已封好 · 链接已抄') {
      seal.sealed = true;
      seal.clay.emissive.set('#ff6a52');
      seal.clay.emissiveIntensity = 1.6;
      seal.tag.setText([text]);
    },
    reset() { seal.tag.setText(['封泥 · 抄一份链接']); },
    get slide() { return at; },
  };
}
