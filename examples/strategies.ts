/**
 * Predict Now — Example Trading Strategies
 *
 * Implement the Strategy interface to create your own strategy,
 * then pass it to the agent in agent.ts.
 *
 * Each strategy receives market context and returns "UP" or "DOWN".
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export type Direction = "UP" | "DOWN";

export interface MarketContext {
  /** Current round number */
  roundNumber: number;
  /** BTC price when the round opened */
  openPrice: number;
  /** Current live BTC price */
  currentPrice: number;
  /** 24-hour BTC price change (percentage) */
  change24h: number;
  /** Total CBTC in the UP pool this round */
  upAmount: number;
  /** Total CBTC in the DOWN pool this round */
  downAmount: number;
  /** Milliseconds remaining in the round */
  timeRemainingMs: number;
  /** Recent round results (newest first) */
  recentResults: Array<{
    roundNumber: number;
    winningDirection: Direction;
    openPrice: number;
    closePrice: number;
  }>;
}

export interface Strategy {
  /** Human-readable name for logging */
  name: string;
  /** Given market context, decide UP or DOWN */
  decide(ctx: MarketContext): Direction;
}

// ─── Strategy 1: Momentum ───────────────────────────────────────────────────

/**
 * Follow the price trend. If BTC is currently above the round's open price,
 * bet UP (momentum continues). If below, bet DOWN.
 *
 * Falls back to 24h trend if open price equals current price.
 */
export const momentumStrategy: Strategy = {
  name: "Momentum",

  decide(ctx: MarketContext): Direction {
    // Primary signal: intra-round price movement
    if (ctx.currentPrice > ctx.openPrice) return "UP";
    if (ctx.currentPrice < ctx.openPrice) return "DOWN";

    // Tiebreaker: 24h trend
    return ctx.change24h >= 0 ? "UP" : "DOWN";
  },
};

// ─── Strategy 2: Contrarian ─────────────────────────────────────────────────

/**
 * Bet against the crowd. When one pool is significantly larger than the other,
 * bet on the smaller side for a better payout ratio.
 *
 * The "edge threshold" controls how lopsided the pools need to be before
 * going contrarian. With a threshold of 0.6, if 60%+ of money is on one side,
 * bet the other side. If pools are roughly even, fall back to momentum.
 */
export function createContrarianStrategy(edgeThreshold = 0.6): Strategy {
  return {
    name: `Contrarian(${edgeThreshold})`,

    decide(ctx: MarketContext): Direction {
      const totalPool = ctx.upAmount + ctx.downAmount;

      // If the pool is empty or nearly even, fall back to momentum
      if (totalPool === 0) {
        return momentumStrategy.decide(ctx);
      }

      const upRatio = ctx.upAmount / totalPool;

      // If UP pool is dominant, bet DOWN for better payout odds
      if (upRatio >= edgeThreshold) return "DOWN";
      // If DOWN pool is dominant, bet UP
      if (upRatio <= 1 - edgeThreshold) return "UP";

      // Pools are roughly even — fall back to momentum
      return momentumStrategy.decide(ctx);
    },
  };
}

export const contrarianStrategy = createContrarianStrategy(0.6);

// ─── Strategy 3: Random ─────────────────────────────────────────────────────

/**
 * Random 50/50 — useful for testing, generating volume, or as a baseline
 * to compare other strategies against.
 */
export const randomStrategy: Strategy = {
  name: "Random",

  decide(_ctx: MarketContext): Direction {
    return Math.random() < 0.5 ? "UP" : "DOWN";
  },
};
