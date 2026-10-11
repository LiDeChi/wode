// 刻字牌：所有中文都在这里画。用 canvas 描好后贴在一块薄板上，
// 板子微微自发光，所以暗处也读得清。
import * as THREE from 'three';

const FONT = '"Songti SC","STSong","Source Han Serif SC","Noto Serif CJK SC",serif';
let anisotropy = 4;
/** main.js 拿到 renderer 之后把真实上限告诉这里。 */
export const setPlateAnisotropy = n => { anisotropy = Math.max(1, Math.min(n | 0, 8)); };

function roundRect(g, x, y, w, h, r) {
  if (g.roundRect) { g.beginPath(); g.roundRect(x, y, w, h, r); return; }
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/**
 * 画一块刻字牌。lines 可以是字符串数组或单个字符串。
 * 返回 { mesh, setText, canvas }——setText 换字不改几何。
 */
export function makePlate({
  width = 1, height = .4, px = 768, py = 256, maxFont = 64,
  at = [0, 0, 0], rotation = [0, 0, 0],
  text, lines, ink = '#f3e2c0', bg = 'rgba(18,13,8,.74)', border = 'rgba(198,162,98,.34)',
  weight = 600,
} = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = px; canvas.height = py;
  const g = canvas.getContext('2d');
  const rows = () => {
    const src = lines !== undefined ? lines : [text ?? ''];
    const arr = Array.isArray(src) ? src : [src];
    return arr.map(s => String(s ?? ''));
  };

  function draw() {
    const list = rows();
    g.clearRect(0, 0, px, py);
    if (bg) {
      g.fillStyle = bg;
      roundRect(g, 2, 2, px - 4, py - 4, Math.round(py * .1));
      g.fill();
    }
    if (border) {
      g.strokeStyle = border;
      g.lineWidth = Math.max(2, py * .014);
      roundRect(g, 2, 2, px - 4, py - 4, Math.round(py * .1));
      g.stroke();
    }
    let fs = Math.min(maxFont, (py / Math.max(list.length, 1)) * .66);
    g.font = `${weight} ${fs}px ${FONT}`;
    const widest = Math.max(1, ...list.map(s => g.measureText(s).width));
    if (widest > px * .86) {
      fs = Math.max(8, Math.floor(fs * (px * .86) / widest));
      g.font = `${weight} ${fs}px ${FONT}`;
    }
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = ink;
    const lead = fs * 1.3;
    list.forEach((s, i) => {
      const y = py / 2 + (i - (list.length - 1) / 2) * lead;
      g.fillText(s, px / 2, y);
    });
  }
  draw();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = anisotropy;
  const mat = new THREE.MeshStandardMaterial({
    map: tex, transparent: true, roughness: .62, metalness: .12,
    emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: .5,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), mat);
  mesh.position.set(...at);
  mesh.rotation.set(...rotation);
  mesh.userData.noPick = true;
  mesh.renderOrder = 3;
  return {
    mesh, canvas,
    setText(next) {
      if (Array.isArray(next)) lines = next; else { lines = undefined; text = next; }
      draw();
      tex.needsUpdate = true;
    },
  };
}
