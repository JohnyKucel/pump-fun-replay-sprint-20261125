// Offline backtest of strategy.ts on the kit dev window with the local engine
// port (tools/sim.ts). Usage:
//   node tools/backtest.ts <kit dir> ['{...params}'] [--trips]
// Prints net PnL, fills, coins, drawdown, reject reasons, and the same run
// without failed transactions and at 2x fees.

import { createStrategy, DEFAULT_PARAMS, type Params } from '../strategy.ts';
import { loadDataset, makeHello, phaseSeed, simulate } from './sim.ts';

const kit = process.argv[2];
if (kit === undefined) {
  console.error('usage: node tools/backtest.ts <kit dir> [params json] [--trips]');
  process.exit(2);
}
const overrides = process.argv[3] !== undefined && process.argv[3].startsWith('{') ? (JSON.parse(process.argv[3]) as Partial<Params>) : {};
const ds = loadDataset(kit);
const hello = makeHello(phaseSeed('pump-fun-replay-sprint', 'dev', ds.sha256));
const params = { ...DEFAULT_PARAMS, ...overrides } as Params;
for (const k of ['minNetSolLamports', 'minRealSolLamports', 'maxRealSolLamports', 'stakeLamports', 'minBuyLamports'] as const) {
  if (typeof (params as any)[k] === 'string') (params as any)[k] = BigInt((params as any)[k]);
}
const r = simulate(ds, hello, createStrategy(params));
const sol = (x: bigint) => (Number(x) / 1e9).toFixed(6);
const top = [...r.perMint.entries()].sort((a, b) => (b[1] > a[1] ? 1 : -1)).slice(0, 3);
console.log(`net ${sol(r.netPnl)} SOL  fills ${r.fills}  coins ${r.mints}  trips ${r.trips.length}  wins ${r.trips.filter((t) => t.pnl > 0n).length}  dd ${r.maxDrawdown.toFixed(4)}  rejected ${r.rejected} ${JSON.stringify(r.rejectReasons)}  failed ${r.failed}`);
console.log(`top3 ${top.map(([m, v]) => `${m.slice(0, 8)}:${sol(v)}`).join(' ')}  top3share ${r.netPnl > 0n ? (Number(top.reduce((a, [, v]) => a + v, 0n)) / Number(r.netPnl)).toFixed(2) : 'n/a'}`);
const noFail = simulate(ds, hello, createStrategy(params), { failKey: null });
const twoX = simulate(ds, hello, createStrategy(params), { feeMultiplier: 2n });
console.log(`without failed txs ${sol(noFail.netPnl)}  at 2x fees ${sol(twoX.netPnl)}`);
if (process.argv.includes('--trips')) {
  for (const t of r.trips) console.log(t.mint, t.open, t.close - t.open, sol(t.pnl));
}
