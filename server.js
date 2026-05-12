const express = require("express");
const { Pool } = require("pg");
const path = require("path");

const app = express();
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
});

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

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
  await pool.query(`
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS received BOOLEAN DEFAULT FALSE
  `);
}

// POST /api/orders — 注文を保存
app.post("/api/orders", async (req, res) => {
  const { customerName, items, total, paymentMethod } = req.body;
  if (!customerName || !items || total == null || !paymentMethod) {
    return res.status(400).json({ error: "missing fields" });
  }
  try {
    const result = await pool.query(
      "INSERT INTO orders (customer_name, items, total, payment_method) VALUES ($1, $2, $3, $4) RETURNING *",
      [customerName, JSON.stringify(items), total, paymentMethod]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "db error" });
  }
});

// PATCH /api/orders/:id/received?key=ADMIN_KEY — 受け取りステータスを更新
app.patch("/api/orders/:id/received", async (req, res) => {
  if (req.query.key !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: "unauthorized" });
  }
  const { received } = req.body;
  if (typeof received !== "boolean") {
    return res.status(400).json({ error: "received must be boolean" });
  }
  try {
    const result = await pool.query(
      "UPDATE orders SET received = $1 WHERE id = $2 RETURNING *",
      [received, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "not found" });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "db error" });
  }
});

// GET /api/orders?key=ADMIN_KEY — 全注文取得（管理者のみ）
app.get("/api/orders", async (req, res) => {
  if (req.query.key !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: "unauthorized" });
  }
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

const PORT = process.env.PORT || 3000;
initDb()
  .then(() => app.listen(PORT, () => console.log(`Server running on port ${PORT}`)))
  .catch(err => { console.error("DB init failed:", err); process.exit(1); });
