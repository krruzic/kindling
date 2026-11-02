// Team colour by material name: models carry a dedicated material ("team", "paint", "team_cloth"...) authored
// near-white; at runtime each instance gets its own copy of those materials tinted with the team colour (Grudge
// heroes and units, RUST RING's `paint` and emissive `light`). Every other material stays shared. dyeColor() is
// Grudge's slightly desaturated, darker take on a UI team colour, so dyed cloth doesn't glow next to painted art.
import * as THREE from "three";

export interface DyeOptions {
  /** Which material names are dyed (default /^team/i). */
  match?: RegExp | ((name: string) => boolean);
  /** "replace" sets the colour; "multiply" multiplies the authored colour (keeps baked shading in it). */
  mode?: "replace" | "multiply";
  /** Also set emissive to the colour times this (lights, glowing trims). */
  emissive?: number;
  /** Colour adjustment before applying (e.g. dyeColor). */
  adjust?: (c: THREE.Color) => THREE.Color;
}

type Colored = THREE.Material & { color?: THREE.Color; emissive?: THREE.Color; emissiveIntensity?: number };

/**
 * Dyes every matching material under root with `color`, cloning each source material once per call (instances
 * never share dyed materials). Returns the dyed copies (recolour later with recolor()).
 */
export function dyeTeam(root: THREE.Object3D, color: THREE.ColorRepresentation, o: DyeOptions = {}): THREE.Material[] {
  const match = o.match ?? /^team/i;
  const test = typeof match === "function" ? match : (n: string) => match.test(n);
  const c = new THREE.Color(color);
  const col = o.adjust ? o.adjust(c.clone()) : c;
  const copies = new Map<THREE.Material, THREE.Material>();
  const conv = (m: THREE.Material): THREE.Material => {
    if (!test(m.name)) return m;
    let d = copies.get(m);
    if (!d) {
      d = m.clone();
      d.userData.dyeBase = ((m as Colored).color ?? new THREE.Color(1, 1, 1)).clone();
      paint(d as Colored, col, o);
      copies.set(m, d);
    }
    return d;
  };
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh && !(obj as THREE.Points).isPoints) return;
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(conv) : conv(mesh.material);
  });
  return [...copies.values()];
}

function paint(m: Colored, col: THREE.Color, o: DyeOptions): void {
  if (m.color) {
    if (o.mode === "multiply") m.color.copy(m.userData.dyeBase as THREE.Color).multiply(col);
    else m.color.copy(col);
  }
  if (o.emissive !== undefined && m.emissive) {
    m.emissive.copy(col);
    m.emissiveIntensity = o.emissive;
  }
}

/** Recolours materials returned by dyeTeam (a player switching team, a flash). */
export function recolor(mats: readonly THREE.Material[], color: THREE.ColorRepresentation, o: DyeOptions = {}): void {
  const c = new THREE.Color(color);
  const col = o.adjust ? o.adjust(c.clone()) : c;
  for (const m of mats) paint(m as Colored, col, o);
}

/** Grudge's dye: the team colour with saturation x0.72 and lightness x0.82. */
export function dyeColor(team: THREE.Color, sat = 0.72, light = 0.82): THREE.Color {
  const hsl = { h: 0, s: 0, l: 0 };
  team.getHSL(hsl);
  return new THREE.Color().setHSL(hsl.h, hsl.s * sat, hsl.l * light);
}
