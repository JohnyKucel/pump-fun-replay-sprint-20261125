// Grid sweep of strategy parameters on the dev window with the local engine.
// Usage: node tools/sweep.ts <kit dir> '<base json>' '<grid json>' [top N]
// Ranks by mean net PnL over several failed-tx keys, and prints the net without
// the best round trip so a setting that only wins through one lucky coin stands out.

import { createStrategy, DEFAULT_PARAMS, type Params } from '../strategy.ts';
import { loadDataset, makeHello, phaseSeed, simulate } from './sim.ts';

const [kit, baseJson, gridJson, topArg] = process.argv.slice(2);
if (kit === undefined || gridJson === undefined) {
  console.error(`usage: node tools/sweep.ts <kit dir> '<base json>' '<grid json>' [top]`);
  process.exit(2);
}
const base = { ...DEFAULT_PARAMS, ...(JSON.parse(baseJson ?? '{}') as Partial<Params>) } as Params;
const grid = JSON.parse(gridJson) as Record<string, unknown[]>;
const ds = loadDataset(kit);
const hello = makeHello(phaseSeed('pump-fun-replay-sprint', 'dev', ds.sha256));
const keys = Object.keys(grid);
const combos: Record<string, unknown>[] = [{}];
for (const k of keys) {
  const next: Record<string, unknown>[] = [];
  for (const c of combos) for (const v of grid[k]!) next.push({ ...c, [k]: v });
  combos.splice(0, combos.length, ...next);
}
const FAIL_KEYS = [11n, 22n, 33n, 44n];
interface Row { c: Record<string, unknown>; net: number; worst: number; exBest: number; fills: number; coins: number; dd: number; trips: number; wins: number }
const rows: Row[] = [];
for (const c of combos) {
  let sum = 0;
  let worst = Infinity;
  let exBest = 0;
  let fills = Infinity;
  let coins = Infinity;
  let dd = 0;
  let trips = 0;
  let wins = 0;
  for (const failKey of FAIL_KEYS) {
    const cc = { ...base, ...c } as Params;
    // bigint params arrive as strings from JSON; restore them.
    for (const k of ['minNetSolLamports', 'minRealSolLamports', 'maxRealSolLamports', 'stakeLamports', 'minBuyLamports'] as const) {
      if (typeof (cc as any)[k] === 'string') (cc as any)[k] = BigInt((cc as any)[k]);
    }
    const r = simulate(ds, hello, createStrategy(cc), { failKey });
    const pnl = r.trips.map((t) => Number(t.pnl) / 1e9).sort((a, b) => b - a);
    const net = Number(r.netPnl) / 1e9;
    sum += net;
    worst = Math.min(worst, net);
    exBest += (net - (pnl[0] ?? 0)) / FAIL_KEYS.length;
    fills = Math.min(fills, r.fills);
    coins = Math.min(coins, r.mints);
    dd = Math.max(dd, r.maxDrawdown);
    trips = r.trips.length;
    wins = r.trips.filter((t) => t.pnl > 0n).length;
  }
  rows.push({ c, net: sum / FAIL_KEYS.length, worst, exBest, fills, coins, dd, trips, wins });
}
rows.sort((a, b) => b.net - a.net);
for (const r of rows.slice(0, Number(topArg ?? 25))) {
  console.log(`mean ${r.net.toFixed(3)} worst ${r.worst.toFixed(3)} exBest ${r.exBest.toFixed(3)} fills ${r.fills} coins ${r.coins} trips ${r.trips} wins ${r.wins} dd ${r.dd.toFixed(3)} ${JSON.stringify(r.c)}`);
}
