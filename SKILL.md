---
name: predictnow-trading-agent
description: "Complete guide for building and deploying AI trading bots on the PredictNow BTC prediction market. Covers: account setup, Zoro Canton wallet creation, writing trading strategies, deploying agents to Railway, and managing real CBTC trading. Use when: setting up a trading bot, creating a prediction market agent, deploying to PredictNow, writing a trading strategy, connecting to the Canton network for trading."
---

# PredictNow AI Trading Agent — Complete Setup Guide

Build and deploy autonomous AI trading bots on the PredictNow BTC prediction market. Agents place bets on whether BTC price goes UP or DOWN in 1-minute rounds, competing against each other with real CBTC on the Canton blockchain.

---

## Quick Overview

**What you're building:** An autonomous agent that:
1. Signs into PredictNow with its own account
2. Polls BTC price and market status every 30 seconds
3. Decides UP or DOWN using a strategy you define
4. Places minimum bets (0.00001 CBTC = 1000 satoshis)
5. Tracks its own performance (win rate, P&L, streaks)
6. Runs 24/7 on Railway (no local machine needed)

**Architecture:**
```
[Your Agent on Railway]
    |
    |-- Firebase Auth (email/password → ID token)
    |-- PredictNow API (predict, balance, market status)
    |-- Canton Wallet API (wallet ops, CBTC transfers)
    |        |
    |        |-- Option A: Zoro API (dev-api.zorowallet.com)
    |        |-- Option B: Any Canton-compatible wallet SDK
    |        |-- Option C: Skip wallet ops (use admin credit for testing)
    |
[PredictNow Market Server]
    |-- 1-minute rounds (preview) / 15-minute rounds (production)
    |-- BTC price oracle (Binance)
    |-- Settlement + payouts
    |-- Pool wallets (retail / institutional escrow)
```

**Wallet-agnostic design:** The core agent (Firebase auth + PredictNow API + strategy) works independently of which Canton wallet provider you use. Wallet operations (creating wallets, signing transactions, transferring CBTC) are a separate layer. You can:
- Use **Zoro API** if you have access (documented below)
- Use **any Canton SDK** that supports Ed25519 signing + the standard Canton transaction model
- **Skip wallet ops entirely** for testing — use the admin credit endpoint to fund agent balances manually

---

## Step 1: Prerequisites

You need:
- **Node.js 20+** and **npm**
- **Railway account** (hobby plan, $5/month) — https://railway.app
- **PredictNow invite code** (get from the team)
- **Zoro API key** (for Canton wallet operations)

Install the Railway CLI:
```bash
npm install -g @railway/cli
railway login
```

---

## Step 2: Create a Canton Wallet

Each agent needs its own Canton wallet (a party ID on the Canton network). You have several options:

### Option A: Use Zoro API (recommended if you have access)

> For complete Zoro API docs, credentials, and gotchas, read the skill at `~/.claude/skills/zoro-wallet-api/SKILL.md`

### Option B: Use any Canton-compatible wallet SDK
Any SDK that can:
1. Generate Ed25519 key pairs
2. Onboard a party to the Canton network
3. Sign transactions (prepare → sign hash → broadcast)
4. Send/receive CBTC and CC (Amulet) tokens

The Canton transaction model is the same regardless of provider:
- `POST .../prepare/<action>` → returns `{ commandId, command: { preparedTransactionHash } }`
- Sign `preparedTransactionHash` with Ed25519 private key
- `POST .../broadcast` → returns `{ transactionId }`

### Option C: Skip wallet ops (testing only)
For quick testing, skip wallet creation entirely. Use the admin credit endpoint to fund agent balances directly. You still need a Canton party ID (ask the team for a pre-created one), but no wallet signing is needed.

### 2a. Generate Ed25519 keys (all providers)

```typescript
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha512";
ed.etc.sha512Sync = sha512;

const privateKeyBytes = ed.utils.randomPrivateKey();
const publicKeyBytes = ed.getPublicKey(privateKeyBytes);
const privateKey = Buffer.from(privateKeyBytes).toString("base64");
const publicKey = Buffer.from(publicKeyBytes).toString("base64");
```

Dependencies: `@noble/ed25519@^2.2.0`, `@noble/hashes@^1.7.0`

### 2b. Onboard the party (Zoro example — adapt for your provider)

```bash
# Step 1: Prepare
curl -X POST "<ZORO_BASE_URL>/canton/transaction/prepare/external-party" \
  -H "Authorization: Bearer <ZORO_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"publicKey": "<BASE64_PUBLIC_KEY>"}'
# Returns: { partyId, topologyTransactions, multiHash, publicKeyFingerprint }

# Step 2: Sign the multiHash (NOT preparedTransactionHash) with Ed25519
# Step 3: Broadcast
curl -X POST "<ZORO_BASE_URL>/canton/transaction/broadcast/external-party" \
  -H "Authorization: Bearer <ZORO_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"signature": "<BASE64_SIG>", "preparedParty": { "partyId": "...", "topologyTransactions": [...], "multiHash": "...", "publicKeyFingerprint": "..." }}'
```

### 2c. Set up the wallet for receiving (Zoro example)

After onboarding, the wallet needs merge delegation and transfer pre-approvals:

```bash
# Merge delegation (required for UTXO management)
POST /canton/transaction/prepare/merge-delegation-proposal
Body: { "partyId": "<AGENT_PARTY_ID>" }
# → sign preparedTransactionHash → broadcast

# CC (Amulet) pre-approval (auto-accept CC transfers)
POST /canton/transaction/prepare/transfer-preapproval
Body: { "partyId": "<AGENT_PARTY_ID>", "instrument": { "id": "Amulet", "admin": "<CC_ADMIN>" } }
# → sign → broadcast

# CBTC pre-approval (auto-accept CBTC transfers)
POST /canton/transaction/prepare/transfer-preapproval
Body: { "partyId": "<AGENT_PARTY_ID>", "instrument": { "id": "CBTC", "admin": "<CBTC_ADMIN>" } }
# → sign → broadcast
```

Wait 3 seconds between each transaction (0.5 TPS rate limit).

### 2d. Fund with CC (gas) — required regardless of provider

The wallet needs CC (Canton Coin / Amulet) to pay transaction fees. CBTC transfers cost ~3.02 CC each in gas. Send at least 10 CC from a funded wallet.

**CRITICAL:** Use full ISO timestamp for expiry (not date-only). Date-only format causes "lock expires before amulet" errors.
```typescript
const expiryDate = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();
// Good: "2026-03-25T10:55:09.091Z"
// Bad:  "2026-03-26" ← causes lock timing errors
```

---

## Step 3: Create a PredictNow Account

Each agent needs its own Firebase account linked to its Canton wallet.

### 3a. Create Firebase account

```bash
curl -X POST "https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=<FIREBASE_WEB_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"email":"my-agent@example.com","password":"SecurePassword123!","returnSecureToken":true}'
# Returns: { idToken, localId (uid), refreshToken }
```

### 3b. Verify with invite code

```bash
curl -X POST "<MARKET_URL>/api/auth/verify" \
  -H "Authorization: Bearer <ID_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"invite_code":"<INVITE_CODE>"}'
# Returns: { uid, email, tier, pool_wallet_id }
```

**Invite code tiers:**
- `retail` — trades against the retail pool
- `institutional` — trades against an institutional pool (e.g., `INST-ALPHA`)
- Master codes (unlimited uses) are available from the team

### 3c. Link Canton wallet

```bash
curl -X POST "<MARKET_URL>/api/auth/link-party" \
  -H "Authorization: Bearer <ID_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"party_id":"<AGENT_CANTON_PARTY_ID>"}'
```

Each Canton wallet can only be linked to one account. To re-link, the old account must be deleted first (admin endpoint).

---

## Step 4: Write a Trading Strategy

A strategy is a single function. It receives market context and returns a bet decision (or null to skip).

### The Strategy Interface

```typescript
type Strategy = (ctx: TradeContext) => TradeDecision | null;

interface TradeContext {
  price: { price: number; change24h: number };           // current BTC price
  round: { status: string; round_number: number;          // current round
            total_up_amount: number; total_down_amount: number;
            time_remaining_ms: number };
  history: RoundResult[];    // last N settled rounds (winning_direction, prices, volumes)
  myBets: MyBetOutcome[];    // my past bets with outcomes (won, pnl)
  balance: number;           // my current CBTC balance
  stats: AgentStats;         // my win rate, streak, total PnL
  config: Record<string, number>;  // tunable parameters
}

interface TradeDecision {
  direction: "UP" | "DOWN";
  amount: number;            // minimum: 0.00001 CBTC
  reason?: string;           // logged for debugging
}
```

### Example: Coin Flip (baseline)

```typescript
const coinFlip: Strategy = (ctx) => {
  const MIN_BET = 0.00001;
  if (MIN_BET > ctx.balance) return null;
  return {
    direction: Math.random() < 0.5 ? "UP" : "DOWN",
    amount: MIN_BET,
    reason: "coin-flip",
  };
};
```

### Example: Contrarian (bet against the crowd)

```typescript
const contrarian: Strategy = (ctx) => {
  const MIN_BET = 0.00001;
  if (MIN_BET > ctx.balance) return null;

  const up = ctx.round.total_up_amount ?? 0;
  const down = ctx.round.total_down_amount ?? 0;

  let direction: "UP" | "DOWN";
  if (up > down) direction = "DOWN";        // majority UP → bet DOWN
  else if (down > up) direction = "UP";     // majority DOWN → bet UP
  else direction = "DOWN";                   // empty/tied → default DOWN

  return { direction, amount: MIN_BET, reason: "contrarian" };
};
```

### Example: Game Theory (Tit-for-Tat + Mean Reversion)

```typescript
const gameTheory: Strategy = (ctx) => {
  const MIN_BET = 0.00001;
  if (MIN_BET > ctx.balance) return null;

  // Mean reversion: 3+ rounds same direction → bet opposite
  if (ctx.history.length >= 3) {
    const last3 = ctx.history.slice(0, 3).map(r => r.winning_direction);
    if (last3.every(d => d === "UP")) return { direction: "DOWN", amount: MIN_BET, reason: "mean-reversion" };
    if (last3.every(d => d === "DOWN")) return { direction: "UP", amount: MIN_BET, reason: "mean-reversion" };
  }

  // Tit-for-tat: repeat what worked, switch what didn't
  if (ctx.myBets.length > 0) {
    const last = ctx.myBets[0];
    const direction = last.won ? last.direction : (last.direction === "UP" ? "DOWN" : "UP");
    return { direction, amount: MIN_BET, reason: "tit-for-tat" };
  }

  // Opening move: follow price trend
  return {
    direction: (ctx.price?.change24h ?? 0) >= 0 ? "UP" : "DOWN",
    amount: MIN_BET,
    reason: "opening-move",
  };
};
```

### Strategy Tips
- `ctx.history` is sorted newest-first (index 0 = most recent settled round)
- `ctx.myBets` is also newest-first, includes `won` and `pnl` fields
- `ctx.stats.currentStreak` is positive for win streaks, negative for losses
- Return `null` to skip a round (counted in `stats.totalSkipped`)
- The `reason` field is logged — use it for debugging
- `ctx.round.total_up_amount` / `total_down_amount` show current round's pool — useful for contrarian strategies

---

## Step 5: Set Up the Agent Project

### 5a. Project structure

```
my-agent/
  package.json
  tsconfig.json
  src/
    cli.ts              # Entry point
    agent.ts            # Agent class (tick loop)
    factory.ts          # Creates and manages agents
    market-client.ts    # HTTP client with Firebase auth
    strategies/
      my-strategy.ts    # Your custom strategy
```

### 5b. package.json

```json
{
  "name": "my-predictnow-agent",
  "version": "0.1.0",
  "type": "module",
  "scripts": { "start": "tsx src/cli.ts" },
  "dependencies": {
    "@noble/ed25519": "^2.2.0",
    "@noble/hashes": "^1.7.0",
    "tsx": "^4.7.0"
  },
  "devDependencies": { "typescript": "^5.4.0" }
}
```

### 5c. Key env vars

```bash
# Market server
MARKET_URL=<PREDICT_NOW_URL>        # e.g., https://predict-now-preview-production.up.railway.app

# Firebase auth (per agent)
FIREBASE_API_KEY=<FIREBASE_WEB_API_KEY>
AGENT_EMAIL_1=agent1@example.com
AGENT_PASS_1=SecurePassword123!
AGENT_EMAIL_2=agent2@example.com
AGENT_PASS_2=SecurePassword456!

# Agent Canton wallet party IDs
PARTY_ID_1=<CANTON_PARTY_ID_1>
PARTY_ID_2=<CANTON_PARTY_ID_2>

# Polling
POLL_MS=30000                        # 30 seconds between ticks

# Zoro Canton API (for deposit manager)
ZORO_BASE_URL=<ZORO_API_URL>
ZORO_API_KEY=<ZORO_API_KEY>
INSTITUTIONAL_POOL_PARTY_ID=<POOL_PARTY_ID>
INSTRUMENT_ID=CBTC
INSTRUMENT_ADMIN=<CBTC_ADMIN>

# Agent wallet keys (for CBTC deposit forwarding)
PRIVATE_KEY_1=<BASE64_PRIVATE_KEY>
PUBLIC_KEY_1=<BASE64_PUBLIC_KEY>
```

---

## Step 6: Firebase Auth in the Agent

The MarketClient handles Firebase authentication automatically:

```typescript
class MarketClient {
  private firebaseAuth?: { email: string; password: string; apiKey: string };
  private idToken?: string;
  private refreshToken?: string;
  private tokenExpiresAt = 0;

  setFirebaseAuth(auth: FirebaseAuth): void { this.firebaseAuth = auth; }

  // Called automatically before each API request
  private async ensureFirebaseToken(): Promise<void> {
    if (!this.firebaseAuth) return;
    if (this.idToken && Date.now() < this.tokenExpiresAt - 60000) return;

    // Try refresh first, then full sign-in
    // Tokens expire after 1 hour — auto-refreshed
  }

  async placeBet(partyId: string, direction: "UP" | "DOWN", amount: number) {
    await this.ensureFirebaseToken();
    return this.post("/api/predict", { direction, amount });
  }
}
```

Each agent gets its own MarketClient with its own Firebase credentials:
```typescript
factory.create({
  name: "my-agent",
  partyId: PARTY_ID_1,
  strategy: myStrategy,
  firebaseAuth: { email: AGENT_EMAIL_1, password: AGENT_PASS_1, apiKey: FIREBASE_API_KEY },
});
```

---

## Step 7: PredictNow API Reference

All endpoints at `<MARKET_URL>/api/...`

### Public (no auth)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/btc-price` | GET | Current BTC price, 24h change |
| `/api/market/status` | GET | Active round info (number, time remaining, pool sizes) |
| `/api/results/history?limit=20` | GET | Settled rounds with outcomes |
| `/api/results/:roundNumber` | GET | Specific round result |
| `/api/pool-info` | GET | Pool wallet address, fee percentage |

### Authenticated (Firebase ID token)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/predict` | POST | Place a bet: `{ direction: "UP"\|"DOWN", amount: number }` |
| `/api/deposit` | POST | Trigger deposit detection (scans Canton for incoming CBTC) |
| `/api/withdraw` | POST | Withdraw CBTC: `{ amount: number }` |
| `/api/balance` | GET | Your internal CBTC balance |
| `/api/bets` | GET | Your bet history |
| `/api/auth/verify` | POST | Register/verify: `{ invite_code: "..." }` |
| `/api/auth/link-party` | POST | Link Canton wallet: `{ party_id: "..." }` |

### Key constraints
- **Min bet:** 0.00001 CBTC (1000 satoshis) — may vary by server config
- **Max bet:** 21,000,000 CBTC
- **Rate limit:** 5 predictions per user per round (15-min cooldown window)
- **Fee:** configurable (1% on preview, 10% default) — taken from losing pool
- **Round duration:** ~1 minute on preview, configurable per server
- **Withdrawal anti-fraud:** blocked if total_withdrawn > total_deposited (admin approval needed)

### Payout formula (how winners get paid)
```
winnerShare = myBetAmount / totalWinningPoolAmount
loserPoolAfterFee = totalLosingPool * (1 - feePercentage / 100)
payout = myBetAmount + (loserPoolAfterFee * winnerShare)
```
If no losers (everyone bet the same direction), bets are refunded.

### Response formats to watch for

**BTC Price** — the API may return `change_24h` (snake_case) or `change24h` (camelCase) depending on the server version. Normalize in your client:
```typescript
async getPrice(): Promise<BTCPrice> {
  const raw = await this.get("/api/btc-price");
  if (raw.change_24h !== undefined) raw.change24h = raw.change_24h;
  return raw;
}
```

---

## Step 8: Deploy to Railway

### 8a. Create project

```bash
cd my-agent
railway init --name "my-trading-agent"
```

### 8b. Set env vars

```bash
railway variable set \
  MARKET_URL="<PREDICT_NOW_URL>" \
  FIREBASE_API_KEY="<KEY>" \
  AGENT_EMAIL_1="agent1@example.com" \
  AGENT_PASS_1="SecurePassword123!" \
  PARTY_ID_1="<CANTON_PARTY_ID>" \
  POLL_MS="30000"
```

### 8c. Deploy

```bash
railway up --detach
```

### 8d. Monitor

```bash
railway service logs -n 30          # recent logs
railway service status              # deployment status
railway service redeploy --yes      # restart after changes
```

### Railway tips
- **Hobby plan:** $5/month, unlimited projects, ~500 compute hours
- **No git needed:** `railway up` deploys directly from your directory
- **Auto-restart:** Railway restarts crashed services automatically
- **Env var changes** trigger redeployment automatically
- **RAILWAY_ROOT_DIRECTORY:** If deploying a subdirectory, set this env var
- When deploying a subdirectory, run `railway up` FROM that directory

---

## Step 9: Funding Your Agent with CBTC

Agents need CBTC balance to place bets. Three approaches:

### Approach A: Admin credit (simplest, for testing)
Ask a platform admin to credit your agent's balance directly. No wallet operations needed.

### Approach B: On-chain deposit
1. Send CBTC from your wallet to the agent's Canton wallet
2. With transfer pre-approval enabled, CBTC auto-accepts
3. The **deposit manager** (optional component) forwards CBTC to the pool and credits internal balance
4. Or call `POST /api/deposit` (authenticated) to trigger manual deposit detection

### Approach C: Direct pool funding
Send CBTC directly to the pool wallet, then admin-credit the agent.

Admin credit endpoint (requires admin secret):
```bash
curl -X POST "<MARKET_URL>/admin/credit" \
  -H "X-Admin-Secret: <ADMIN_SECRET>" \
  -H "Content-Type: application/json" \
  -d '{"email":"agent1@example.com","amount":0.0001,"reason":"initial funding"}'
```

---

## Step 10: Monitoring & Debugging

### Check agent stats via logs
Agents print stats every 5 minutes:
```
momentum    | 15 trades | WR: 60.0% | PnL: +0.00003 | Streak: 2
contrarian  | 15 trades | WR: 40.0% | PnL: -0.00002 | Streak: -1
```

### Check via API
```bash
# Recent rounds with bets
curl "<MARKET_URL>/api/results/history?limit=10"

# Agent balance (requires auth)
curl "<MARKET_URL>/api/balance" -H "Authorization: Bearer <TOKEN>"

# Admin: view specific user
curl "<MARKET_URL>/admin/user?email=agent1@example.com" \
  -H "X-Admin-Secret: <ADMIN_SECRET>"
```

### Common issues

| Error | Cause | Fix |
|-------|-------|-----|
| `Invalid amount (must be 0.00001-...)` | Balance below minimum bet | Fund the agent with more CBTC |
| `Rate limit exceeded` | Too many bets per round | Mark `lastBetRound` on failure too, not just success |
| `No active market round` | Between rounds | Normal — agent waits for next round |
| `Unauthorized: missing or invalid token` | Firebase token expired | Ensure `ensureFirebaseToken()` is called before API requests |
| `lock expires before amulet` | Bad expiry date format | Use full ISO timestamp, not date-only |
| `No input utxos found for instrument Amulet` | Wallet has no CC for gas | Fund wallet with CC (Amulet) first |
| `AmuletTransferInstruction not found` | Stale pending transfer | Transfer may have expired — send a fresh one |

---

## Complete Checklist

- [ ] Generate Ed25519 key pair for agent wallet
- [ ] Onboard party via Zoro API
- [ ] Set up merge delegation + CC and CBTC pre-approvals
- [ ] Fund wallet with CC (gas, at least 10 CC)
- [ ] Create Firebase account for agent
- [ ] Verify account with invite code on PredictNow
- [ ] Link Canton wallet to Firebase account
- [ ] Write your trading strategy
- [ ] Set up the agent project (package.json, tsconfig, source files)
- [ ] Test locally: `MARKET_URL=<url> npm start`
- [ ] Deploy to Railway
- [ ] Fund agent with CBTC (send to wallet or admin credit)
- [ ] Monitor logs and performance
