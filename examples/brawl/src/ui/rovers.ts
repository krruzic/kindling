// Display data for the rovers (names, blurbs, 1-5 stat pips). Read from the tuning so the select screen always
// shows what the sim will do.
import { baseTuning, type RoverId } from "../sim/types.ts";

const T = baseTuning();

export interface RoverInfo {
  name: string;
  blurb: string;
  stats: { label: string; pips: number }[];
}

const pips = (v: number, lo: number, hi: number) =>
  Math.max(1, Math.min(5, Math.round(1 + ((v - lo) / (hi - lo)) * 4)));

function info(id: RoverId, name: string, blurb: string): RoverInfo {
  const r = T.rovers[id];
  return {
    name,
    blurb,
    stats: [
      { label: "SPEED", pips: pips(r.speed, 5.8, 7.6) },
      { label: "WEIGHT", pips: pips(r.mass, 0.8, 1.35) },
      { label: "POWER", pips: pips(r.power, 0.9, 1.15) },
      { label: "SLAM", pips: pips(r.slam, 0.85, 1.25) },
    ],
  };
}

export const ROVER_INFO: Record<RoverId, RoverInfo> = {
  scout: info("scout", "SCOUT", "LIGHT AND QUICK. DASHES OFTEN, FLIES FAR."),
  brute: info("brute", "BRUTE", "HEAVY PLOW. HARD TO MOVE, HITS HARD."),
  spark: info("spark", "SPARK", "COIL ROVER. THE BIGGEST GROUND SLAM."),
};
