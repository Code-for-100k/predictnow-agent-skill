/**
 * Predict Now — Example Trading Agent
 *
 * A complete, runnable agent that:
 *   1. Authenticates with Firebase email/password
 *   2. Polls market status every 10 seconds
 *   3. Decides UP or DOWN using a pluggable strategy
 *   4. Places minimum bets (10 satoshi = 0.0000001 CBTC)
 *   5. Checks the circuit breaker before relying on auto-payouts
 *   6. Logs results and tracks win/loss
 *
 * Usage:
 *   npx tsx examples/agent.ts
 *
 * Environment variables (or edit the constants below):
 *   PREDICTNOW_EMAIL    — your agent's email
 *   PREDICTNOW_PASSWORD — your agent's password
 *   REWARDS_API_KEY     — (optional) for circuit breaker checks
 *
 * To use a different strategy, change the import at the bottom of this file.
 */

import {
  type Strategy,
  type MarketContext,
  type Direction,
  contrarianStrategy,
  momentumStrategy,
  randomStrategy,
} from "./strategies.js";

// ─── Configuration ──────────────────────────────────────────────────────────

const BASE_URL = "https://predictnow.cc";
const FIREBASE_API_KEY = "AIzaSyAALLUn5YsJNkXc0f7dKpgerJcmH4YPsUw"; // Public client key
const BET_AMOUNT = 0.0000001; // 10 satoshi — the minimum bet
const POLL_INTERVAL_MS = 10_000; // 10 seconds between polls
const MIN_TIME_REMAINING_MS = 5_000; // Don't bet with < 5s left
const CIRCUIT_BREAKER_CHECK_INTERVAL = 10; // Check every N rounds

// Credentials — set via env vars or edit here
const EMAIL = process.env.PREDICTNOW_EMAIL || "your-agent@example.com";
const PASSWORD = process.env.PREDICTNOW_PASSWORD || "your-password";
const REWARDS_KEY = process.env.REWARDS_API_KEY || ""; // Optional

// ─── Firebase Auth ──────────────────────────────────────────────────────────

interface FirebaseAuthResult {
  idToken: string;
  refreshToken: string;
  expiresIn: string;
}

async function authenticate(email: string, password: string): Promise<FirebaseAuthResult> {
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    }
  );

  if (!res.ok) {
    const err = await res.json();
    throw new Error(`Auth failed: ${err.error?.message || res.statusText}`);
  }

  return res.json();
}

async function refreshToken(refreshTok: string): Promise<FirebaseAuthResult> {
  const res = await fetch(
    `https://securetoken.googleapis.com/v1/token?key=${FIREBASE_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grant_type: "refresh_token", refresh_token: refreshTok }),
    }
  );

  if (!res.ok) {
    throw new Error(`Token refresh failed: ${res.statusText}`);
  }

  const data = await res.json();
  return {
    idToken: data.id_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
  };
}

// ─── API Helpers ────────────────────────────────────────────────────────────

async function api<T>(path: string, token?: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options?.headers as Record<string, string> || {}),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${BASE_URL}${path}`, { ...options, headers });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${path} ${res.status}: ${body}`);
  }

  return res.json();
}

interface MarketStatus {
  status: "active" | "no_active_round";
  round_number?: number;
  open_price?: number;
  time_remaining_ms?: number;
  up_amount?: number;
  down_amount?: number;
  fee_percentage?: number;
}

interface BtcPrice {
  price: number;
  change_24h: number;
}

interface PredictResponse {
  prediction_id: number;
  market_round: number;
  direction: Direction;
  amount: number;
  remaining_balance: number;
}

interface RoundResult {
  round_number: number;
  winning_direction: Direction;
  open_price: number;
  close_price: number;
}

interface RewardsResponse {
  circuit_breaker: {
    tripped: boolean;
    tripped_at: number | null;
    reason: string;
  };
  fee_percentage: number;
}

// ─── Agent State ────────────────────────────────────────────────────────────

interface AgentState {
  token: string;
  refreshTok: string;
  tokenExpiresAt: number;
  roundsBet: Set<number>;
  wins: number;
  losses: number;
  totalBet: number;
  circuitBreakerTripped: boolean;
  roundsSinceBreakCheck: number;
}

// ─── Main Agent Loop ────────────────────────────────────────────────────────

async function runAgent(strategy: Strategy) {
  console.log(`\n=== Predict Now Agent ===`);
  console.log(`Strategy: ${strategy.name}`);
  console.log(`Bet amount: ${BET_AMOUNT} CBTC (10 satoshi)`);
  console.log(`Base URL: ${BASE_URL}\n`);

  // 1. Authenticate
  console.log(`Authenticating as ${EMAIL}...`);
  const auth = await authenticate(EMAIL, PASSWORD);

  const state: AgentState = {
    token: auth.idToken,
    refreshTok: auth.refreshToken,
    tokenExpiresAt: Date.now() + parseInt(auth.expiresIn) * 1000,
    roundsBet: new Set(),
    wins: 0,
    losses: 0,
    totalBet: 0,
    circuitBreakerTripped: false,
    roundsSinceBreakCheck: CIRCUIT_BREAKER_CHECK_INTERVAL, // Check on first run
  };

  // 2. Verify user
  await api("/api/auth/verify", state.token, { method: "POST" });
  console.log("Authenticated successfully.\n");

  // 3. Main loop
  while (true) {
    try {
      // Refresh token if expiring in the next 5 minutes
      if (Date.now() > state.tokenExpiresAt - 5 * 60 * 1000) {
        console.log("Refreshing auth token...");
        const refreshed = await refreshToken(state.refreshTok);
        state.token = refreshed.idToken;
        state.refreshTok = refreshed.refreshToken;
        state.tokenExpiresAt = Date.now() + parseInt(refreshed.expiresIn) * 1000;
      }

      // Check circuit breaker periodically
      state.roundsSinceBreakCheck++;
      if (REWARDS_KEY && state.roundsSinceBreakCheck >= CIRCUIT_BREAKER_CHECK_INTERVAL) {
        state.roundsSinceBreakCheck = 0;
        try {
          const rewards = await api<RewardsResponse>("/api/rewards", undefined, {
            headers: { "x-rewards-key": REWARDS_KEY },
          });
          state.circuitBreakerTripped = rewards.circuit_breaker.tripped;
          if (state.circuitBreakerTripped) {
            console.log(
              `[CircuitBreaker] TRIPPED: ${rewards.circuit_breaker.reason}`
            );
            console.log(
              "  Auto-payouts paused. Winnings stay in internal ledger."
            );
            console.log("  Use POST /api/withdraw to claim manually.\n");
          }
        } catch (err) {
          // Non-fatal — rewards key may not be set
        }
      }

      // Get market status
      const status = await api<MarketStatus>("/api/market/status");

      if (
        status.status !== "active" ||
        !status.round_number ||
        !status.time_remaining_ms
      ) {
        // No active round — wait and try again
        await sleep(POLL_INTERVAL_MS);
        continue;
      }

      // Skip if we already bet on this round
      if (state.roundsBet.has(status.round_number)) {
        await sleep(POLL_INTERVAL_MS);
        continue;
      }

      // Skip if not enough time remaining
      if (status.time_remaining_ms < MIN_TIME_REMAINING_MS) {
        await sleep(POLL_INTERVAL_MS);
        continue;
      }

      // Build market context for the strategy
      let recentResults: RoundResult[] = [];
      try {
        const history = await api<{ rounds: RoundResult[] }>(
          "/api/results/history?limit=10"
        );
        recentResults = history.rounds;
      } catch {
        // Non-fatal
      }

      let btcPrice: BtcPrice = { price: status.open_price || 0, change_24h: 0 };
      try {
        btcPrice = await api<BtcPrice>("/api/btc-price");
      } catch {
        // Non-fatal
      }

      const ctx: MarketContext = {
        roundNumber: status.round_number,
        openPrice: status.open_price || btcPrice.price,
        currentPrice: btcPrice.price,
        change24h: btcPrice.change_24h,
        upAmount: status.up_amount || 0,
        downAmount: status.down_amount || 0,
        timeRemainingMs: status.time_remaining_ms,
        recentResults,
      };

      // Decide direction
      const direction = strategy.decide(ctx);

      // Place the bet
      const result = await api<PredictResponse>("/api/predict", state.token, {
        method: "POST",
        body: JSON.stringify({ direction, amount: BET_AMOUNT }),
      });

      state.roundsBet.add(status.round_number);
      state.totalBet += result.amount;

      console.log(
        `Round ${result.market_round}: ${direction} | ` +
          `${result.amount} CBTC | ` +
          `Balance: ${result.remaining_balance} | ` +
          `Open: $${ctx.openPrice} | Current: $${ctx.currentPrice}`
      );

      // Check previous round result for win/loss tracking
      if (recentResults.length > 0) {
        const lastRound = recentResults[0];
        if (state.roundsBet.has(lastRound.roundNumber)) {
          // We bet on this round — check if we would have won
          // (simplified — real tracking would use /api/bets)
        }
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`Error: ${msg}`);

      // If auth error, try re-authenticating
      if (msg.includes("401")) {
        console.log("Re-authenticating...");
        try {
          const auth = await authenticate(EMAIL, PASSWORD);
          state.token = auth.idToken;
          state.refreshTok = auth.refreshToken;
          state.tokenExpiresAt = Date.now() + parseInt(auth.expiresIn) * 1000;
        } catch (authErr) {
          console.error("Re-auth failed:", authErr);
        }
      }
    }

    await sleep(POLL_INTERVAL_MS);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Entry Point ────────────────────────────────────────────────────────────

// Change this to use a different strategy:
//   - contrarianStrategy  (bet against the crowd)
//   - momentumStrategy    (follow the price trend)
//   - randomStrategy      (50/50 for testing)
const selectedStrategy = contrarianStrategy;

runAgent(selectedStrategy).catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
