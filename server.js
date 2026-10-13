const express = require("express");
const { Pool } = require("pg");
const path = require("path");
const crypto = require("crypto");

const app = express();
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
});

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ── メニュー定義（金額・在庫計算はサーバー側で行う） ──
// yakitori / soup は 1つあたりに使う本数・杯数
const MENU = [
  { key: "setSolo",   type: "set",    name: "ひとりセット",     desc: "焼き鳥3本＋スープ1杯",  price: 300,  regular: 400,  yakitori: 3,  soup: 1 },
  { key: "setCoin",   type: "set",    name: "ワンコインセット", desc: "焼き鳥6本＋スープ1杯",  price: 500,  regular: 700,  yakitori: 6,  soup: 1, badge: "人気No.1" },
  { key: "setPair",   type: "set",    name: "ペアセット",       desc: "焼き鳥8本＋スープ2杯",  price: 700,  regular: 1000, yakitori: 8,  soup: 2 },
  { key: "setFamily", type: "set",    name: "みんなでセット",   desc: "焼き鳥12本＋スープ4杯", price: 1000, regular: 1600, yakitori: 12, soup: 4, badge: "いちばんお得" },
  { key: "yakitori",  type: "single", name: "焼き鳥",           desc: "1本",                   price: 100,  yakitori: 1, soup: 0 },
  { key: "soup",      type: "single", name: "コンソメスープ",   desc: "1杯",                   price: 100,  yakitori: 0, soup: 1 },
];
const STOCK_ITEMS = ["yakitori", "soup"];

// DB初期化（テーブルがなければ作成、カラム追加も冪等に）
async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id            SERIAL PRIMARY KEY,
      customer_name VARCHAR(100) NOT NULL,
      items         JSONB        NOT NULL,
      total         INTEGER      NOT NULL,
      payment_method VARCHAR(20) NOT NULL,
      created_at    TIMESTAMPTZ  DEFAULT NOW()
    )
  `);
  // received: 会計・受け取りが完了したか
  await pool.query(`
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS received BOOLEAN DEFAULT FALSE
  `);
  await pool.query(`
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_confirmed BOOLEAN DEFAULT FALSE
  `);
  // お客様が自分の注文だけを操作できるよう、注文ごとの秘密トークン
  await pool.query(`
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS token VARCHAR(32)
  `);
  // 在庫（remaining が NULL なら無制限）
  await pool.query(`
    CREATE TABLE IF NOT EXISTS stock (
      item      VARCHAR(20) PRIMARY KEY,
      remaining INTEGER,
      sold_out  BOOLEAN DEFAULT FALSE
    )
  `);
  for (const item of STOCK_ITEMS) {
    await pool.query("INSERT INTO stock (item) VALUES ($1) ON CONFLICT (item) DO NOTHING", [item]);
  }
}

function adminOnly(req, res, next) {
  if (req.query.key !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
}

// 注文明細に必要な焼き鳥本数・スープ杯数
function portionsOf(items) {
  const need = { yakitori: 0, soup: 0 };
  for (const i of items) {
    for (const s of STOCK_ITEMS) need[s] += (i[s] || 0) * i.qty;
  }
  return need;
}

function isAvailable(menuItem, stockMap) {
  return STOCK_ITEMS.every(s => {
    if (!menuItem[s]) return true;
    const st = stockMap[s];
    return !st.sold_out && (st.remaining == null || st.remaining >= menuItem[s]);
  });
}

async function getStockMap(db = pool) {
  const result = await db.query("SELECT * FROM stock");
  return Object.fromEntries(result.rows.map(r => [r.item, r]));
}

// 取り消し・削除した注文の分を在庫に戻す
async function restoreStock(db, items) {
  const need = portionsOf(items);
  for (const s of STOCK_ITEMS) {
    if (need[s] > 0) {
      await db.query(
        "UPDATE stock SET remaining = remaining + $1::int WHERE item = $2 AND remaining IS NOT NULL",
        [need[s], s]
      );
    }
  }
}

// トランザクション内で処理を実行
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

class SoldOutError extends Error {}

// GET /api/menu — メニューと売り切れ状況
app.get("/api/menu", async (req, res) => {
  try {
    const stockMap = await getStockMap();
    res.json(MENU.map(m => ({ ...m, available: isAvailable(m, stockMap) })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "db error" });
  }
});

// POST /api/orders — 注文を保存（返り値の id が注文番号）
app.post("/api/orders", async (req, res) => {
  const { customerName, cart } = req.body;
  if (typeof customerName !== "string" || !customerName.trim() || !cart || typeof cart !== "object") {
    return res.status(400).json({ error: "missing fields" });
  }
  const items = [];
  for (const [key, qty] of Object.entries(cart)) {
    const m = MENU.find(x => x.key === key);
    if (!m || !Number.isInteger(qty) || qty < 0 || qty > 99) {
      return res.status(400).json({ error: "invalid cart" });
    }
    if (qty === 0) continue;
    items.push({
      key, name: m.name, unit: m.desc, qty, price: m.price,
      subtotal: m.price * qty, yakitori: m.yakitori, soup: m.soup,
    });
  }
  if (items.length === 0) return res.status(400).json({ error: "empty cart" });
  const total = items.reduce((s, i) => s + i.subtotal, 0);
  const need = portionsOf(items);

  try {
    const order = await withTransaction(async client => {
      const stockRows = await client.query("SELECT * FROM stock FOR UPDATE");
      for (const st of stockRows.rows) {
        const n = need[st.item];
        if (!n) continue;
        if (st.sold_out || (st.remaining != null && st.remaining < n)) throw new SoldOutError();
        await client.query(
          "UPDATE stock SET remaining = remaining - $1::int WHERE item = $2 AND remaining IS NOT NULL",
          [n, st.item]
        );
      }
      const result = await client.query(
        "INSERT INTO orders (customer_name, items, total, payment_method, token) VALUES ($1, $2, $3, $4, $5) RETURNING *",
        [customerName.trim().slice(0, 30), JSON.stringify(items), total, "cash", crypto.randomBytes(16).toString("hex")]
      );
      return result.rows[0];
    });
    res.json(order);
  } catch (err) {
    if (err instanceof SoldOutError) return res.status(409).json({ error: "sold out" });
    console.error(err);
    res.status(500).json({ error: "db error" });
  }
});

// POST /api/orders/:id/receive — お客様が「受け取りました」を押したとき（トークンで本人確認）
app.post("/api/orders/:id/receive", async (req, res) => {
  const { token } = req.body;
  if (typeof token !== "string" || !token) {
    return res.status(400).json({ error: "token required" });
  }
  try {
    const result = await pool.query(
      "UPDATE orders SET received = TRUE, payment_confirmed = TRUE WHERE id = $1 AND token = $2 RETURNING id",
      [req.params.id, token]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "not found" });
    res.json({ received: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "db error" });
  }
});

// POST /api/orders/:id/cancel — お客様による取り消し（受け取り前のみ）
app.post("/api/orders/:id/cancel", async (req, res) => {
  const { token } = req.body;
  if (typeof token !== "string" || !token) {
    return res.status(400).json({ error: "token required" });
  }
  try {
    const cancelled = await withTransaction(async client => {
      const result = await client.query(
        "DELETE FROM orders WHERE id = $1 AND token = $2 AND received = FALSE RETURNING items",
        [req.params.id, token]
      );
      if (result.rows.length === 0) return false;
      await restoreStock(client, result.rows[0].items);
      return true;
    });
    if (!cancelled) return res.status(409).json({ error: "cannot cancel" });
    res.json({ cancelled: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "db error" });
  }
});

// PATCH /api/orders/:id/received?key=ADMIN_KEY — 完了（会計・受け取り）ステータスを更新
app.patch("/api/orders/:id/received", adminOnly, async (req, res) => {
  const { received } = req.body;
  if (typeof received !== "boolean") {
    return res.status(400).json({ error: "received must be boolean" });
  }
  try {
    const result = await pool.query(
      "UPDATE orders SET received = $1, payment_confirmed = $1 WHERE id = $2 RETURNING *",
      [received, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "not found" });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "db error" });
  }
});

// DELETE /api/orders/:id?key=ADMIN_KEY — 注文を削除（未完了なら在庫を戻す）
app.delete("/api/orders/:id", adminOnly, async (req, res) => {
  try {
    const deleted = await withTransaction(async client => {
      const result = await client.query(
        "DELETE FROM orders WHERE id = $1 RETURNING id, items, received",
        [req.params.id]
      );
      if (result.rows.length === 0) return null;
      const row = result.rows[0];
      if (!row.received) await restoreStock(client, row.items);
      return row.id;
    });
    if (deleted == null) return res.status(404).json({ error: "not found" });
    res.json({ deleted });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "db error" });
  }
});

// GET /api/orders?key=ADMIN_KEY — 全注文取得（管理者のみ）
app.get("/api/orders", adminOnly, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM orders ORDER BY created_at DESC"
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "db error" });
  }
});

// GET /api/stock?key=ADMIN_KEY — 在庫取得
app.get("/api/stock", adminOnly, async (req, res) => {
  try {
    res.json(await getStockMap());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "db error" });
  }
});

// PUT /api/stock/:item?key=ADMIN_KEY — 在庫数・売り切れを設定（remaining: null で無制限）
app.put("/api/stock/:item", adminOnly, async (req, res) => {
  const { remaining, soldOut } = req.body;
  if (!STOCK_ITEMS.includes(req.params.item)
    || !(remaining === null || (Number.isInteger(remaining) && remaining >= 0))
    || typeof soldOut !== "boolean") {
    return res.status(400).json({ error: "invalid stock" });
  }
  try {
    const result = await pool.query(
      "UPDATE stock SET remaining = $1, sold_out = $2 WHERE item = $3 RETURNING *",
      [remaining, soldOut, req.params.item]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "db error" });
  }
});

const PORT = process.env.PORT || 3000;
initDb()
  .then(() => app.listen(PORT, () => console.log(`Server running on port ${PORT}`)))
  .catch(err => { console.error("DB init failed:", err); process.exit(1); });
