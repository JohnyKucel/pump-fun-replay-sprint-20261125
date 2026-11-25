// Pump.fun Replay Sprint — Paper Bot, Real Ranking.
// A momentum bot on the agent-fun/replay/v2 protocol: the harness sends a hello
// (capital, caps, fees) and then one batch per slot with the slot's events, marks,
// fills and account, and this bot answers each batch with its orders. Price is
// virtual_quote_reserves / virtual_token_reserves per curve.
//
// The tuned rule only enters mature curves: a coin whose real SOL reserve has
// grown to 50–85 SOL (near the ~85 SOL completion of a pump.fun bonding curve)
// while its price is still rising off the recent low on fresh net buying. It
// buys 0.08 SOL, then exits on take-profit (+50%), stop-loss (−15%), a
// trailing exit (25% below peak once +10% in profit), or a hard time exit after
// 1000 slots. A coin may be entered twice with no cooldown, so a mature curve
// that keeps climbing can be ridden again after the first exit. Sells go out
// at tight slippage so a crashing exit is refused and retried instead of
// filled at the bottom. See DESIGN.md for the tuning log. Deterministic: no
// clock, no environment reads, no Math.random, so two runs over the same
// batches reply byte-identical orders.

import { runBot } from './vendor/makefun-bot.ts';
import { createStrategy, DEFAULT_PARAMS } from './strategy.ts';

const strategy = createStrategy(DEFAULT_PARAMS);

await runBot({
  onBatch(state, batch) {
    return strategy.onBatch(state, batch);
  },
});
