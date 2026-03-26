# Predict Now — Agent Skill

Build trading agents for [Predict Now](https://predictnow.cc), a BTC prediction market on Canton Network.

## Getting Started

Follow this checklist to go from zero to a running agent:

1. **Sign up** at [predictnow.cc](https://predictnow.cc) with invite code `PREDICT-NOW`
2. **Get your Firebase auth token** — sign in with email/password or Google, then retrieve an ID token (see [Authentication](#authentication) below)
3. **Link your Canton wallet** — call `POST /api/auth/link-party` with your Canton party ID
4. **Deposit CBTC** — send CBTC from your Canton/Zoro wallet to the pool address (`GET /api/pool-info`), then call `POST /api/deposit` to credit your balance
5. **Run the example agent** — copy `examples/agent.ts`, add your credentials, and run it (see [Example Agent](#example-agent))
6. **Check the rewards dashboard** — visit `/rewards.html` with your rewards API key to monitor transaction economics

## What's in This Repo

| File | Description |
|------|-------------|
| `API_REFERENCE.md` | Full API documentation — all endpoints, request/response schemas, error codes |
| `examples/agent.ts` | Complete working agent with pluggable strategy interface |
| `examples/strategies.ts` | Three example strategies: momentum, contrarian, random |
| `.claude/skills/predictnow-agent/SKILL.md` | Claude Code skill for AI-assisted agent development |

## Authentication

Agents authenticate with Firebase ID tokens. Two options:

**Email/password (recommended for agents):**

```javascript
const res = await fetch(
  "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=AIzaSyAALLUn5YsJNkXc0f7dKpgerJcmH4YPsUw",
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "your-agent@example.com",
      password: "your-password",
      returnSecureToken: true,
    }),
  }
);
const { idToken } = await res.json();
```

**Google Sign-In:** use the Firebase Web SDK. Get config from `GET /api/firebase-config`.

Tokens expire after ~1 hour. Refresh them by calling the same sign-in endpoint again, or use the Firebase `refreshToken` flow.

## Example Agent

See `examples/agent.ts` for a complete, runnable agent that:

- Authenticates with Firebase email/password
- Polls market status every 10 seconds
- Decides UP or DOWN using a pluggable strategy
- Places minimum bets (10 satoshi)
- Checks the circuit breaker before relying on auto-payouts
- Logs results and tracks win/loss

Swap in your own strategy by implementing the `Strategy` interface from `examples/strategies.ts`.

## Market Rules

| Rule | Value |
|------|-------|
| Round duration | 1 minute |
| Minimum bet | 10 satoshi (0.0000001 CBTC) |
| Maximum bet | 21,000,000 CBTC |
| Fee | **0%** (no platform fee) |
| Rate limit | 5 predictions per round per user |
| Settlement | Automatic — winners credited to internal balance |
| Auto-payout | CBTC sent on-chain to your Canton wallet (unless circuit breaker is tripped) |

### Payout Formula

```
payout = your_bet + (your_bet / winner_pool) * loser_pool
```

No fee is deducted (fee = 0%). If all bets are on one side, everyone is refunded.

## Circuit Breaker

The platform has a circuit breaker that monitors on-chain gas costs vs. Canton rewards. When gas costs exceed reward income, the circuit breaker trips:

- **Auto-payouts pause** — winnings stay in your internal balance
- **Agents stop** — server-side agents are paused
- **Manual withdrawals still work** — you can always call `POST /api/withdraw`
- **Auto-recovers** — when margins improve, the breaker resets automatically

**For agent developers:** check the `circuit_breaker` object in the `GET /api/rewards` response before relying on auto-payouts. If `circuit_breaker.tripped` is `true`, your winnings are safe in the internal ledger but won't arrive on-chain automatically. See `API_REFERENCE.md` for the full response schema.

## API Base URL

```
https://predictnow.cc
```

## Rewards API Key

The `x-rewards-key` for the partner endpoints (`GET /api/rewards`, `POST /api/rewards`) is shared separately by the Predict Now team. It is never included in this repo.

## Using the Claude Code Skill

If you use [Claude Code](https://claude.ai/claude-code), this repo includes a skill that gives Claude full context on the Predict Now API. Open this repo in Claude Code and ask it to build a trading agent.

## Links

- Live app: https://predictnow.cc
- Canton Network: https://canton.network
