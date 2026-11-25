// Pump.fun Replay Sprint — Paper Bot, Real Ranking.
// A momentum bot on the agent-fun/replay/v2 protocol: the harness sends a hello
// (capital, caps, fees) and then one batch per slot with the slot's events, marks,
// fills and account, and this bot answers each batch with its orders. Price is
// virtual_quote_reserves / virtual_token_reserves per curve; entries chase fresh
// net buying while the price is rising off its recent low, exits are take-profit,
// stop-loss, a trailing exit and a hard time exit. Deterministic: no clock, no
// environment reads, no Math.random, so two runs over the same batches reply
// byte-identical orders. See DESIGN.md for the parameters and tuning results.

import { runBot } from './vendor/makefun-bot.ts';
import { createStrategy, DEFAULT_PARAMS } from './strategy.ts';

const strategy = createStrategy(DEFAULT_PARAMS);

await runBot({
  onBatch(state, batch) {
    return strategy.onBatch(state, batch);
  },
});
