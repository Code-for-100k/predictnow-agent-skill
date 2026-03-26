---
name: predictnow-agent
description: "Build trading agents for Predict Now (predictnow.cc) — a BTC prediction market on Canton Network. Use when: building a trading bot, placing predictions via API, checking market status, managing deposits/withdrawals, or any development against the Predict Now API. Trigger on: predictnow, prediction market, BTC bet, trading agent, UP DOWN, market round, CBTC bet, predictnow API."
---

# Predict Now — Agent Development Guide

**Production URL:** `https://predictnow.cc`
**API Reference:** See `API_REFERENCE.md` in this repo for full endpoint documentation.

## What is Predict Now?

A BTC prediction market on Canton Network. Users predict whether Bitcoin price goes **UP** or **DOWN** in 1-minute rounds. Winners split the loser pool proportionally (minus 1% fee). All bets use **CBTC** (Canton BTC).

## Quick Start: Build a Trading Agent

### 1. Sign Up & Get Auth Token

```javascript
// Firebase email/password auth
const res = await fetch(
  `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=AIzaSyAALLUn5YsJNkXc0f7dKpgerJcmH4YPsUw`,
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

Or use Google Sign-In via the Firebase Web SDK. Get Firebase config from `GET /api/firebase-config`.

### 2. Core Agent Loop

```javascript
const BASE = "https://predictnow.cc";

async function agentLoop(token) {
  while (true) {
    // 1. Check market status
    const status = await fetch(`${BASE}/api/market/status`).then(r => r.json());

    if (status.status === "active" && status.time_remaining_ms > 5000) {
      // 2. Decide direction (your strategy here)
      const direction = status.up_amount > status.down_amount ? "DOWN" : "UP";

      // 3. Place bet (minimum 10 satoshi = 0.0000001 CBTC)
      const bet = await fetch(`${BASE}/api/predict`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ direction, amount: 0.0000001 }),
      }).then(r => r.json());

      console.log(`Round ${status.round_number}: ${direction} ${bet.amount} CBTC`);
    }

    // 4. Wait before next poll (10s for 1-min rounds)
    await new Promise(r => setTimeout(r, 10000));
  }
}
```

### 3. Key API Endpoints

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/market/status` | GET | No | Current round, pools, time remaining |
| `/api/btc-price` | GET | No | Live BTC price + 24h change |
| `/api/results/history?limit=50` | GET | No | Recent settled rounds |
| `/api/results/latest` | GET | No | Last settled round with predictions |
| `/api/predict` | POST | Yes | Place a bet (UP/DOWN + amount) |
| `/api/balance` | GET | Yes | Your balance + stats |
| `/api/bets` | GET | Yes | Your bet history |
| `/api/deposit` | POST | Yes | Verify & credit CBTC deposits |
| `/api/withdraw` | POST | Yes | Withdraw CBTC to Canton wallet |
| `/api/auth/verify` | POST | Yes | Register/login (needs invite_code for new users) |
| `/api/auth/link-party` | POST | Yes | Link a Canton wallet |
| `/api/pool-info` | GET | No | Pool wallet address for deposits |
| `/api/rewards` | GET | Partner key | Reward/txn, gas/txn, net/txn metrics |

**Partner endpoints** require `x-rewards-key` header (provided by Predict Now team).

### 4. Market Rules

- **Round duration:** 1 minute
- **Minimum bet:** 0.0000001 CBTC (10 satoshi)
- **Maximum bet:** 21,000,000 CBTC
- **Fee:** 0% (no platform fee currently)
- **Rate limit:** 5 predictions per round per user
- **Settlement:** Automatic. Winners credited to internal balance. Auto-payout sends CBTC on-chain.
- **No losers = refund:** If all bets are on one side, everyone gets refunded.

### 5. Payout Formula

```
payout = original_bet + (your_bet / winner_pool) × loser_pool × 0.99
```

### 6. Strategy Tips

- **Always bet both sides** across multiple agents for guaranteed settlement activity
- **Check `time_remaining_ms`** — don't bet in the last 5 seconds
- **Use `results/history`** to analyze recent winning directions
- **Monitor `up_amount` vs `down_amount`** for contrarian edge when pools are lopsided
- **Minimum bets (10 sats)** keep costs near zero while generating transaction volume

### 7. Invite Codes

New users need an invite code on first `/api/auth/verify` call:
- Master code: `PREDICT-NOW` (unlimited uses, retail tier)

### 8. Deposit Flow

1. Get pool address: `GET /api/pool-info` → `pool_party_id`
2. Send CBTC from your Canton/Zoro wallet to that party ID
3. Call `POST /api/deposit` to scan and credit your balance
4. Wait 30s and retry if Canton settlement is still processing

## Reference

- Full API docs: `API_REFERENCE.md`
- Live app: https://predictnow.cc
- Canton Network: https://canton.network
- Zoro Wallet API: https://dev-api.zorowallet.com
