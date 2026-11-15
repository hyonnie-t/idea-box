// 사진 줄이기: 폰 사진(수 MB)을 올리기 전에 기기에서 JPEG로 줄인다.
// b 큰 그림(긴 변 1280px, 보통 150~300KB) · s 작은 그림(긴 변 320px, 보통 10~20KB). 둘 다 data URL.
export const MAX_PICS = 4;
const BIG = 1280, SMALL = 320;

async function decode(file) {
  // createImageBitmap은 사진 방향(EXIF)을 맞춰 준다. 안 되는 브라우저는 <img>로.
  if ('createImageBitmap' in window) {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) { /* 아래로 */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
}

function draw(src, max, q) {
  const w0 = src.width, h0 = src.height;
  const r = Math.min(1, max / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * r)), h = Math.max(1, Math.round(h0 * r));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; // 투명한 PNG·스크린숏이 JPEG에서 까맣게 되지 않게
  g.fillRect(0, 0, w, h);
  g.drawImage(src, 0, 0, w, h);
  return c.toDataURL('image/jpeg', q);
}

export async function shrink(file) {
  if (!file || !/^image\//.test(file.type || 'image/')) throw new Error('not image');
  const src = await decode(file);
  try {
    return { b: draw(src, BIG, 0.72), s: draw(src, SMALL, 0.6) };
  } finally { src.close?.(); }
}

export const newPicKey = () => 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
