// ── 商品定義（サーバーの /api/menu から取得） ──
let MENU = [];
const TICKET_STORAGE_KEY = "lastTicket";
let currentOrder = null; // 注文番号画面に表示中の注文

// ── カート状態 ──
const cart = {};

function findItem(key) {
  return MENU.find(m => m.key === key);
}

// ── メニュー取得 ──
async function loadMenu() {
  try {
    const res = await fetch("/api/menu");
    if (!res.ok) throw new Error();
    MENU = await res.json();
  } catch {
    document.getElementById("set-list").innerHTML =
      '<p class="soup-note">メニューを読み込めませんでした。ページを再読み込みしてください。</p>';
    return;
  }
  for (const m of MENU) {
    // 売り切れになった商品はカートから外す
    cart[m.key] = m.available ? (cart[m.key] || 0) : 0;
  }
  renderMenu();
  updateMenuUI();
}

// ── メニュー描画 ──
function renderMenuItem(item) {
  const isSet = item.type === "set";
  const saving = isSet ? item.regular - item.price : 0;
  return `
    <div class="menu-item ${isSet ? "menu-item--set" : ""} ${item.available ? "" : "is-sold-out"}">
      <div class="menu-info">
        <span class="menu-name">${item.name}${item.badge ? ` <span class="set-badge">${item.badge}</span>` : ""}</span>
        <span class="menu-label">${item.desc}</span>
        <span class="menu-price">
          ${isSet ? `<s class="menu-regular">¥${item.regular.toLocaleString()}</s>` : ""}
          ¥${item.price.toLocaleString()}
          ${isSet ? `<span class="set-saving">¥${saving}お得</span>` : ""}
        </span>
      </div>
      ${item.available ? `
      <div class="counter">
        <button class="counter-btn" onclick="change('${item.key}', -1)">−</button>
        <span class="counter-val" id="qty-${item.key}">0</span>
        <button class="counter-btn" onclick="change('${item.key}', 1)">＋</button>
      </div>` : `<span class="sold-out-label">売り切れ</span>`}
    </div>`;
}

function renderMenu() {
  document.getElementById("set-list").innerHTML =
    MENU.filter(m => m.type === "set").map(renderMenuItem).join("");
  document.getElementById("single-list").innerHTML =
    MENU.filter(m => m.type === "single").map(renderMenuItem).join("");
}

// ── 数量変更 ──
function change(key, delta) {
  cart[key] = Math.min(99, Math.max(0, cart[key] + delta));
  updateMenuUI();
}

// ── メニュー画面の表示更新 ──
function updateMenuUI() {
  for (const key in cart) {
    const el = document.getElementById("qty-" + key);
    if (el) el.textContent = cart[key];
  }
  const total = calcTotal();
  document.getElementById("menu-total").textContent = "¥" + total.toLocaleString();
  document.getElementById("btn-order").disabled = total === 0;
}

// ── 合計計算 ──
function calcTotal() {
  return Object.keys(cart).reduce((sum, key) => sum + cart[key] * findItem(key).price, 0);
}

// ── 確認画面用の注文明細 ──
function buildOrderItems() {
  return Object.keys(cart)
    .filter(key => cart[key] > 0)
    .map(key => {
      const m = findItem(key);
      return { name: m.name, unit: m.desc, qty: cart[key], subtotal: cart[key] * m.price };
    });
}

// ── 注文内容 HTML を生成 ──
function buildOrderSummaryHTML(items) {
  return items
    .map(i => `<li>
      <span>${i.name}（${i.unit}）× ${i.qty}</span>
      <span class="item-price">¥${i.subtotal.toLocaleString()}</span>
    </li>`)
    .join("");
}

// ── 名前入力イベント ──
function onNameInput() {
  const hasName = document.getElementById("customer-name").value.trim().length > 0;
  document.getElementById("btn-issue").disabled = !hasName;
}

// ── 画面切り替え ──
function showScreen(id) {
  document.querySelectorAll(".screen").forEach(el => el.classList.remove("active"));
  document.getElementById("screen-" + id).classList.add("active");
  window.scrollTo(0, 0);
}

function showMessage(id, text) {
  const el = document.getElementById(id);
  el.textContent = text;
  el.style.display = text ? "block" : "none";
}

// ── ② 確認画面へ ──
function goToConfirmScreen() {
  document.getElementById("confirm-order-list").innerHTML = buildOrderSummaryHTML(buildOrderItems());
  document.getElementById("confirm-total").textContent = "¥" + calcTotal().toLocaleString();
  document.getElementById("customer-name").value = "";
  document.getElementById("btn-issue").disabled = true;
  showMessage("issue-error", "");
  showScreen("confirm");
}

// ── 注文を確定（保存して注文番号を受け取る） ──
async function issueTicket() {
  const btn = document.getElementById("btn-issue");
  btn.disabled = true;
  showMessage("issue-error", "");
  try {
    const res = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customerName: document.getElementById("customer-name").value.trim(),
        cart,
      }),
    });
    if (res.status === 409) {
      // 注文中に売り切れた → メニューを更新して選び直してもらう
      await loadMenu();
      showScreen("menu");
      showMessage("menu-error", "申し訳ありません。売り切れの商品があります。もう一度お選びください。");
      return;
    }
    if (!res.ok) throw new Error();
    const order = await res.json();
    try { localStorage.setItem(TICKET_STORAGE_KEY, JSON.stringify(order)); } catch {}
    showTicket(order);
  } catch {
    // 注文番号が必要なので、保存失敗時は再試行してもらう
    showMessage("issue-error", "注文の送信に失敗しました。もう一度お試しください。");
    btn.disabled = false;
  }
}

// ── ③ 注文番号表示 ──
function showTicket(order) {
  currentOrder = order;
  showMessage("ticket-error", "");
  document.getElementById("ticket-number").textContent = order.id;
  document.getElementById("ticket-name").textContent = `${order.customer_name} 様`;
  document.getElementById("ticket-order-list").innerHTML = buildOrderSummaryHTML(order.items);
  document.getElementById("ticket-total").textContent = "¥" + Number(order.total).toLocaleString();
  showScreen("ticket");
}

// 注文番号画面から注文を更新する（受け取り・取り消し共通）
function postOrderAction(action) {
  return fetch(`/api/orders/${currentOrder.id}/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: currentOrder.token }),
  });
}

function showDone(title) {
  clearTicket();
  document.getElementById("done-title").textContent = title;
  document.getElementById("done-number").textContent = `注文番号 ${currentOrder.id}`;
  showScreen("done");
}

// ── 受け取りました ──
async function markReceived() {
  if (!confirm("商品を受け取りましたか？")) return;
  showMessage("ticket-error", "");
  try {
    const res = await postOrderAction("receive");
    if (!res.ok) throw new Error();
    showDone("ありがとうございました！");
  } catch {
    showMessage("ticket-error", "送信に失敗しました。もう一度お試しください。");
  }
}

// ── 注文を取り消す ──
async function cancelOrder() {
  if (!confirm("この注文を取り消しますか？")) return;
  showMessage("ticket-error", "");
  try {
    const res = await postOrderAction("cancel");
    if (res.status === 409) {
      showMessage("ticket-error", "お受け取り済みのため取り消しできません。");
      return;
    }
    if (!res.ok) throw new Error();
    showDone("注文を取り消しました");
  } catch {
    showMessage("ticket-error", "送信に失敗しました。もう一度お試しください。");
  }
}

function clearTicket() {
  try { localStorage.removeItem(TICKET_STORAGE_KEY); } catch {}
}

// ── 新しく注文する ──
function startNewOrder() {
  clearTicket();
  for (const key in cart) cart[key] = 0;
  showMessage("menu-error", "");
  loadMenu();
  showScreen("menu");
}

// ── 初期化 ──
loadMenu();

// 再読み込みしても注文番号を表示し続ける
try {
  const saved = JSON.parse(localStorage.getItem(TICKET_STORAGE_KEY));
  if (saved) showTicket(saved);
} catch {}
