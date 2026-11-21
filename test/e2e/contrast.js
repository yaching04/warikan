// WCAG 2.x のコントラスト比。E2E と test/visual/contrast.js で使う。
/* WCAG のコントラスト比（#hex と rgb() のどちらでも） */
const contrast = (fg, bg) => {
  const toRgb = (c) => {
    const s = String(c).trim();
    const hx = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (hx) {
      let h = hx[1];
      if (h.length === 3) h = h.split('').map((x) => x + x).join('');
      return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
    }
    const m = s.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
    return null;
  };
  const lum = (c) => {
    const rgb = toRgb(c);
    if (!rgb) return 0;
    const [r, g, b] = rgb.map((v) => {
      const x = v / 255;
      return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const a = lum(fg), b = lum(bg);
  const hi = Math.max(a, b), lo = Math.min(a, b);
  return (hi + 0.05) / (lo + 0.05);
};

module.exports = { contrast };
