// 场景里的字：匾额、木签、竹简、导师灯下那句。
// 不生成 HTML 文本，先把字画进画布，再贴到一块薄板上——字是刻在东西上的。
import * as THREE from 'three';

const SERIF = '"Songti SC","STSong","Noto Serif CJK SC","Source Han Serif SC",serif';
const SANS = '"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif';

function canvasOf(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return canvas;
}

function applyFont(ctx, { font = SERIF, size = 64, weight = 400 }) {
  ctx.font = `${weight} ${size}px ${font}`;
}

/** 竖排：从上往下，一行一列。匾额与竹简用这个。 */
function drawVertical(ctx, text, box, { color, size, lineHeight, chars }) {
  const rows = text.split('\n');
  const colW = size * (lineHeight ?? 1.16);
  const totalW = colW * rows.length;
  const startX = box.x + (box.w - totalW) / 2 + colW / 2;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  rows.forEach((row, c) => {
    const list = chars ? [...row] : row.split('');
    const step = size * 1.1;
    const startY = box.y + (box.h - step * list.length) / 2 + step / 2;
    list.forEach((ch, i) => {
      ctx.fillText(ch, startX + c * colW, startY + i * step);
    });
  });
}

/**
 * 一块写着字的薄板。
 * text 里的 '\n' 在 vertical 模式代表换列。
 */
export function textPlate(text, opts = {}) {
  const {
    size = 64, font = SERIF, weight = 400, color = '#f0e6d2',
    bg = 'rgba(20,16,11,0.0)', pad = 0.34, vertical = false, maxWidth = 0,
    letterSpacing = 0, stroke = null, worldHeight = 0.3,
  } = opts;
  const probe = canvasOf(8, 8).getContext('2d');
  applyFont(probe, { font, size, weight });
  const rows = String(text).split('\n');
  let width;
  if (vertical) {
    width = Math.ceil(rows.length * size * 1.16 + size * pad * 2);
  } else {
    const longest = Math.max(...rows.map(r => probe.measureText(r).width + r.length * letterSpacing));
    width = Math.ceil(Math.min(maxWidth || Infinity, longest) + size * pad * 2);
  }
  const lineStep = size * 1.32;
  const height = Math.ceil((vertical ? Math.max(...rows.map(r => r.length)) * size * 1.1 : rows.length * lineStep) + size * pad * 2);

  const canvas = canvasOf(width, height);
  const ctx = canvas.getContext('2d');
  applyFont(ctx, { font, size, weight });
  if (bg && bg !== 'transparent') { ctx.fillStyle = bg; ctx.fillRect(0, 0, width, height); }
  if (stroke) { ctx.lineWidth = Math.max(2, size * 0.06); ctx.strokeStyle = stroke; ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, width - ctx.lineWidth, height - ctx.lineWidth); }
  ctx.fillStyle = color;
  ctx.shadowColor = 'rgba(0,0,0,0.65)';
  ctx.shadowBlur = size * 0.16;
  const box = { x: size * pad, y: size * pad, w: width - size * pad * 2, h: height - size * pad * 2 };
  if (vertical) {
    drawVertical(ctx, String(text), box, { color, size, chars: true });
  } else {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    rows.forEach((row, i) => {
      const y = box.y + lineStep * i + lineStep / 2;
      if (!letterSpacing) { ctx.fillText(row, box.x + box.w / 2, y); return; }
      const total = ctx.measureText(row).width + row.length * letterSpacing;
      let x = box.x + (box.w - total) / 2;
      ctx.textAlign = 'left';
      for (const ch of row) { ctx.fillText(ch, x, y); x += ctx.measureText(ch).width + letterSpacing; }
      ctx.textAlign = 'center';
    });
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(1, height / width),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, side: THREE.DoubleSide }),
  );
  const h = worldHeight ?? 0.3;
  plane.scale.set(h * (width / height), h, 1);
  plane.userData.texture = texture;
  plane.userData.canvas = canvas;
  plane.userData.aspect = width / height;
  return plane;
}

/** 竖直挂在木架上的匾额（一块厚板 + 刻字）。 */
export function plaque(text, opts = {}) {
  const { h = 0.5, color = '#2b2016', ink = '#e8d9b6', ...rest } = opts;
  const g = new THREE.Group();
  const face = textPlate(text, { ...rest, color: ink, weight: 500, worldHeight: h * 0.72, vertical: true, letterSpacing: 8 });
  const back = new THREE.Mesh(new THREE.BoxGeometry(face.scale.x * 1.22, h, 0.07),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 0.9 }));
  back.castShadow = true;
  face.position.z = 0.041;
  g.add(back, face);
  g.userData.face = face;
  return g;
}

/** 木签：挂在卷轴/物件边上的一小片木牌，写片名。 */
export function woodTag(text, opts = {}) {
  const { h = 0.72, ink = '#241a10', ...rest } = opts;
  const g = new THREE.Group();
  // 片名长的，折成两列；字大一点，远看也认得出。
  const wrapped = rest.wrap === false ? text : wrapVertical(text, 4);
  const face = textPlate(wrapped, { ...rest, color: ink, bg: 'rgba(0,0,0,0)', worldHeight: h * 0.72, weight: 500, vertical: true, size: 110, letterSpacing: 8 });
  const board = new THREE.Mesh(new THREE.BoxGeometry(face.scale.x * 1.34, h, 0.026),
    new THREE.MeshStandardMaterial({ color: new THREE.Color('#8a7748'), roughness: 0.95 }));
  board.castShadow = true;
  face.position.z = 0.016;
  g.add(board, face);
  g.userData.face = face;
  return g;
}

/** 竹简：一片竖着的竹条，两侧有边棱。用来滑进画面的那句话。 */
export function bambooSlip(text, opts = {}) {
  const { h = 1.5, ...rest } = opts;
  const g = new THREE.Group();
  const face = textPlate(text, { ...rest, color: '#241b0e', bg: 'rgba(0,0,0,0)', worldHeight: h * 0.66, vertical: true, size: 78 });
  const board = new THREE.Mesh(new THREE.BoxGeometry(face.scale.x * 1.16, h, 0.035),
    new THREE.MeshStandardMaterial({ color: new THREE.Color('#a99a54'), roughness: 0.92 }));
  board.castShadow = true;
  const lip = boxLike(face.scale.x * 1.3, 0.05, 0.05, '#7d7040');
  lip.position.set(0, h / 2, 0);
  const lip2 = lip.clone(); lip2.position.y = -h / 2;
  face.position.z = 0.021;
  g.add(board, lip, lip2, face);
  g.userData.face = face;
  return g;
}

function boxLike(w, h, d, color) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 0.95 }));
  m.castShadow = true;
  return m;
}

/** 竖排的片名折成几列，太长就不会变成一根细线。 */
export function wrapVertical(text, perColumn = 4) {
  const chars = [...String(text)];
  if (chars.length <= perColumn) return text;
  const rows = [];
  for (let i = 0; i < chars.length; i += perColumn) rows.push(chars.slice(i, i + perColumn).join(''));
  return rows.join('\n');
}

export { SERIF, SANS };
