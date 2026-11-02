// The save: options, player names, per-rover records, a short match log and controller remaps, in one versioned
// localStorage document (@kindling/save). Version 2 split v1's single `volume` into music / sfx / ambience and
// turned `shake` from a boolean into a level; the migration below upgrades old saves (tested in test/save.test.ts).
import {
  NameBook,
  RecordsTable,
  SaveStore,
  pushLog,
  snapToRows,
  type NameEntry,
  type OptionRow,
  type RecordEntry,
  type StorageLike,
} from "@kindling/save";
import type { RemapData } from "@kindling/input";

export interface Options {
  /** 0..10 */
  music: number;
  sfx: number;
  ambience: number;
  /** 0 off, 1 low, 2 full. */
  shake: number;
  /** Render scale percent; 0 = adaptive. */
  scale: number;
  /** Holiday cosmetics (snow in December...). */
  holidays: number;
  /** CPU level for added CPUs: 0 easy, 1 normal, 2 hard. */
  cpu: number;
}

export interface PlayerName extends NameEntry {
  wins: number;
  games: number;
}

export interface MatchLogEntry {
  at: number;
  winner: string;
  players: string[];
  seconds: number;
  online: boolean;
}

export interface SaveData {
  options: Options;
  names: Record<string, PlayerName>;
  /** Name id last used per local seat. */
  seatNames: string[];
  rovers: Record<string, RecordEntry>;
  log: MatchLogEntry[];
  pads: RemapData;
}

const levels = (n: number) => Array.from({ length: n + 1 }, (_, i) => i);

export const OPTION_ROWS: OptionRow<Options>[] = [
  { key: "music", label: "MUSIC", values: levels(10) },
  { key: "sfx", label: "SOUND", values: levels(10) },
  { key: "ambience", label: "AMBIENCE", values: levels(10) },
  { key: "shake", label: "SCREEN SHAKE", values: [0, 1, 2], fmt: (v) => ["OFF", "LOW", "FULL"][v] },
  { key: "scale", label: "RENDER SCALE", values: [0, 50, 75, 100], fmt: (v) => (v ? `${v}%` : "AUTO") },
  { key: "holidays", label: "HOLIDAY TWEAKS", values: [0, 1], fmt: (v) => (v ? "ON" : "OFF") },
  { key: "cpu", label: "CPU LEVEL", values: [0, 1, 2], fmt: (v) => ["EASY", "NORMAL", "HARD"][v] },
];

export const SAVE_KEY = "brawl.save";
export const SAVE_VERSION = 2;

export function defaults(): SaveData {
  return {
    options: { music: 6, sfx: 8, ambience: 5, shake: 2, scale: 0, holidays: 1, cpu: 1 },
    names: {},
    seatNames: [],
    rovers: {},
    log: [],
    pads: {},
  };
}

/** v1 -> v2: one `volume` (0..1) became three 0..10 levels; `shake: boolean` became 0 / 2. */
export function migrateV2(v1: { options?: { volume?: number; shake?: boolean } & Record<string, unknown> }): unknown {
  const o = v1.options ?? {};
  const vol = typeof o.volume === "number" ? Math.round(Math.max(0, Math.min(1, o.volume)) * 10) : 8;
  const { volume: _v, shake, ...rest } = o;
  return {
    ...v1,
    options: {
      ...rest,
      music: Math.min(vol, 7),
      sfx: vol,
      ambience: Math.round(vol * 0.6),
      shake: shake === false ? 0 : 2,
    },
  };
}

export function createSave(storage?: StorageLike) {
  const store = new SaveStore<SaveData>(
    {
      key: SAVE_KEY,
      version: SAVE_VERSION,
      defaults,
      migrations: { 2: migrateV2 },
      sanitize: (d, def) => void snapToRows(d.options, OPTION_ROWS, def.options),
    },
    storage,
  );
  const write = () => store.write();
  const names = new NameBook<PlayerName>(() => store.data.names, {
    make: () => ({ wins: 0, games: 0 }),
    onChange: write,
  });
  const rovers = new RecordsTable(() => store.data.rovers, write);
  return {
    store,
    names,
    rovers,
    get data() {
      return store.data;
    },
    write,
    /** The name a local seat played as last (or a fresh default). */
    seatName(seat: number): string {
      const id = store.data.seatNames[seat];
      return (id && names.get(id)?.name) || `P${seat + 1}`;
    },
    setSeatName(seat: number, name: string): string {
      const ref = names.add(name);
      if (!ref) return this.seatName(seat);
      store.data.seatNames[seat] = ref.id;
      write();
      return ref.name;
    },
    logMatch(e: MatchLogEntry): void {
      pushLog(store.data.log, e, 20);
      write();
    },
  };
}

export type Save = ReturnType<typeof createSave>;
