// Local fonts — registered once at app boot so the Generate canvas can
// use them without falling back to Times on the first draw.
//
// Two-step setup per face:
//   1. Inject an @font-face rule via a single <style> tag so HTML/CSS
//      consumers can reference the family by name.
//   2. Preload the font via the FontFace API so the browser actually
//      fetches the bytes immediately (CSS @font-face is lazy by default).
//      Canvas text rendering reads from document.fonts, so without a
//      forced load the first paint of a Custom-template post would
//      render in Times before snapping to Gotham one frame later.
//
// Font catalogue:
//   - Gotham Bold       — clean modern grotesque, paired well with sports
//   - Press Gothic      — display tabloid-headline face; great for hype
//   - United Sans Bold  — geometric sans (Hoefler), heavy display weight
//
// Canvas-friendly slot keys (used by FONT_MAP in template-config.js):
//   `gotham`, `press`, `united`

export const LOCAL_FONTS = [
  {
    family: 'Gotham',
    weight: 700,
    style: 'normal',
    src: '/fonts/Gotham-Bold.ttf',
    format: 'truetype',
  },
  {
    family: 'Press Gothic',
    weight: 400,
    style: 'normal',
    src: '/fonts/PressGothic.otf',
    format: 'opentype',
  },
  {
    family: 'United Sans',
    weight: 700,
    style: 'normal',
    src: '/fonts/UnitedSans-Bold.otf',
    format: 'opentype',
  },
  // v4.5.37: Winner Sans — heavy condensed display face used by the
  // optional "Headline" treatment on Blank Slate / Highlight / Stat
  // Leader templates. Drop the bold weight at /public/fonts/
  // WinnerSans-Bold.otf; loader logs a warning and falls back to
  // Bebas Neue if the file isn't there yet, so the canvas still
  // renders cleanly during the soft rollout.
  {
    family: 'Winner Sans',
    weight: 700,
    style: 'normal',
    src: '/fonts/WinnerSans-Bold.otf',
    format: 'opentype',
  },
];

let _registered = false;
let _readyPromise = null;

// Register all local fonts. Idempotent — safe to call multiple times,
// only writes the <style> tag and forces preload on the first call.
// Returns a Promise that resolves once all faces are in document.fonts
// so callers (e.g. the Generate canvas) can `await` before drawing.
export function registerLocalFonts() {
  if (typeof document === 'undefined') return Promise.resolve();
  if (_registered) return _readyPromise;

  // 1. Inject the @font-face CSS rules so anything CSS-rendered (HTML
  //    text, the per-field font preview, the labels in the field-edit
  //    UI) picks them up.
  const css = LOCAL_FONTS.map(f => `
    @font-face {
      font-family: '${f.family}';
      src: url('${f.src}') format('${f.format}');
      font-weight: ${f.weight};
      font-style: ${f.style};
      font-display: block;
    }
  `).join('\n');
  const style = document.createElement('style');
  style.setAttribute('data-blw-local-fonts', '');
  style.textContent = css;
  document.head.appendChild(style);

  // 2. Force the actual byte fetch via the FontFace API. document.fonts
  //    only loads a face the first time some element requests a glyph
  //    in that family — but the canvas doesn't trigger that load, so
  //    the first draw lands in fallback. Loading explicitly here puts
  //    the FontFace into document.fonts so canvas can render correctly.
  if (typeof FontFace === 'function' && document.fonts?.add) {
    const promises = LOCAL_FONTS.map(async (f) => {
      try {
        const face = new FontFace(f.family, `url(${f.src}) format('${f.format}')`, {
          weight: String(f.weight),
          style: f.style,
          display: 'block',
        });
        const loaded = await face.load();
        document.fonts.add(loaded);
        return loaded;
      } catch (err) {
        console.warn(`[local-fonts] failed to load ${f.family}`, err?.message);
        return null;
      }
    });
    _readyPromise = Promise.all(promises).then(() => undefined);
  } else {
    _readyPromise = Promise.resolve();
  }

  _registered = true;
  return _readyPromise;
}

// Wait until every local font is in document.fonts. The Generate canvas
// awaits this before drawing so it never has to ship a fallback frame.
export function localFontsReady() {
  if (!_registered) return registerLocalFonts();
  return _readyPromise || Promise.resolve();
}
