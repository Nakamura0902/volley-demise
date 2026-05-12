let adminKey = "";

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
      document.getElementById("login-overlay").style.display = "none";
      document.getElementById("admin-content").style.display = "block";
      renderOrders(data);
    })
    .catch(err => {
      if (err.message === "unauthorized") {
        document.getElementById("login-error").style.display = "block";
      }
    });
}

function loadOrders() {
  fetch("/api/orders?key=" + encodeURIComponent(adminKey))
    .then(r => r.json())
    .then(renderOrders)
    .catch(() => {
      document.getElementById("orders-container").innerHTML =
        '<div class="empty-state">データ取得に失敗しました</div>';
    });
}

function renderOrders(orders) {
  renderStats(orders);

  if (orders.length === 0) {
    document.getElementById("orders-container").innerHTML =
      '<div class="empty-state">まだ注文がありません</div>';
    return;
  }

  const rows = orders.map(o => {
    const items = (o.items || [])
      .map(i => `${i.name}（${i.unit}）× ${i.qty}`)
      .join("<br>");
    const badge = o.payment_method === "paypay"
      ? '<span class="badge badge-paypay">PayPay</span>'
      : '<span class="badge badge-cash">現金</span>';
    const time = new Date(o.created_at).toLocaleString("ja-JP", {
      month: "numeric", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
    return `
      <tr>
        <td data-label="時刻">${time}</td>
        <td data-label="お名前"><strong>${esc(o.customer_name)}</strong></td>
        <td data-label="注文内容">${items}</td>
        <td data-label="合計">¥${Number(o.total).toLocaleString()}</td>
        <td data-label="支払方法">${badge}</td>
      </tr>`;
  }).join("");

  document.getElementById("orders-container").innerHTML = `
    <table class="order-table">
      <thead>
        <tr>
          <th>時刻</th>
          <th>お名前</th>
          <th>注文内容</th>
          <th>合計</th>
          <th>支払方法</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderStats(orders) {
  const totalSales = orders.reduce((s, o) => s + Number(o.total), 0);
  const cashCount = orders.filter(o => o.payment_method === "cash").length;
  const paypayCount = orders.filter(o => o.payment_method === "paypay").length;

  document.getElementById("admin-stats").innerHTML = `
    <div class="stat-card">
      <div class="stat-label">注文数</div>
      <div class="stat-value">${orders.length}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">売上合計</div>
      <div class="stat-value">¥${totalSales.toLocaleString()}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">現金</div>
      <div class="stat-value">${cashCount}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">PayPay</div>
      <div class="stat-value">${paypayCount}</div>
    </div>`;
}

function esc(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
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
    .then(data => {
      document.getElementById("login-overlay").style.display = "none";
      document.getElementById("admin-content").style.display = "block";
      renderOrders(data);
    })
    .catch(() => sessionStorage.removeItem("adminKey"));
}
