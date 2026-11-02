# @kindling/ui

The canvas UI layer: one 2D canvas over the game view with a virtual resolution, bitmap / canvas fonts that measure
before they draw, themed panels (nine-slice art or procedural plates), layout helpers with a debug overlay that
flags overflow and overlap, and the components every couch game needs: menu lists, options pages, prompt footers,
dialogs, name entry, cards, callouts, a screen stack and split-screen view layout.

## Why

See [docs/LESSONS.md](../../docs/LESSONS.md), sections **UI** and **Balance and testing**:

- Game UI is drawn on canvas with the game's own art (bitmap font, 9-slice panels, painted icons); generic boxes
  and system fonts read as "vibe-coded". Themes carry the art; components never hard-code a look.
- Measure every string before drawing; shrink or wrap within the card; never overflow; cards grow to content.
  `text.ts` guarantees it (every returned line fits) and `LayoutDebug` outlines anything that still escapes.
- Most UI bugs we shipped were visible in a screenshot nobody looked at (overlapping panels, text past a card, the
  footer covered). The debug overlay makes them red.
- Selection cursors point AT the thing they select. Footer prompts show the right glyph per device.
- Memoise panels (redraw only when their key changes): a third of HUD CPU in 4-player split.

## API

| Module                                                           | What                                                                                                                                                                                                                                                                                                                                                                               |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `UiCanvas`, `computeUiMetrics`                                   | The overlay canvas. `{ kind: "height", height: 240 }` (Grudge: fixed logical height, width follows aspect, native-resolution backing store capped at `maxPx`) or `{ kind: "pixel", width: 480, height: 270 }` (QUICKLORE: largest integer scale, centred `stage`, no smoothing). `begin()` refits to the element size and DPR every frame and returns the context in layout units. |
| `Font`, `AtlasFont`, `CanvasFont`                                | `measure(s, size)`, `lineHeight(size)`, `draw(ctx, s, x, y, size, style)`. AtlasFont: PNG + metrics JSON, fill in R and dilated outline in G, tinted per colour, baked per device size (LRU), pixel faces at whole multiples. CanvasFont: a CSS family fallback. Styles: colour, outline, drop shadow, bevel.                                                                      |
| `text.ts`                                                        | Pure, take any `Measure`: `wrap`, `breakWord`, `shrinkToFit`, `ellipsize`, `fitLine`, `fitBlock` (shrink then truncate; `h = Infinity` for auto height).                                                                                                                                                                                                                           |
| `drawText`, `drawTextFit`, `drawParagraph`; `label`, `paragraph` | Draw through a font; the themed versions take a `Ui`, fit into a rect and report to the debugger.                                                                                                                                                                                                                                                                                  |
| `layout.ts`                                                      | `Rect`, `inset`, `stack`, `row`, `grid`, `splitX/Y`, `anchor`, `contains`, `overlapArea`, `fits`, `safeArea(W, H, aspect)` + `ASPECTS` (16:9 / 16:10 / 4:3).                                                                                                                                                                                                                       |
| `LayoutDebug`                                                    | `begin(ctx, screen)`, `box(id, rect, { bounds, group })`, `content(...)`, `end()` -> issues (`overflow`, `overlap` within a group, `offscreen`), `draw(ctx)` red dashed outlines; `strict` throws. Rects are compared through the context transform.                                                                                                                               |
| `Theme`, `Ui`, `panel`, `withPanels`                             | Fonts, colours, metrics, text styles, panel painters by role (`backdrop`, `window`, `card`, `row`, `inset`, `header`, `button`, `banner`, `dialog`, `field`, `key`, `track`, `knob`), `cursor` (tip at x, y, pointing at the selection), optional `glyph` / `title` painters. Panel styles are plugins: `withPanels(theme, { myRole })`.                                           |
| `drawNine`, `SpriteAtlas`                                        | Nine-slice from an image (stretch, or tile for pixel art, at an integer scale); a sprite sheet JSON of rects / nine-slices.                                                                                                                                                                                                                                                        |
| `PlateCache`, `cacheCanvas`                                      | Bake expensive procedural plates once per size and device scale.                                                                                                                                                                                                                                                                                                                   |
| `Memo`                                                           | `draw(ctx, id, key, x, y, w, h, paint)`: repaint only on key / transform / `extraKey()` change; `invalidate`, `tick` frees idle panels.                                                                                                                                                                                                                                            |
| `Nav`, `KeyRepeat`, `NavRepeater`, `HitList`                     | One frame of menu input (steps + button edges) with key repeat in one place; mouse targets registered while drawing.                                                                                                                                                                                                                                                               |
| `MenuList`                                                       | Items (disabled skipped, wrap / clamp, scrolling with arrows, value column), cursor pointing at the item, `update(nav, ptr)` -> `move` / `select` / `back`, sound callback.                                                                                                                                                                                                        |
| `OptionsPage`, `OptionRow`, `adjustRow`                          | Rows: `slider`, `toggle`, `choice`, `keybind` (shows the game-provided `Glyph`, "PRESS A BUTTON" while listening), `action` (danger). get / set callbacks keep the save format the game's.                                                                                                                                                                                         |
| `drawPromptBar`, `drawPrompts`, `promptWidth`, `drawGlyph`       | Footer rows of `{ glyph: Glyph, label }`. `Glyph = { label, family, color? }` comes from the game's input layer; the default painter draws keycaps (keyboard), discs / pills (pads) and PlayStation symbols as shapes. Shrinks to fit its rect.                                                                                                                                    |
| `Dialog`                                                         | Title + wrapped body (auto height) + choices; `initial` lets the safe choice be the default.                                                                                                                                                                                                                                                                                       |
| `NameEntry`                                                      | Letter grid + SPACE / DEL / DONE, slot underlines, `type()` / `backspace()` for keyboards, B deletes before cancelling.                                                                                                                                                                                                                                                            |
| `cardLayout`, `cardHeight`, `drawCard`                           | Icon + eyebrow + title + body + footer; grows to content, `maxH` caps (body shrinks / truncates), `minH` for equal-height grids (footers stay on the bottom edge).                                                                                                                                                                                                                 |
| `Callouts`, `slam`                                               | Banner / big-word queue with lanes; slam-in (scale overshoot + shake), hold, fade.                                                                                                                                                                                                                                                                                                 |
| `ScreenManager`, `Screen`                                        | Stack with `push` / `pop` / `replace` / `popTo` / `reset`; fade / slide / none transitions; input only to the settled top; overlays (`opaque: false`) draw over the screen below.                                                                                                                                                                                                  |
| `layoutViews`, `splitViews`, `seams`, `drawSeams`                | 1-4 views: fixed pixel views at the largest integer scale (side by side or stacked, spare quadrant for 3), or screen-filling splits with gaps; the seams between them as a framed border.                                                                                                                                                                                          |

Themes (subpath exports):

- `@kindling/ui/themes/wood`: `woodTheme({ font, titleFont, textures? })`, Grudge's parchment cards on a wooden
  board, beams with nails, cloth ribbons, wax seals, gold arrow cursor. Textures default to procedural ones
  (`themes/procedural.ts`); pass the game's own images to reskin. For a 240-unit tall UI.
- `@kindling/ui/themes/pixel`: `pixelTheme({ font, atlas })`, QUICKLORE's pixel frames from a GUI sprite sheet
  (entries listed in the file), pixel font, play-arrow cursor. For a 480 x 270 pixel UI.

## Usage

```ts
import { AtlasFont, LayoutDebug, MenuList, NavRepeater, UiCanvas, drawPromptBar, panel, type Ui } from "@kindling/ui";
import { woodTheme } from "@kindling/ui/themes/wood";

const font = await AtlasFont.load("/ui/font.png", "/ui/font.json");
const theme = woodTheme({ font });
const canvas = new UiCanvas({ kind: "height", height: 240 }, document.body);
const menu = new MenuList(
  [
    { id: "play", label: "PLAY" },
    { id: "quit", label: "QUIT" },
  ],
  { sound: (k) => audio.ui(k) },
);
const repeat = new NavRepeater();
const debug = new LayoutDebug();

function frame(dt: number, now: number) {
  const ctx = canvas.begin();
  const ui: Ui = { ctx, theme, time: now, debug: import.meta.env.DEV ? debug : null };
  debug.begin(ctx, { x: 0, y: 0, w: canvas.w, h: canvas.h });
  const ev = menu.update(repeat.update(input.held(), dt)); // input: the game's merged devices
  if (ev?.type === "select") start(ev.item.id);
  panel(ui, "backdrop", { x: 0, y: 0, w: canvas.w, h: canvas.h });
  menu.draw(ui, { x: 20, y: 40, w: 150, h: 120 });
  drawPromptBar(ui, [{ glyph: input.glyph("a"), label: "SELECT" }], { x: 0, y: canvas.h - 16, w: canvas.w, h: 14 });
  if (debug.end().length) debug.draw(ctx);
}
```

## Demo

`pnpm --filter @kindling/ui demo` (or `vite packages/ui/demo`). Every component in both themes:
`?theme=wood|pixel&scene=menu|options|cards|name|dialog|split|debug&pad=keyboard|xbox|playstation|gamecube&debug=1`.
Keys: arrows / Enter / Esc, Q / E scene, T theme, P prompt device, G debugger, 1-4 split views. The demo's atlas
font (Barlow Semi Condensed Bold, OFL), pixel font and GUI sheet are generated by `demo/tools/make_assets.py`; the
title face is Pirata One (OFL). Licences are in `demo/assets/fonts/`.

## In Grudge

Grudge's `src/ui` is where this came from: `hud/canvas.ts` (UiCanvas, 240-unit UI), `font.ts` (the atlas game
font with outline / shadow bakes and the animated-text bake budget), `uiPaint.ts` (parchment, beams, ribbons,
seals, baked plates), `hud/memo.ts`, `prompts.ts` (glyph rows + wrap), `menus.ts` + `menus/*` (pages, settings
rows with arrows, hit lists), `screens.ts`, `nameEntry.ts`, `hud/callouts.ts` (banners and big words). QUICKLORE
contributed the pixel style (`ui/gui.ts` boxes and nine-slice frames, integer-scaled stage) and the split-screen
`layoutViews` / `drawSeams` from its renderer.
