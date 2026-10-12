// 每一幕的场：地面、灯、布景、人站在哪，都在这里。人身上的坐标由 stage 报给主程序。
import * as THREE from 'three';
import { createWorld } from '/game/world.js';
import { createActor } from '/game/actors.js';
import * as P from './props.js';
import { bodyOf } from './body.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const TILES_Z = [12, 6, 0, -6, -12];

// 每一幕各人站哪、朝哪。坐标是手摆的，改了就改画面。
const LAYOUT = {
  daliang: {
    ground: '#6b5b45', sky: '#1a1613', fog: 0.028, world: 'daliang',
    people: {
      xinling: { x: 0.4, z: -1.6, facing: 0 },
      zhaoshi: { x: -2.6, z: -0.4, facing: 22 },
      zhuhai: { x: 2.7, z: -0.2, facing: -16 },
      player: { x: -0.6, z: 2.4, facing: 180 },
    },
  },
  yimen: {
    ground: '#5d5648', sky: '#14181c', fog: 0.034, world: 'yimen',
    people: {
      xinling: { x: -1.7, z: 2.4, facing: 14 },
      houying: { x: 2.0, z: 1.3, facing: -22 },
      player: { x: -0.4, z: 4.6, facing: 180 },
    },
  },
  night: {
    ground: '#26232a', sky: '#0a0c14', fog: 0.05, world: null,
    people: {
      player: { x: 0, z: 12, facing: 180 },
      guard_b: { x: 2.9, z: 0, facing: -70 },
      ruji: { x: -2.6, z: -6, facing: -10 },
      guard_a: { x: 1.7, z: 6, facing: 120 },
    },
  },
  ye: {
    ground: '#5f5340', sky: '#241d16', fog: 0.036, world: null,
    people: {
      jinbi: { x: 0.7, z: -2.6, facing: 6 },
      xinling: { x: -2.6, z: -0.4, facing: 12 },
      zhuhai: { x: -4.4, z: 0.6, facing: -26 },
      player: { x: -1.3, z: 2.8, facing: 178 },
    },
  },
  granary: {
    ground: '#4f4534', sky: '#2b1f16', fog: 0.03, world: null,
    people: {
      player: { x: 0.4, z: 1.8, facing: 180 },
      borrower: { x: -4.2, z: 1.4, facing: 24 },
      keeper_doubt: { x: 1.0, z: -1.3, facing: -6 },
      keeper_rash: { x: 1.0, z: -1.3, facing: -6 },
    },
  },
};

export function createStage(scene, render) {
  const world = createWorld(scene);
  let root = null;              // 这一幕自己加的布景
  const actors = new Map();
  const anchors = new Map();    // key → { getPos(), kind, label }
  const live = [];              // 每帧要动的东西 {update(t,dt)}
  let flavor = [];
  let nightFeed = null;
  let actId = null;
  let clock = 0;
  let lifeBodies = new Map();

  function clear() {
    for (const a of actors.values()) {
      scene.remove(a.group);
      a.group.traverse?.((o) => { o.geometry?.dispose?.(); });
    }
    actors.clear();
    lifeBodies.clear();
    if (root) {
      scene.remove(root);
      root.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose?.());
      });
      root = null;
    }
    anchors.clear();
    live.length = 0;
    flavor = [];
    nightFeed = null;
  }

  function put(object3D) { root.add(object3D); return object3D; }

  function addPerson(id, def, style) {
    const actor = createActor(id, { x: def.x, z: def.z, facing: def.facing, style });
    scene.add(actor.group);
    actors.set(id, actor);
    anchors.set(`person:${id}`, {
      kind: 'person',
      label: actor.def?.name ?? id,
      getPos: () => V(actor.group.position.x, 2.15, actor.group.position.z),
    });
    return actor;
  }

  function addPropAnchor() { /* 保留占位：锚点一律直接写 anchors.set，避免传错对象 */ }

  function stageDaliang() {
    put(P.dustRing(0.4, -1.4, 3.2));
    const t = P.table(1.9, 1.0, 0.4, -3.0, 0);
    put(t);
    const sc = P.scrolls(0.1, 0.7, -2.9, 0.25);
    put(sc);
    anchors.set('prop:letter', { kind: 'prop', label: '赵使的竹简', getPos: () => V(0.1, 1.5, -2.9) });
    // 宫门立在院侧——必须落在镜头前方（相机在 +z 侧朝 −z 看），否则这张签永远点不到
    const gate = P.gateMark(-6.6, 2.8, 3.0, 3.2);
    put(gate);
    const pad = P.devicePad(1.1);
    pad.position.set(-6.6, 0.02, 3.4);
    put(pad);
    anchors.set('device', { kind: 'device', label: '宫门', getPos: () => V(-6.6, 2.0, 3.2) });
    for (const [x, z] of [[-1.6, 6.5], [1.9, 7.2]]) put(P.torchProp(x, 2.4, z));
    const l = P.lantern(-3.4, 4.0, 2.6);
    put(l);
    live.push({ update: (t2) => { l.userData.light.intensity = 1.1 + Math.sin(t2 * 4.2) * 0.16; } });
  }

  function stageYimen() {
    const pad = P.devicePad(1.2, '#8fa6c4');
    pad.position.set(0, 0.02, -1.6);
    put(pad);
    anchors.set('device', { kind: 'device', label: '门洞', getPos: () => V(0, 3.2, -1.4) });
    put(P.bannerProp(-3.6, 4.6, 0.3));
    put(P.bannerProp(3.4, 5.4, -0.2));
    // 车骑百余乘：几辆停在门外的车
    for (let i = 0; i < 3; i += 1) {
      const x = -6.4 + i * 0.4;
      const z = 6.5 + i * 2.4;
      put(P.box(1.6, 0.5, 2.6, P.MAT.wood, x, 0.5, z));
      put(P.box(1.4, 0.9, 0.2, P.MAT.clothDark, x, 1.0, z - 1.0));
      put(P.cyl(0.5, 0.5, 0.14, P.MAT.woodDark, x + 0.85, 0.42, z - 0.8, 12)).rotation.z = Math.PI / 2;
      put(P.cyl(0.5, 0.5, 0.14, P.MAT.woodDark, x + 0.85, 0.42, z + 0.8, 12)).rotation.z = Math.PI / 2;
    }
    const l = P.lantern(-3.2, 0.6, 2.6);
    put(l);
    live.push({ update: (t) => { l.userData.light.intensity = 0.9 + Math.sin(t * 3.1) * 0.2; } });
  }

  function stageNight() {
    put(P.groundPlane('#26232a', 90));
    // 一条从宫门外走到后门的甬道：地面砖、两壁、梁
    for (let i = 0; i < 5; i += 1) {
      const z = TILES_Z[i];
      const tile = new THREE.Mesh(new THREE.PlaneGeometry(8.4, 5.6), new THREE.MeshStandardMaterial({
        color: new THREE.Color(i % 2 ? '#312d33' : '#2a272d'),
        roughness: 0.96,
      }));
      tile.rotation.x = -Math.PI / 2;
      tile.position.set(0, 0.01, z);
      tile.receiveShadow = true;
      put(tile);
    }
    put(P.wall(1.1, 4.2, 30, -5.4, 0, 0, P.MAT.stoneDark));
    put(P.wall(1.1, 4.2, 30, 5.4, 0, 0, P.MAT.stoneDark));
    for (let i = 0; i < 5; i += 1) put(P.beam(0, 4.4, TILES_Z[i] + 3, 11.4, 0, 0.3));
    put(P.gateMark(0, 15.4, 3.4, 3.6));
    put(P.wall(3.0, 3.4, 0.5, -2.6, 0, -12.6, P.MAT.stoneDark));
    put(P.wall(3.0, 3.4, 0.5, 2.6, 0, -12.6, P.MAT.stoneDark));
    put(P.dustRing(0, -6, 2.6, '#6f88a8'));

    const wallTorchA = P.torchProp(-4.7, 2.6, 6, '#ff9d3c', 1.3);
    const wallTorchB = P.torchProp(-4.7, 2.6, -6, '#ff9d3c', 1.1);
    const wallTorchC = P.torchProp(4.7, 2.6, 0, '#ff9d3c', 1.0);
    put(wallTorchA); put(wallTorchB); put(wallTorchC);
    const moon = new THREE.DirectionalLight(new THREE.Color('#7f96c4'), 0.42);
    moon.position.set(-8, 16, -6);
    put(moon);

    // 玩家手上的半块铜符
    const token = new THREE.Group();
    const tk = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.06, 0.34), P.MAT.bronzeLit);
    const glow = new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 8), new THREE.MeshBasicMaterial({
      color: new THREE.Color('#c8892f'), transparent: true, opacity: 0.16,
    }));
    token.add(tk, glow);
    put(token);
    live.push({
      update: (t) => {
        const p = actors.get('player');
        if (!p) return;
        token.position.set(p.group.position.x + 0.34, 1.02 + Math.sin(t * 1.6) * 0.03, p.group.position.z + 0.3);
        token.rotation.y = t * 0.6;
        glow.scale.setScalar(1 + Math.sin(t * 2.4) * 0.08);
      },
    });
    anchors.set('prop:token', {
      kind: 'prop', label: '宫中令牌',
      getPos: () => {
        const p = actors.get('player');
        return V((p?.group.position.x ?? 0) + 0.34, 1.35, (p?.group.position.z ?? 0) + 0.3);
      },
    });

    // 守卫甲提的那盏灯，落在哪一格，人就站在哪一格
    const lantern = P.lantern(1.7, 6, 2.2, '#ffd79a');
    put(lantern);
    live.push({
      update: (t, dt) => {
        const feed = nightFeed;
        const a = actors.get('guard_a');
        if (feed && a) {
          const li = Math.max(0, Math.min(TILES_Z.length - 1, (feed.lantern ?? 0)));
          a.walkTo(1.7, TILES_Z[li]);
          lantern.children[0].position.set(a.group.position.x, 0, a.group.position.z);
          lantern.children[1].position.set(a.group.position.x, 1.9, a.group.position.z);
          lantern.userData.light.position.set(a.group.position.x, 1.88, a.group.position.z);
          lantern.userData.light.intensity = feed.seen ? 2.6 : 1.5 + Math.sin(t * 5.4) * 0.3;
          const alert = !!feed.seen;
          a.group.children.forEach((c) => { if (c.material && c.material.emissive) c.material.emissiveIntensity = alert ? 1.1 : 0.6; });
        }
        const r = actors.get('ruji');
        if (r && feed) {
          const ready = feed.rujiReady || feed.done;
          r.group.rotation.y = (ready ? -18 : -6) * (Math.PI / 180);
        }
        const p = actors.get('player');
        if (p && feed) {
          const i = Math.max(0, Math.min(TILES_Z.length - 1, feed.pos ?? 0));
          p.walkTo(0, TILES_Z[i]);
        }
      },
    });
    anchors.set('person:guard_a', {
      kind: 'person', label: '宫中守卫甲',
      getPos: () => {
        const a = actors.get('guard_a');
        return V(a?.group.position.x ?? 1.7, 2.15, a?.group.position.z ?? 6);
      },
    });
    // 走道前方：夜里「往前挪一格」这类动作的落点
    anchors.set('path', {
      kind: 'device', label: '前路',
      getPos: () => {
        const p = actors.get('player');
        const z = (p?.group.position.z ?? 12) - 3.6;
        return V(0, 1.2, z);
      },
    });
  }

  function stageYe(view) {
    // 取符之夜没把兵符带出宫（flags.night !== 'clean'）：案上就不能还摆着两半铜符，
    // 否则和正文「手里没有兵符」自相矛盾。改成案上一卷没递出去的军令。
    const hasTally = view?.flags?.night === 'clean';
    put(P.groundPlane('#5f5340', 90));
    put(P.dustRing(0, -1, 7.2, '#c8892f'));
    for (let i = 0; i < 7; i += 1) {
      const a = i * 1.1 + 0.4;
      put(P.tent(Math.cos(a) * 12.5, Math.sin(a) * 7.5 - 2, a, 0.9 + (i % 3) * 0.2));
    }
    for (let i = 0; i < 6; i += 1) {
      put(P.bannerProp(-10 + i * 4.0, -8.2 + (i % 2) * 0.8, 0.32, i % 2 ? '#5b3327' : '#7c3a2c'));
    }
    const t = P.table(1.9, 1.0, -0.6, -2.2, 0);
    put(t);
    if (hasTally) {
      const tally = P.tallyPair(-0.6, 0.72, -2.2);
      put(tally);
      anchors.set('prop:tally', { kind: 'prop', label: '兵符', getPos: () => V(-0.6, 1.25, -2.2) });
      live.push({
        update: (t2) => {
          tally.userData.halves.forEach((h, i) => {
            h.position.y = 0.72 + Math.sin(t2 * 1.4 + i * 2.1) * 0.012;
          });
        },
      });
    } else {
      // 空案：摊着一卷写了又卷起来的军令，边上放一只空木匣——本来该装那半块铜符
      put(P.scrolls(-0.75, 0.72, -2.25, 0.35));
      const box = P.sealBox(-0.35, 0.72, -2.05);
      box.scale.set(0.72, 0.5, 0.72);
      put(box);
      anchors.set('prop:order', { kind: 'prop', label: '没递出去的军令', getPos: () => V(-0.62, 1.02, -2.2) });
    }
    put(P.hammer(-4.2, 0.05, 1.6, 0.4));
    const b1 = P.brazier(3.4, 1.4);
    const b2 = P.brazier(-6.2, -3.4);
    put(b1); put(b2);
    live.push({
      update: (t2) => {
        for (const b of [b1, b2]) {
          b.userData.fire.scale.y = 0.85 + Math.sin(t2 * 6.2 + (b === b1 ? 0 : 1.7)) * 0.18;
          b.userData.light.intensity = 1.5 + Math.sin(t2 * 7.1 + (b === b1 ? 0 : 2.2)) * 0.4;
        }
      },
    });
    const pad = P.devicePad(0.8, '#c8892f');
    pad.position.set(-0.6, 0.02, 0.6);
    put(pad);
  }

  function stageGranary() {
    put(P.groundPlane('#4f4534', 90));
    put(P.dustRing(0.4, -1.4, 6.2, '#c8892f'));
    for (let i = 0; i < 6; i += 1) put(P.beam(0, 4.6, 3.2 - i * 4.2, 18, 0, 0.34));
    for (let i = 0; i < 4; i += 1) put(P.wall(0.7, 4.4, 0.7, -7.6, 0, 6 - i * 4.2, P.MAT.woodDark));
    for (let i = 0; i < 4; i += 1) put(P.wall(0.7, 4.4, 0.7, 7.6, 0, 6 - i * 4.2, P.MAT.woodDark));
    for (let i = 0; i < 12; i += 1) {
      const x = -6.4 + (i % 4) * 1.15;
      const z = -7.6 + Math.floor(i / 4) * 1.5;
      put(P.sack(x, z, 1.0 + (i % 3) * 0.12));
    }
    const t = P.table(1.7, 0.95, 0.4, -2.2, 0);
    put(t);
    put(P.sealBox(-0.1, 0.7, -2.4));
    put(P.noteStrip(0.4, 0.7, -2.05));
    put(P.pledgeBundle(0.95, 0.7, -2.4));
    put(P.ledger(0.4, 0.7, -1.9));
    anchors.set('prop:seal', { kind: 'prop', label: '印信', getPos: () => V(-0.1, 1.15, -2.4) });
    anchors.set('prop:note', { kind: 'prop', label: '借条', getPos: () => V(0.4, 1.05, -2.05) });
    anchors.set('prop:pledge', { kind: 'prop', label: '担保物', getPos: () => V(0.95, 1.25, -2.4) });
    anchors.set('device', { kind: 'device', label: '仓簿', getPos: () => V(0.4, 1.1, -1.9) });
    const torch = P.torchProp(2.6, 2.6, -1.0, '#ffb066', 1.7);
    put(torch);
    const torch2 = P.torchProp(-3.0, 2.4, -2.4, '#ffb066', 1.4);
    put(torch2);
    live.push({
      update: (t2) => {
        torch.userData.fire.scale.y = 0.85 + Math.sin(t2 * 5.4) * 0.16;
        torch.userData.light.intensity = 1.6 + Math.sin(t2 * 6.6) * 0.34;
      },
    });
  }

  const BUILDERS = {
    daliang: stageDaliang,
    yimen: stageYimen,
    night: stageNight,
    ye: stageYe,
    granary: stageGranary,
  };

  return {
    get actors() { return actors; },
    get anchors() { return anchors; },
    get actId() { return actId; },
    get flavor() { return flavor; },
    world,

    build(id, view) {
      clear();
      actId = id;
      const def = LAYOUT[id] ?? LAYOUT.daliang;
      root = new THREE.Group();
      root.name = `play:${id}`;
      scene.add(root);

      if (def.world) {
        render.setSceneEnvironment({ sky: def.sky, fog: def.fog, ground: def.ground });
        world.show(def.world);
        if (world.current) world.current.visible = true;
      } else {
        if (world.current) world.current.visible = false;
        render.setSceneEnvironment({ sky: def.sky, fog: def.fog, ground: def.ground });
      }

      BUILDERS[id]?.(view);

      // 人：这一幕数据里有的按手摆位置站好；没有手摆的，围在案前
      const people = view?.people ?? [];
      let extra = 0;
      for (const person of people) {
        const spot = def.people[person.id];
        if (spot) {
          addPerson(person.id, spot);
        } else {
          const a = -0.7 + extra * 0.85;
          extra += 1;
          addPerson(person.id, { x: Math.cos(a) * 3.4, z: Math.sin(a) * 2.4 - 0.6, facing: 0 });
        }
      }
      // 玩家自己在场（有些幕数据里没有他，也要在）
      if (!actors.has('player')) addPerson('player', def.people.player ?? { x: 0, z: 3.4, facing: 180 });

      // 一幕特有的场景细语：不参与选择，只是场景里能动的东西
      if (id === 'granary') {
        flavor = [
          { key: 'device', label: '仓簿', line: '仓簿摊在案上。出多少、进多少，一笔一笔都记着——只是记的人也会手抖。' },
          { key: 'person:borrower', label: '借粮的人', line: '他一直搓手。他不是不怕，是家里等不到。' },
        ];
      } else if (id === 'night') {
        flavor = [
          { key: 'person:guard_a', label: '提灯的守卫', line: '灯举得不高。他的影子在砖上拖得很长——他在打盹，也在看灯。' },
          { key: 'person:guard_b', label: '背身的守卫', line: '他背对着回廊。有人塞东西给他，他大概也会装作没看见。' },
          { key: 'device', label: '铜壶滴漏', line: '水一滴一滴地落。落到底，这一夜就过去了。' },
        ];
      } else if (id === 'ye') {
        flavor = [
          { key: 'person:zhuhai', label: '朱亥的袖子', line: '袖子里藏着一柄四十斤的铁椎。他不说话，只看公子的眼色。' },
        ];
        // 兵符没出宫那一局，案上是空的：只留一卷没递出去的军令
        if (view?.flags?.night === 'clean') {
          flavor.push({ key: 'prop:tally', label: '兵符', line: '两半铜符合在一处，纹路严丝合缝。凭这个，能叫动十万人的营。' });
        } else {
          flavor.push({ key: 'prop:order', label: '没递出去的军令', line: '军令写了又卷起来。符不在手里，这张纸叫不动辕门。' });
        }
      } else if (id === 'daliang') {
        flavor = [
          { key: 'prop:letter', label: '赵使的竹简', line: '竹简上的字很急。邯郸的使者已经写过三封了。' },
          { key: 'device', label: '宫门', line: '宫门在街那头。魏王的门，比城墙还难进。' },
        ];
      } else if (id === 'yimen') {
        flavor = [
          { key: 'device', label: '夷门门洞', line: '门洞里穿风。一个看门的老头在这里站了五十年。' },
        ];
      }
      if (id === 'granary') this.refresh(view);
      return this;
    },

    setNight(feed) {
      nightFeed = feed;
      if (actId !== 'night') return;
      const t = feed ? Math.max(0, Math.min(1, (feed.step ?? 0) / (feed.limit ?? 12))) : 0;
      const mix = (a, b) => {
        const pa = parseInt(a.slice(1), 16); const pb = parseInt(b.slice(1), 16);
        const ch = (sh) => Math.round((((pa >> sh) & 255) * (1 - t)) + (((pb >> sh) & 255) * t));
        return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`;
      };
      render.setSceneEnvironment({ sky: mix('#07080f', '#2b3346'), fog: 0.05 - t * 0.016 });
    },

    /** 同一幕里换人/换状态（不重建布景，人不会瞬移） */
    refresh(v) {
      const def = LAYOUT[actId] ?? LAYOUT.daliang;
      const people = v?.people ?? [];
      for (const person of people) {
        if (!actors.has(person.id)) addPerson(person.id, def.people[person.id] ?? { x: 0, z: -3.4, facing: 0 });
      }
      for (const [id, a] of actors) {
        if (id === 'player') continue;
        a.group.visible = people.some((p) => p.id === id);
      }
      if (v?.stage === 'granary' && v.granary) {
        const active = actors.get(v.granary.keeper);
        if (active) { active.group.position.set(1.0, 0, -1.3); active.group.rotation.y = -0.1; }
        for (const k of v.granary.keepers ?? []) {
          if (k.id === v.granary.keeper) continue;
          const a = actors.get(k.id);
          if (a) { a.group.visible = true; a.group.position.set(3.7, 0, -0.2); a.group.rotation.y = -0.6; }
        }
      }
      return this;
    },

    setLife(read, entries, from = 0) {
      lifeBodies = new Map((read?.actors ?? []).map(a => [a.id, bodyOf(a, entries, from)]));
      for (const [id, body] of lifeBodies) {
        const actor = actors.get(id); if (!actor) continue;
        actor.group.userData.lifeSource = body.source;
      }
    },

    /** 每帧 */
    update(dt) {
      clock += dt;
      const player = actors.get('player');
      const pp = player ? player.group.position : null;
      for (const [id, a] of actors) {
        const body = lifeBodies.get(id);
        a.update(clock, dt, body ? null : pp);
        if (!body) continue;
        const parts = a.group.userData.parts;
        const pose = body.pose;
        const tension = Math.min(.18, Math.max(0, Number(body.actor.stress ?? 0)) * .18);
        parts.torso.rotation.x = (a.state.style.hunch ?? 0) + tension;
        parts.head.rotation.x = pose === 'hesitate' ? .18 : pose === 'offer' ? -.08 : 0;
        parts.armR.rotation.x = pose === 'offer' || pose === 'given' ? -.65 : pose === 'hesitate' ? -.22 : 0;
        parts.armL.rotation.z = pose === 'guard' ? .42 : 0;
        const target = pose === 'away' ? null : actors.get('player')?.group.position;
        parts.head.rotation.y = target ? Math.max(-.55, Math.min(.55, Math.atan2(target.x - a.x, target.z - a.z) - a.group.rotation.y)) : 0;
      }
      for (const l of live) l.update(clock, dt);
    },

    /** 这一幕的开场景别 */
    actShot(id) {
      const table = {
        daliang: { target: [0.4, 1.2, -1.2], dist: 14.5, az: 0.62, elev: 0.42 },
        yimen: { target: [0, 2.0, 1.6], dist: 16.0, az: 0.75, elev: 0.44 },
        night: { target: [0, 1.6, 2.0], dist: 17.5, az: 0.30, elev: 0.40 },
        ye: { target: [0, 1.4, -0.6], dist: 17.0, az: 0.66, elev: 0.40 },
        granary: { target: [0.2, 1.4, -0.6], dist: 15.0, az: 0.58, elev: 0.38 },
      };
      return table[id] ?? table.daliang;
    },

    shotFor(key) {
      const a = anchors.get(key);
      if (!a) return this.actShot(actId);
      const p = a.getPos();
      const wide = a.kind === 'device';
      return {
        target: [p.x, Math.max(1.0, p.y - (a.kind === 'person' ? 0.45 : 0.35)), p.z],
        dist: a.kind === 'person' ? 6.6 : wide ? 8.4 : 5.6,
        elev: a.kind === 'person' ? 0.24 : 0.30,
      };
    },
  };
}
