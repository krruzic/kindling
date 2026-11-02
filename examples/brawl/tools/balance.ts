// Headless balance runner over CPU matches, sharded over cores with @kindling/core's launcher.
//   pnpm balance                 write runs/balance/run.sh, start SHARDS shards detached, block once, report
//   GAMES=8 SHARDS=8 MUT="rovers.brute.mass*=0.9" pnpm balance     (A/B a data change without touching code)
//   REPORT=1 pnpm balance        only re-print the report of the last run
// A shard (SHARD/SHARDS set by the launcher) plays its share of the job list and writes one JSONL row per game.
// The report: win rate per rover (duels and free-for-alls), the duel matchup grid, match length, how rounds ended
// (credited knock-out, self-destruct, timeout draw) and what the bots did per rover (to tell a weak rover from a
// weak bot).
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyMut,
  distribution,
  envConfig,
  formatDistribution,
  formatGrid,
  formatTable,
  formatWinRates,
  matchupGrid,
  shardEnv,
  shardOf,
  tally,
  winRates,
  type GameRow,
} from "@kindling/core";
import { jsonlWriter, readJsonlAll, writeLauncher } from "@kindling/core/node";
import { playCpuMatch } from "../src/sim/headless.ts";
import { baseTuning, ROVERS, type GameEvent, type RoverId } from "../src/sim/types.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const cfg = envConfig({ GAMES: 4, SHARDS: 4, MUT: "", SKILL: 0.7, OUT: join(root, "runs/balance"), REPORT: false });

interface Job {
  mode: "duel" | "ffa";
  seed: number;
  rovers: RoverId[];
}

interface Row extends GameRow {
  mode: Job["mode"];
  seed: number;
  seconds: number;
  rounds: number;
  ends: string[];
  bots: Record<string, { attacks: number; dashes: number; slams: number; retreats: number; seconds: number }>;
}

function jobs(games: number): Job[] {
  const out: Job[] = [];
  let seed = 1000;
  for (const a of ROVERS)
    for (const b of ROVERS)
      if (a < b)
        for (let g = 0; g < games; g++) out.push({ mode: "duel", seed: seed++, rovers: g % 2 ? [b, a] : [a, b] });
  for (let g = 0; g < games * 3; g++) {
    const rovers = [0, 1, 2, 3].map((i) => ROVERS[(g * 7 + i * 5 + Math.floor(g / 3)) % ROVERS.length]);
    out.push({ mode: "ffa", seed: seed++, rovers });
  }
  return out;
}

function play(job: Job, tuning: ReturnType<typeof baseTuning>): Row {
  const ends: string[] = [];
  const onStep = (w: { events: readonly GameEvent[] }) => {
    for (const e of w.events) {
      if (e.type === "fall") ends.push(e.by >= 0 ? "ko" : "self");
      if (e.type === "roundOver" && e.winner < 0) ends.push("draw");
    }
  };
  const m = playCpuMatch({ seed: job.seed, rovers: job.rovers }, { skill: cfg.SKILL, tuning, onStep });
  const w = m.world;
  const bots: Row["bots"] = {};
  m.bots.forEach((b, i) => {
    const k = job.rovers[i];
    const acc = (bots[k] ??= { attacks: 0, dashes: 0, slams: 0, retreats: 0, seconds: 0 });
    acc.attacks += b.profile.attacks;
    acc.dashes += b.profile.dashes;
    acc.slams += b.profile.slams;
    acc.retreats += b.profile.retreats;
    acc.seconds += w.time;
  });
  return {
    mode: job.mode,
    seed: job.seed,
    sides: job.rovers.map((r) => [r]),
    winner: w.state.match.winner,
    seconds: Math.round(w.time * 10) / 10,
    rounds: w.state.match.round,
    ends,
    bots,
  };
}

function report(rows: Row[]): string {
  const out: string[] = [];
  const section = (title: string, body: string) => out.push(`== ${title}\n${body}\n`);
  for (const mode of ["duel", "ffa"] as const) {
    const rs = rows.filter((r) => r.mode === mode);
    section(`${mode} win rates (${rs.length} games)`, formatWinRates(winRates(rs)));
  }
  section("duel matchups (row beats column)", formatGrid(matchupGrid(rows.filter((r) => r.mode === "duel"))));
  section(
    "match length (s)",
    formatDistribution(
      distribution(
        rows.map((r) => r.seconds),
        8,
      ),
      "s",
    ),
  );
  const ends = rows.flatMap((r) => r.ends.map((e) => ({ e })));
  section(
    "how rovers left the ring (ko: credited to a hit, self: walked off; draw: round timed out)",
    formatTable(
      ["end", "count", "share"],
      tally(ends, (x) => x.e).map((t) => [t.key, t.count, `${(t.share * 100).toFixed(1)}%`]),
    ),
  );
  const per = new Map<string, Row["bots"][string]>();
  for (const r of rows)
    for (const [k, b] of Object.entries(r.bots)) {
      const a = per.get(k) ?? { attacks: 0, dashes: 0, slams: 0, retreats: 0, seconds: 0 };
      for (const f of ["attacks", "dashes", "slams", "retreats", "seconds"] as const) a[f] += b[f];
      per.set(k, a);
    }
  section(
    "bot behaviour per rover (per minute)",
    formatTable(
      ["rover", "attacks", "dashes", "slams", "retreat ticks"],
      [...per].map(([k, b]) => {
        const pm = (v: number) => ((v * 60) / Math.max(1, b.seconds)).toFixed(1);
        return [k, pm(b.attacks), pm(b.dashes), pm(b.slams), pm(b.retreats)];
      }),
    ),
  );
  return out.join("\n");
}

if (process.env.SHARD !== undefined) {
  const { shard, shards } = shardEnv(process.env);
  const tuning = applyMut(baseTuning(), cfg.MUT);
  const w = jsonlWriter(null);
  for (const job of shardOf(jobs(cfg.GAMES), shard, shards)) w.write(play(job, tuning));
} else {
  mkdirSync(cfg.OUT, { recursive: true });
  if (!cfg.REPORT) {
    const script = writeLauncher(join(cfg.OUT, "run.sh"), {
      name: "brawl balance",
      shards: cfg.SHARDS,
      outDir: cfg.OUT,
      cwd: root,
      env: { GAMES: cfg.GAMES, MUT: cfg.MUT, SKILL: cfg.SKILL },
      command: "node --experimental-transform-types --no-warnings tools/balance.ts",
    });
    for (const arg of ["start", "wait"]) {
      const r = spawnSync(script, [arg], { stdio: "inherit" });
      if (r.status !== 0) process.exit(r.status ?? 1);
    }
  }
  const text =
    `MUT=${JSON.stringify(cfg.MUT)} GAMES=${cfg.GAMES} SKILL=${cfg.SKILL}\n\n` + report(readJsonlAll<Row>(cfg.OUT));
  writeFileSync(join(cfg.OUT, "report.txt"), text);
  console.log(text);
}
