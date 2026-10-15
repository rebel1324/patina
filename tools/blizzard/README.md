# `blizzard_diffuse` — a standardized Paint Base / Blizzard diffuse tool

The Patina equivalent of TexTools' **"Paint Base"** shader mode: the stylized
"Blizzard diffuse" used on WoW / Dota 2 / Overwatch-era characters, plus the hand-painted
outline along the border of each UV island. It composes four things:

```text
vertical value ramp (bbox Z)   ->  {"type":"gradient","axis":"up", gradient:[bottom, mid, top]}
× cavity / crevice shadow      ->  {"type":"cavity"}              (1 - baked AO)
+ top light + convex edge light ->  {"type":"direction"} / {"type":"curvature","mode":"convex"}
+ island border outline         ->  {"type":"uv_stroke"}          (baked UV border distance)
```

Everything stays in one hue family and only the **value** changes across the silhouette:
warm and light at the top, cool and dark at the bottom, creases pulled toward a cool dark,
thin light on convex ridges. That is what makes it read as hand-painted rather than airbrushed.

## Files

| File | What it is |
| --- | --- |
| `library/blizzard.patina.json` | the smart material (Patina project library format, `${param}` templates) |
| `recipe.json` | the ops, named palettes, and the calibration notes from tuning |
| `apply.mjs` | the driver: one command to install + bake + apply + verify + render |

## Use it

```bash
# apply to an existing project (idempotent: replaces the previous "blizzard" layer)
node tools/blizzard/apply.mjs input/skirt.patina.json

# from a raw mesh, with a palette, then render + export
node tools/blizzard/apply.mjs work/axe.patina.json --mesh assets/axe.glb \
  --palette steel --render --export blender

# with a high poly: normal / curvature / AO bake off the dense mesh (best edge light)
node tools/blizzard/apply.mjs input/skirt.patina.json --high input/skirt_highpoly.glb --render

# hand-tune anything on top of a palette
node tools/blizzard/apply.mjs input/skirt.patina.json \
  --params '{"cavity":0.9,"cavity_soft":0.1,"edge_blur":16}'
```

Flags: `--mesh` (create the project if missing) · `--high <glb>` (high poly: writes
`bake.normal.high` **and** the measured high-poly preset — `bake.normal.curvature 4`,
`curvature_gain 2`, `crease 0.55 / crease_lo 0.55 / crease_hi 0.85` — unless those keys are
already in your `--params`) ·
`--palette lavender|steel|leather|blood|jade|ice|bone|pearl|slate` — default is **pearl**, the
cleanest white-grey ramp (white over grey, where value alone carves the form; `bone` is the warm
version, `slate` the highest-contrast one) ·
`--params '<json>'` · `--set <texture_set>` · `--render` · `--export <preset>` · `--no-bake` ·
`--keep-library` · `--binary <patina>` (also honours `$PATINA_BIN`).

## Outputs

- Maps: `--export maps` writes the channels **and** the baked mesh maps as PNGs into the project's
  `export.dir` (`textures/` next to the project): `{set}_basecolor.png`, `{set}_normal.png`,
  `{set}_roughness.png`, … plus `{set}_bake_ao.png`, `{set}_curvature.png`, `{set}_thickness.png`.
  Use `blender` / `gltf` / `unreal` / `unity_*` / `godot` when shipping to an engine.
- Previews: render as **multi-panel collages**, one file per question (`palettes`, `edge compare`,
  `curvature sources`), into `renders/` next to the project. Keep the count low: a comparison sheet
  beats eight single-view files, and the flat maps live in `textures/` instead.
- `input/render.sh` is that convention written down for the skirt: it bakes (cached), renders the hero
  views, a close-up pair and a diagnostics collage (curvature / island outline / edge light / bake
  misses), and with `--export` writes the maps. Flags: `--fast` (1024), `--force-bake`, `--export`.

Every step is a plain `patina call <command> <json>`, so you can copy any of them out of
`apply.mjs` and drive them from a shell or an agent:

```bash
patina call edit   '{"project":"input/skirt.patina.json","ops":[{"op":"add","set":"skirt_lp","layer":{"id":"blizzard","type":"smart","material":"blizzard_diffuse"}}]}'
patina render      input/skirt.patina.json --mode mask:blizzard/cavity   # where does the crevice shadow land?
patina render      input/skirt.patina.json --mode basecolor --sheet      # the flat Blizzard diffuse map
```

## Making the material available

`apply.mjs` copies `library/blizzard.patina.json` into `<project dir>/library/`, which is
Patina's project library. To use it everywhere without copying:

```bash
export PATINA_LIBRARY=$PWD/tools/blizzard/library
```

Then `{"type":"smart","material":"blizzard_diffuse"}` resolves in any project, and
`patina library --topic smart_materials` lists it.

## Parameters

| Param | Default | What it does |
| --- | --- | --- |
| `top` / `mid` / `bottom` | pearl ramp | the vertical ramp; `mid` is the real material color |
| `low` / `high` | 0.04 / 0.92 | bbox height (0..1) where bottom/top colors land |
| `curve` | 0.88 | gamma on the ramp; `<1` lifts the light half up the silhouette |
| `cavity` | 0.8 | strength of the crevice darkening (the AO/Paint-Base term) |
| `cavity_color` | `#3d4149` | dark pulled into creases |
| `cavity_soft` | 0.3 | upper end of the cavity window: 0.10 hairline creases → 0.5 wide soft folds (a narrow window saturates into flat plateaus with hard edges) |
| `cavity_blur` | 8 | blur on the cavity field before the window — removes the baked lattice staircase |
| `crease` / `crease_color` | 0.3 / `#454a55` | concave-crease darkening (`curvature mode:concave`): the wrinkle/fold lines a high poly actually carries. 0.5-0.6 with a high-poly bake, 0-0.2 off a low only |
| `crease_lo` / `crease_hi` | 0.3 / 0.6 | concave window. With the high-poly preset below use 0.55 / 0.85 — a wider window keeps folds soft instead of clipping them to plateaus |
| `crease_blur` / `crease_rough` | 6 / 0.15 | blur on the concave field; extra roughness **added** in creases (the layer sets `blend_modes: {roughness: "add"}`) |
| `toplight` / `toplight_color` | 0.14 / `#f8fafc` | lift on upward-facing faces |
| `edge` / `edge_color` | 0.2 / `#fff0d8` | convex edge highlight (warm, so it also reads on white-grey albedos) |
| `edge_lo` / `edge_hi` | 0.52 / 0.8 | curvature window for the edge light (`lo` up = only the sharpest ridges); with a high-poly bake you can come down to 0.45 and push `edge` to 0.45 |
| `edge_blur` | 10 | blur radius in texels at 1024 — raise to 12–20 on low-poly / sliver-heavy meshes |
| `seam` / `seam_color` | 0.5 / `#3f444d` | outline inside each UV island border (`seam: 0` turns it off) |
| `seam_width` | 0 | outline width in texels at 1024 — **0 = off**: the outline is drawn only when you set this above 0; 4-8 hand-inked, 12-20 soft rim |
| `seam_soft` | 0.5 | 0 = crisp inked line, 1 = airbrushed edge |
| `roughness` | 0.8 | matte albedo; the value ramp carries the form |
| `cavity_rough` | 0.2 | extra roughness **added** in crevices (0 to disable); the Cavity layer sets `blend_modes: {roughness: "add"}` — without it the channel *replaces* roughness with 0..0.2 and creases go mirror-smooth |

## The outline: `uv_stroke`

`uv_stroke` is an engine field (`src/eval.cpp`), backed by a new baked map: `SampleSet::uv_border`
(`src/bake.cpp`) holds the **texel distance to the nearest border of each UV island**. An edge is
interior only when two triangles agree on it in UV space *and* are welded together in 3D, so real UV
seams and islands that merely touch in the layout both stay borders — that is what keeps the outline
continuous instead of dashed. Interior triangle edges stay clean, so only the outline of a UV shell
(its seams and the mesh boundary) is drawn. The field is 1 on the border and falls to 0 `width` texels
inboard; the border raster is seeded 3 texels wide so the inboard half never breaks up.

- It costs ~38 ms at 2048² (UV+weld edge hashing, Bresenham of the border edges, a two-pass chamfer),
  and it is stored in the bake cache, so you pay it once per mesh/resolution.
- It bumped `kBakerVersion` to 7: older `.patina/bake-*.bin` caches are ignored and re-baked.
- Inspect it on the mesh with `patina render <project> --mode mask:blizzard/seam --views front`.
- Use it directly, without this material, for a stencil-style rim: a `paint`-free outline that also
  hides UV seams, or `invert` it to fade detail away from island edges.

## Getting the most out of a real high poly

Measured on `input/sailor.glb` (6 372 tris) against `sailor_highpoly.glb` (103 266 tris, wrinkled
cloth) — harness and every table in `input/ab_highpoly/README.md`.

A high poly reaches the *albedo* through two channels, and only one of them is the one people
reach for:

| channel | what it feeds | what a dense mesh actually contributes |
| --- | --- | --- |
| AO (`bake.normal.high` also moves the AO rays) | the `cavity` term | **29/255** of the AO map, 17% of texels — the largest channel by far |
| `bake.normal.curvature` (baked-normal divergence folded into curvature) | the `crease` + `edge` terms | 8/255 of the field at the default `curvature: 1`; **39/255** at `curvature: 4, curvature_gain: 2` |

With `curvature` switched off in both bakes, high-poly-vs-low-poly basecolor difference collapses
to **0.12/255**: the edge light is not the channel, cavity is. So `--high` now sets
`bake.normal.curvature 4` + `curvature_gain 2` (4x the injection; `curvature` clamps at 16) and
raises `crease` to 0.55, which turns those fold lines into painted crease shadow.

There is a ceiling, and it is a look ceiling, not an engine one — `ladder.sh` runs it:

| bake (`curvature` / `curvature_gain`) | albedo owned by the dense mesh | crease term | how it reads |
| --- | --- | --- | --- |
| 1 / 1 (old default) | 9.04/255 | 0 | clean, a little flat |
| 4 / 2 (`--high` preset) | 9.16 | 1.25 | folds |
| 8 / 2 | 10.16 | 2.52 | folds, the last rung that stays clean |
| 16 / 4 | 16.7 | 11.1 | **dirt**, not wrinkles — splotchy camouflage |

Push the injection 16x and the *usable* albedo share barely moves: the rest of that detail belongs
in the **normal map**, where it is already going (normal map differs 7.4/255 high-vs-low).

## Tuning notes (from the skirt pass)

- `metallic` is pinned to 0 and `height` untouched: this is an albedo tool, so it stays game-ready.
- Don't cross hues in the ramp. `bottom`/`top` must be value-shifts of `mid` (plus a small
  warm-up / cool-down bias). Cross-hue ramps look airbrushed.
- Roughness wants *add*, not replace. `"roughness": {"type":"cavity","range":[0,0.12]}` under the default
  `normal` blend writes 0..0.12 into the crevices: a mirror-polished fold and a posterized map (mean 0.52,
  std 0.29). With `blend_modes: {roughness: "add"}` the same layer lands at mean 0.82, std 0.03.
- Keep the cavity window wide and blurred. `[0.08, 0.14]` clips almost the whole crease region to 1.0, so
  the baked AO staircase shows up as hard triangular plateaus; `[0.05, 0.30]` + `blur 8` gives a soft ramp.
- Prefer `{"type":"curvature","mode":"convex"}` + `blur` over `edge_wear` for the edge light:
  `edge_wear`'s noise breakup turns into big cloudy patches on a clean stylized surface.
- Needs the baked maps (including `uv_border`), so run `bake` first — `apply.mjs` does it, and
  Patina caches the bake. Rebuild the binary after engine changes; a long-lived `patina mcp`
  server keeps running the old binary until it is restarted.
- Verified on `input/skirt.glb` (2244 tris, 5 UV islands, 40% slivers) with the pearl palette, baked
  from `input/skirt_highpoly.glb` (36608 tris, matched by part name): `input/skirt.patina.json`, maps
  in `input/textures/`, collages in `input/renders/`.
- A `bake.normal` block changes the curvature map even without a high poly: the baked normal is mixed
  in at `curvature` gain, which damps the low's own edge curvature. See
  `input/renders/skirt_curvature_sources.png` (low only / bevel shader / high poly).
- Watch the mesh warnings: uneven texel density makes the ramp detail inconsistent between
  UV islands, and sliver-heavy fans give razor-thin curvature ridges (hence `edge_blur`).
