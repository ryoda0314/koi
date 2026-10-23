/* Photos are shrunk in the browser before upload: a 1600px picture and a 480px thumbnail, both JPEG.
   Re-encoding also drops the location and camera data that phones put in the original file. */

const FULL = 1600, THUMB = 480;

async function decode(file) {
  if (window.createImageBitmap) {
    try { return await createImageBitmap(file, { imageOrientation: "from-image" }); } catch (e) { /* fall through */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function encode(src, max, quality) {
  const w = src.width, h = src.height;
  const k = Math.min(1, max / Math.max(w, h));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w * k));
  c.height = Math.max(1, Math.round(h * k));
  c.getContext("2d").drawImage(src, 0, 0, c.width, c.height);
  return new Promise((res, rej) => c.toBlob(b => (b ? res({ blob: b, w: c.width, h: c.height }) : rej(new Error("encode"))), "image/jpeg", quality));
}

/* -> { full: Blob, thumb: Blob, w, h }; throws { code: "unsupported" } for files the browser cannot read (e.g. HEIC on a PC) */
export async function prepare(file) {
  let src;
  try { src = await decode(file); } catch (e) { throw { code: "unsupported" }; }
  const full = await encode(src, FULL, 0.82);
  const thumb = await encode(src, THUMB, 0.75);
  if (src.close) src.close();
  return { full: full.blob, thumb: thumb.blob, w: full.w, h: full.h };
}

export const fullName = id => id + ".jpg";
export const thumbName = id => id + "_t.jpg";
