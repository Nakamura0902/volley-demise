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
    const receivedBtn = o.received
      ? `<button class="btn-received received" onclick="toggleReceived(${o.id}, true)">受け取り済み ✓</button>`
      : `<button class="btn-received"           onclick="toggleReceived(${o.id}, false)">未受け取り</button>`;
    const paymentBtn = o.payment_method === "paypay"
      ? (o.payment_confirmed
          ? `<button class="btn-payment-confirm confirmed" onclick="togglePaymentConfirmed(${o.id}, true)">送金済み ✓</button>`
          : `<button class="btn-payment-confirm"           onclick="togglePaymentConfirmed(${o.id}, false)">未確認</button>`)
      : `<span class="badge badge-cash" style="font-size:0.75rem">現金</span>`;
    return `
      <tr id="order-row-${o.id}" class="${o.received ? "row-received" : ""}">
        <td data-label="時刻">${time}</td>
        <td data-label="お名前"><strong>${esc(o.customer_name)}</strong></td>
        <td data-label="注文内容">${items}</td>
        <td data-label="合計">¥${Number(o.total).toLocaleString()}</td>
        <td data-label="支払方法">${badge}</td>
        <td data-label="送金確認">${paymentBtn}</td>
        <td data-label="受け取り">${receivedBtn}</td>
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
          <th>送金確認</th>
          <th>受け取り</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderStats(orders) {
  const totalSales = orders.reduce((s, o) => s + Number(o.total), 0);
  const cashOrders = orders.filter(o => o.payment_method === "cash");
  const paypayOrders = orders.filter(o => o.payment_method === "paypay");
  const cashSales = cashOrders.reduce((s, o) => s + Number(o.total), 0);
  const paypaySales = paypayOrders.reduce((s, o) => s + Number(o.total), 0);
  const pendingCount = orders.filter(o => !o.received).length;

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
      <div class="stat-label">💴 現金売上（${cashOrders.length}件）</div>
      <div class="stat-value">¥${cashSales.toLocaleString()}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">📱 PayPay売上（${paypayOrders.length}件）</div>
      <div class="stat-value">¥${paypaySales.toLocaleString()}</div>
    </div>
    <div class="stat-card stat-card-pending">
      <div class="stat-label">未受け取り</div>
      <div class="stat-value ${pendingCount > 0 ? "stat-pending" : ""}">${pendingCount}</div>
    </div>`;
}

function toggleReceived(id, current) {
  const newVal = !current;
  const row = document.getElementById("order-row-" + id);
  const btn = row.querySelector(".btn-received");

  // 楽観的UI更新
  btn.textContent = newVal ? "受け取り済み ✓" : "未受け取り";
  btn.classList.toggle("received", newVal);
  row.classList.toggle("row-received", newVal);

  fetch(`/api/orders/${id}/received?key=${encodeURIComponent(adminKey)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ received: newVal }),
  })
    .then(r => { if (!r.ok) throw new Error(); return r.json(); })
    .then(updated => {
      // onclick を新しい状態に更新
      btn.setAttribute("onclick", `toggleReceived(${id}, ${updated.received})`);
      // サマリーを再集計するため全データを再取得
      loadOrders();
    })
    .catch(() => {
      // 失敗時は元に戻す
      btn.textContent = current ? "受け取り済み ✓" : "未受け取り";
      btn.classList.toggle("received", current);
      row.classList.toggle("row-received", current);
    });
}

function togglePaymentConfirmed(id, current) {
  const newVal = !current;
  const row = document.getElementById("order-row-" + id);
  const btn = row.querySelector(".btn-payment-confirm");

  btn.textContent = newVal ? "送金済み ✓" : "未確認";
  btn.classList.toggle("confirmed", newVal);

  fetch(`/api/orders/${id}/payment-confirmed?key=${encodeURIComponent(adminKey)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paymentConfirmed: newVal }),
  })
    .then(r => { if (!r.ok) throw new Error(); return r.json(); })
    .then(updated => {
      btn.setAttribute("onclick", `togglePaymentConfirmed(${id}, ${updated.payment_confirmed})`);
      loadOrders();
    })
    .catch(() => {
      btn.textContent = current ? "送金済み ✓" : "未確認";
      btn.classList.toggle("confirmed", current);
    });
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
