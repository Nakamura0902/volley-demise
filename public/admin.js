let adminKey = "";
let allOrders = [];
let stock = {};
let currentFilter = "active"; // active: 未完了 / done: 完了 / all: すべて
let searchQuery = "";

const FILTERS = {
  active: { label: "未完了", match: o => !o.received },
  done:   { label: "完了",   match: o => o.received },
  all:    { label: "すべて", match: () => true },
};

const STOCK_LABELS = {
  yakitori: { name: "焼き鳥",         unit: "本", icon: "🍢" },
  soup:     { name: "コンソメスープ", unit: "杯", icon: "🥣" },
};

// 1本・1杯あたりの原価（焼き鳥 50本1500円、スープ 333杯1000円）
const COST = { yakitori: 1500 / 50, soup: 1000 / 333 };

function api(path, options = {}) {
  const sep = path.includes("?") ? "&" : "?";
  return fetch(`${path}${sep}key=${encodeURIComponent(adminKey)}`, {
    ...options,
    headers: { "Content-Type": "application/json" },
  }).then(r => {
    if (r.status === 401) throw new Error("unauthorized");
    if (!r.ok) throw new Error();
    return r.json();
  });
}

function login() {
  adminKey = document.getElementById("admin-password").value;
  api("/api/orders")
    .then(() => {
      sessionStorage.setItem("adminKey", adminKey);
      showAdmin();
    })
    .catch(err => {
      if (err.message === "unauthorized") {
        document.getElementById("login-error").style.display = "block";
      }
    });
}

function showAdmin() {
  document.getElementById("login-overlay").style.display = "none";
  document.getElementById("admin-content").style.display = "block";
  loadOrders();
  // 新しい注文を拾うため定期的に再取得
  setInterval(loadOrders, 15000);
}

function loadOrders() {
  Promise.all([api("/api/orders"), api("/api/stock")])
    .then(([orders, stockMap]) => {
      allOrders = orders;
      stock = stockMap;
      renderAll();
      document.getElementById("last-updated").textContent =
        "最終更新 " + new Date().toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    })
    .catch(() => {
      document.getElementById("orders-container").innerHTML =
        '<div class="empty-state">データ取得に失敗しました</div>';
    });
}

function renderAll() {
  renderStats();
  renderTabs();
  renderOrderList();
  renderStock();
  renderReport();
}

// ── 画面切り替え（注文 / 在庫 / 集計） ──
function setView(view) {
  document.querySelectorAll(".view-tab").forEach(el => el.classList.toggle("active", el.dataset.view === view));
  document.querySelectorAll(".admin-view").forEach(el => el.classList.toggle("active", el.id === "view-" + view));
}

// ── 注文一覧 ──
function setFilter(key) {
  currentFilter = key;
  renderTabs();
  renderOrderList();
}

function onSearchInput() {
  searchQuery = document.getElementById("order-search").value.trim();
  renderOrderList();
}

function renderTabs() {
  document.getElementById("filter-tabs").innerHTML = Object.entries(FILTERS)
    .map(([key, f]) => {
      const count = allOrders.filter(f.match).length;
      return `<button class="filter-tab ${key === currentFilter ? "active" : ""}" onclick="setFilter('${key}')">
        ${f.label}<span class="filter-count">${count}</span>
      </button>`;
    })
    .join("");
}

function renderOrderList() {
  let orders = allOrders.filter(FILTERS[currentFilter].match);

  if (searchQuery) {
    orders = orders.filter(o =>
      String(o.id) === searchQuery || o.customer_name.includes(searchQuery));
  }

  // 未完了は番号順（探しやすさ優先）、それ以外は新しい順
  orders.sort((a, b) => currentFilter === "active" ? a.id - b.id : b.id - a.id);

  const container = document.getElementById("orders-container");
  if (orders.length === 0) {
    container.innerHTML = `<div class="empty-state">${searchQuery ? "該当する注文がありません" : "注文はありません"}</div>`;
    return;
  }
  container.innerHTML = orders.map(renderOrderCard).join("");
}

function renderOrderCard(o) {
  const items = (o.items || [])
    .map(i => `<li><span>${esc(i.name)}<small>（${esc(i.unit)}）</small></span><span>× ${i.qty}</span></li>`)
    .join("");
  const created = new Date(o.created_at);
  const time = created.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
  const date = created.toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" });
  const portions = `🍢${countPortions(o, "yakitori")}本・🥣${countPortions(o, "soup")}杯`;

  return `
    <article class="order-card ${o.received ? "is-done" : ""}">
      <div class="order-card-head">
        <span class="order-no">No.${o.id}</span>
        <span class="order-customer">${esc(o.customer_name)} 様</span>
        <span class="order-time">${date} ${time}</span>
      </div>
      <ul class="order-items">${items}</ul>
      <div class="order-card-foot">
        <span class="order-portions">${portions}</span>
        <span class="order-total-amount">¥${Number(o.total).toLocaleString()}</span>
      </div>
      <div class="order-actions">
        <button class="btn-received ${o.received ? "received" : ""}" onclick="toggleReceived(${o.id}, ${!!o.received})">
          ${o.received ? "完了 ✓" : "会計して渡す"}
        </button>
        <button class="btn-delete" onclick="deleteOrder(${o.id})">削除</button>
      </div>
    </article>`;
}

// 注文に含まれる焼き鳥本数・スープ杯数（セット分も展開）
function countPortions(order, field) {
  return (order.items || []).reduce((s, i) => s + (i[field] || 0) * i.qty, 0);
}

function sumPortions(orders, field) {
  return orders.reduce((s, o) => s + countPortions(o, field), 0);
}

function stockText(item) {
  const st = stock[item];
  if (!st) return "-";
  if (st.sold_out) return "売り切れ";
  return st.remaining == null ? "無制限" : `${st.remaining}${STOCK_LABELS[item].unit}`;
}

function renderStats() {
  const doneOrders = allOrders.filter(o => o.received);
  const sales = doneOrders.reduce((s, o) => s + Number(o.total), 0);
  const pendingOrders = allOrders.filter(o => !o.received);
  const pendingSales = pendingOrders.reduce((s, o) => s + Number(o.total), 0);

  document.getElementById("admin-stats").innerHTML = `
    <div class="stat-card">
      <div class="stat-label">💴 売上（完了 ${doneOrders.length}件）</div>
      <div class="stat-value">¥${sales.toLocaleString()}</div>
    </div>
    <div class="stat-card stat-card-pending">
      <div class="stat-label">未完了（${pendingOrders.length}件・¥${pendingSales.toLocaleString()}）</div>
      <div class="stat-value ${pendingOrders.length > 0 ? "stat-pending" : ""}">🍢${sumPortions(pendingOrders, "yakitori")}本 🥣${sumPortions(pendingOrders, "soup")}杯</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">在庫の残り</div>
      <div class="stat-value stat-value-sm">🍢${stockText("yakitori")} 🥣${stockText("soup")}</div>
    </div>`;
}

// 完了（会計・受け取り）を切り替えて再描画
function toggleReceived(id, current) {
  api(`/api/orders/${id}/received`, { method: "PATCH", body: JSON.stringify({ received: !current }) })
    .then(updated => {
      allOrders = allOrders.map(o => o.id === updated.id ? updated : o);
      renderAll();
    })
    .catch(() => alert("更新に失敗しました。もう一度お試しください。"));
}

function deleteOrder(id) {
  const order = allOrders.find(o => o.id === id);
  if (!confirm(`No.${id}「${order.customer_name}」の注文を削除しますか？\nこの操作は元に戻せません。`)) return;

  api(`/api/orders/${id}`, { method: "DELETE" })
    .then(() => loadOrders())
    .catch(() => alert("削除に失敗しました。もう一度お試しください。"));
}

// ── 在庫 ──
function renderStock() {
  const container = document.getElementById("stock-container");
  // 入力中に自動更新で値が消えないようにする
  if (container.contains(document.activeElement)) return;

  container.innerHTML = Object.entries(STOCK_LABELS).map(([item, label]) => {
    const st = stock[item] || {};
    return `
      <div class="stock-card ${st.sold_out ? "is-sold-out" : ""}">
        <div class="stock-head">
          <span class="stock-name">${label.icon} ${label.name}</span>
          <span class="stock-current">${stockText(item)}</span>
        </div>
        <div class="stock-form">
          <label>残り
            <input id="stock-input-${item}" class="stock-input" type="number" min="0" inputmode="numeric"
              value="${st.remaining ?? ""}" placeholder="無制限">
            ${label.unit}
          </label>
          <button class="btn-refresh" onclick="saveStock('${item}')">保存</button>
        </div>
        <button class="btn-sold-out ${st.sold_out ? "active" : ""}" onclick="toggleSoldOut('${item}')">
          ${st.sold_out ? "販売を再開する" : "売り切れにする"}
        </button>
      </div>`;
  }).join("");
}

function updateStock(item, remaining, soldOut) {
  api(`/api/stock/${item}`, { method: "PUT", body: JSON.stringify({ remaining, soldOut }) })
    .then(updated => {
      stock[item] = updated;
      document.activeElement.blur();
      renderAll();
    })
    .catch(() => alert("在庫の更新に失敗しました。"));
}

function saveStock(item) {
  const value = document.getElementById("stock-input-" + item).value.trim();
  const remaining = value === "" ? null : Number(value);
  if (remaining !== null && (!Number.isInteger(remaining) || remaining < 0)) {
    alert("0以上の整数を入力してください");
    return;
  }
  updateStock(item, remaining, stock[item].sold_out);
}

function toggleSoldOut(item) {
  updateStock(item, stock[item].remaining, !stock[item].sold_out);
}

// ── 集計 ──
function renderReport() {
  const doneOrders = allOrders.filter(o => o.received);
  const rows = {};
  for (const o of doneOrders) {
    for (const i of o.items || []) {
      const key = `${i.name}（${i.unit}）`;
      const r = rows[key] || (rows[key] = { qty: 0, sales: 0, cost: 0 });
      r.qty += i.qty;
      r.sales += i.subtotal;
      r.cost += ((i.yakitori || 0) * COST.yakitori + (i.soup || 0) * COST.soup) * i.qty;
    }
  }

  const yen = n => "¥" + Math.round(n).toLocaleString();
  const entries = Object.entries(rows).sort((a, b) => b[1].sales - a[1].sales);
  const total = entries.reduce((t, [, r]) => ({ qty: t.qty + r.qty, sales: t.sales + r.sales, cost: t.cost + r.cost }), { qty: 0, sales: 0, cost: 0 });
  const rate = r => r.sales ? Math.round((r.sales - r.cost) / r.sales * 100) + "%" : "-";

  document.getElementById("report-container").innerHTML = `
    <div class="admin-stats">
      <div class="stat-card"><div class="stat-label">売上</div><div class="stat-value">${yen(total.sales)}</div></div>
      <div class="stat-card"><div class="stat-label">粗利（${rate(total)}）</div><div class="stat-value">${yen(total.sales - total.cost)}</div></div>
      <div class="stat-card"><div class="stat-label">販売数</div><div class="stat-value stat-value-sm">🍢${sumPortions(doneOrders, "yakitori")}本 🥣${sumPortions(doneOrders, "soup")}杯</div></div>
    </div>
    ${entries.length === 0 ? '<div class="empty-state">まだ完了した注文がありません</div>' : `
    <div class="report-table-wrap">
      <table class="report-table">
        <thead><tr><th>メニュー</th><th>数</th><th>売上</th><th>原価</th><th>粗利</th><th>粗利率</th></tr></thead>
        <tbody>
          ${entries.map(([name, r]) => `
            <tr><td>${esc(name)}</td><td>${r.qty}</td><td>${yen(r.sales)}</td><td>${yen(r.cost)}</td><td>${yen(r.sales - r.cost)}</td><td>${rate(r)}</td></tr>`).join("")}
        </tbody>
        <tfoot>
          <tr><td>合計</td><td>${total.qty}</td><td>${yen(total.sales)}</td><td>${yen(total.cost)}</td><td>${yen(total.sales - total.cost)}</td><td>${rate(total)}</td></tr>
        </tfoot>
      </table>
    </div>`}`;
}

function esc(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/'/g, "&#39;")
    .replace(/"/g, "&quot;");
}

// セッションに保存済みのキーで自動ログイン
const saved = sessionStorage.getItem("adminKey");
if (saved) {
  adminKey = saved;
  api("/api/orders")
    .then(showAdmin)
    .catch(() => sessionStorage.removeItem("adminKey"));
}
