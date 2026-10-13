let adminKey = "";
let allOrders = [];
let currentFilter = "active"; // active: 対応中 / done: 完了 / all: すべて
let searchQuery = "";

const FILTERS = {
  active: { label: "対応中", match: o => !o.received },
  done:   { label: "完了",   match: o => o.received },
  all:    { label: "すべて", match: () => true },
};

function login() {
  const pw = document.getElementById("admin-password").value;
  adminKey = pw;
  fetch("/api/orders?key=" + encodeURIComponent(pw))
    .then(r => {
      if (r.status === 401) throw new Error("unauthorized");
      return r.json();
    })
    .then(data => {
      sessionStorage.setItem("adminKey", pw);
      showAdmin(data);
    })
    .catch(err => {
      if (err.message === "unauthorized") {
        document.getElementById("login-error").style.display = "block";
      }
    });
}

function showAdmin(data) {
  document.getElementById("login-overlay").style.display = "none";
  document.getElementById("admin-content").style.display = "block";
  renderOrders(data);
  // 新しい注文を拾うため定期的に再取得
  setInterval(loadOrders, 15000);
}

function loadOrders() {
  fetch("/api/orders?key=" + encodeURIComponent(adminKey))
    .then(r => { if (!r.ok) throw new Error(); return r.json(); })
    .then(renderOrders)
    .catch(() => {
      document.getElementById("orders-container").innerHTML =
        '<div class="empty-state">データ取得に失敗しました</div>';
    });
}

function renderOrders(orders) {
  allOrders = orders;
  renderStats(orders);
  renderTabs();
  renderOrderList();
  document.getElementById("last-updated").textContent =
    "最終更新 " + new Date().toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

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

  // 対応中は古い順（呼び出し順）、それ以外は新しい順
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
  const elapsed = Math.floor((Date.now() - created.getTime()) / 60000);
  const elapsedLabel = !o.received ? `<span class="order-elapsed ${elapsed >= 10 ? "late" : ""}">${elapsed}分経過</span>` : "";
  const portions = `🍢${countPortions(o, "yakitori")}本・🥣${countPortions(o, "soup")}杯`;

  return `
    <article class="order-card ${o.received ? "is-done" : ""}">
      <div class="order-card-head">
        <span class="order-no">No.${o.id}</span>
        <span class="order-customer">${esc(o.customer_name)} 様</span>
        <span class="order-time">${date} ${time}</span>
        ${elapsedLabel}
      </div>
      <ul class="order-items">${items}</ul>
      <div class="order-card-foot">
        <span class="order-portions">${portions}</span>
        <span class="order-total-amount">¥${Number(o.total).toLocaleString()}</span>
      </div>
      <div class="order-actions">
        <button class="btn-payment-confirm ${o.payment_confirmed ? "confirmed" : ""}" onclick="togglePaymentConfirmed(${o.id}, ${!!o.payment_confirmed})">
          ${o.payment_confirmed ? "会計済み ✓" : "未会計"}
        </button>
        <button class="btn-received ${o.received ? "received" : ""}" onclick="toggleReceived(${o.id}, ${!!o.received})">
          ${o.received ? "受け取り済み ✓" : "未受け取り"}
        </button>
        <button class="btn-delete" onclick="deleteOrder(${o.id})">削除</button>
      </div>
    </article>`;
}

// 注文に含まれる焼き鳥本数・スープ杯数（セット分も展開）
function countPortions(order, field) {
  return (order.items || []).reduce((s, i) => s + (i[field] || 0) * i.qty, 0);
}

function renderStats(orders) {
  const paidOrders = orders.filter(o => o.payment_confirmed);
  const paidSales = paidOrders.reduce((s, o) => s + Number(o.total), 0);
  const unpaidSales = orders.filter(o => !o.payment_confirmed).reduce((s, o) => s + Number(o.total), 0);
  const pendingOrders = orders.filter(o => !o.received);
  const pendingYakitori = pendingOrders.reduce((s, o) => s + countPortions(o, "yakitori"), 0);
  const pendingSoup = pendingOrders.reduce((s, o) => s + countPortions(o, "soup"), 0);

  document.getElementById("admin-stats").innerHTML = `
    <div class="stat-card">
      <div class="stat-label">注文数</div>
      <div class="stat-value">${orders.length}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">💴 会計済み売上（${paidOrders.length}件）</div>
      <div class="stat-value">¥${paidSales.toLocaleString()}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">未会計</div>
      <div class="stat-value">¥${unpaidSales.toLocaleString()}</div>
    </div>
    <div class="stat-card stat-card-pending">
      <div class="stat-label">未受け取り（${pendingOrders.length}件）</div>
      <div class="stat-value ${pendingOrders.length > 0 ? "stat-pending" : ""}">🍢${pendingYakitori}本 🥣${pendingSoup}杯</div>
    </div>`;
}

// 状態を更新して再描画（失敗時は元の表示のまま）
function updateOrder(id, field, body) {
  fetch(`/api/orders/${id}/${field}?key=${encodeURIComponent(adminKey)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
    .then(r => { if (!r.ok) throw new Error(); return r.json(); })
    .then(updated => {
      allOrders = allOrders.map(o => o.id === updated.id ? updated : o);
      renderOrders(allOrders);
    })
    .catch(() => alert("更新に失敗しました。もう一度お試しください。"));
}

function toggleReceived(id, current) {
  updateOrder(id, "received", { received: !current });
}

function togglePaymentConfirmed(id, current) {
  updateOrder(id, "payment-confirmed", { paymentConfirmed: !current });
}

function deleteOrder(id) {
  const order = allOrders.find(o => o.id === id);
  if (!confirm(`No.${id}「${order.customer_name}」の注文を削除しますか？\nこの操作は元に戻せません。`)) return;

  fetch(`/api/orders/${id}?key=${encodeURIComponent(adminKey)}`, {
    method: "DELETE",
  })
    .then(r => { if (!r.ok) throw new Error(); return r.json(); })
    .then(() => loadOrders())
    .catch(() => alert("削除に失敗しました。もう一度お試しください。"));
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
  fetch("/api/orders?key=" + encodeURIComponent(saved))
    .then(r => {
      if (!r.ok) throw new Error();
      return r.json();
    })
    .then(showAdmin)
    .catch(() => sessionStorage.removeItem("adminKey"));
}
