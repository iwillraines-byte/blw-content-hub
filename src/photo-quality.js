// Photo quality heuristics — flag images that would benefit from
// running through Topaz / a desktop cleanup tool before they ship.
//
// We compute two cheap signals client-side, no AI service needed:
//
//   1. Resolution check — if the long edge is under
//      RESOLUTION_THRESHOLD_PX (default 1500), the photo will be
//      upscaled at export time and is likely to show artifacts.
//
//   2. Blur detection — variance of the Laplacian on a downsampled
//      grayscale version of the image. Low variance = soft/blurry.
//      Threshold tuned conservatively so the badge surfaces on
//      genuinely out-of-focus shots, not on legitimately bokeh-heavy
//      portrait shots.
//
// Score interpretation:
//   { needsPolish: bool, reasons: [], width, height, blurScore }
//
// The badge UI uses `needsPolish` + the `reasons` list. The blurScore
// is exposed so the chip tooltip can show the actual number for power
// users who want to reason about it.
//
// Cost: ~5-10ms per image at the 256px downsample size. Designed to
// run lazily — call once per record on first surface, cache the
// result on the record so subsequent renders don't re-compute.

// Long edge below this triggers a resolution warning. The portrait
// export is 1080×1350; anything below 1500px on the long edge will
// be upscaled and will show artifacts where the upscaler had to
// invent detail.
const RESOLUTION_THRESHOLD_PX = 1500;

// Variance of Laplacian below this triggers a blur warning. Calibrated
// from a small sample of BLW media — sharp action shots score 200-1500,
// well-focused portraits 150-800, soft/grainy/out-of-focus 20-80.
// Default 80 catches the soft cases without flagging legitimately
// shallow-depth-of-field photos.
const BLUR_THRESHOLD = 80;

// Downsample target for the blur analysis. Doesn't need to be high res —
// the kernel response scales with edge density, and Laplacian variance
// is a measure of frequency content. 256px gives a stable signal in
// ~5ms vs 50ms+ at full resolution.
const ANALYSIS_TARGET_PX = 256;

// Compute the variance of the Laplacian (Δ²) over a grayscale image.
// Returns a single scalar — higher = more edge content = sharper.
// Uses the standard 3×3 Laplacian kernel:
//     0  1  0
//     1 -4  1
//     0  1  0
function laplacianVariance(imageData) {
  const { data, width, height } = imageData;
  // Convert to grayscale and store in a Float32Array for kernel math.
  const gray = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    // ITU-R BT.601 luma coefficients — same numbers cv2's cvtColor uses.
    gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
  }

  let sum = 0;
  let sumSq = 0;
  let count = 0;
  // Run the kernel — skip the 1px border to avoid edge artifacts
  // distorting the variance.
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const lap =
        gray[i - width] + gray[i + width] +
        gray[i - 1] + gray[i + 1] -
        4 * gray[i];
      sum += lap;
      sumSq += lap * lap;
      count++;
    }
  }
  const mean = sum / count;
  const variance = (sumSq / count) - (mean * mean);
  return variance;
}

// Compute quality signals for a media Blob. Returns a plain object.
// Caller owns the blob lifecycle; we revoke our own intermediate
// object URL before resolving.
export async function analyzePhotoQuality(blob, opts = {}) {
  if (!blob || !blob.type || !blob.type.startsWith('image/')) {
    return { needsPolish: false, reasons: [], width: 0, height: 0, blurScore: null };
  }
  const resThreshold = opts.resolutionThreshold || RESOLUTION_THRESHOLD_PX;
  const blurThreshold = opts.blurThreshold || BLUR_THRESHOLD;

  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('image decode failed'));
      i.src = url;
    });

    const width = img.naturalWidth;
    const height = img.naturalHeight;
    const longEdge = Math.max(width, height);

    // Downsample for the blur analysis. We keep the aspect ratio and
    // size the long edge to ANALYSIS_TARGET_PX — the kernel response
    // is roughly scale-invariant after this normalization, so all
    // photos compare fairly regardless of input resolution.
    const scale = ANALYSIS_TARGET_PX / Math.max(longEdge, 1);
    const dw = Math.max(2, Math.round(width * scale));
    const dh = Math.max(2, Math.round(height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = dw;
    canvas.height = dh;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, dw, dh);
    let blurScore = null;
    try {
      const imageData = ctx.getImageData(0, 0, dw, dh);
      blurScore = laplacianVariance(imageData);
    } catch {
      // Canvas tainted (cross-origin source). Skip blur — we'll still
      // surface a resolution-based warning if it applies.
      blurScore = null;
    }

    const reasons = [];
    if (longEdge < resThreshold) {
      reasons.push({
        kind: 'low-res',
        message: `Low resolution: ${width}×${height}. Export upscales to 1080×1350; consider cleanup before posting.`,
      });
    }
    if (blurScore != null && blurScore < blurThreshold) {
      reasons.push({
        kind: 'blurry',
        message: `Soft / out-of-focus (blur score ${blurScore.toFixed(0)}). A pass through Topaz would help.`,
      });
    }
    return {
      needsPolish: reasons.length > 0,
      reasons,
      width,
      height,
      longEdge,
      blurScore,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Same call but lazy + memoized at the record level. Stores the
// computed result on a WeakMap keyed by the record's id so we don't
// re-analyze the same blob on every render. Returns the cached
// result synchronously if available, otherwise undefined (caller
// should set up an effect to call analyzePhotoQuality and re-render
// when it resolves).
const cache = new Map(); // id → { needsPolish, reasons, ... }

export function getCachedQuality(id) {
  if (!id) return undefined;
  return cache.get(id);
}

export async function analyzeAndCache(record) {
  if (!record || !record.id || !record.blob) return null;
  if (cache.has(record.id)) return cache.get(record.id);
  const result = await analyzePhotoQuality(record.blob);
  cache.set(record.id, result);
  return result;
}

// Public threshold constants so consumers can document them in
// tooltips without re-importing from here.
export const PHOTO_QUALITY_THRESHOLDS = Object.freeze({
  RESOLUTION_THRESHOLD_PX,
  BLUR_THRESHOLD,
  ANALYSIS_TARGET_PX,
});
