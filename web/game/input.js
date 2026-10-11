// 輸入：鍵盤狀態 + 邊緣觸發（按下的那一下）。
// Tab 與空白鍵會被 preventDefault，否則瀏覽器會把焦點跳走或捲動頁面。

const MOVE_KEYS = {
  KeyW: [0, -1], ArrowUp: [0, -1],
  KeyS: [0, 1], ArrowDown: [0, 1],
  KeyA: [-1, 0], ArrowLeft: [-1, 0],
  KeyD: [1, 0], ArrowRight: [1, 0],
};

export function createInput() {
  const down = new Set();
  const pressedThisFrame = new Set();

  function onKeyDown(e) {
    if (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    if (e.repeat) return;
    down.add(e.code);
    pressedThisFrame.add(e.code);
  }
  function onKeyUp(e) {
    down.delete(e.code);
  }
  function onBlur() {
    down.clear();
  }

  window.addEventListener('keydown', onKeyDown, { passive: false });
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);

  return {
    // 這一格的移動方向（已正規化）。被阻擋時回傳零向量。
    axis(blocked) {
      if (blocked) return { x: 0, z: 0 };
      let x = 0;
      let z = 0;
      for (const code of down) {
        const v = MOVE_KEYS[code];
        if (v) { x += v[0]; z += v[1]; }
      }
      const len = Math.hypot(x, z);
      if (len < 1e-6) return { x: 0, z: 0 };
      return { x: x / len, z: z / len };
    },
    justPressed(code) {
      return pressedThisFrame.has(code);
    },
    isDown(code) {
      return down.has(code);
    },
    // 每一格結束時清掉邊緣觸發。main 迴圈負責呼叫。
    endFrame() {
      pressedThisFrame.clear();
    },
    dispose() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    },
  };
}
