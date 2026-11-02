// Wrappers for the fal models the pipeline uses: Nano Banana (Pro) image generation and editing (sheets of many
// icons at once, turnarounds, a reference image for style), Tripo image-to-3D (face budget, textured), and
// ElevenLabs sound effects. Each returns URLs plus the raw response; save() helpers download next to a meta.json
// recording the exact input (prompt, seed, model, request id) so any output can be traced and regenerated.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { asUrl, type FalClient, type FalResult } from "./fal.ts";

export interface ImageGenInput {
  prompt: string;
  /** Reference images (paths, URLs or data URIs): switches to the /edit endpoint. */
  images?: string[];
  aspect?: string;
  resolution?: "1K" | "2K" | "4K";
  format?: "png" | "jpeg" | "webp";
  seed?: number;
  /** "pro" (default) or "flash" (cheaper nano-banana). */
  tier?: "pro" | "flash";
  label?: string;
}

export interface ImageGenOutput {
  urls: string[];
  description?: string;
  input: Record<string, unknown>;
  result: FalResult<Record<string, unknown>>;
}

export function nanoBananaModel(tier: "pro" | "flash" = "pro", edit = false): string {
  return `fal-ai/nano-banana${tier === "pro" ? "-pro" : ""}${edit ? "/edit" : ""}`;
}

export async function nanoBanana(fal: FalClient, i: ImageGenInput): Promise<ImageGenOutput> {
  const edit = !!i.images?.length;
  const model = nanoBananaModel(i.tier, edit);
  const input: Record<string, unknown> = {
    prompt: i.prompt,
    aspect_ratio: i.aspect ?? "1:1",
    output_format: i.format ?? "png",
  };
  if (i.tier !== "flash") input.resolution = i.resolution ?? "2K";
  if (edit) input.image_urls = i.images!.map(asUrl);
  if (i.seed !== undefined) input.seed = i.seed;
  const result = await fal.run<Record<string, unknown>>(model, input, i.label);
  const imgs = (result.data.images as { url: string }[] | undefined) ?? [];
  return { urls: imgs.map((x) => x.url), description: result.data.description as string | undefined, input, result };
}

export interface MeshGenInput {
  /** Front image (path, URL or data URI). */
  image: string;
  /** Face budget (Grudge: 900-15000). */
  faces?: number;
  texture?: boolean;
  pbr?: boolean;
  seed?: number;
  textureSeed?: number;
  model?: string;
  label?: string;
}

export interface MeshGenOutput {
  glb: string | null;
  preview: string | null;
  input: Record<string, unknown>;
  result: FalResult<Record<string, unknown>>;
}

export async function tripoImageTo3d(fal: FalClient, i: MeshGenInput): Promise<MeshGenOutput> {
  const model = i.model ?? "tripo3d/p1/image-to-3d";
  const input: Record<string, unknown> = {
    image_url: asUrl(i.image),
    face_limit: i.faces ?? 1500,
    texture: i.texture ?? true,
  };
  if (!model.includes("/p1/")) input.pbr = i.pbr ?? false;
  if (i.seed !== undefined) input.model_seed = i.seed;
  if (i.textureSeed !== undefined) input.texture_seed = i.textureSeed;
  const result = await fal.run<Record<string, unknown>>(model, input, i.label);
  const d = result.data as {
    model_mesh?: { url: string };
    model_urls?: { glb?: { url: string }; pbr_model?: { url: string } };
    rendered_image?: { url: string };
  };
  const glb = d.model_mesh?.url ?? d.model_urls?.glb?.url ?? d.model_urls?.pbr_model?.url ?? null;
  return { glb, preview: d.rendered_image?.url ?? null, input, result };
}

export interface SfxInput {
  text: string;
  seconds?: number;
  /** 0..1: how literally to follow the prompt. */
  influence?: number;
  label?: string;
}

export async function elevenSfx(fal: FalClient, i: SfxInput) {
  const model = "fal-ai/elevenlabs/sound-effects/v2";
  const input: Record<string, unknown> = { text: i.text, prompt_influence: i.influence ?? 0.5 };
  if (i.seconds !== undefined) input.duration_seconds = i.seconds;
  const result = await fal.run<{ audio?: { url: string } }>(model, input, i.label);
  return { url: result.data.audio?.url ?? null, input, result };
}

/**
 * Downloads `urls` into `dir` as `${name}${suffix}` (suffix per index, e.g. "", ".1") and writes `${name}.meta.json`
 * with the model, input (data URIs elided) and request id. Raw outputs are kept: slicing re-runs from them.
 */
export async function saveOutputs(
  fal: FalClient,
  dir: string,
  name: string,
  ext: string,
  urls: string[],
  result: FalResult<unknown>,
  input: Record<string, unknown>,
  extra: Record<string, unknown> = {},
): Promise<string[]> {
  mkdirSync(dir, { recursive: true });
  const files: string[] = [];
  for (let k = 0; k < urls.length; k++)
    files.push(await fal.download(urls[k], join(dir, `${name}${k ? `.${k}` : ""}.${ext}`)));
  const elide = (v: unknown): unknown =>
    typeof v === "string" && v.startsWith("data:")
      ? `${v.slice(0, 32)}...(${v.length} chars)`
      : Array.isArray(v)
        ? v.map(elide)
        : v;
  const meta = {
    model: result.model,
    requestId: result.requestId,
    cost: result.cost,
    input: Object.fromEntries(Object.entries(input).map(([k, v]) => [k, elide(v)])),
    files: files.map((f) => f.split("/").pop()),
    created: new Date().toISOString(),
    ...extra,
  };
  writeFileSync(join(dir, `${name}.meta.json`), JSON.stringify(meta, null, 2));
  return files;
}
