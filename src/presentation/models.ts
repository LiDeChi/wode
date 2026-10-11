import * as THREE from 'three';
import type { GranaryView, SceneCharacter, SceneKind } from './contracts';

export const PALETTE = {
  ink: '#142b35', wood: '#443934', jade: '#749f91', gold: '#d8bd7b',
  bone: '#f1eada', clay: '#a78b73', roof: '#586169', mist: '#91a4ab',
};

function hash(text: string): number {
  let value = 2166136261;
  for (const letter of text) value = Math.imul(value ^ letter.charCodeAt(0), 16777619);
  return value >>> 0;
}

export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = Math.imul(1664525, state) + 1013904223 >>> 0;
    return state / 4294967296;
  };
}

function combine(parts: Array<{ geometry: THREE.BufferGeometry; matrix: THREE.Matrix4 }>): THREE.BufferGeometry {
  const positions: number[] = [], normals: number[] = [], uvs: number[] = [];
  const point = new THREE.Vector3(), normal = new THREE.Vector3(), normalMatrix = new THREE.Matrix3();
  for (const { geometry, matrix } of parts) {
    const position = geometry.getAttribute('position');
    const sourceNormal = geometry.getAttribute('normal');
    const sourceUv = geometry.getAttribute('uv');
    normalMatrix.getNormalMatrix(matrix);
    const count = geometry.index?.count ?? position.count;
    for (let i = 0; i < count; i++) {
      const index = geometry.index ? geometry.index.getX(i) : i;
      point.fromBufferAttribute(position, index).applyMatrix4(matrix);
      normal.fromBufferAttribute(sourceNormal, index).applyNormalMatrix(normalMatrix);
      positions.push(point.x, point.y, point.z);
      normals.push(normal.x, normal.y, normal.z);
      uvs.push(sourceUv?.getX(index) ?? 0, sourceUv?.getY(index) ?? 0);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeBoundingSphere();
  return geometry;
}

export class AssetKit {
  private geometries = new Map<string, THREE.BufferGeometry>();
  private materials = new Map<string, THREE.Material>();
  private textures = new Map<string, THREE.CanvasTexture>();

  geometry(name: string, create: () => THREE.BufferGeometry): THREE.BufferGeometry {
    let geometry = this.geometries.get(name);
    if (!geometry) { geometry = create(); this.geometries.set(name, geometry); }
    return geometry;
  }

  texture(name: string, paint: (ctx: CanvasRenderingContext2D, size: number) => void, size = 256): THREE.CanvasTexture {
    let texture = this.textures.get(name);
    if (!texture) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas 2D is required to paint the theatre materials.');
      paint(ctx, size);
      texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 2;
      this.textures.set(name, texture);
    }
    return texture;
  }

  material(name: string, color: string, options: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
    let material = this.materials.get(name);
    if (!material) {
      material = new THREE.MeshStandardMaterial({ color, roughness: 0.86, ...options });
      this.materials.set(name, material);
    }
    return material as THREE.MeshStandardMaterial;
  }

  basic(name: string, options: THREE.MeshBasicMaterialParameters): THREE.MeshBasicMaterial {
    let material = this.materials.get(name);
    if (!material) { material = new THREE.MeshBasicMaterial(options); this.materials.set(name, material); }
    return material as THREE.MeshBasicMaterial;
  }

  surface(role: string): THREE.MeshStandardMaterial {
    const colors: Record<string, string> = {
      wood: PALETTE.wood, timber: '#79604b', clay: PALETTE.clay, wall: '#c3b194',
      stone: '#8b9696', nightStone: '#6d8490', roof: PALETTE.roof, jade: PALETTE.jade,
      gold: PALETTE.gold, bone: PALETTE.bone, ink: PALETTE.ink, cloth: '#b8a889',
      lacquer: '#713f38', copper: '#9b795a', leaf: '#587d71', darkLeaf: '#355d55',
    };
    const textureKind = ['wood', 'timber'].includes(role) ? 'wood'
      : ['wall', 'clay'].includes(role) ? 'earth'
        : ['stone', 'nightStone'].includes(role) ? 'stone'
          : role === 'roof' ? 'roof' : role === 'cloth' ? 'cloth' : null;
    const map = textureKind ? this.texture(`surface-${textureKind}`, (ctx, size) => {
      const random = seeded(hash(textureKind));
      ctx.fillStyle = textureKind === 'stone' ? '#e1e0d5' : '#e4d9c3';
      ctx.fillRect(0, 0, size, size);
      for (let i = 0; i < 500; i++) {
        const x = random() * size, y = random() * size;
        ctx.fillStyle = `rgba(52,44,32,${0.025 + random() * 0.075})`;
        ctx.fillRect(x, y, textureKind === 'wood' ? 1 + random() * 2 : 1.5, textureKind === 'wood' ? 12 + random() * 55 : 1.5);
      }
      ctx.strokeStyle = 'rgba(48,44,38,0.20)';
      ctx.lineWidth = 1.5;
      if (textureKind === 'wood' || textureKind === 'roof') {
        for (let x = 0; x < size; x += textureKind === 'wood' ? 48 : 24) {
          ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + 3, size); ctx.stroke();
        }
      } else if (textureKind === 'stone') {
        for (let y = 0; y <= size; y += 64) {
          ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(size, y); ctx.stroke();
          for (let x = (y / 64 % 2) * 64; x < size; x += 128) {
            ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + 64); ctx.stroke();
          }
        }
      } else if (textureKind === 'earth') {
        for (let y = 18; y < size; y += 34) {
          ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(size, y + 4); ctx.stroke();
        }
      } else {
        ctx.strokeStyle = 'rgba(65,51,35,.10)';
        for (let x = 0; x < size; x += 5) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, size); ctx.stroke(); }
      }
    }) : null;
    return this.material(`surface-${role}`, colors[role] ?? PALETTE.bone, {
      ...(map ? { map } : {}),
      metalness: role === 'gold' ? 0.5 : role === 'copper' ? 0.4 : 0,
      roughness: role === 'gold' ? 0.42 : role === 'lacquer' ? 0.38 : 0.9,
    });
  }

  paper(kind = 'ledger'): THREE.MeshStandardMaterial {
    const map = this.texture(`paper-${kind}`, (ctx, size) => {
      const random = seeded(hash(kind));
      ctx.fillStyle = '#e7dcc0'; ctx.fillRect(0, 0, size, size);
      for (let i = 0; i < 500; i++) {
        ctx.fillStyle = 'rgba(91,64,36,.045)'; ctx.fillRect(random() * size, random() * size, 1, 3);
      }
      ctx.strokeStyle = '#615449'; ctx.lineWidth = 2;
      if (kind === 'map') {
        ctx.strokeStyle = '#80968a'; ctx.lineWidth = 12;
        ctx.beginPath(); ctx.moveTo(0, size * .8); ctx.bezierCurveTo(size * .7, size, size * .3, size * .1, size, size * .3); ctx.stroke();
        ctx.strokeStyle = '#7c5c45'; ctx.lineWidth = 2;
        for (let i = 0; i < 7; i++) {
          const x = random() * size, y = random() * size;
          ctx.strokeRect(x, y, 15, 12);
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(size * .5, size * .5); ctx.stroke();
        }
      } else if (kind === 'storyboard' || kind === 'film') {
        for (let y = 14; y < size; y += 116) for (let x = 12; x < size; x += 120) {
          ctx.strokeRect(x, y, 105, 83);
          ctx.beginPath(); ctx.moveTo(x + 4, y + 68); ctx.lineTo(x + 102, y + 68); ctx.stroke();
          ctx.fillStyle = '#738b80'; ctx.fillRect(x + 13, y + 26, 26, 42);
          ctx.fillStyle = '#554b43'; ctx.fillRect(x + 60, y + 21, 10, 39);
          ctx.beginPath(); ctx.arc(x + 65, y + 15, 8, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#aa8556'; ctx.fillRect(x + 42, y + 55, 42, 7);
          ctx.strokeStyle = '#615449';
          for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.moveTo(x, y + 91 + k * 5); ctx.lineTo(x + 55 + k * 12, y + 91 + k * 5); ctx.stroke(); }
        }
      } else if (kind === 'screen') {
        ctx.fillStyle = '#82998d';
        ctx.beginPath(); ctx.moveTo(0, size * .8);
        for (let x = 0; x <= size; x += 12) ctx.lineTo(x, size * (.5 + random() * .28));
        ctx.lineTo(size, size); ctx.lineTo(0, size); ctx.fill();
        ctx.fillStyle = '#bda270'; ctx.beginPath(); ctx.arc(size * .72, size * .24, size * .10, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#455f56'; ctx.lineWidth = 3;
        for (let x = 15; x < 85; x += 22) {
          ctx.beginPath(); ctx.moveTo(x, size); ctx.quadraticCurveTo(x + 35, size * .4, x + 20, size * .15); ctx.stroke();
        }
      } else {
        for (let x = 22; x < size - 15; x += 22) for (let y = 18; y < size - 40; y += 20) {
          const width = 6 + random() * 7;
          ctx.beginPath(); ctx.moveTo(x - width / 2, y); ctx.lineTo(x + width / 2, y + 2); ctx.moveTo(x, y - 4); ctx.lineTo(x - 1, y + 8); ctx.stroke();
        }
        ctx.strokeStyle = '#945947'; ctx.lineWidth = 4; ctx.strokeRect(size - 60, size - 63, 33, 35);
        ctx.beginPath(); ctx.moveTo(size - 53, size - 46); ctx.lineTo(size - 36, size - 46); ctx.moveTo(size - 45, size - 55); ctx.lineTo(size - 45, size - 33); ctx.stroke();
      }
    });
    return this.material(`paper-${kind}`, '#fff7e6', { map, roughness: .94, side: THREE.DoubleSide });
  }

  glow(): THREE.CanvasTexture {
    return this.texture('soft-light', (ctx, size) => {
      const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      gradient.addColorStop(0, 'rgba(255,236,181,.8)'); gradient.addColorStop(.18, 'rgba(255,213,125,.30)'); gradient.addColorStop(1, 'rgba(255,200,100,0)');
      ctx.fillStyle = gradient; ctx.fillRect(0, 0, size, size);
    }, 64);
  }

  dispose(): void {
    for (const geometry of this.geometries.values()) geometry.dispose();
    for (const material of this.materials.values()) material.dispose();
    for (const texture of this.textures.values()) texture.dispose();
    this.geometries.clear(); this.materials.clear(); this.textures.clear();
  }
}

function part(parent: THREE.Group, _kit: AssetKit, geometry: THREE.BufferGeometry, material: THREE.Material,
  x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, cast = false): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z); mesh.scale.set(sx, sy, sz);
  mesh.castShadow = cast; mesh.receiveShadow = true; parent.add(mesh);
  return mesh;
}

function box(parent: THREE.Group, kit: AssetKit, role: string | THREE.Material, x: number, y: number, z: number,
  width: number, height: number, depth: number, cast = false): THREE.Mesh {
  return part(parent, kit, kit.geometry('box', () => new THREE.BoxGeometry(1, 1, 1)), typeof role === 'string' ? kit.surface(role) : role,
    x, y, z, width, height, depth, cast);
}

function cylinder(parent: THREE.Group, kit: AssetKit, role: string | THREE.Material, x: number, y: number, z: number,
  radius: number, height: number, cast = false, taper = 1): THREE.Mesh {
  return part(parent, kit, kit.geometry(`cylinder-${taper}`, () => new THREE.CylinderGeometry(.5 * taper, .5, 1, 12)),
    typeof role === 'string' ? kit.surface(role) : role, x, y, z, radius * 2, height, radius * 2, cast);
}

function beam(parent: THREE.Group, kit: AssetKit, role: string, start: THREE.Vector3, end: THREE.Vector3, radius = .045): THREE.Mesh {
  const vector = end.clone().sub(start), center = start.clone().add(end).multiplyScalar(.5);
  const mesh = cylinder(parent, kit, role, center.x, center.y, center.z, radius, vector.length());
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vector.normalize());
  return mesh;
}

function roofGeometry(): THREE.BufferGeometry {
  const positions: number[] = [], uvs: number[] = [];
  const steps = 8;
  for (const side of [-1, 1]) for (let j = 0; j < steps; j++) {
    const points = [j / steps, (j + 1) / steps];
    const height = (t: number) => .47 * (1 - t) + .16 * Math.pow(t, 5);
    const a = [-.5, height(points[0]), side * points[0] * .5];
    const b = [.5, height(points[0]), side * points[0] * .5];
    const c = [.5, height(points[1]), side * points[1] * .5];
    const d = [-.5, height(points[1]), side * points[1] * .5];
    for (const [vertex, uv] of [[a, [0, points[0]]], [b, [1, points[0]]], [c, [1, points[1]]], [a, [0, points[0]]], [c, [1, points[1]]], [d, [0, points[1]]]]) {
      positions.push(...vertex); uvs.push(...uv);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  return geometry;
}

function roof(parent: THREE.Group, kit: AssetKit, x: number, y: number, z: number, width: number, depth: number, role = 'roof'): void {
  const material = kit.surface(role); material.side = THREE.DoubleSide;
  part(parent, kit, kit.geometry('swept-eave', roofGeometry), material, x, y, z, width, 1.25, depth, true);
  box(parent, kit, 'timber', x, y + .06, z, width * .93, .12, depth * .88);
  box(parent, kit, 'gold', x, y + .61, z, width * .92, .04, .07);
}

function house(parent: THREE.Group, kit: AssetKit, x: number, z: number, width = 2.6, depth = 2, height = 1.65): void {
  box(parent, kit, 'wall', x, height / 2, z, width, height, depth, true);
  for (const dx of [-width / 2 + .08, width / 2 - .08]) {
    box(parent, kit, 'wood', x + dx, height / 2, z + depth / 2 + .025, .13, height, .1);
  }
  box(parent, kit, 'wood', x, .12, z + depth / 2 + .03, width, .14, .10);
  box(parent, kit, 'ink', x, .65, z + depth / 2 + .055, .61, 1.15, .04);
  for (const dx of [-.83, .83]) {
    box(parent, kit, 'wood', x + dx, 1.05, z + depth / 2 + .065, .55, .44, .055);
    for (let i = 0; i < 4; i++) box(parent, kit, 'gold', x + dx - .20 + i * .13, 1.05, z + depth / 2 + .10, .025, .37, .025);
  }
  roof(parent, kit, x, height, z, width + .55, depth + .55);
}

function table(parent: THREE.Group, kit: AssetKit, x: number, z: number, width = 2.5, depth = 1.3, height = .65): void {
  box(parent, kit, 'wood', x, height, z, width, .12, depth, true);
  box(parent, kit, 'gold', x, height - .10, z + depth / 2, width * .93, .035, .03);
  for (const dx of [-width * .4, width * .4]) for (const dz of [-depth * .33, depth * .33]) {
    box(parent, kit, 'timber', x + dx, height / 2, z + dz, .10, height, .12);
  }
}

function scroll(parent: THREE.Group, kit: AssetKit, x: number, y: number, z: number, width = .85, kind = 'ledger'): void {
  box(parent, kit, kit.paper(kind), x, y, z, width, .024, .53);
  for (const dz of [-.26, .26]) {
    const roller = cylinder(parent, kit, 'bone', x, y + .05, z + dz, .07, width + .10);
    roller.rotation.z = Math.PI / 2;
  }
}

function banner(parent: THREE.Group, kit: AssetKit, x: number, z: number, height: number, role = 'lacquer'): void {
  cylinder(parent, kit, 'timber', x, height / 2, z, .045, height);
  box(parent, kit, 'gold', x + .48, height - .16, z, 1.1, .045, .045);
  const cloth = box(parent, kit, role, x + .46, height - .68, z, .82, 1.03, .035);
  cloth.rotation.y = -.09;
  box(parent, kit, 'gold', x + .46, height - .69, z + .035, .055, .62, .015);
  box(parent, kit, 'gold', x + .46, height - .57, z + .036, .38, .04, .016);
  box(parent, kit, 'gold', x + .46, height - .83, z + .036, .38, .04, .016);
}

function sack(parent: THREE.Group, kit: AssetKit, x: number, y: number, z: number, scale = 1): void {
  const geometry = kit.geometry('grain-sack', () => new THREE.LatheGeometry([
    new THREE.Vector2(0, 0), new THREE.Vector2(.30, .02), new THREE.Vector2(.38, .24),
    new THREE.Vector2(.34, .53), new THREE.Vector2(.18, .68), new THREE.Vector2(.12, .76), new THREE.Vector2(0, .79),
  ], 10));
  part(parent, kit, geometry, kit.surface('cloth'), x, y, z, scale, scale, scale);
  cylinder(parent, kit, 'wood', x, y + .70 * scale, z, .14 * scale, .035 * scale);
}

function crate(parent: THREE.Group, kit: AssetKit, x: number, z: number, width: number, depth: number): void {
  box(parent, kit, 'timber', x, .48, z, width, .96, depth, true);
  for (const dx of [-width * .38, width * .38]) box(parent, kit, 'wood', x + dx, .5, z + depth / 2 + .02, .095, .95, .05);
  for (const y of [.14, .83]) box(parent, kit, 'wood', x, y, z + depth / 2 + .04, width, .095, .05);
  const diagonal = box(parent, kit, 'wood', x, .49, z + depth / 2 + .08, Math.hypot(width * .9, .7), .08, .04);
  diagonal.rotation.z = Math.atan2(.7, width * .9);
}

function shrub(parent: THREE.Group, kit: AssetKit, x: number, z: number, width: number, depth: number): void {
  box(parent, kit, 'wood', x, .16, z, width, .32, depth, true);
  box(parent, kit, 'darkLeaf', x, .57, z, width * .97, .72, depth * .95, true);
  const geometry = kit.geometry('leaves', () => new THREE.DodecahedronGeometry(.5, 0));
  const count = Math.max(2, Math.ceil(depth / .65));
  for (let i = 0; i < count; i++) for (const dx of [-width * .19, width * .19]) {
    const dz = -depth * .32 + i / (count - 1) * depth * .64;
    part(parent, kit, geometry, kit.surface('leaf'), x + dx, .92, z + dz, width * .55, .7, Math.min(.75, depth * .3));
  }
}

export interface Practical { sprite: THREE.Sprite; phase: number; baseScale: number }
export interface Environment { root: THREE.Group; practicals: Practical[]; dispose: () => void }

function lamp(parent: THREE.Group, kit: AssetKit, practicals: Practical[], x: number, y: number, z: number, lantern = false): void {
  cylinder(parent, kit, 'wood', x, y / 2, z, .045, y);
  const fire = kit.material('flame', '#ffe5a0', { emissive: '#f4b65f', emissiveIntensity: 1.6, roughness: 1 });
  if (lantern) {
    cylinder(parent, kit, fire, x, y, z, .18, .34);
    for (const dy of [-.18, .18]) box(parent, kit, 'wood', x, y + dy, z, .39, .045, .39);
    for (const dx of [-.15, .15]) box(parent, kit, 'wood', x + dx, y, z + .16, .025, .34, .025);
  } else {
    cylinder(parent, kit, 'gold', x, y - .08, z, .13, .11);
    part(parent, kit, kit.geometry('flame', () => new THREE.ConeGeometry(.12, .38, 5)), fire, x, y + .15, z);
  }
  const material = new THREE.SpriteMaterial({ map: kit.glow(), color: '#ffda96', transparent: true, opacity: .50, depthWrite: false, blending: THREE.AdditiveBlending });
  const sprite = new THREE.Sprite(material); sprite.position.set(x, y + .06, z); sprite.scale.setScalar(1.1);
  parent.add(sprite); practicals.push({ sprite, phase: x * 1.7 + z, baseScale: 1.1 });
}

function batchScenery(source: THREE.Group): { root: THREE.Group; geometries: THREE.BufferGeometry[] } {
  source.updateMatrixWorld(true);
  const batches = new Map<string, { material: THREE.Material; cast: boolean; parts: Array<{ geometry: THREE.BufferGeometry; matrix: THREE.Matrix4 }> }>();
  const sprites: THREE.Sprite[] = [];
  source.traverse(object => {
    if (object instanceof THREE.Sprite) sprites.push(object);
    if (!(object instanceof THREE.Mesh) || Array.isArray(object.material)) return;
    const key = `${object.material.uuid}/${object.castShadow}`;
    let batch = batches.get(key);
    if (!batch) { batch = { material: object.material, cast: object.castShadow, parts: [] }; batches.set(key, batch); }
    batch.parts.push({ geometry: object.geometry, matrix: object.matrixWorld.clone() });
  });
  const root = new THREE.Group(), geometries: THREE.BufferGeometry[] = [];
  root.name = 'authored-scenery';
  for (const batch of batches.values()) {
    const geometry = combine(batch.parts); geometries.push(geometry);
    const mesh = new THREE.Mesh(geometry, batch.material); mesh.castShadow = batch.cast; mesh.receiveShadow = true;
    root.add(mesh);
  }
  for (const sprite of sprites) { sprite.removeFromParent(); root.add(sprite); }
  return { root, geometries };
}

function distantHills(parent: THREE.Group, kit: AssetKit): void {
  const random = seeded(1807), geometry = kit.geometry('hill', () => new THREE.ConeGeometry(1, 1, 7));
  const material = kit.material('distant-hill', '#5e7478', { roughness: 1 });
  for (let i = 0; i < 12; i++) {
    part(parent, kit, geometry, material, -15 + i * 2.8, .5, -11 - random() * 3, 3 + random() * 3, 2 + random() * 3, 2 + random() * 2);
  }
}

function smallFolk(parent: THREE.Group, kit: AssetKit, x: number, z: number, robe: string, carry = false): void {
  const fabric = kit.material(`folk-${robe}`, robe);
  part(parent, kit, kit.geometry('folk-robe', () => new THREE.CylinderGeometry(.21, .32, .94, 9)), fabric, x, .60, z);
  cylinder(parent, kit, 'bone', x, 1.25, z, .18, .35);
  cylinder(parent, kit, 'wood', x, 1.46, z, .22, .11);
  for (const dx of [-.27, .27]) box(parent, kit, fabric, x + dx, .94, z + .09, .18, .53, .23);
  if (carry) sack(parent, kit, x, .60, z + .36, .65);
}

export function buildEnvironment(kind: SceneKind, kit: AssetKit, granary?: GranaryView): Environment {
  const source = new THREE.Group(), practicals: Practical[] = [];
  box(source, kit, 'ink', 0, -.35, 0, 14.8, .6, 10.8);
  box(source, kit, kind === 'night' ? 'nightStone' : kind === 'court' || kind === 'studio' ? 'wood' : 'clay', 0, -.06, 0, 14, .12, 10);
  box(source, kit, 'gold', 0, -.23, 5.38, 14.2, .025, .025);
  if (kind === 'city') {
    distantHills(source, kit);
    box(source, kit, 'wall', 0, 1.10, -4.65, 14, 2.2, .72, true);
    for (let i = -6; i <= 6; i++) box(source, kit, 'clay', i, 2.38, -4.65, .56, .54, .81);
    for (const x of [-5.5, 5.5]) {
      box(source, kit, 'clay', x, 1.6, -4.4, 1.7, 3.2, 1.6, true);
      roof(source, kit, x, 3.2, -4.4, 2.25, 2.0);
      banner(source, kit, x - .45, -4.3, 4.45, 'jade');
    }
    box(source, kit, 'ink', .3, .76, -4.24, 1.5, 1.52, .1);
    for (const [x, z, width] of [[-4.6, -1.4, 2.5], [4.8, -1.2, 2.4], [-5.0, 2.0, 2.1], [5.1, 2.4, 2.0]]) house(source, kit, x, z, width);
    box(source, kit, 'stone', .3, .025, 0, 2.1, .055, 8.6);
    for (const x of [-2.2, 2.8]) lamp(source, kit, practicals, x, 1.7, -3.6);
    for (const x of [-3.3, 3.3]) { crate(source, kit, x, 2.4, .95, .8); sack(source, kit, x + .8, .03, 2.3, .7); }
  } else if (kind === 'court') {
    box(source, kit, 'lacquer', 0, .035, -.55, 8.2, .035, 7.1);
    box(source, kit, 'gold', 0, .057, 2.9, 8.2, .025, .04);
    box(source, kit, 'wood', 0, 1.65, -4.3, 12, 3.3, .20, true);
    for (const x of [-5.4, -3.5, 3.5, 5.4]) {
      cylinder(source, kit, 'lacquer', x, 1.9, -3.1, .16, 3.8, true);
      cylinder(source, kit, 'gold', x, .2, -3.1, .24, .25);
      cylinder(source, kit, 'gold', x, 3.35, -3.1, .19, .11);
    }
    box(source, kit, 'timber', 0, 3.65, -3.1, 11.7, .22, .32, true);
    roof(source, kit, 0, 3.8, -4.6, 12.7, 3.0);
    for (const x of [-1.75, 0, 1.75]) {
      box(source, kit, 'wood', x, 1.7, -3.25, 1.76, 2.6, .12);
      box(source, kit, kit.paper('screen'), x, 1.7, -3.16, 1.54, 2.36, .035);
      box(source, kit, 'gold', x, 2.85, -3.13, 1.47, .035, .025);
    }
    box(source, kit, 'wood', 0, .14, -1.8, 5.5, .28, 1.9, true);
    table(source, kit, 0, -1.55, 3.6, 1.2, .75);
    scroll(source, kit, -.5, .83, -1.5);
    cylinder(source, kit, 'copper', 1.0, 1.02, -1.5, .18, .40, false, .7);
    for (const x of [-4.1, 4.1]) lamp(source, kit, practicals, x, 2.15, -1.8, true);
    for (const x of [-2.5, 0, 2.5]) box(source, kit, 'cloth', x, .036, 1.6, 1.4, .04, 1.5);
  } else if (kind === 'gate') {
    distantHills(source, kit);
    for (const x of [-4.4, 4.4]) {
      box(source, kit, 'wall', x, 1.4, -3.65, 5.25, 2.8, 1.2, true);
      for (let i = 0; i < 5; i++) box(source, kit, 'clay', x - 2.05 + i * 1.03, 2.93, -3.65, .60, .36, 1.24);
    }
    for (const x of [-1.73, 1.73]) {
      box(source, kit, 'clay', x, 1.65, -3.65, .85, 3.3, 1.8, true);
      box(source, kit, 'wood', x * .68, 1.1, -3.7, .35, 2.2, .25);
    }
    box(source, kit, 'timber', 0, 2.9, -3.65, 3.7, .40, 1.5, true);
    roof(source, kit, 0, 3.24, -3.65, 4.6, 2.6);
    for (let i = 0; i < 3; i++) box(source, kit, 'stone', 0, .10 + i * .12, -1.9 - i * .48, 2.9, .20 + i * .24, .56);
    box(source, kit, 'stone', 0, .025, 1.5, 2.4, .055, 5.1);
    for (let i = 0; i < 7; i++) box(source, kit, 'timber', 0, .09, 3.2 + i * .24, 2.45, .07, .20);
    for (const x of [-1.3, 1.3]) {
      box(source, kit, 'wood', x, .52, 3.95, .06, .06, 1.65);
      for (const z of [3.3, 4.0, 4.7]) cylinder(source, kit, 'wood', x, .30, z, .045, .63);
    }
    lamp(source, kit, practicals, -2.5, 1.8, -1.7);
    house(source, kit, -5.0, .6, 2.6, 2.2, 1.7);
    table(source, kit, 4.5, .7, 1.7, 1.0, .56); scroll(source, kit, 4.5, .64, .7, .7);
  } else if (kind === 'night') {
    box(source, kit, 'wall', 0, 1.0, -5.25, 14.5, 2, .40, true);
    box(source, kit, 'roof', 0, 2.07, -5.25, 14.8, .15, .60);
    for (const x of [-7.15, 7.15]) box(source, kit, 'wood', x, .38, 0, .18, .75, 10.1);
    house(source, kit, 3.4, -6.1, 5.9, 2.0, 2.8);
    house(source, kit, -4.7, -6.0, 3.4, 2.0, 2.25);
    shrub(source, kit, -1.3, -.5, 1.5, 4.6);
    crate(source, kit, 2.35, 1.8, 1.3, 1.2); crate(source, kit, 3.65, 1.8, 1.3, 1.2);
    shrub(source, kit, -4, -2, 2, 1.2);
    box(source, kit, 'wood', 2, .1, -3.5, 2, .2, 1.1, true);
    box(source, kit, 'lacquer', 2, .83, -3.5, 1.88, 1.42, .14, true);
    for (const x of [1, 3]) cylinder(source, kit, 'gold', x, .82, -3.5, .055, 1.65);
    box(source, kit, kit.paper('screen'), 2, .90, -3.40, 1.68, 1.10, .025);
    for (const x of [-6.2, 6.2]) lamp(source, kit, practicals, x, 1.6, -4.45, true);
    table(source, kit, 5.2, -3.5, .80, .75, .57);
    for (const x of [-6.15, -4.85]) cylinder(source, kit, 'wood', x, .37, 4.0, .08, .74);
    const exitMaterial = kit.material('exit-inlay', '#a9d8bd', { emissive: '#749f91', emissiveIntensity: .45 });
    part(source, kit, kit.geometry('exit-ring', () => new THREE.RingGeometry(.41, .49, 40)), exitMaterial, -5.5, .025, 4).rotation.x = -Math.PI / 2;
    for (let i = 0; i < 6; i++) box(source, kit, 'stone', -5.5, .022, 3.4 - i * .44, 1.1, .035, .19);
  } else if (kind === 'camp') {
    distantHills(source, kit);
    const tent = (x: number, z: number, width: number) => {
      const geometry = kit.geometry('ridge-tent', () => {
        const shape = new THREE.Shape(); shape.moveTo(-.5, 0); shape.lineTo(0, .72); shape.lineTo(.5, 0); shape.closePath();
        return new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false });
      });
      part(source, kit, geometry, kit.surface('cloth'), x, 0, z - 1.2, width, 2.4, 2.4, true);
      box(source, kit, 'ink', x, .59, z + 1.225, .65, 1.14, .025);
      beam(source, kit, 'timber', new THREE.Vector3(x, 0, z + 1.3), new THREE.Vector3(x, 1.78, z + 1.3), .045);
      for (const dx of [-width / 2, width / 2]) beam(source, kit, 'bone', new THREE.Vector3(x + dx, .3, z), new THREE.Vector3(x + dx * 1.3, .04, z + 1.7), .012);
    };
    tent(-4.5, -1.9, 3.2); tent(4.5, -2.1, 3.1);
    for (const x of [-5.8, 0, 5.8]) banner(source, kit, x, -3.9, 3.8);
    table(source, kit, 0, -1.7, 3.1, 1.8, .73); scroll(source, kit, 0, .82, -1.7, 1.8, 'map');
    for (const x of [-.5, .3, .65]) cylinder(source, kit, 'gold', x, .90, -1.7 + x * .3, .075, .1);
    for (const x of [-2.4, 2.4]) lamp(source, kit, practicals, x, 1.4, .2);
    for (let i = 0; i < 10; i++) {
      const x = -6.1 + i * 1.35;
      smallFolk(source, kit, x, -4.7, i % 2 ? '#4b6062' : '#59696b');
      cylinder(source, kit, 'wood', x + .36, 1.04, -4.7, .015, 2.1);
      part(source, kit, kit.geometry('spear-tip', () => new THREE.ConeGeometry(.075, .28, 4)), kit.surface('bone'), x + .36, 2.13, -4.7);
    }
    crate(source, kit, -5.5, 2.4, .85, .8); crate(source, kit, 5.5, 2.5, .9, .8);
  } else if (kind === 'granary') {
    box(source, kit, 'wall', 0, 1.55, -4.0, 12.4, 3.1, .25, true);
    for (const x of [-5.9, -2.9, 2.9, 5.9]) cylinder(source, kit, 'wood', x, 1.7, -3.55, .13, 3.4, true);
    box(source, kit, 'timber', 0, 3.15, -3.55, 12.1, .22, .26, true);
    roof(source, kit, 0, 3.28, -4.3, 13.1, 2.8);
    box(source, kit, 'ink', 0, 1.10, -3.82, 2.25, 2.2, .1);
    box(source, kit, 'timber', -1.24, 1.15, -3.65, .16, 2.3, .2);
    box(source, kit, 'timber', 1.24, 1.15, -3.65, .16, 2.3, .2);
    box(source, kit, 'wood', 0, 2.35, -3.65, 2.7, .18, .24);
    // Stock is real world state, not decoration: one sack stands for two measures, so
    // every handover you make removes something you can actually see.
    const stock = granary ? Math.max(0, Math.min(granary.capacity, granary.stock)) : 24;
    const sacks = Math.min(Math.ceil((granary?.capacity ?? 24) / 2), Math.ceil(stock / 2));
    for (let i = 0; i < sacks; i++) {
      const row = Math.floor(i / 4), column = i % 4;
      // An odd remainder is a smaller pile, so a one-bag transfer is visible too.
      const scale = i === sacks - 1 && stock % 2 ? .9 * Math.cbrt(.5) : .9;
      sack(source, kit, -6.0 + column * .68 + row * .3, row * .55, -2.7, scale);
    }
    for (const x of [3.4, 4.4, 5.4]) {
      box(source, kit, 'timber', x, .16, -2.6, .8, .11, 1.0);
      box(source, kit, 'wood', x, .085, -2.6, .08, .09, .90);
    }
    table(source, kit, -.1, -1.55, 3.5, 1.5, .72);
    // The last handover determines the credential; matching receipt pages mark the
    // installed verification method. Before any handover, the credential spot is empty.
    const credential = granary?.credential ?? '';
    if (granary?.mechanism) {
      scroll(source, kit, -.78, .81, -1.6, 1.05); scroll(source, kit, .98, .81, -1.73, 1.05);
      cylinder(source, kit, 'jade', .10, .90, -1.62, .09, .10);
    } else {
      scroll(source, kit, -.5, .81, -1.6, 1.05); scroll(source, kit, .92, .81, -1.73, .58);
    }
    if (credential === 'letter') {
      scroll(source, kit, .45, .81, -1.25, .62);
    } else if (credential === 'pledge') {
      cylinder(source, kit, 'jade', .45, .90, -1.25, .17, .12);
      box(source, kit, 'bone', .45, 1.03, -1.25, .3, .03, .11);
    } else if (credential === 'seal') {
      box(source, kit, 'lacquer', .45, .85, -1.25, .26, .075, .24);
      cylinder(source, kit, 'gold', .45, .96, -1.25, .08, .18);
      cylinder(source, kit, 'jade', .45, 1.08, -1.25, .10, .06);
    }
    for (const x of [-4.2, 4.5]) lamp(source, kit, practicals, x, 2.5, -.7, true);
    smallFolk(source, kit, -5.7, 1.5, '#8b8f7c', true); smallFolk(source, kit, 5.6, 1.9, '#a18e71');
    const random = seeded(79);
    for (let i = 0; i < 25; i++) box(source, kit, 'bone', -3.5 + random() * 1.0, .04, -.7 + random(), .04, .025, .07);
  } else {
    box(source, kit, 'ink', 0, 1.75, -4.15, 12, 3.5, .16, true);
    box(source, kit, 'gold', .8, 2.02, -3.96, 5.05, 2.45, .08);
    box(source, kit, kit.paper('film'), .8, 2.02, -3.90, 4.88, 2.28, .04);
    for (const x of [-5.3, 5.3]) {
      cylinder(source, kit, 'ink', x, 1.7, -3.0, .055, 3.4);
      box(source, kit, 'bone', x, 3.1, -2.93, .65, .42, .12);
    }
    table(source, kit, -.8, -.4, 4.9, 2.25, .78);
    for (let i = 0; i < 5; i++) {
      const sheet = box(source, kit, kit.paper('storyboard'), -2.4 + i * .82, .86 + i * .003, -.3 + (i % 2) * .25, .68, .022, .94);
      sheet.rotation.y = (i - 2) * .045;
    }
    table(source, kit, -4.6, -2.45, 2.4, 1.6, .72);
    box(source, kit, 'clay', -4.6, .81, -2.45, 1.8, .05, 1.10);
    for (const x of [-5.1, -4.6, -4.1]) box(source, kit, 'wall', x, 1.01, -2.6, .32, .40, .22);
    roof(source, kit, -4.6, 1.25, -2.6, 1.9, .55);
    for (const x of [-2.7, -.6, 1.5]) {
      for (const dx of [-.32, .32]) beam(source, kit, 'timber', new THREE.Vector3(x + dx, .02, 2.65), new THREE.Vector3(x - dx, .8, 2.15), .045);
      box(source, kit, 'lacquer', x, .60, 2.4, .8, .065, .67);
      box(source, kit, 'lacquer', x, 1.01, 2.78, .80, .59, .065);
      box(source, kit, 'gold', x, 1.06, 2.83, .37, .035, .012);
    }
    for (let i = 0; i < 3; i++) {
      const reel = cylinder(source, kit, 'gold', 4.0, .17 + i * .19, -1.8, .61, .13);
      reel.name = 'film-reel';
      cylinder(source, kit, 'ink', 4.0, .24 + i * .19, -1.8, .12, .014);
      for (let k = 0; k < 5; k++) cylinder(source, kit, 'ink', 4.0 + Math.cos(k * Math.PI * .4) * .35, .24 + i * .19, -1.8 + Math.sin(k * Math.PI * .4) * .35, .12, .014);
    }
    box(source, kit, kit.paper('storyboard'), 4.8, 1.62, -3.89, 1.6, 1.9, .04);
    lamp(source, kit, practicals, 3.5, 1.7, 2.0, true);
  }
  const { root, geometries } = batchScenery(source);
  root.userData.assetId = `environment-${kind}-v1`;
  root.userData.provenance = 'Original procedural scenery; historical visual interpretation.';
  return {
    root, practicals,
    dispose: () => {
      for (const geometry of geometries) geometry.dispose();
      for (const practical of practicals) practical.sprite.material.dispose();
      root.clear();
    },
  };
}

function combineRigidParts(group: THREE.Group, kit: AssetKit, cacheKey: string): void {
  const batches = new Map<string, { material: THREE.Material; cast: boolean; parts: Array<{ geometry: THREE.BufferGeometry; matrix: THREE.Matrix4 }> }>();
  for (const child of [...group.children]) {
    if (!(child instanceof THREE.Mesh) || Array.isArray(child.material)) continue;
    child.updateMatrix();
    let batch = batches.get(child.material.uuid);
    if (!batch) { batch = { material: child.material, cast: false, parts: [] }; batches.set(child.material.uuid, batch); }
    batch.cast ||= child.castShadow;
    batch.parts.push({ geometry: child.geometry, matrix: child.matrix.clone() });
    group.remove(child);
  }
  let index = 0;
  for (const batch of batches.values()) {
    const geometry = kit.geometry(`${cacheKey}-${index++}`, () => combine(batch.parts));
    const mesh = new THREE.Mesh(geometry, batch.material); mesh.castShadow = batch.cast; mesh.receiveShadow = true;
    group.add(mesh);
  }
}

export interface CharacterModel {
  root: THREE.Group;
  headHeight: number;
  animate: (time: number, delta: number, moving: boolean, mood?: string) => void;
  setFocused: (focused: boolean) => void;
  setOpacity: (opacity: number) => void;
  dispose: () => void;
}

export function buildCharacter(character: SceneCharacter, kit: AssetKit): CharacterModel {
  const identity = `${character.id}/${character.silhouette}`;
  const identityHash = hash(identity), phase = (identityHash % 100) / 16;
  const description = `${character.silhouette} ${character.name} ${character.id}`;
  const elder = /elder|old|sage|侯嬴|侯赢|白髯|老/i.test(description);
  const warrior = /warrior|guard|soldier|general|朱亥|晋鄙|武|甲/i.test(description);
  const lady = /lady|woman|ruji|如姬|姬|female/i.test(description);
  const royal = /royal|king|魏王|公子|信陵/i.test(description);
  const root = new THREE.Group(); root.name = character.id; root.userData.characterId = character.id;
  root.userData.assetId = `character-${character.id}-v1`;
  root.position.set(character.x, .06, character.z);
  const materials: THREE.Material[] = [];
  const own = <T extends THREE.Material>(material: T): T => { const clone = material.clone() as T; materials.push(clone); return clone; };
  const color = /^#[\da-f]{3,8}$/i.test(character.color) ? character.color : PALETTE.jade;
  const robeMaterial = own(kit.material(`robe-${color}`, color, { roughness: .95 }));
  const skin = own(kit.material(`skin-${identityHash % 3}`, ['#d5b495', '#c4a186', '#b89479'][identityHash % 3], { roughness: .86 }));
  const dark = own(kit.surface('ink')), trim = own(kit.surface(royal ? 'gold' : 'bone'));
  const leather = own(kit.surface('wood'));
  const hair = elder ? own(kit.material('grey-hair', '#b8bbb0')) : dark;
  const rig = new THREE.Group(); rig.name = 'breathing-torso'; root.add(rig);
  const robe = kit.geometry('tailored-robe', () => new THREE.LatheGeometry([
    new THREE.Vector2(0, .12), new THREE.Vector2(.42, .12), new THREE.Vector2(.44, .22),
    new THREE.Vector2(.35, .67), new THREE.Vector2(.29, .95), new THREE.Vector2(.35, 1.18),
    new THREE.Vector2(.30, 1.34), new THREE.Vector2(.13, 1.43), new THREE.Vector2(0, 1.43),
  ], 14));
  part(rig, kit, robe, robeMaterial, 0, 0, 0, lady ? .92 : warrior ? 1.15 : 1, 1, 1, true).name = 'cross-collar-robe';
  for (const dx of [-.16, .16]) box(root, kit, dark, dx, .095, .10, .22, .13, .38);
  cylinder(rig, kit, leather, 0, .98, 0, .315, .12).name = 'belt';
  box(rig, kit, trim, 0, .98, .318, .10, .10, .04);
  const collarGeometry = kit.geometry('crossed-collar', () => {
    const base = kit.geometry('box', () => new THREE.BoxGeometry(1, 1, 1));
    const transforms = [-1, 1].map(side => {
      const matrix = new THREE.Matrix4().compose(new THREE.Vector3(side * .09, 1.20, .28), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, side * .53)), new THREE.Vector3(.11, .45, .045));
      return { geometry: base, matrix };
    });
    return combine(transforms);
  });
  part(rig, kit, collarGeometry, trim, 0, 0, 0);
  if (warrior) box(rig, kit, own(kit.surface('copper')), 0, 1.21, .22, .47, .27, .18);
  const head = new THREE.Group(); head.name = 'head-joint'; head.position.set(0, 1.63, .01); rig.add(head);
  const orb = kit.geometry('smooth-form', () => new THREE.SphereGeometry(1, 12, 9));
  part(head, kit, orb, hair, 0, .02, -.038, .241, .303, .218);
  part(head, kit, orb, skin, 0, 0, .015, .227, .28, .204, true);
  part(head, kit, kit.geometry('nose', () => new THREE.ConeGeometry(1, 1, 4)), skin, 0, -.04, .234, .035, .095, .058).rotation.x = Math.PI / 2;
  const faceMap = kit.texture(`face-${identity}`, (ctx, size) => {
    ctx.clearRect(0, 0, size, size);
    ctx.strokeStyle = '#3c342d'; ctx.lineWidth = elder ? 5 : 6; ctx.lineCap = 'round';
    for (const x of [size * .30, size * .70]) {
      ctx.beginPath(); ctx.moveTo(x - size * .09, size * .37 + (warrior ? size * .035 : 0)); ctx.lineTo(x + size * .07, size * .36); ctx.stroke();
      ctx.fillStyle = '#292b27'; ctx.fillRect(x - 8, size * .44, 16, 8);
    }
    ctx.strokeStyle = lady ? '#92695b' : '#65503e'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(size * .41, size * .68); ctx.quadraticCurveTo(size * .51, size * .70 + (identityHash % 3) * 3, size * .60, size * .67); ctx.stroke();
    if (elder) {
      ctx.strokeStyle = '#8c8070'; ctx.lineWidth = 2;
      for (const x of [size * .22, size * .72]) { ctx.beginPath(); ctx.moveTo(x, size * .49); ctx.lineTo(x + 16, size * .51); ctx.stroke(); }
    }
  }, 128);
  const faceMaterial = own(kit.basic(`face-ink-${identity}`, { map: faceMap, transparent: true, depthWrite: false, side: THREE.FrontSide }));
  part(head, kit, kit.geometry('face-plane', () => new THREE.PlaneGeometry(1, 1)), faceMaterial, 0, -.015, .213, .36, .34, 1);
  if (royal) {
    box(head, kit, dark, 0, .33, -.015, .46, .30, .35, true);
    box(head, kit, trim, 0, .45, .005, .59, .055, .36);
    box(head, kit, trim, 0, .33, .168, .045, .21, .025);
  } else if (lady) {
    part(head, kit, orb, dark, -.045, .30, -.055, .18, .17, .16);
    const pin = cylinder(head, kit, trim, -.02, .31, -.055, .023, .59); pin.rotation.z = Math.PI / 2;
  } else {
    cylinder(head, kit, warrior ? dark : leather, 0, .255, -.018, warrior ? .28 : .25, warrior ? .17 : .12, true, .82);
    if (warrior) box(head, kit, trim, 0, .40, -.03, .075, .23, .24);
  }
  if (elder || (!lady && !royal && identityHash % 3 === 0)) {
    const beard = part(head, kit, kit.geometry('beard', () => new THREE.ConeGeometry(.17, .34, 6)), hair, 0, -.255, .09);
    beard.rotation.z = Math.PI;
  }
  const arms: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const joint = new THREE.Group(); joint.name = side < 0 ? 'left-shoulder-joint' : 'right-shoulder-joint';
    joint.position.set(side * .34, 1.24, 0); joint.rotation.z = side * .18; rig.add(joint); arms.push(joint);
    const sleeve = part(joint, kit, kit.geometry('tailored-sleeve', () => new THREE.CylinderGeometry(.135, .205, .60, 9)), robeMaterial, side * .035, -.28, 0, 1, 1, 1, true);
    sleeve.name = 'wide-sleeve';
    part(joint, kit, orb, skin, side * .06, -.62, .025, .105, .135, .095);
    if (side === 1 && (elder || warrior)) {
      cylinder(joint, kit, leather, .14, -.48, .03, .024, elder ? 1.50 : 1.85);
      if (warrior) part(joint, kit, kit.geometry('spear-tip', () => new THREE.ConeGeometry(.075, .28, 4)), trim, .14, .55, .03);
    }
  }
  combineRigidParts(root, kit, `${identity}-feet`);
  combineRigidParts(rig, kit, `${identity}-torso`);
  combineRigidParts(head, kit, `${identity}-head`);
  arms.forEach((arm, index) => combineRigidParts(arm, kit, `${identity}-arm-${index}`));
  const contact = part(root, kit, kit.geometry('contact-disc', () => new THREE.CircleGeometry(.48, 24)),
    own(kit.basic('contact-shadow', { color: '#142b35', transparent: true, opacity: .16, depthWrite: false })), 0, -.035, 0);
  contact.rotation.x = -Math.PI / 2;
  const focused = new THREE.Group(); focused.name = 'thought-channel'; root.add(focused); focused.visible = false;
  const focusMaterial = own(kit.basic('thought-gold', { color: PALETTE.gold, transparent: true, opacity: .83, depthWrite: false }));
  const ring = part(focused, kit, kit.geometry('focus-ring', () => new THREE.RingGeometry(.51, .54, 40)), focusMaterial, 0, -.02, 0);
  ring.rotation.x = -Math.PI / 2;
  cylinder(focused, kit, focusMaterial, -.66, .86, 0, .016, 1.34);
  for (let i = 0; i < 3; i++) part(focused, kit, orb, focusMaterial, -.66, .34 + i * .52, 0, .07, .07, .07);
  combineRigidParts(focused, kit, `${identity}-thought-channel`);
  let opacity = 1;
  return {
    root, headHeight: royal || warrior ? 2.25 : 2.03,
    animate: (time, delta, moving, mood) => {
      const tension = /fear|anx|wary|疑|焦|畏|谨慎/i.test(mood ?? '');
      rig.position.y = Math.sin(time * (tension ? 2.5 : 1.6) + phase) * .014;
      head.rotation.z = Math.sin(time * .65 + phase) * .023;
      const stride = moving ? Math.sin(time * 8) * .23 : 0;
      arms.forEach((arm, index) => {
        const target = (tension ? -.25 : -.06) + stride * (index ? 1 : -1);
        arm.rotation.x = THREE.MathUtils.lerp(arm.rotation.x, target, 1 - Math.exp(-delta * 12));
      });
      focused.rotation.y = Math.sin(time * .4) * .035;
    },
    setFocused: value => { focused.visible = value; },
    setOpacity: value => {
      if (Math.abs(opacity - value) < .001) return;
      opacity = value;
      for (const material of materials) {
        if (!(material instanceof THREE.MeshStandardMaterial || material instanceof THREE.MeshBasicMaterial)) continue;
        if (material === faceMaterial || material === focusMaterial || material === contact.material) continue;
        const transparent = value < .999;
        if (material.transparent !== transparent) { material.transparent = transparent; material.needsUpdate = true; }
        material.opacity = value; material.depthWrite = !transparent;
      }
      faceMaterial.opacity = value;
    },
    dispose: () => { for (const material of materials) material.dispose(); root.clear(); },
  };
}

export function makeSeal(kit: AssetKit): THREE.Group {
  const root = new THREE.Group(); root.name = 'tiger-seal'; root.userData.assetId = 'tiger-seal-v1';
  const shape = new THREE.Shape();
  shape.moveTo(-.37, -.09); shape.lineTo(-.27, .10); shape.lineTo(-.08, .15); shape.lineTo(.04, .10);
  shape.lineTo(.25, .20); shape.lineTo(.34, .16); shape.lineTo(.36, .05); shape.lineTo(.23, -.04);
  shape.lineTo(.17, -.16); shape.lineTo(.09, -.16); shape.lineTo(.06, -.03); shape.lineTo(-.18, -.03);
  shape.lineTo(-.22, -.15); shape.lineTo(-.30, -.15); shape.closePath();
  const geometry = kit.geometry('tiger-half', () => new THREE.ExtrudeGeometry(shape, { depth: .12, bevelEnabled: true, bevelThickness: .025, bevelSize: .02, bevelSegments: 1, steps: 1 }));
  const token = part(root, kit, geometry, kit.material('seal-bronze', '#d8bd7b', { metalness: .55, roughness: .34, emissive: '#749f91', emissiveIntensity: .35 }), 0, .81, 0, 1.35, 1.35, 1.35);
  token.name = 'seal-body';
  box(root, kit, 'jade', .06, .91, .15, .035, .22, .025);
  const material = kit.basic('seal-halo', { color: '#a5d4c1', transparent: true, opacity: .35, depthWrite: false, side: THREE.DoubleSide });
  const ring = part(root, kit, kit.geometry('seal-ring', () => new THREE.RingGeometry(.39, .43, 40)), material, 0, .015, 0);
  ring.rotation.x = -Math.PI / 2;
  return root;
}

export function makeVisionSector(kit: AssetKit): THREE.BufferGeometry {
  return kit.geometry('guard-view-sector', () => {
    const positions = [0, .02, 0], indices: number[] = [];
    for (let i = 0; i <= 24; i++) {
      const angle = -.55 + i / 24 * 1.1;
      positions.push(Math.sin(angle) * 3.2, .02, Math.cos(angle) * 3.2);
      if (i > 0) indices.push(0, i, i + 1);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices); geometry.computeVertexNormals(); geometry.computeBoundingSphere();
    return geometry;
  });
}
