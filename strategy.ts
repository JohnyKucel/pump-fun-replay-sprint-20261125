// Fresh momentum strategy for the Pump.fun Replay Sprint (agent-fun/replay/v2).
//
// Idea: most pump.fun curves die fast, a few run hard for a short while. This bot
// only chases a curve while fresh buying is still arriving, and it gets out fast:
// take-profit, stop-loss, a trailing exit once a position is in profit, and a hard
// time exit so no position is left to bleed out. One small entry per coin keeps the
// bot broad enough to clear the 20-coin round-trip bar.
//
// How the hello / batch / orders loop works here: the harness sends one hello with
// the capital, caps and fees, then one batch per slot carrying that slot's events,
// marks, fills and account. This strategy answers every batch with at most a few
// orders. Prices come from the curve reserves in the batch: price is
// virtual_quote_reserves / virtual_token_reserves, tracked per mint in a short
// rolling window measured in slots. Nothing here reads the clock, the environment
// or Math.random, so two runs over the same batches produce identical orders.

import type { Batch, BotState, OrderInput, Pubkey } from './vendor/makefun-bot.ts';

export interface Params {
  /** Lookback window in slots for the low price and the buy flow. */
  windowSlots: number;
  /** Buy when the price is at least this far above the window low, in bps. */
  minRiseBps: number;
  /** Never chase a coin that already ran this far above its window low, in bps. */
  maxRiseBps: number;
  /** Buy when the price is at least this far above its creation price, in bps. */
  minBreakoutBps: number;
  /** Never chase a coin that already ran this far above its creation price, in bps. */
  maxBreakoutBps: number;
  /** Net buy SOL over the window (buys minus sells), in lamports. */
  minNetSolLamports: bigint;
  /** Minimum buy trades inside the window. */
  minBuys: number;
  /** Minimum distinct buying wallets inside the window. */
  minBuyers: number;
  /** Real SOL reserve bounds at entry, in lamports. */
  minRealSolLamports: bigint;
  maxRealSolLamports: bigint;
  /** Age window in slots since the CreateEvent for a first entry. */
  minAgeSlots: number;
  maxAgeSlots: number;
  /** SOL to put into one position, in lamports. */
  stakeLamports: bigint;
  /** Smallest single buy worth paying a transaction fee for, in lamports. */
  minBuyLamports: bigint;
  /** Take-profit above the position's average cost, in bps. */
  takeProfitBps: number;
  /** Stop-loss below the average cost, in bps. */
  stopLossBps: number;
  /** Trailing exit: sell once the price falls this far below its peak, in bps. */
  trailBps: number;
  /** The trailing exit only arms once the price is this far above cost, in bps. */
  trailArmBps: number;
  /** Sell whatever is left after this many slots held. */
  maxHoldSlots: number;
  /** Slots to wait after an exit before the same coin may be entered again. */
  cooldownSlots: number;
  /** Entries per coin over the whole run (1 = one shot per coin). */
  maxEntriesPerCoin: number;
  /** Max new entries decided in a single batch. */
  maxEntriesPerBatch: number;
  /** Price must be at least this share of the window high, in bps. */
  nearHighBps: number;
  /** Slippage allowed on buys / sells, in bps. */
  buySlippageBps: number;
  sellSlippageBps: number;
}

export const DEFAULT_PARAMS: Params = {
  windowSlots: 40,
  minRiseBps: 800,
  maxRiseBps: 40000,
  minBreakoutBps: 300,
  maxBreakoutBps: 15000,
  minNetSolLamports: 100_000_000n,
  minBuys: 3,
  minBuyers: 2,
  minRealSolLamports: 1_500_000_000n,
  maxRealSolLamports: 80_000_000_000n,
  minAgeSlots: 0,
  maxAgeSlots: 3000,
  stakeLamports: 50_000_000n,
  minBuyLamports: 10_000_000n,
  takeProfitBps: 3000,
  stopLossBps: 1500,
  trailBps: 2000,
  trailArmBps: 1000,
  maxHoldSlots: 600,
  cooldownSlots: 300,
  maxEntriesPerCoin: 1,
  maxEntriesPerBatch: 4,
  nearHighBps: 9000,
  buySlippageBps: 1000,
  sellSlippageBps: 10000,
};

interface Sample {
  slot: number;
  price: number;
  netLamports: bigint;
  buys: number;
  buyers: Set<string>;
}

interface Book {
  createdSlot: number | null;
  createPrice: number;
  samples: Sample[];
  entries: number;
  coolUntil: number;
  entrySlot: number;
  peakPrice: number;
}

interface Held {
  entrySlot: number;
  peakPrice: number;
}

const BPS = 10000;

function priceOf(state: BotState, mint: Pubkey): number {
  const c = state.curves.get(mint);
  if (c === undefined || c.virtual_token_reserves === 0n) return 0;
  return Number(c.virtual_quote_reserves) / Number(c.virtual_token_reserves);
}

export function createStrategy(p: Params = DEFAULT_PARAMS) {
  const books = new Map<Pubkey, Book>();
  const held = new Map<Pubkey, Held>();
  const pendingSell = new Set<Pubkey>();
  const pendingBuy = new Set<Pubkey>();

  const book = (mint: Pubkey): Book => {
    let b = books.get(mint);
    if (b === undefined) {
      b = { createdSlot: null, createPrice: 0, samples: [], entries: 0, coolUntil: -1, entrySlot: -1, peakPrice: 0 };
      books.set(mint, b);
    }
    return b;
  };

  return {
    params: p,
    onBatch(state: BotState, batch: Batch): OrderInput[] {
      const orders: OrderInput[] = [];
      const tx = state.txFeeLamports();
      let free = state.freeCashLamports();
      let openSlots = state.hello.caps.max_open_positions - state.committedPositionCount();

      // Sync exits: a fill of any outcome clears its pending flag, so a failed
      // or rejected order never strands a position or a coin. A filled buy
      // opens the holding record and counts the entry; a filled sell that
      // empties the position starts the coin's cooldown. Fills arrive in the
      // batch before onBatch runs.
      for (const f of batch.fills) {
        if (f.side === 'sell') {
          pendingSell.delete(f.mint);
          if (f.status === 'filled' && !state.positions.has(f.mint)) {
            held.delete(f.mint);
            book(f.mint).coolUntil = batch.slot + p.cooldownSlots;
          }
        } else {
          pendingBuy.delete(f.mint);
          if (f.status !== 'filled') continue;
          book(f.mint).entries += 1;
          const pos = state.positions.get(f.mint);
          if (pos !== undefined && !held.has(f.mint)) {
            const costPrice = Number(pos.cost_lamports) / Number(pos.token_amount);
            held.set(f.mint, { entrySlot: f.slot, peakPrice: costPrice });
          }
        }
      }
      // Positions the harness closed itself (curve completed / flatten) leave no
      // holding behind; positions that appeared without a fill are adopted too.
      for (const mint of [...held.keys()]) {
        if (!state.positions.has(mint)) held.delete(mint);
      }
      for (const [mint, pos] of state.positions) {
        if (!held.has(mint)) {
          const costPrice = Number(pos.cost_lamports) / Number(pos.token_amount);
          held.set(mint, { entrySlot: batch.slot, peakPrice: costPrice });
        }
      }

      // Fold this batch's trades into per-mint samples, one sample per mint.
      const flow = new Map<Pubkey, Sample>();
      for (const e of batch.events) {
        if (e.event === 'CreateEvent') {
          const b = book(e.mint);
          b.createdSlot = e.slot;
          const vt = BigInt(e.virtual_token_reserves);
          if (vt > 0n) b.createPrice = Number(e.virtual_quote_reserves) / Number(vt);
          continue;
        }
        if (e.event !== 'TradeEvent') continue;
        let s = flow.get(e.mint);
        if (s === undefined) {
          s = { slot: batch.slot, price: 0, netLamports: 0n, buys: 0, buyers: new Set<string>() };
          flow.set(e.mint, s);
        }
        const amt = BigInt(e.sol_amount);
        s.netLamports += e.is_buy ? amt : -amt;
        if (e.is_buy) {
          s.buys += 1;
          s.buyers.add(e.user);
        }
      }
      for (const [mint, s] of flow) {
        const b = book(mint);
        s.price = priceOf(state, mint);
        b.samples.push(s);
        const cutoff = batch.slot - p.windowSlots;
        while (b.samples.length > 0 && b.samples[0]!.slot < cutoff) b.samples.shift();
        if (b.samples.length > 64) b.samples.splice(0, b.samples.length - 64);
      }

      // Exits first: every held position is checked against take-profit,
      // stop-loss, the trailing exit and the time exit, in that order.
      for (const [mint, pos] of state.positions) {
        if (pendingSell.has(mint)) continue;
        const h = held.get(mint);
        if (h === undefined) continue;
        const price = priceOf(state, mint);
        if (price <= 0) continue;
        const costPrice = Number(pos.cost_lamports) / Number(pos.token_amount);
        if (costPrice <= 0) continue;
        if (price > h.peakPrice) h.peakPrice = price;
        const upBps = ((price - costPrice) / costPrice) * BPS;
        const downFromPeakBps = ((h.peakPrice - price) / h.peakPrice) * BPS;
        const armedTrail = upBps >= p.trailArmBps && downFromPeakBps >= p.trailBps;
        const timedOut = batch.slot - h.entrySlot >= p.maxHoldSlots;
        if (upBps >= p.takeProfitBps || upBps <= -p.stopLossBps || armedTrail || timedOut) {
          if (orders.length >= state.hello.caps.max_orders_per_batch) break;
          if (free < tx) break;
          orders.push({ side: 'sell', mint, token_amount: pos.token_amount, max_slippage_bps: p.sellSlippageBps });
          pendingSell.add(mint);
          free -= tx;
        }
      }

      // Entries: coins that traded in this batch, in batch order, strongest first
      // only by the order the harness delivered them (deterministic, no sorting
      // on floats that could differ across runs).
      let entered = 0;
      for (const [mint] of flow) {
        if (entered >= p.maxEntriesPerBatch) break;
        if (orders.length >= state.hello.caps.max_orders_per_batch) break;
        if (openSlots <= 0) break;
        const b = book(mint);
        const curve = state.curves.get(mint);
        if (curve === undefined || curve.complete) continue;
        if (state.positions.has(mint) || pendingBuy.has(mint)) continue;
        if (b.entries >= p.maxEntriesPerCoin) continue;
        if (batch.slot < b.coolUntil) continue;
        const age = b.createdSlot === null ? p.maxAgeSlots + 1 : batch.slot - b.createdSlot;
        if (age < p.minAgeSlots || age > p.maxAgeSlots) continue;
        if (curve.real_quote_reserves < p.minRealSolLamports || curve.real_quote_reserves > p.maxRealSolLamports) continue;
        if (b.samples.length < 2) continue;
        let low = Infinity;
        let high = 0;
        let net = 0n;
        let buys = 0;
        const buyers = new Set<string>();
        for (const s of b.samples) {
          if (s.price > 0 && s.price < low) low = s.price;
          if (s.price > high) high = s.price;
          net += s.netLamports;
          buys += s.buys;
          for (const u of s.buyers) buyers.add(u);
        }
        const price = priceOf(state, mint);
        if (!Number.isFinite(low) || low <= 0 || price <= 0) continue;
        const riseBps = ((price - low) / low) * BPS;
        if (riseBps < p.minRiseBps || riseBps > p.maxRiseBps) continue;
        // Breakout from the creation price: enter early, while the run is
        // young, and never chase a coin that already ran far past create.
        if (b.createPrice > 0) {
          const breakoutBps = ((price - b.createPrice) / b.createPrice) * BPS;
          if (breakoutBps < p.minBreakoutBps || breakoutBps > p.maxBreakoutBps) continue;
        }
        // Do not buy a coin that already faded off its window high, or whose
        // latest batch stopped buying: the momentum must still be alive.
        if (price * BPS < high * p.nearHighBps) continue;
        const last = b.samples[b.samples.length - 1]!;
        if (last.netLamports <= 0n) continue;
        if (net < p.minNetSolLamports || buys < p.minBuys || buyers.size < p.minBuyers) continue;
        const cap = state.maxBuyLamports(mint);
        if (cap < p.minBuyLamports) continue;
        const amount = cap < p.stakeLamports ? cap : p.stakeLamports;
        if (amount < p.minBuyLamports) continue;
        if (free < amount + tx) continue;
        orders.push({ side: 'buy', mint, quote_lamports: amount, max_slippage_bps: p.buySlippageBps });
        pendingBuy.add(mint);
        free -= amount + tx;
        openSlots -= 1;
        entered += 1;
      }
      return orders;
    },
  };
}
