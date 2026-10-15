#!/usr/bin/env node
// blizzard_diffuse - apply the Blizzard/WoW-style stylized diffuse (TexTools "Paint Base")
// to any Patina project, from the command line, in one shot.
//
//   node tools/blizzard/apply.mjs input/skirt.patina.json
//   node tools/blizzard/apply.mjs work/axe.patina.json --mesh assets/axe.glb --palette steel --render --export blender
//   node tools/blizzard/apply.mjs input/skirt.patina.json --params '{"cavity":0.9,"edge_blur":16}'
//
// It is idempotent: re-running replaces the previous "blizzard" layer instead of stacking.
// Every step is a `patina call <command> <json>` (the same JSON the MCP tools take).

import { spawnSync } from "node:child_process";
import { readFileSync, existsSync, mkdirSync, copyFileSync } from "node:fs";
import { dirname, join, resolve, basename, relative } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

// CLI-friendly failures: one clean line instead of a Node stack trace.
process.on("uncaughtException", (err) => {
  process.stderr.write(`blizzard: ${err.message}\n`);
  process.exit(1);
});

// Parse JSON defensively: every external input (a file, patina's stdout, a CLI flag) can be malformed.
const parseJson = (text, what) => {
  try {
    return JSON.parse(text);
  } catch (err) {
    console.error(`could not parse ${what}: ${err.message}`);
    const preview = String(text).slice(0, 200).replace(/\s+/g, " ");
    if (preview) console.error(`  starts with: ${preview}`);
    process.exit(1);
  }
};

let RECIPE;
try {
  RECIPE = parseJson(readFileSync(join(HERE, "recipe.json"), "utf8"), "recipe.json");
} catch (err) {
  console.error(`could not read ${join(HERE, "recipe.json")}: ${err.message}`);
  process.exit(1);
}

const args = process.argv.slice(2);
const project = args.find((a) => !a.startsWith("--"));
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
};
const bool = (name) => args.includes(`--${name}`);

if (!project) {
  process.stderr.write(`usage: apply.mjs <project.patina.json> [--mesh m] [--high hp.glb]
                    [--palette ${Object.keys(RECIPE.palettes).join("|")}]
                    [--params '<json>'] [--set <texture_set>] [--render] [--export <preset>]
                    [--binary <patina>] [--no-bake] [--keep-library]`);
  process.exit(1);
}

const bin =
  flag("binary") ||
  process.env.PATINA_BIN ||
  (existsSync(resolve("build/patina")) ? resolve("build/patina") : "patina");

const call = (command, payload) => {
  const r = spawnSync(bin, ["call", command, JSON.stringify(payload)], { encoding: "utf8" });
  if (r.status !== 0) {
    throw new Error(`${command} failed (${r.status}):\n${r.stderr || r.stdout}`);
  }
  const parsed = parseJson(r.stdout, `output of \`patina call ${command}\``);
  // MCP-shaped results wrap the payload in content[].text; `patina call` prints it directly.
  const inner = parsed?.content?.[0]?.text;
  return inner ? parseJson(inner, `result text of \`patina call ${command}\``) : parsed;
};

const log = (msg) => process.stdout.write(`• ${msg}\n`);
const warn = (msg) => process.stderr.write(`  warning: ${msg}\n`);

// resolve the look before touching anything, so a bad flag fails before a bake
const paletteName = flag("palette") || RECIPE.default_palette || "lavender";
const palette = RECIPE.palettes[paletteName];
if (!palette) throw new Error(`unknown palette "${paletteName}" (have: ${Object.keys(RECIPE.palettes).join(", ")})`);
const overrides = flag("params") ? parseJson(flag("params"), "--params json") : null;
const params = overrides ? { ...palette, ...overrides } : { ...palette };

// 1. make sure the project exists
let proj = resolve(project);
if (!existsSync(proj)) {
  const mesh = flag("mesh");
  if (!mesh) throw new Error(`${proj} does not exist - pass --mesh <glb|gltf|obj> to create it`);
  log(`new project from ${mesh}`);
  call("new", { project: proj, mesh, name: basename(proj).replace(/\.patina\.json$/, "") });
}

// 2. install the smart material into <project dir>/library/ (Patina's project library)
const libDir = join(dirname(proj), "library");
const libDst = join(libDir, basename(RECIPE.library_file));
if (!bool("keep-library")) {
  mkdirSync(libDir, { recursive: true });
  const src = join(HERE, RECIPE.library_file);
  if (!existsSync(libDst) || readFileSync(libDst).toString() !== readFileSync(src).toString()) {
    copyFileSync(src, libDst);
    log(`library -> ${libDst}`);
  } else {
    log("library already up to date");
  }
}

// 2b. optional high poly. Two things come off the dense mesh: the AO (which feeds the cavity term,
// by far the biggest albedo channel a high poly owns) and the baked-normal divergence that
// bake.normal.curvature folds into the curvature map (which feeds the crease + edge terms).
// The default curvature: 1 leaves ~8/255 of the curvature field owned by the dense mesh on
// input/sailor.glb; curvature 4 + curvature_gain 2 takes it to ~39/255 without the albedo turning
// into dirt - beyond that the crease term reads as grime (see input/ab_highpoly/README.md).
const HP_BAKE = { curvature: 4, curvature_gain: 2 };
const HP_PARAMS = { crease: 0.55, crease_lo: 0.55, crease_hi: 0.85 };
if (flag("high")) {
  const high = resolve(flag("high"));
  if (!existsSync(high)) throw new Error(`--high mesh not found: ${high}`);
  const rel = relative(dirname(proj), high).split("\\").join("/");
  log(`bake normal/curvature/AO from high poly ${rel}`);
  call("edit", {
    project: proj,
    ops: [
      { op: "set", path: "/bake/normal", value: { high: rel, cage: 0.02, depth: 0.02, curvature: HP_BAKE.curvature } },
      { op: "set", path: "/bake/curvature_gain", value: HP_BAKE.curvature_gain },
    ],
  });
  for (const [k, v] of Object.entries(HP_PARAMS)) if (!(k in (overrides || {}))) params[k] = v;
  log(`high-poly preset: bake.normal.curvature ${HP_BAKE.curvature}, curvature_gain ${HP_BAKE.curvature_gain}, crease ${params.crease}`);
}

// 3. mesh maps: the cavity + curvature terms are baked maps
if (!bool("no-bake")) {
  log("bake ao/curvature/thickness (cached if already baked)");
  const baked = call("bake", { project: proj });
  if (baked.stats) log(`baked in ${Math.round(baked.stats.total_ms)} ms (from_cache: ${baked.stats.from_cache})`);
}

// 4. resolve which texture sets to touch
const current = call("get", { project: proj, outline: true });
// The outline labels the section, e.g. "texture_sets (layers bottom -> top)".
const setsKey = Object.keys(current).find((k) => k.startsWith("texture_sets"));
const setsObj = setsKey ? current[setsKey] : null;
const sets = flag("set") ? [flag("set")] : Object.keys(setsObj || {});
if (!sets.length) throw new Error(`no texture sets found in the project (get returned: ${Object.keys(current).join(", ")})`);

// 5. build the ops: replace an existing blizzard layer, then add one per texture set
const ops = [];
for (const set of sets) {
  const layers = setsObj?.[set] || [];
  if (layers.some((l) => String(l).startsWith(`${RECIPE.layer_id} `))) ops.push({ op: "remove", id: RECIPE.layer_id });
}
for (const set of sets) {
  ops.push({
    op: "add",
    set,
    layer: { id: RECIPE.layer_id, type: "smart", material: RECIPE.material, params },
  });
}
log(`apply ${RECIPE.material} [${paletteName}] -> ${sets.join(", ")}`);
const edit = call("edit", { project: proj, ops });
for (const w of edit.warnings || []) warn(w);

// 6. verify
const check = call("validate", { project: proj });
log(`validate: ${check.errors?.length || 0} errors, ${check.warnings?.length || 0} warnings`);
if (check.errors?.length) {
  process.stderr.write(`blizzard: validate failed\n${check.errors.join("\n")}\n`);
  process.exit(1);
}

// 7. optional renders: lit (final look) + basecolor sheet (the flat Blizzard diffuse map)
if (bool("render")) {
  const stem = basename(proj).replace(/\.patina\.json$/, "");
  const dir = join(dirname(proj), "renders");
  for (const [mode, suffix, extra] of [
    ["lit", "blizzard_lit", { views: "front,iso,back", size: 512 }],
    ["basecolor", "blizzard_diffuse", { sheet: true }],
  ]) {
    const out = join(dir, `${stem}_${suffix}.png`);
    call("render", { project: proj, mode, out, return_image: false, ...extra });
    log(`render ${mode} -> ${out}`);
  }
}

// 8. optional export
if (flag("export")) {
  const ex = call("export", { project: proj, preset: flag("export") });
  log(`export (${flag("export")}) -> ${ex.dir || ex.out || "see manifest.json"}`);
}

process.stdout.write(`\n${proj}  texture sets: ${sets.join(", ")}\n`);
process.stdout.write(`params: ${JSON.stringify(params)}\n`);
