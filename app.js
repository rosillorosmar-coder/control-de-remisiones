const money = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
});

const today = () => new Date().toISOString().slice(0, 10);
const uid = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const currency = (value) => money.format(Number(value || 0));
const byDateDesc = (a, b) => (b.date || "").localeCompare(a.date || "");

const blankState = () => ({ clients: [], remissions: [], payments: [], paymentRequests: [], adjustments: [] });
const agingBuckets = [
  { key: "days0To15", label: "0 a 15 días", min: 0, max: 15 },
  { key: "days16To30", label: "16 a 30 días", min: 16, max: 30 },
  { key: "days31To45", label: "31 a 45 días", min: 31, max: 45 },
  { key: "days46To60", label: "46 a 60 días", min: 46, max: 60 },
  { key: "days61Plus", label: "Más de 61 días", min: 61, max: Infinity },
];

let state = blankState();
let currentUser = null;
let users = [];

const els = {
  title: document.querySelector("#viewTitle"),
  views: document.querySelectorAll(".view"),
  navItems: document.querySelectorAll(".nav-item"),
  metricsGrid: document.querySelector("#metricsGrid"),
  agingMetrics: document.querySelector("#agingMetrics"),
  balanceTable: document.querySelector("#balanceTable"),
  activityList: document.querySelector("#activityList"),
  clientsTable: document.querySelector("#clientsTable"),
  agingTable: document.querySelector("#agingTable"),
  remissionsTable: document.querySelector("#remissionsTable"),
  paymentRequestsTable: document.querySelector("#paymentRequestsTable"),
  paymentsTable: document.querySelector("#paymentsTable"),
  adjustmentsTable: document.querySelector("#adjustmentsTable"),
  usersTable: document.querySelector("#usersTable"),
  clientSearch: document.querySelector("#clientSearch"),
  agingSearch: document.querySelector("#agingSearch"),
  remissionSearch: document.querySelector("#remissionSearch"),
  remissionStatusFilter: document.querySelector("#remissionStatusFilter"),
  remissionClientFilter: document.querySelector("#remissionClientFilter"),
  remissionDateFromFilter: document.querySelector("#remissionDateFromFilter"),
  remissionDateToFilter: document.querySelector("#remissionDateToFilter"),
  downloadRemissionTemplateButton: document.querySelector("#downloadRemissionTemplateButton"),
  importRemissionsLabel: document.querySelector("#importRemissionsLabel"),
  importRemissionsInput: document.querySelector("#importRemissionsInput"),
  paymentRequestSearch: document.querySelector("#paymentRequestSearch"),
  paymentRequestMonthFilter: document.querySelector("#paymentRequestMonthFilter"),
  paymentSearch: document.querySelector("#paymentSearch"),
  paymentMonthFilter: document.querySelector("#paymentMonthFilter"),
  adjustmentSearch: document.querySelector("#adjustmentSearch"),
  adjustmentMonthFilter: document.querySelector("#adjustmentMonthFilter"),
  userSearch: document.querySelector("#userSearch"),
  clientForm: document.querySelector("#clientForm"),
  clientFormTitle: document.querySelector("#clientFormTitle"),
  remissionForm: document.querySelector("#remissionForm"),
  remissionFormTitle: document.querySelector("#remissionFormTitle"),
  remissionDeliveryDate: document.querySelector("#remissionDeliveryDate"),
  paymentRequestForm: document.querySelector("#paymentRequestForm"),
  paymentForm: document.querySelector("#paymentForm"),
  userForm: document.querySelector("#userForm"),
  userFormTitle: document.querySelector("#userFormTitle"),
  userPasswordHint: document.querySelector("#userPasswordHint"),
  remissionClient: document.querySelector("#remissionClient"),
  paymentRequestClient: document.querySelector("#paymentRequestClient"),
  paymentRequestFolio: document.querySelector("#paymentRequestFolio"),
  paymentRequestDate: document.querySelector("#paymentRequestDate"),
  paymentRequestRemissions: document.querySelector("#paymentRequestRemissions"),
  paymentRequestNotes: document.querySelector("#paymentRequestNotes"),
  paymentRequestTotal: document.querySelector("#paymentRequestTotal"),
  paymentClient: document.querySelector("#paymentClient"),
  paymentRemission: document.querySelector("#paymentRemission"),
  remissionTotal: document.querySelector("#remissionTotal"),
  dialog: document.querySelector("#detailDialog"),
  passwordDialog: document.querySelector("#passwordDialog"),
  passwordForm: document.querySelector("#passwordForm"),
  passwordHint: document.querySelector("#passwordHint"),
  detailTitle: document.querySelector("#detailTitle"),
  detailContent: document.querySelector("#detailContent"),
  toast: document.querySelector("#toast"),
  appShell: document.querySelector("#appShell"),
  loginScreen: document.querySelector("#loginScreen"),
  loginForm: document.querySelector("#loginForm"),
  loginMessage: document.querySelector("#loginMessage"),
  userChip: document.querySelector("#userChip"),
  adminOnly: document.querySelectorAll(".admin-only"),
  quickRemissionButton: document.querySelector("#quickRemissionButton"),
  clearDataButton: document.querySelector("#clearDataButton"),
  importJsonInput: document.querySelector("#importJsonInput"),
  changePasswordButton: document.querySelector("#changePasswordButton"),
};

async function apiRequest(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || "No se pudo completar la operación");
    error.status = response.status;
    if (response.status === 401 && currentUser && url !== "/api/session") {
      showLogin("Tu sesión venció. Inicia sesión de nuevo para continuar.");
    }
    throw error;
  }
  return data;
}

async function loadState() {
  const data = await apiRequest("/api/state");
  state = {
    clients: data.clients || [],
    remissions: data.remissions || [],
    payments: data.payments || [],
    paymentRequests: data.paymentRequests || [],
    adjustments: data.adjustments || [],
  };
}

async function loadUsers() {
  if (currentUser?.role !== "admin") {
    users = [];
    return;
  }

  const data = await apiRequest("/api/users");
  users = data.users || [];
}

async function saveState() {
  const saved = await apiRequest("/api/state", {
    method: "PUT",
    body: JSON.stringify(state),
  });
  if (saved.clients) {
    state = {
      clients: saved.clients || [],
      remissions: saved.remissions || [],
      payments: saved.payments || [],
      paymentRequests: saved.paymentRequests || [],
      adjustments: saved.adjustments || [],
    };
  }
}

function can(permission) {
  const role = currentUser?.role;
  if (role === "admin") return true;

  const permissions = {
    editClients: role === "captura",
    editRemissions: role === "captura",
    editPaymentRequests: role === "captura" || role === "cobranza",
    confirmPaymentRequests: role === "cobranza",
    editPayments: role === "cobranza",
    manageUsers: false,
    manageData: false,
  };

  return Boolean(permissions[permission]);
}

function showApp(user) {
  currentUser = user;
  els.userChip.textContent = `${user.name || user.username} · ${user.role}`;
  els.adminOnly.forEach((element) => {
    element.hidden = user.role !== "admin";
  });
  applyRoleVisibility();
  els.loginScreen.classList.add("hidden");
  els.appShell.classList.remove("locked");
  if (user.mustChangePassword) {
    window.setTimeout(() => openPasswordDialog("Cambia la contraseña inicial antes de publicar o compartir el acceso."), 0);
  }
}

function showLogin(message = "") {
  currentUser = null;
  els.appShell.classList.add("locked");
  els.loginScreen.classList.remove("hidden");
  els.loginMessage.textContent = message || "Usuario inicial: admin / admin123";
}

async function boot() {
  try {
    const session = await apiRequest("/api/session");
    showApp(session.user);
    await loadState();
    await loadUsers();
    resetClientForm();
    resetRemissionForm();
    resetPaymentRequestForm();
    resetUserForm();
    setView("dashboard");
  } catch {
    showLogin();
  }
}

function setElementHidden(selector, hidden) {
  document.querySelectorAll(selector).forEach((element) => {
    element.hidden = hidden;
  });
}

function applyRoleVisibility() {
  setElementHidden("#clientForm", !can("editClients"));
  setElementHidden("#resetClientFormButton", !can("editClients"));
  setElementHidden("#remissionForm", !can("editRemissions"));
  setElementHidden("#resetRemissionFormButton", !can("editRemissions"));
  setElementHidden("#importRemissionsLabel", !can("editRemissions"));
  setElementHidden("#paymentRequestForm", !can("editPaymentRequests"));
  setElementHidden("#resetPaymentRequestFormButton", !can("editPaymentRequests"));
  setElementHidden("#paymentForm", !can("editPayments"));
  setElementHidden("#quickRemissionButton", !can("editRemissions"));
  setElementHidden("#clearDataButton", !can("manageData"));
  setElementHidden(".data-file-button", !can("manageData"));
}

function openPasswordDialog(message = "Usa al menos 6 caracteres.") {
  els.passwordForm.reset();
  els.passwordHint.textContent = message;
  els.passwordDialog.showModal();
}

function clientById(id) {
  return state.clients.find((client) => client.id === id);
}

function remissionById(id) {
  return state.remissions.find((remission) => remission.id === id);
}

function paymentRequestById(id) {
  return state.paymentRequests.find((request) => request.id === id);
}

function remissionTotal(remission) {
  if (remission.total !== undefined && remission.total !== null && remission.total !== "") return Number(remission.total || 0);
  return (remission.items || []).reduce((sum, item) => {
    return sum + Number(item.quantity || 0) * Number(item.price || 0);
  }, 0);
}

function paymentsForClient(clientId) {
  return state.payments.filter((payment) => payment.clientId === clientId);
}

function paymentsForRemission(remissionId) {
  return state.payments.filter((payment) => payment.remissionId === remissionId);
}

function adjustmentBreakdownForStoredItem(item) {
  const base = Number(item.baseAmount || 0) || Math.max(0, remissionTotal(remissionById(item.remissionId) || {}) - remissionPaid(item.remissionId));
  const returnsAmount = Math.min(base, Math.max(0, Number(item.returnsAmount || 0)));
  const afterReturns = base - returnsAmount;
  const financialAmount = afterReturns * (percentValue(item.financialDiscount) / 100);
  const afterFinancial = afterReturns - financialAmount;
  const commercialAmount = afterFinancial * (percentValue(item.commercialDiscount) / 100);
  const afterCommercial = afterFinancial - commercialAmount;
  const specialAmount = afterCommercial * (percentValue(item.specialDiscount) / 100);
  return {
    returnsAmount: Math.round(returnsAmount * 100) / 100,
    financialAmount: Math.round(financialAmount * 100) / 100,
    commercialAmount: Math.round(commercialAmount * 100) / 100,
    specialAmount: Math.round(specialAmount * 100) / 100,
  };
}

function effectiveAdjustments() {
  const stored = state.adjustments || [];
  const requestsWithStoredAdjustments = new Set(stored.map((adjustment) => adjustment.paymentRequestId).filter(Boolean));
  const derived = (state.paymentRequests || [])
    .filter((request) => request.status === "confirmed" && !requestsWithStoredAdjustments.has(request.id))
    .flatMap((request) => {
      const date = paymentRequestCollectionDate(request) || String(request.confirmedAt || "").slice(0, 10) || request.date;
      return (request.items || []).flatMap((item) => {
        const breakdown = adjustmentBreakdownForStoredItem(item);
        return [
          { type: "returns", amount: breakdown.returnsAmount },
          { type: "financial", amount: breakdown.financialAmount },
          { type: "commercial", amount: breakdown.commercialAmount },
          { type: "special", amount: breakdown.specialAmount },
        ]
          .filter((adjustment) => adjustment.amount > 0)
          .map((adjustment) => ({
            id: `derived-${request.id}-${item.remissionId}-${adjustment.type}`,
            date,
            clientId: request.clientId,
            remissionId: item.remissionId,
            paymentRequestId: request.id,
            type: adjustment.type,
            label: adjustmentLabel(adjustment.type),
            amount: Math.round(adjustment.amount * 100) / 100,
            reference: request.folio || request.id,
            notes: [request.notes, item.lineNotes].filter(Boolean).join(" | "),
            createdAt: request.confirmedAt || "",
            createdBy: request.confirmedBy || "",
          }));
      });
    });
  return [...stored, ...derived];
}

function adjustmentsForClient(clientId) {
  return effectiveAdjustments().filter((adjustment) => adjustment.clientId === clientId);
}

function adjustmentsForRemission(remissionId) {
  return effectiveAdjustments().filter((adjustment) => adjustment.remissionId === remissionId);
}

function clientTotals(clientId) {
  const charges = state.remissions
    .filter((remission) => remission.clientId === clientId)
    .reduce((sum, remission) => sum + remissionTotal(remission), 0);
  const payments = paymentsForClient(clientId).reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const adjustments = adjustmentsForClient(clientId).reduce((sum, adjustment) => sum + Number(adjustment.amount || 0), 0);
  return { charges, payments, adjustments, balance: charges - payments - adjustments };
}

function remissionPaid(remissionId) {
  return paymentsForRemission(remissionId).reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
}

function remissionAdjusted(remissionId) {
  return adjustmentsForRemission(remissionId).reduce((sum, adjustment) => sum + Number(adjustment.amount || 0), 0);
}

function remissionBalance(remission) {
  return Math.max(0, remissionTotal(remission) - remissionPaid(remission.id) - remissionAdjusted(remission.id));
}

function remissionPaymentDate(remissionId) {
  return paymentsForRemission(remissionId)
    .map((payment) => payment.date)
    .filter(Boolean)
    .sort((a, b) => b.localeCompare(a))[0] || "";
}

function paymentRequestCollectionDate(request) {
  const reference = request.folio || request.id;
  return state.payments
    .filter((payment) => payment.clientId === request.clientId && payment.reference === reference)
    .map((payment) => payment.date)
    .filter(Boolean)
    .sort((a, b) => b.localeCompare(a))[0] || "";
}

function remissionStatus(remission) {
  const paid = remissionPaid(remission.id);
  const adjusted = remissionAdjusted(remission.id);
  const total = remissionTotal(remission);
  if (paid + adjusted >= total && total > 0) return "paid";
  if (paid + adjusted > 0) return "partial";
  return "pending";
}

function requestStatusLabel(status) {
  return {
    pending: "Pendiente",
    confirmed: "Confirmada",
  }[status] || status;
}

function adjustmentLabel(type) {
  return {
    returns: "Devolución",
    financial: "Descuento financiero",
    commercial: "Descuento comercial",
    special: "Descuento especial",
  }[type] || "Descuento";
}

function percentValue(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return 0;
  return Math.min(100, Math.max(0, number));
}

function requestLineBase(item) {
  if (item.baseAmount !== undefined && item.baseAmount !== null && item.baseAmount !== "") return Number(item.baseAmount || 0);
  const remission = remissionById(item.remissionId);
  if (!remission) return 0;
  return remissionBalance(remission);
}

function requestLineAmount(item) {
  return requestLineBreakdown(item).amount;
}

function requestLineBreakdown(item) {
  const base = requestLineBase(item);
  const returnsAmount = Math.min(base, Math.max(0, Number(item.returnsAmount || 0)));
  const afterReturns = base - returnsAmount;
  const financialAmount = afterReturns * (percentValue(item.financialDiscount) / 100);
  const afterFinancial = afterReturns - financialAmount;
  const commercialAmount = afterFinancial * (percentValue(item.commercialDiscount) / 100);
  const afterCommercial = afterFinancial - commercialAmount;
  const specialAmount = afterCommercial * (percentValue(item.specialDiscount) / 100);
  const afterSpecial = afterCommercial - specialAmount;
  return {
    base,
    returnsAmount: Math.round(returnsAmount * 100) / 100,
    financialAmount: Math.round(financialAmount * 100) / 100,
    commercialAmount: Math.round(commercialAmount * 100) / 100,
    specialAmount: Math.round(specialAmount * 100) / 100,
    amount: Math.round(afterSpecial * 100) / 100,
  };
}

function paymentRequestTotal(request) {
  return (request.items || []).reduce((sum, item) => sum + requestLineAmount(item), 0);
}

function deliveryDateFor(remission) {
  return remission.deliveryDate || "";
}

function daysSince(value) {
  if (!value) return "-";
  const [year, month, day] = String(value).split("-").map(Number);
  if (!year || !month || !day) return "-";
  const start = new Date(year, month - 1, day);
  const now = new Date();
  const current = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const elapsed = Math.floor((current - start) / 86400000);
  return Math.max(0, elapsed);
}

function agingDaysFor(remission) {
  const deliveryDate = deliveryDateFor(remission);
  if (!deliveryDate) return 0;
  const days = daysSince(deliveryDate);
  return Number.isFinite(Number(days)) ? Number(days) : 0;
}

function agingBucketFor(days) {
  return agingBuckets.find((bucket) => days >= bucket.min && days <= bucket.max) || agingBuckets[0];
}

function blankAgingTotals() {
  return agingBuckets.reduce((totals, bucket) => ({ ...totals, [bucket.key]: 0 }), {});
}

function agingRows() {
  const rows = new Map();

  state.remissions.forEach((remission) => {
    const balance = remissionBalance(remission);
    if (balance <= 0) return;

    const client = clientById(remission.clientId);
    if (!client) return;

    if (!rows.has(client.id)) {
      rows.set(client.id, {
        client,
        remissions: 0,
        total: 0,
        ...blankAgingTotals(),
      });
    }

    const row = rows.get(client.id);
    const bucket = agingBucketFor(agingDaysFor(remission));
    row[bucket.key] += balance;
    row.total += balance;
    row.remissions += 1;
  });

  return [...rows.values()].sort((a, b) => b.total - a.total);
}

function statusLabel(status) {
  return {
    pending: "Pendiente",
    partial: "Abono",
    paid: "Pagada",
  }[status];
}

function roleLabel(role) {
  return {
    admin: "Administrador",
    captura: "Captura",
    cobranza: "Cobranza",
    consulta: "Consulta",
  }[role] || role;
}

function nextFolio() {
  const max = state.remissions.reduce((current, remission) => {
    const match = String(remission.folio).match(/(\d+)$/);
    return Math.max(current, match ? Number(match[1]) : 0);
  }, 0);
  return `R-${String(max + 1).padStart(4, "0")}`;
}

function nextPaymentRequestFolio() {
  const max = state.paymentRequests.reduce((current, request) => {
    const match = String(request.folio || "").match(/(\d+)$/);
    return Math.max(current, match ? Number(match[1]) : 0);
  }, 0);
  return `SP-${String(max + 1).padStart(4, "0")}`;
}

function nextPaymentFolio(offset = 0) {
  const max = state.payments.reduce((current, payment) => {
    const match = String(payment.folio || "").match(/(\d+)$/);
    return Math.max(current, match ? Number(match[1]) : 0);
  }, 0);
  return `P-${String(max + 1 + offset).padStart(4, "0")}`;
}

function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("visible");
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => els.toast.classList.remove("visible"), 2400);
}

function setView(view) {
  if (view === "users" && currentUser?.role !== "admin") {
    toast("Solo el administrador puede abrir usuarios");
    view = "dashboard";
  }

  const titles = {
    dashboard: "Panel",
    clients: "Clientes",
    remissions: "Remisiones",
    aging: "Antigüedad",
    paymentRequests: "Solicitudes de pago",
    payments: "Pagos",
    adjustments: "Descuentos y devoluciones",
    users: "Usuarios",
  };

  els.title.textContent = titles[view] || "Panel";
  els.views.forEach((section) => section.classList.toggle("active", section.id === `${view}View`));
  els.navItems.forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  render();
}

function render() {
  renderSelects();
  renderDashboard();
  renderAging();
  renderClients();
  renderRemissions();
  renderPaymentRequests();
  renderPayments();
  renderAdjustments();
  renderUsers();
}

function renderSelects() {
  const selectedRemissionClientFilter = els.remissionClientFilter.value || "all";
  const clientOptions = state.clients
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, "es"))
    .map((client) => `<option value="${client.id}">${escapeHtml(client.clave || client.id)} · ${escapeHtml(client.name)}</option>`)
    .join("");

  els.remissionClient.innerHTML = clientOptions || '<option value="">Agrega un cliente</option>';
  els.paymentRequestClient.innerHTML = clientOptions || '<option value="">Agrega un cliente</option>';
  els.remissionClientFilter.innerHTML = `<option value="all">Todos los clientes</option>${clientOptions}`;
  els.remissionClientFilter.value = state.clients.some((client) => client.id === selectedRemissionClientFilter)
    ? selectedRemissionClientFilter
    : "all";
  if (els.paymentClient) els.paymentClient.innerHTML = clientOptions || '<option value="">Agrega un cliente</option>';
  renderPaymentRequestRemissions();
  renderPaymentRemissionOptions();
}

function renderPaymentRemissionOptions() {
  if (!els.paymentClient || !els.paymentRemission) return;
  const clientId = els.paymentClient.value || state.clients[0]?.id || "";
  const options = state.remissions
    .filter((remission) => remission.clientId === clientId)
    .sort(byDateDesc)
    .map((remission) => {
      const balance = remissionBalance(remission);
      return `<option value="${remission.id}">${escapeHtml(remission.folio)} · saldo ${currency(balance)}</option>`;
    })
    .join("");

  els.paymentRemission.innerHTML = `<option value="">Abono a cuenta</option>${options}`;
}

function renderDashboard() {
  const charges = state.remissions.reduce((sum, remission) => sum + remissionTotal(remission), 0);
  const payments = state.payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const adjustments = effectiveAdjustments().reduce((sum, adjustment) => sum + Number(adjustment.amount || 0), 0);
  const balance = charges - payments - adjustments;
  const pendingRemissions = state.remissions.filter((remission) => remissionStatus(remission) !== "paid").length;

  const metrics = [
    ["Saldo total", currency(balance)],
    ["Remisiones", state.remissions.length],
    ["Pendientes", pendingRemissions],
    ["Cobrado", currency(payments)],
    ["Desc. y dev.", currency(adjustments)],
  ];

  els.metricsGrid.innerHTML = metrics
    .map(([label, value]) => `<article class="metric"><span>${label}</span><strong>${value}</strong></article>`)
    .join("");

  const balances = state.clients
    .map((client) => ({ client, ...clientTotals(client.id) }))
    .filter((row) => row.balance !== 0)
    .sort((a, b) => b.balance - a.balance);

  els.balanceTable.innerHTML = balances.length
    ? balances
        .map(
          ({ client, charges, payments, adjustments, balance }) => `
          <tr>
            <td><strong>${escapeHtml(client.clave || client.id)}</strong><br><span>${escapeHtml(client.name)}</span></td>
            <td class="money">${currency(charges)}</td>
            <td class="money">${currency(payments + adjustments)}</td>
            <td class="money"><strong>${currency(balance)}</strong></td>
          </tr>
        `,
        )
        .join("")
    : `<tr><td colspan="4"><div class="empty-state">Sin saldos pendientes.</div></td></tr>`;

  const activity = [
    ...state.remissions.map((remission) => ({
      type: "Remisión",
      date: remission.date,
      title: remission.folio,
      detail: `${clientById(remission.clientId)?.name || "Sin cliente"} · ${currency(remissionTotal(remission))}`,
    })),
    ...state.payments.map((payment) => ({
      type: "Pago",
      date: payment.date,
      title: currency(payment.amount),
      detail: `${clientById(payment.clientId)?.name || "Sin cliente"} · ${payment.method}`,
    })),
  ]
    .sort(byDateDesc)
    .slice(0, 8);

  els.activityList.innerHTML = activity.length
    ? activity
        .map(
          (item) => `
          <div class="activity-item">
            <div>
              <strong>${escapeHtml(item.title)}</strong>
              <span>${escapeHtml(item.type)} · ${escapeHtml(item.detail)}</span>
            </div>
            <span>${formatDate(item.date)}</span>
          </div>
        `,
        )
        .join("")
    : `<div class="empty-state">Aún no hay movimientos.</div>`;
}

function renderAging() {
  if (!els.agingTable || !els.agingMetrics) return;
  const query = els.agingSearch.value.trim().toLowerCase();
  const rows = agingRows().filter((row) => {
    const client = row.client;
    return [client.clave, client.name, client.contact, client.phone].join(" ").toLowerCase().includes(query);
  });
  const totals = rows.reduce(
    (summary, row) => {
      agingBuckets.forEach((bucket) => {
        summary[bucket.key] += row[bucket.key];
      });
      summary.total += row.total;
      return summary;
    },
    { total: 0, ...blankAgingTotals() },
  );

  els.agingMetrics.innerHTML = [
    ["Saldo total", totals.total],
    ...agingBuckets.map((bucket) => [bucket.label, totals[bucket.key]]),
  ]
    .map(([label, value]) => `<article class="metric"><span>${label}</span><strong>${currency(value)}</strong></article>`)
    .join("");

  els.agingTable.innerHTML = rows.length
    ? rows
        .map(
          (row) => `
          <tr>
            <td><strong>${escapeHtml(row.client.clave || row.client.id)}</strong></td>
            <td><strong>${escapeHtml(row.client.name)}</strong><br><span>${row.remissions} remisiones pendientes</span></td>
            ${agingBuckets.map((bucket) => `<td class="money">${currency(row[bucket.key])}</td>`).join("")}
            <td class="money"><strong>${currency(row.total)}</strong></td>
            <td>
              <div class="row-actions">
                <button type="button" data-action="detail-client" data-id="${row.client.id}">Ver</button>
              </div>
            </td>
          </tr>
        `,
        )
        .join("")
    : `<tr><td colspan="9"><div class="empty-state">No hay saldos pendientes con ese filtro.</div></td></tr>`;
}

function renderClients() {
  const query = els.clientSearch.value.trim().toLowerCase();
  const rows = state.clients
    .filter((client) =>
      [client.clave, client.name, client.contact, client.sellerKey, client.sellerName, client.phone, client.address, client.notes]
        .join(" ")
        .toLowerCase()
        .includes(query),
    )
    .sort((a, b) => String(a.clave || a.name).localeCompare(String(b.clave || b.name), "es"));

  els.clientsTable.innerHTML = rows.length
    ? rows
        .map((client) => {
          const totals = clientTotals(client.id);
          return `
            <tr>
              <td><strong>${escapeHtml(client.clave || client.id)}</strong></td>
              <td>
                <strong>${escapeHtml(client.name)}</strong>
                ${client.address ? `<br><span>${escapeHtml(client.address)}</span>` : ""}
                ${client.notes ? `<br><span>Nota: ${escapeHtml(client.notes)}</span>` : ""}
              </td>
              <td>${escapeHtml(client.contact || "-")}</td>
              <td>${escapeHtml(client.sellerKey || "-")}</td>
              <td>${escapeHtml(client.sellerName || "-")}</td>
              <td>${escapeHtml(client.phone || "-")}</td>
              <td class="money"><strong>${currency(totals.balance)}</strong></td>
              <td>
                <div class="row-actions">
                  <button type="button" data-action="detail-client" data-id="${client.id}">Ver</button>
                  ${
                    can("editClients")
                      ? `<button type="button" data-action="edit-client" data-id="${client.id}">Editar</button>
                         <button type="button" data-action="delete-client" data-id="${client.id}">Eliminar</button>`
                      : ""
                  }
                </div>
              </td>
            </tr>
          `;
        })
        .join("")
    : `<tr><td colspan="8"><div class="empty-state">No hay clientes con ese filtro.</div></td></tr>`;
}

function renderRemissions() {
  const query = els.remissionSearch.value.trim().toLowerCase();
  const status = els.remissionStatusFilter.value;
  const clientFilter = els.remissionClientFilter.value;
  const dateFrom = els.remissionDateFromFilter.value;
  const dateTo = els.remissionDateToFilter.value;
  const rows = state.remissions
    .filter((remission) => {
      const client = clientById(remission.clientId);
      const text = [remission.folio, client?.clave, client?.name, remission.notes].join(" ").toLowerCase();
      const matchesText = text.includes(query);
      const matchesStatus = status === "all" || remissionStatus(remission) === status;
      const matchesClient = clientFilter === "all" || remission.clientId === clientFilter;
      const matchesDateFrom = !dateFrom || String(remission.date || "") >= dateFrom;
      const matchesDateTo = !dateTo || String(remission.date || "") <= dateTo;
      return matchesText && matchesStatus && matchesClient && matchesDateFrom && matchesDateTo;
    })
    .sort(byDateDesc);

  els.remissionsTable.innerHTML = rows.length
    ? rows
        .map((remission) => {
          const total = remissionTotal(remission);
          const adjusted = remissionAdjusted(remission.id);
          const balance = remissionBalance(remission);
          const statusName = remissionStatus(remission);
          const client = clientById(remission.clientId);
          const deliveryDate = deliveryDateFor(remission);
          const paymentDate = remissionPaymentDate(remission.id);
          return `
            <tr>
              <td><strong>${escapeHtml(remission.folio)}</strong></td>
              <td>${escapeHtml(client?.clave || "-")}</td>
              <td>${escapeHtml(client?.name || "-")}</td>
              <td>${formatDate(remission.date)}</td>
              <td>${formatDate(deliveryDate)}</td>
              <td>${formatDate(paymentDate)}</td>
              <td>${daysSince(deliveryDate)}</td>
              <td class="money">${currency(total)}</td>
              <td class="money"><strong>${currency(balance)}</strong>${adjusted ? `<br><span>Ajustes: ${currency(adjusted)}</span>` : ""}</td>
              <td><span class="badge ${statusName}">${statusLabel(statusName)}</span></td>
              <td>
                <div class="row-actions">
                  <button type="button" data-action="detail-remission" data-id="${remission.id}">Ver</button>
                  ${
                    can("editRemissions")
                      ? `<button type="button" data-action="edit-remission" data-id="${remission.id}">Editar</button>
                         <button type="button" data-action="delete-remission" data-id="${remission.id}">Eliminar</button>`
                      : ""
                  }
                </div>
              </td>
            </tr>
          `;
        })
        .join("")
    : `<tr><td colspan="11"><div class="empty-state">No hay remisiones con ese filtro.</div></td></tr>`;
}

function renderPaymentRequests() {
  const query = els.paymentRequestSearch.value.trim().toLowerCase();
  const monthFilter = els.paymentRequestMonthFilter.value;
  const rows = state.paymentRequests
    .filter((request) => {
      if (monthFilter && !String(request.date || "").startsWith(monthFilter)) return false;
      const client = clientById(request.clientId);
      const folios = (request.items || []).map((item) => remissionById(item.remissionId)?.folio).join(" ");
      return [request.folio, client?.clave, client?.name, folios, request.status, request.notes].join(" ").toLowerCase().includes(query);
    })
    .sort(byDateDesc);

  els.paymentRequestsTable.innerHTML = rows.length
    ? rows
        .map((request) => {
          const client = clientById(request.clientId);
          const status = request.status || "pending";
          const remissions = (request.items || []).map((item) => remissionById(item.remissionId)?.folio).filter(Boolean);
          return `
            <tr>
              <td><strong>${escapeHtml(request.folio || request.id)}</strong></td>
              <td>${formatDate(request.date)}</td>
              <td><strong>${escapeHtml(client?.clave || "-")}</strong><br><span>${escapeHtml(client?.name || "-")}</span></td>
              <td>${escapeHtml(remissions.join(", ") || "-")}</td>
              <td class="money"><strong>${currency(request.status === "confirmed" ? request.receivedAmount || 0 : paymentRequestTotal(request))}</strong></td>
              <td><span class="badge ${status}">${requestStatusLabel(status)}</span></td>
              <td>
                <div class="row-actions">
                  <button type="button" data-action="detail-payment-request" data-id="${request.id}">Ver</button>
                  <button type="button" data-action="pdf-payment-request" data-id="${request.id}">PDF</button>
                  ${
                    status === "pending" && can("confirmPaymentRequests")
                      ? `<button type="button" data-action="confirm-payment-request" data-id="${request.id}">Confirmar</button>`
                      : ""
                  }
                </div>
              </td>
            </tr>
          `;
        })
        .join("")
    : `<tr><td colspan="7"><div class="empty-state">No hay solicitudes con ese filtro.</div></td></tr>`;
}

function renderPaymentRequestRemissions() {
  if (!els.paymentRequestRemissions) return;
  const clientId = els.paymentRequestClient.value || state.clients[0]?.id || "";
  const remissions = state.remissions
    .filter((remission) => remission.clientId === clientId && remissionStatus(remission) !== "paid")
    .sort(byDateDesc);

  els.paymentRequestRemissions.innerHTML = remissions.length
    ? `
      <div class="request-lines-header">
        <span>Remisión</span>
        <span>Emisión</span>
        <span>Entrega</span>
        <span>Saldo</span>
        <span>Dev. $</span>
        <span>Fin. %</span>
        <span>Fin. $</span>
        <span>Com. %</span>
        <span>Com. $</span>
        <span>Esp. %</span>
        <span>Esp. $</span>
        <span>Observación</span>
        <span>A cobrar</span>
      </div>
      ${remissions
        .map((remission) => {
          const balance = remissionBalance(remission);
          return `
            <div class="request-line" data-remission-id="${remission.id}" data-balance="${balance}">
              <label class="check-line">
                <input type="checkbox" class="request-line-check">
                <span>${escapeHtml(remission.folio)}</span>
              </label>
              <span>${formatDate(remission.date)}</span>
              <span>${formatDate(deliveryDateFor(remission))}</span>
              <strong class="money">${currency(balance)}</strong>
              <input class="request-discount returns currency-entry" inputmode="decimal" value="${currency(0)}" aria-label="Devoluciones en valor">
              <input class="request-discount financial" type="number" min="0" max="100" step="0.01" value="0" aria-label="Descuento financiero">
              <strong class="request-discount-value financial-value money">${currency(0)}</strong>
              <input class="request-discount commercial" type="number" min="0" max="100" step="0.01" value="0" aria-label="Descuento comercial">
              <strong class="request-discount-value commercial-value money">${currency(0)}</strong>
              <input class="request-discount special" type="number" min="0" max="100" step="0.01" value="0" aria-label="Descuento especial">
              <strong class="request-discount-value special-value money">${currency(0)}</strong>
              <input class="line-notes" aria-label="Observación de la remisión">
              <strong class="request-line-total money">${currency(balance)}</strong>
            </div>
          `;
        })
        .join("")}
    `
    : `<div class="empty-state">Este cliente no tiene remisiones pendientes.</div>`;
  updatePaymentRequestPreview();
}

function renderPayments() {
  const query = els.paymentSearch.value.trim().toLowerCase();
  const monthFilter = els.paymentMonthFilter.value;
  const rows = state.payments
    .filter((payment) => {
      if (monthFilter && !String(payment.date || "").startsWith(monthFilter)) return false;
      const client = clientById(payment.clientId);
      const remission = remissionById(payment.remissionId);
      return [payment.folio, client?.name, client?.sellerKey, client?.sellerName, remission?.folio, payment.method, payment.reference]
        .join(" ")
        .toLowerCase()
        .includes(query);
    })
    .sort(byDateDesc);

  els.paymentsTable.innerHTML = rows.length
    ? rows
        .map((payment) => {
          const client = clientById(payment.clientId);
          const remission = remissionById(payment.remissionId);
          return `
            <tr>
              <td><strong>${escapeHtml(payment.folio || payment.id)}</strong></td>
              <td>${formatDate(payment.date)}</td>
              <td>${escapeHtml(client?.name || "-")}</td>
              <td>${escapeHtml(client?.sellerKey || "-")}</td>
              <td>${escapeHtml(client?.sellerName || "-")}</td>
              <td>${escapeHtml(remission?.folio || "Cuenta")}</td>
              <td>${escapeHtml(payment.method)}${payment.reference ? `<br><span>${escapeHtml(payment.reference)}</span>` : ""}</td>
              <td class="money"><strong>${currency(payment.amount)}</strong></td>
              <td>
                <div class="row-actions">
                  ${can("editPayments") ? `<button type="button" data-action="delete-payment" data-id="${payment.id}">Eliminar</button>` : ""}
                </div>
              </td>
            </tr>
          `;
        })
        .join("")
    : `<tr><td colspan="9"><div class="empty-state">No hay pagos con ese filtro.</div></td></tr>`;
}

function renderAdjustments() {
  const query = els.adjustmentSearch.value.trim().toLowerCase();
  const monthFilter = els.adjustmentMonthFilter.value;
  const rows = effectiveAdjustments()
    .filter((adjustment) => {
      if (monthFilter && !String(adjustment.date || "").startsWith(monthFilter)) return false;
      const client = clientById(adjustment.clientId);
      const remission = remissionById(adjustment.remissionId);
      const text = [
        adjustment.reference,
        adjustment.label,
        adjustment.notes,
        client?.clave,
        client?.name,
        remission?.folio,
      ].join(" ").toLowerCase();
      return text.includes(query);
    })
    .sort(byDateDesc);

  els.adjustmentsTable.innerHTML = rows.length
    ? rows
        .map((adjustment) => {
          const client = clientById(adjustment.clientId);
          const remission = remissionById(adjustment.remissionId);
          return `
            <tr>
              <td>${formatDate(adjustment.date)}</td>
              <td><strong>${escapeHtml(client?.clave || "-")}</strong><br><span>${escapeHtml(client?.name || "-")}</span></td>
              <td>${escapeHtml(remission?.folio || "-")}</td>
              <td>${escapeHtml(adjustment.reference || "-")}</td>
              <td>${escapeHtml(adjustment.label || adjustmentLabel(adjustment.type))}</td>
              <td class="money"><strong>${currency(adjustment.amount)}</strong></td>
              <td>${escapeHtml(adjustment.notes || "-")}</td>
            </tr>
          `;
        })
        .join("")
    : `<tr><td colspan="7"><div class="empty-state">No hay descuentos o devoluciones con ese filtro.</div></td></tr>`;
}

function renderUsers() {
  if (!els.usersTable || currentUser?.role !== "admin") return;

  const query = els.userSearch.value.trim().toLowerCase();
  const rows = users
    .filter((user) => [user.name, user.username, user.role].join(" ").toLowerCase().includes(query))
    .sort((a, b) => a.name.localeCompare(b.name, "es"));

  els.usersTable.innerHTML = rows.length
    ? rows
        .map(
          (user) => `
            <tr>
              <td><strong>${escapeHtml(user.name)}</strong></td>
              <td>${escapeHtml(user.username)}</td>
              <td><span class="role-pill">${escapeHtml(roleLabel(user.role))}</span></td>
              <td>
                <div class="row-actions">
                  <button type="button" data-action="edit-user" data-id="${user.id}">Editar</button>
                </div>
              </td>
            </tr>
          `,
        )
        .join("")
    : `<tr><td colspan="4"><div class="empty-state">No hay usuarios con ese filtro.</div></td></tr>`;
}

function resetClientForm() {
  els.clientForm.reset();
  document.querySelector("#clientId").value = "";
  els.clientFormTitle.textContent = "Nuevo cliente";
}

function resetRemissionForm() {
  els.remissionForm.reset();
  document.querySelector("#remissionId").value = "";
  document.querySelector("#remissionFolio").value = nextFolio();
  document.querySelector("#remissionDate").value = today();
  els.remissionDeliveryDate.value = "";
  els.remissionTotal.value = "";
  els.remissionFormTitle.textContent = "Nueva remisión";
  renderSelects();
}

function resetPaymentRequestForm() {
  els.paymentRequestForm.reset();
  els.paymentRequestFolio.value = nextPaymentRequestFolio();
  els.paymentRequestDate.value = today();
  renderSelects();
  updatePaymentRequestPreview();
}

function resetPaymentForm() {
  if (!els.paymentForm) return;
  els.paymentForm.reset();
  document.querySelector("#paymentDate").value = today();
  renderSelects();
}

function collectPaymentRequestItems() {
  return [...els.paymentRequestRemissions.querySelectorAll(".request-line")]
    .filter((row) => row.querySelector(".request-line-check").checked)
    .map((row) => ({
      remissionId: row.dataset.remissionId,
      baseAmount: Number(row.dataset.balance || 0),
      returnsAmount: Math.max(0, parseTemplateNumber(row.querySelector(".returns").value)),
      financialDiscount: percentValue(row.querySelector(".financial").value),
      commercialDiscount: percentValue(row.querySelector(".commercial").value),
      specialDiscount: percentValue(row.querySelector(".special").value),
      lineNotes: row.querySelector(".line-notes").value.trim(),
    }));
}

function updatePaymentRequestPreview() {
  if (!els.paymentRequestRemissions) return;
  let total = 0;
  els.paymentRequestRemissions.querySelectorAll(".request-line").forEach((row) => {
    const base = Number(row.dataset.balance || 0);
    const returnsInput = row.querySelector(".returns");
    const returnsAmount = Math.min(base, Math.max(0, parseTemplateNumber(returnsInput.value)));
    const item = {
      remissionId: row.dataset.remissionId,
      returnsAmount,
      financialDiscount: row.querySelector(".financial").value,
      commercialDiscount: row.querySelector(".commercial").value,
      specialDiscount: row.querySelector(".special").value,
    };
    const breakdown = requestLineBreakdown(item);
    row.querySelector(".financial-value").textContent = currency(breakdown.financialAmount);
    row.querySelector(".commercial-value").textContent = currency(breakdown.commercialAmount);
    row.querySelector(".special-value").textContent = currency(breakdown.specialAmount);
    row.querySelector(".request-line-total").textContent = currency(breakdown.amount);
    if (row.querySelector(".request-line-check").checked) total += breakdown.amount;
  });
  els.paymentRequestTotal.textContent = currency(total);
}

function resetUserForm() {
  if (!els.userForm) return;
  els.userForm.reset();
  document.querySelector("#userId").value = "";
  document.querySelector("#userRole").value = "captura";
  document.querySelector("#userPassword").required = true;
  els.userFormTitle.textContent = "Nuevo usuario";
  els.userPasswordHint.textContent = "Para usuarios nuevos, usa al menos 6 caracteres.";
}

function editClient(id) {
  const client = clientById(id);
  if (!client) return;
  setView("clients");
  document.querySelector("#clientId").value = client.id;
  document.querySelector("#clientClave").value = client.clave || client.id;
  document.querySelector("#clientName").value = client.name;
  document.querySelector("#clientContact").value = client.contact || "";
  document.querySelector("#clientSellerKey").value = client.sellerKey || "";
  document.querySelector("#clientSellerName").value = client.sellerName || "";
  document.querySelector("#clientPhone").value = client.phone || "";
  document.querySelector("#clientAddress").value = client.address || "";
  document.querySelector("#clientNotes").value = client.notes || "";
  els.clientFormTitle.textContent = "Editar cliente";
}

function editRemission(id) {
  const remission = remissionById(id);
  if (!remission) return;
  setView("remissions");
  document.querySelector("#remissionId").value = remission.id;
  document.querySelector("#remissionFolio").value = remission.folio;
  document.querySelector("#remissionDate").value = remission.date;
  els.remissionDeliveryDate.value = deliveryDateFor(remission);
  document.querySelector("#remissionClient").value = remission.clientId;
  els.remissionTotal.value = remissionTotal(remission);
  document.querySelector("#remissionNotes").value = remission.notes || "";
  els.remissionFormTitle.textContent = "Editar remisión";
}

function editUser(id) {
  const user = users.find((item) => item.id === id);
  if (!user) return;
  setView("users");
  document.querySelector("#userId").value = user.id;
  document.querySelector("#userName").value = user.name;
  document.querySelector("#userUsername").value = user.username;
  document.querySelector("#userRole").value = user.role;
  document.querySelector("#userPassword").value = "";
  document.querySelector("#userPassword").required = false;
  els.userFormTitle.textContent = "Editar usuario";
  els.userPasswordHint.textContent = "Deja la contraseña vacía para conservar la actual.";
}

async function deleteClient(id) {
  const hasMovements =
    state.remissions.some((remission) => remission.clientId === id) ||
    state.payments.some((payment) => payment.clientId === id) ||
    effectiveAdjustments().some((adjustment) => adjustment.clientId === id);

  if (hasMovements) {
    toast("No se puede eliminar un cliente con movimientos");
    return;
  }

  if (!confirm("¿Eliminar este cliente?")) return;
  state.clients = state.clients.filter((client) => client.id !== id);
  await saveState();
  resetClientForm();
  render();
  toast("Cliente eliminado");
}

async function deleteRemission(id) {
  if (state.payments.some((payment) => payment.remissionId === id) || effectiveAdjustments().some((adjustment) => adjustment.remissionId === id)) {
    toast("No se puede eliminar una remisión con pagos o ajustes");
    return;
  }

  if (!confirm("¿Eliminar esta remisión?")) return;
  state.remissions = state.remissions.filter((remission) => remission.id !== id);
  await saveState();
  resetRemissionForm();
  render();
  toast("Remisión eliminada");
}

function showClientDetail(id) {
  const client = clientById(id);
  if (!client) return;
  const totals = clientTotals(id);
  const remissions = state.remissions.filter((remission) => remission.clientId === id).sort(byDateDesc);
  const payments = paymentsForClient(id).sort(byDateDesc);

  els.detailTitle.textContent = `${client.clave || client.id} · ${client.name}`;
  els.detailContent.innerHTML = `
    <div class="detail-grid">
      <div class="detail-card"><span>Contacto</span><strong>${escapeHtml(client.contact || "-")}</strong></div>
      <div class="detail-card"><span>Remisiones</span><strong>${currency(totals.charges)}</strong></div>
      <div class="detail-card"><span>Abonos</span><strong>${currency(totals.payments)}</strong></div>
      <div class="detail-card"><span>Saldo</span><strong>${currency(totals.balance)}</strong></div>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Fecha</th><th>Movimiento</th><th>Cargo</th><th>Abono</th></tr></thead>
        <tbody>
          ${[
            ...remissions.map((remission) => ({
              date: remission.date,
              label: `Remisión ${remission.folio}`,
              charge: remissionTotal(remission),
              payment: 0,
            })),
            ...payments.map((payment) => ({
              date: payment.date,
              label: `Pago ${payment.reference || payment.method}`,
              charge: 0,
              payment: payment.amount,
            })),
          ]
            .sort(byDateDesc)
            .map(
              (row) => `
              <tr>
                <td>${formatDate(row.date)}</td>
                <td>${escapeHtml(row.label)}</td>
                <td class="money">${row.charge ? currency(row.charge) : ""}</td>
                <td class="money">${row.payment ? currency(row.payment) : ""}</td>
              </tr>
            `,
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
  els.dialog.showModal();
}

function showRemissionDetail(id) {
  const remission = remissionById(id);
  if (!remission) return;
  const client = clientById(remission.clientId);
  const paid = remissionPaid(id);
  const adjusted = remissionAdjusted(id);
  const balance = remissionBalance(remission);
  const total = remissionTotal(remission);
  const deliveryDate = deliveryDateFor(remission);
  const paymentDate = remissionPaymentDate(id);

  els.detailTitle.textContent = remission.folio;
  els.detailContent.innerHTML = `
    <div class="detail-grid">
      <div class="detail-card"><span>Clave cliente</span><strong>${escapeHtml(client?.clave || "-")}</strong></div>
      <div class="detail-card"><span>Cliente</span><strong>${escapeHtml(client?.name || "-")}</strong></div>
      <div class="detail-card"><span>Fecha entrega</span><strong>${formatDate(deliveryDate)}</strong></div>
      <div class="detail-card"><span>Fecha pago</span><strong>${formatDate(paymentDate)}</strong></div>
      <div class="detail-card"><span>Días</span><strong>${daysSince(deliveryDate)}</strong></div>
      <div class="detail-card"><span>Total</span><strong>${currency(total)}</strong></div>
      <div class="detail-card"><span>Pagado</span><strong>${currency(paid)}</strong></div>
      <div class="detail-card"><span>Descuentos/dev.</span><strong>${currency(adjusted)}</strong></div>
      <div class="detail-card"><span>Saldo</span><strong>${currency(balance)}</strong></div>
    </div>
    ${remission.notes ? `<p class="detail-note">${escapeHtml(remission.notes)}</p>` : ""}
  `;
  els.dialog.showModal();
}

function paymentRequestRows(request) {
  return (request.items || []).map((item) => {
    const remission = remissionById(item.remissionId);
    const breakdown = requestLineBreakdown(item);
    return {
      item,
      remission,
      base: breakdown.base,
      amount: breakdown.amount,
      breakdown,
      issueDate: remission?.date || "",
      deliveryDate: remission ? deliveryDateFor(remission) : "",
    };
  });
}

function showPaymentRequestDetail(id) {
  const request = paymentRequestById(id);
  if (!request) return;
  const client = clientById(request.clientId);
  const rows = paymentRequestRows(request);
  const collectionDate = paymentRequestCollectionDate(request);

  els.detailTitle.textContent = `Solicitud ${request.folio || request.id}`;
  els.detailContent.innerHTML = `
    <div class="detail-grid">
      <div class="detail-card"><span>Folio</span><strong>${escapeHtml(request.folio || request.id)}</strong></div>
      <div class="detail-card"><span>Cliente</span><strong>${escapeHtml(client?.name || "-")}</strong></div>
      <div class="detail-card"><span>Fecha emisión</span><strong>${formatDate(request.date)}</strong></div>
      <div class="detail-card"><span>Estado</span><strong>${requestStatusLabel(request.status)}</strong></div>
      <div class="detail-card"><span>Remisiones</span><strong>${rows.length}</strong></div>
      <div class="detail-card"><span>Total a cobrar</span><strong>${currency(paymentRequestTotal(request))}</strong></div>
      <div class="detail-card"><span>Monto cobrado</span><strong>${currency(request.receivedAmount || 0)}</strong></div>
      <div class="detail-card"><span>Fecha cobro</span><strong>${formatDate(collectionDate)}</strong></div>
      <div class="detail-card"><span>Confirmada por</span><strong>${escapeHtml(request.confirmedBy || "-")}</strong></div>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Remisión</th>
            <th>Emisión</th>
            <th>Entrega</th>
            <th>Saldo</th>
            <th>Devoluciones</th>
            <th>Financiero</th>
            <th>Comercial</th>
            <th>Especial</th>
            <th>A cobrar</th>
            <th>Observación</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map(
              ({ item, remission, base, amount, breakdown, issueDate, deliveryDate }) => `
              <tr>
                <td>${escapeHtml(remission?.folio || item.remissionId)}</td>
                <td>${formatDate(issueDate)}</td>
                <td>${formatDate(deliveryDate)}</td>
                <td class="money">${currency(base)}</td>
                <td class="money">${currency(breakdown.returnsAmount)}</td>
                <td>${percentValue(item.financialDiscount)}%<br><span class="money">${currency(breakdown.financialAmount)}</span></td>
                <td>${percentValue(item.commercialDiscount)}%<br><span class="money">${currency(breakdown.commercialAmount)}</span></td>
                <td>${percentValue(item.specialDiscount)}%<br><span class="money">${currency(breakdown.specialAmount)}</span></td>
                <td class="money"><strong>${currency(amount)}</strong></td>
                <td>${escapeHtml(item.lineNotes || "-")}</td>
              </tr>
            `,
            )
            .join("")}
        </tbody>
      </table>
    </div>
    ${request.notes ? `<p class="detail-note">${escapeHtml(request.notes)}</p>` : ""}
  `;
  els.dialog.showModal();
}

function paymentRequestPdfHtml(request) {
  const client = clientById(request.clientId);
  const rows = paymentRequestRows(request);
  const collectionDate = paymentRequestCollectionDate(request);
  return `
    <!doctype html>
    <html lang="es">
      <head>
        <meta charset="utf-8">
        <title>Solicitud de pago ${escapeHtml(request.folio || request.id)}</title>
        <style>
          * { box-sizing: border-box; }
          @page { size: letter landscape; margin: 12mm; }
          body { font-family: Arial, sans-serif; color: #1f2723; margin: 0; }
          h1, h2, p { margin: 0; }
          h1 { font-size: 24px; }
          h2 { font-size: 14px; margin: 16px 0 8px; }
          .document-header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #1f6f63; padding-bottom: 12px; margin-bottom: 14px; }
          .eyebrow { color: #5f6d65; font-size: 11px; font-weight: bold; letter-spacing: .04em; text-transform: uppercase; margin-bottom: 4px; }
          .header-meta { text-align: right; font-size: 12px; line-height: 1.5; }
          .meta-grid { display: grid; grid-template-columns: 1.5fr .75fr .75fr .75fr; gap: 8px; margin-bottom: 12px; }
          .box { border: 1px solid #bfcac3; padding: 8px; min-height: 46px; }
          .wide { grid-column: span 2; }
          .label { display: block; color: #5f6d65; font-size: 11px; text-transform: uppercase; margin-bottom: 4px; }
          table { width: 100%; border-collapse: collapse; margin-top: 12px; }
          th, td { border: 1px solid #bfcac3; padding: 6px; font-size: 10px; text-align: left; vertical-align: top; }
          th { background: #edf2ef; }
          .money { text-align: right; white-space: nowrap; }
          .discount strong { display: block; margin-bottom: 2px; }
          .discount span { display: block; text-align: right; white-space: nowrap; }
          .summary { display: grid; grid-template-columns: 1fr 260px; gap: 12px; margin-top: 12px; align-items: stretch; }
          .notes { border: 1px solid #bfcac3; padding: 10px; min-height: 64px; }
          .total { background: #edf2ef; border: 1px solid #bfcac3; padding: 12px; text-align: right; }
          .total strong { display: block; font-size: 22px; margin-top: 6px; }
          .receipt { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin-top: 28px; }
          .line { border-bottom: 1px solid #1f2723; height: 34px; margin-bottom: 6px; }
          .signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 36px; margin-top: 30px; text-align: center; }
          @media print { body { margin: 0; } }
        </style>
      </head>
      <body>
        <header class="document-header">
          <div>
            <p class="eyebrow">Solicitud de pago</p>
            <h1>${escapeHtml(request.folio || request.id)}</h1>
          </div>
          <div class="header-meta">
            <strong>Fecha de emisión:</strong> ${formatDate(request.date)}<br>
            <strong>Estado:</strong> ${requestStatusLabel(request.status)}
          </div>
        </header>
        <section class="meta-grid">
          <div class="box wide"><span class="label">Cliente</span><strong>${escapeHtml(client?.name || "-")}</strong></div>
          <div class="box"><span class="label">Clave</span><strong>${escapeHtml(client?.clave || "-")}</strong></div>
          <div class="box"><span class="label">Remisiones</span><strong>${rows.length}</strong></div>
          <div class="box"><span class="label">Contacto</span><strong>${escapeHtml(client?.contact || "-")}</strong></div>
          <div class="box"><span class="label">Teléfono</span><strong>${escapeHtml(client?.phone || "-")}</strong></div>
          <div class="box wide"><span class="label">Dirección</span><strong>${escapeHtml(client?.address || "-")}</strong></div>
          <div class="box"><span class="label">Monto cobrado</span><strong>${currency(request.receivedAmount || 0)}</strong></div>
          <div class="box"><span class="label">Fecha cobro</span><strong>${formatDate(collectionDate)}</strong></div>
        </section>
        <h2>Detalle de remisiones solicitadas</h2>
        <table>
          <thead>
            <tr>
              <th>Remisión</th>
              <th>Emisión</th>
              <th>Entrega</th>
              <th>Saldo</th>
              <th>Devoluciones</th>
              <th>Financiero</th>
              <th>Comercial</th>
              <th>Especial</th>
              <th>A cobrar</th>
              <th>Observación</th>
            </tr>
          </thead>
          <tbody>
            ${rows
              .map(
                ({ item, remission, base, amount, breakdown, issueDate, deliveryDate }) => `
                <tr>
                  <td>${escapeHtml(remission?.folio || item.remissionId)}</td>
                  <td>${formatDate(issueDate)}</td>
                  <td>${formatDate(deliveryDate)}</td>
                  <td class="money">${currency(base)}</td>
                  <td class="money">${currency(breakdown.returnsAmount)}</td>
                  <td class="discount"><strong>${percentValue(item.financialDiscount)}%</strong><span>${currency(breakdown.financialAmount)}</span></td>
                  <td class="discount"><strong>${percentValue(item.commercialDiscount)}%</strong><span>${currency(breakdown.commercialAmount)}</span></td>
                  <td class="discount"><strong>${percentValue(item.specialDiscount)}%</strong><span>${currency(breakdown.specialAmount)}</span></td>
                  <td class="money"><strong>${currency(amount)}</strong></td>
                  <td>${escapeHtml(item.lineNotes || "")}</td>
                </tr>
              `,
              )
              .join("")}
          </tbody>
        </table>
        <section class="summary">
          <div class="notes"><span class="label">Observación general</span>${escapeHtml(request.notes || "")}</div>
          <div class="total"><span class="label">Total a cobrar</span><strong>${currency(paymentRequestTotal(request))}</strong></div>
        </section>
        <section class="receipt">
          <div><span class="label">Monto recibido</span><div class="line"></div></div>
          <div><span class="label">Fecha</span><div class="line"></div></div>
        </section>
        <section class="signatures">
          <div><div class="line"></div><strong>Entrega</strong></div>
          <div><div class="line"></div><strong>Recibe</strong></div>
        </section>
      </body>
    </html>
  `;
}

function openPaymentRequestPdf(id) {
  const request = paymentRequestById(id);
  if (!request) return;
  const popup = window.open("", "_blank");
  if (!popup) {
    toast("Permite ventanas emergentes para generar el PDF");
    return;
  }
  popup.document.open();
  popup.document.write(paymentRequestPdfHtml(request));
  popup.document.close();
  popup.focus();
  popup.print();
}

async function confirmPaymentRequest(id) {
  if (!can("confirmPaymentRequests")) return toast("Tu rol no puede confirmar solicitudes");
  const request = paymentRequestById(id);
  if (!request || request.status === "confirmed") return;
  const requestedTotal = paymentRequestTotal(request);
  const rawReceived = prompt("Monto realmente cobrado", String(requestedTotal.toFixed(2)));
  if (rawReceived === null) return;
  const receivedAmount = parseTemplateNumber(rawReceived);
  if (!Number.isFinite(receivedAmount) || receivedAmount <= 0) {
    toast("Captura un monto cobrado válido");
    return;
  }
  if (receivedAmount > requestedTotal) {
    toast("El monto cobrado no puede ser mayor al total solicitado");
    return;
  }
  const rawCollectionDate = prompt("Fecha de cobro", today());
  if (rawCollectionDate === null) return;
  const collectionDate = normalizeTemplateDate(rawCollectionDate);
  if (!collectionDate) {
    toast("Captura una fecha de cobro válida");
    return;
  }
  if (!confirm(`Se aplicarán ${currency(receivedAmount)} con fecha ${formatDate(collectionDate)} al saldo de las remisiones. ¿Confirmar?`)) return;

  let remaining = receivedAmount;
  let paymentFolioOffset = 0;
  const payments = paymentRequestRows(request)
    .map(({ item, amount }) => {
      const applied = Math.min(amount, remaining);
      remaining = Math.max(0, remaining - applied);
      const folio = applied > 0 ? nextPaymentFolio(paymentFolioOffset++) : "";
      return {
        id: uid("pay"),
        folio,
        date: collectionDate,
        amount: Math.round(applied * 100) / 100,
        clientId: request.clientId,
        remissionId: item.remissionId,
        method: "Solicitud de pago",
        reference: request.folio || request.id,
        notes: [request.notes, item.lineNotes].filter(Boolean).join(" | "),
      };
    })
    .filter((payment) => payment.amount > 0);
  const adjustments = paymentRequestRows(request)
    .flatMap(({ item, breakdown }) => [
      { type: "returns", amount: breakdown.returnsAmount },
      { type: "financial", amount: breakdown.financialAmount },
      { type: "commercial", amount: breakdown.commercialAmount },
      { type: "special", amount: breakdown.specialAmount },
    ]
      .filter((adjustment) => adjustment.amount > 0)
      .map((adjustment) => ({
        id: uid("adj"),
        date: collectionDate,
        clientId: request.clientId,
        remissionId: item.remissionId,
        paymentRequestId: request.id,
        type: adjustment.type,
        label: adjustmentLabel(adjustment.type),
        amount: Math.round(adjustment.amount * 100) / 100,
        reference: request.folio || request.id,
        notes: [request.notes, item.lineNotes].filter(Boolean).join(" | "),
        createdAt: new Date().toISOString(),
        createdBy: currentUser?.username || "",
      })));

  const index = state.paymentRequests.findIndex((item) => item.id === id);
  state.paymentRequests[index] = {
    ...request,
    status: "confirmed",
    confirmedAt: new Date().toISOString(),
    confirmedBy: currentUser?.username || "",
    receivedAmount,
  };
  state.payments.push(...payments);
  state.adjustments.push(...adjustments);
  await saveState();
  render();
  toast("Solicitud confirmada y pagos aplicados");
}

function exportCsv(filename, rows) {
  if (!rows.length) {
    toast("No hay datos para exportar");
    return;
  }

  const headers = Object.keys(rows[0]);
  const csv = [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(",")),
  ].join("\n");

  download(filename, `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`);
}

function download(filename, href) {
  const link = document.createElement("a");
  link.href = href;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function csvCell(value) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function downloadRemissionTemplate() {
  const headers = ["Folio", "Clave cliente", "Fecha", "Fecha entrega", "Notas", "Total"];
  const html = `
    <html>
      <head>
        <meta charset="utf-8">
        <style>
          table { border-collapse: collapse; font-family: Arial, sans-serif; }
          th, td { border: 1px solid #8a9a91; padding: 8px; mso-number-format:"\\@"; }
          th { background: #176a5f; color: #ffffff; font-weight: bold; }
        </style>
      </head>
      <body>
        <table>
          <thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead>
          <tbody></tbody>
        </table>
      </body>
    </html>
  `.trim();

  download(`plantilla-remisiones-${today()}.xls`, `data:application/vnd.ms-excel;charset=utf-8,${encodeURIComponent(html)}`);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

function normalizeHeader(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function normalizeTemplateDate(value) {
  const text = String(value ?? "")
    .trim()
    .replace(/^\uFEFF/, "")
    .replace(/^'/, "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ");
  if (!text) return "";

  const iso = text.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:\s|T|$)/);
  if (iso) return validTemplateDate(iso[1], iso[2], iso[3]);

  const mx = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (mx) {
    const year = normalizeTemplateYear(mx[3]);
    return validTemplateDate(year, mx[2], mx[1]) || validTemplateDate(year, mx[1], mx[2]);
  }

  const serial = Number(text.replace(",", "."));
  if (Number.isFinite(serial) && serial > 20000 && serial < 80000) {
    const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000);
    return date.toISOString().slice(0, 10);
  }

  const normalized = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replaceAll(".", "")
    .replaceAll(",", "")
    .replace(/\bde\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const months = {
    ene: 1,
    enero: 1,
    feb: 2,
    febrero: 2,
    mar: 3,
    marzo: 3,
    abr: 4,
    abril: 4,
    may: 5,
    mayo: 5,
    jun: 6,
    junio: 6,
    jul: 7,
    julio: 7,
    ago: 8,
    agosto: 8,
    sep: 9,
    sept: 9,
    septiembre: 9,
    oct: 10,
    octubre: 10,
    nov: 11,
    noviembre: 11,
    dic: 12,
    diciembre: 12,
  };
  const dayMonthText = normalized.match(/^(\d{1,2})\s+([a-z]+)\s+(\d{2,4})$/);
  if (dayMonthText && months[dayMonthText[2]]) {
    return validTemplateDate(normalizeTemplateYear(dayMonthText[3]), months[dayMonthText[2]], dayMonthText[1]);
  }
  const monthDayText = normalized.match(/^([a-z]+)\s+(\d{1,2})\s+(\d{2,4})$/);
  if (monthDayText && months[monthDayText[1]]) {
    return validTemplateDate(normalizeTemplateYear(monthDayText[3]), months[monthDayText[1]], monthDayText[2]);
  }

  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) {
    return validTemplateDate(parsed.getFullYear(), parsed.getMonth() + 1, parsed.getDate());
  }

  return "";
}

function normalizeTemplateYear(value) {
  const year = Number(value);
  if (year < 100) return year >= 70 ? 1900 + year : 2000 + year;
  return year;
}

function validTemplateDate(yearValue, monthValue, dayValue) {
  const year = Number(yearValue);
  const month = Number(monthValue);
  const day = Number(dayValue);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return "";
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return "";
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return "";
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseTemplateNumber(value) {
  const text = String(value ?? "").trim().replace(/[$\s]/g, "");
  if (!text) return 0;
  const normalized = text.includes(",") && !text.includes(".") ? text.replace(",", ".") : text.replaceAll(",", "");
  return Number(normalized);
}

function rowsFromTemplateText(text, filename) {
  const isCsv = filename.toLowerCase().endsWith(".csv") || !text.toLowerCase().includes("<table");
  const matrix = isCsv
    ? parseCsv(text)
    : (() => {
        const doc = new DOMParser().parseFromString(text, "text/html");
        return [...doc.querySelectorAll("table tr")].map((tr) => [...tr.children].map((cell) => cell.textContent.trim()));
      })();

  const [headers = [], ...dataRows] = matrix;
  const keys = headers.map(normalizeHeader);
  return dataRows.map((cells) =>
    keys.reduce((row, key, index) => {
      if (key) row[key] = cells[index] || "";
      return row;
    }, {}),
  );
}

function buildRemissionsFromTemplate(rows) {
  const clientByClave = new Map(state.clients.map((client) => [String(client.clave || client.id).trim().toLowerCase(), client]));
  const existingFolios = new Set(state.remissions.map((remission) => String(remission.folio).trim().toLowerCase()));
  const importedFolios = new Set();
  const remissions = [];
  const errors = [];

  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const values = Object.values(row).map((value) => String(value ?? "").trim());
    if (!values.some(Boolean)) return;

    const folio = String(row.folio || "").trim();
    const clave = String(row.clave_cliente || row.cliente_clave || "").trim();
    const date = normalizeTemplateDate(row.fecha);
    const deliveryDateValue = String(row.fecha_entrega || row.fecha_de_entrega || "").trim();
    const deliveryDate = deliveryDateValue ? normalizeTemplateDate(deliveryDateValue) : "";
    const notes = String(row.notas || "").trim();
    const total = parseTemplateNumber(row.total);
    const client = clientByClave.get(clave.toLowerCase());
    const folioKey = folio.toLowerCase();

    if (!folio) errors.push(`Fila ${rowNumber}: falta Folio`);
    if (!clave) errors.push(`Fila ${rowNumber}: falta Clave cliente`);
    if (clave && !client) errors.push(`Fila ${rowNumber}: no existe cliente con clave ${clave}`);
    if (!date) errors.push(`Fila ${rowNumber}: fecha inválida`);
    if (deliveryDateValue && !deliveryDate) errors.push(`Fila ${rowNumber}: fecha de entrega inválida`);
    if (!Number.isFinite(total) || total <= 0) errors.push(`Fila ${rowNumber}: total inválido`);
    if (folio && existingFolios.has(folioKey)) errors.push(`Fila ${rowNumber}: ya existe una remisión con folio ${folio}`);
    if (folio && importedFolios.has(folioKey)) errors.push(`Fila ${rowNumber}: el folio ${folio} está repetido en la plantilla`);
    if (!folio || !client || !date || (deliveryDateValue && !deliveryDate) || !Number.isFinite(total) || total <= 0 || existingFolios.has(folioKey) || importedFolios.has(folioKey)) return;

    importedFolios.add(folioKey);
    remissions.push({
      id: uid("rem"),
      folio,
      clientId: client.id,
      date,
      deliveryDate,
      total,
      notes,
      items: [],
    });
  });

  if (errors.length) {
    throw new Error(errors.slice(0, 8).join("\n"));
  }

  return remissions;
}

function formatDate(value) {
  if (!value) return "-";
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}

document.addEventListener("click", async (event) => {
  const nav = event.target.closest("[data-view]");
  if (nav) setView(nav.dataset.view);

  const jump = event.target.closest("[data-view-jump]");
  if (jump) setView(jump.dataset.viewJump);

  const actionButton = event.target.closest("[data-action]");
  if (!actionButton) return;

  const { action, id } = actionButton.dataset;
  if ((action === "edit-client" || action === "delete-client") && !can("editClients")) return toast("Tu rol no puede modificar clientes");
  if ((action === "edit-remission" || action === "delete-remission") && !can("editRemissions")) {
    return toast("Tu rol no puede modificar remisiones");
  }
  if (action === "delete-payment" && !can("editPayments")) return toast("Tu rol no puede modificar pagos");
  if (action === "confirm-payment-request" && !can("confirmPaymentRequests")) return toast("Tu rol no puede confirmar solicitudes");
  if (action === "edit-user" && !can("manageUsers")) return toast("Solo el administrador puede modificar usuarios");

  if (action === "edit-client") editClient(id);
  if (action === "detail-client") showClientDetail(id);
  if (action === "delete-client") await deleteClient(id);
  if (action === "edit-remission") editRemission(id);
  if (action === "detail-remission") showRemissionDetail(id);
  if (action === "delete-remission") await deleteRemission(id);
  if (action === "detail-payment-request") showPaymentRequestDetail(id);
  if (action === "pdf-payment-request") openPaymentRequestPdf(id);
  if (action === "confirm-payment-request") await confirmPaymentRequest(id);
  if (action === "edit-user") editUser(id);
  if (action === "delete-payment") {
    if (!confirm("¿Eliminar este pago?")) return;
    state.payments = state.payments.filter((payment) => payment.id !== id);
    await saveState();
    render();
    toast("Pago eliminado");
  }
});

document.querySelector("#quickRemissionButton").addEventListener("click", () => setView("remissions"));
document.querySelector("#printButton").addEventListener("click", () => window.print());
document.querySelector("#logoutButton").addEventListener("click", async () => {
  await apiRequest("/api/logout", { method: "POST", body: "{}" });
  state = blankState();
  showLogin("Sesión cerrada");
});
document.querySelector("#clearDataButton").addEventListener("click", async () => {
  if (!can("manageData")) return toast("Solo el administrador puede borrar datos");
  if (!confirm("¿Borrar todos los clientes, remisiones y pagos compartidos?")) return;
  state = blankState();
  await saveState();
  resetClientForm();
  resetRemissionForm();
  resetPaymentRequestForm();
  resetPaymentForm();
  setView("dashboard");
  toast("Datos borrados");
});
document.querySelector("#resetClientFormButton").addEventListener("click", resetClientForm);
document.querySelector("#resetRemissionFormButton").addEventListener("click", resetRemissionForm);
document.querySelector("#resetPaymentRequestFormButton").addEventListener("click", resetPaymentRequestForm);
document.querySelector("#resetUserFormButton").addEventListener("click", resetUserForm);
document.querySelector("#closeDialogButton").addEventListener("click", () => els.dialog.close());
document.querySelector("#changePasswordButton").addEventListener("click", () => openPasswordDialog());
document.querySelector("#closePasswordDialogButton").addEventListener("click", () => els.passwordDialog.close());

[els.clientSearch, els.agingSearch, els.remissionSearch, els.remissionStatusFilter, els.remissionClientFilter, els.remissionDateFromFilter, els.remissionDateToFilter, els.paymentRequestSearch, els.paymentRequestMonthFilter, els.paymentSearch, els.paymentMonthFilter, els.adjustmentSearch, els.adjustmentMonthFilter, els.userSearch].forEach((input) => {
  input.addEventListener("input", render);
  input.addEventListener("change", render);
});

els.paymentRequestClient.addEventListener("change", renderPaymentRequestRemissions);
els.paymentRequestRemissions.addEventListener("input", updatePaymentRequestPreview);
els.paymentRequestRemissions.addEventListener("change", updatePaymentRequestPreview);
els.paymentRequestRemissions.addEventListener("focusout", (event) => {
  if (!event.target.matches(".returns")) return;
  const row = event.target.closest(".request-line");
  const base = Number(row?.dataset.balance || 0);
  const amount = Math.min(base, Math.max(0, parseTemplateNumber(event.target.value)));
  event.target.value = currency(amount);
  updatePaymentRequestPreview();
});
if (els.paymentClient) els.paymentClient.addEventListener("change", renderPaymentRemissionOptions);

els.loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  els.loginMessage.textContent = "Validando acceso...";

  try {
    const session = await apiRequest("/api/login", {
      method: "POST",
      body: JSON.stringify({
        username: document.querySelector("#loginUsername").value.trim(),
        password: document.querySelector("#loginPassword").value,
      }),
    });
    showApp(session.user);
    await loadState();
    await loadUsers();
    resetClientForm();
    resetRemissionForm();
    resetPaymentRequestForm();
    resetUserForm();
    setView("dashboard");
    els.loginForm.reset();
  } catch (error) {
    showLogin(error.message);
  }
});

els.passwordForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const currentPassword = document.querySelector("#currentPassword").value;
  const newPassword = document.querySelector("#newPassword").value;
  const confirmPassword = document.querySelector("#confirmPassword").value;

  if (newPassword !== confirmPassword) {
    toast("La confirmación no coincide");
    return;
  }

  try {
    const result = await apiRequest("/api/change-password", {
      method: "POST",
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    if (result.user) showApp(result.user);
    els.passwordForm.reset();
    els.passwordDialog.close();
    toast("Contraseña actualizada");
  } catch (error) {
    toast(error.message);
  }
});

els.clientForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!can("editClients")) return toast("Tu rol no puede modificar clientes");
  const id = document.querySelector("#clientId").value || uid("cli");
  const payload = {
    id,
    clave: document.querySelector("#clientClave").value.trim(),
    name: document.querySelector("#clientName").value.trim(),
    contact: document.querySelector("#clientContact").value.trim(),
    sellerKey: document.querySelector("#clientSellerKey").value.trim(),
    sellerName: document.querySelector("#clientSellerName").value.trim(),
    phone: document.querySelector("#clientPhone").value.trim(),
    address: document.querySelector("#clientAddress").value.trim(),
    notes: document.querySelector("#clientNotes").value.trim(),
  };

  if (!payload.clave) return toast("Captura la clave del cliente");
  if (state.clients.some((client) => client.id !== id && String(client.clave || "").toLowerCase() === payload.clave.toLowerCase())) {
    return toast("Ya existe un cliente con esa clave");
  }

  const index = state.clients.findIndex((client) => client.id === id);
  if (index >= 0) state.clients[index] = payload;
  else state.clients.push(payload);

  await saveState();
  resetClientForm();
  render();
  toast("Cliente guardado");
});

els.remissionForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!can("editRemissions")) return toast("Tu rol no puede modificar remisiones");
  const total = Number(els.remissionTotal.value || 0);
  if (!Number.isFinite(total) || total <= 0) {
    toast("Captura el total de la remisión");
    return;
  }

  const id = document.querySelector("#remissionId").value || uid("rem");
  const payload = {
    id,
    folio: document.querySelector("#remissionFolio").value.trim(),
    date: document.querySelector("#remissionDate").value,
    deliveryDate: els.remissionDeliveryDate.value,
    clientId: document.querySelector("#remissionClient").value,
    total,
    notes: document.querySelector("#remissionNotes").value.trim(),
    items: [],
  };

  const index = state.remissions.findIndex((remission) => remission.id === id);
  if (index >= 0) state.remissions[index] = payload;
  else state.remissions.push(payload);

  await saveState();
  resetRemissionForm();
  render();
  toast("Remisión guardada");
});

els.paymentRequestForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!can("editPaymentRequests")) return toast("Tu rol no puede crear solicitudes");
  const items = collectPaymentRequestItems();
  if (!items.length) {
    toast("Selecciona al menos una remisión");
    return;
  }

  state.paymentRequests.push({
    id: uid("sol"),
    folio: els.paymentRequestFolio.value || nextPaymentRequestFolio(),
    clientId: els.paymentRequestClient.value,
    date: els.paymentRequestDate.value,
    status: "pending",
    notes: els.paymentRequestNotes.value.trim(),
    items,
    createdAt: new Date().toISOString(),
    createdBy: currentUser?.username || "",
    confirmedAt: "",
    confirmedBy: "",
    receivedAmount: 0,
  });

  await saveState();
  resetPaymentRequestForm();
  render();
  toast("Solicitud guardada");
});

els.userForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!can("manageUsers")) return toast("Solo el administrador puede modificar usuarios");
  const id = document.querySelector("#userId").value;
  const password = document.querySelector("#userPassword").value;
  const payload = {
    name: document.querySelector("#userName").value.trim(),
    username: document.querySelector("#userUsername").value.trim(),
    role: document.querySelector("#userRole").value,
    password,
  };

  try {
    const saved = await apiRequest(id ? `/api/users/${encodeURIComponent(id)}` : "/api/users", {
      method: id ? "PUT" : "POST",
      body: JSON.stringify(payload),
    });

    if (saved.user?.id === currentUser?.id) showApp(saved.user);
    await loadUsers();
    resetUserForm();
    renderUsers();
    toast("Usuario guardado");
  } catch (error) {
    toast(error.message);
  }
});

document.querySelector("#exportClientsButton").addEventListener("click", () => {
  exportCsv(
    "clientes.csv",
    state.clients.map((client) => ({ ...client, saldo: clientTotals(client.id).balance })),
  );
});

document.querySelector("#exportRemissionsButton").addEventListener("click", () => {
  exportCsv(
    "remisiones.csv",
    state.remissions.map((remission) => ({
      folio: remission.folio,
      clave_cliente: clientById(remission.clientId)?.clave || "",
      fecha: remission.date,
      fecha_entrega: deliveryDateFor(remission),
      fecha_pago: remissionPaymentDate(remission.id),
      dias: daysSince(deliveryDateFor(remission)),
      cliente: clientById(remission.clientId)?.name || "",
      total: remissionTotal(remission),
      pagado: remissionPaid(remission.id),
      descuentos_devoluciones: remissionAdjusted(remission.id),
      saldo: remissionBalance(remission),
      estado: statusLabel(remissionStatus(remission)),
    })),
  );
});

document.querySelector("#exportAgingButton").addEventListener("click", () => {
  exportCsv(
    "antiguedad-saldos.csv",
    agingRows().map((row) => ({
      clave: row.client.clave || row.client.id,
      cliente: row.client.name,
      remisiones_pendientes: row.remissions,
      saldo_0_15_dias: row.days0To15,
      saldo_16_30_dias: row.days16To30,
      saldo_31_45_dias: row.days31To45,
      saldo_46_60_dias: row.days46To60,
      saldo_mas_61_dias: row.days61Plus,
      total: row.total,
    })),
  );
});

els.downloadRemissionTemplateButton.addEventListener("click", downloadRemissionTemplate);

els.importRemissionsInput.addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  if (!can("editRemissions")) {
    toast("Tu rol no puede importar remisiones");
    event.target.value = "";
    return;
  }

  try {
    const text = await file.text();
    if (text.startsWith("PK")) {
      throw new Error("Usa la plantilla descargada desde la aplicación en formato .xls.");
    }

    const rows = rowsFromTemplateText(text, file.name);
    const remissions = buildRemissionsFromTemplate(rows);
    if (!remissions.length) {
      toast("La plantilla no tiene remisiones para importar");
      return;
    }

    if (!confirm(`Se importarán ${remissions.length} remisiones. ¿Continuar?`)) return;
    const previousRemissions = [...state.remissions];
    state.remissions = [...state.remissions, ...remissions];
    try {
      await saveState();
    } catch (error) {
      state.remissions = previousRemissions;
      throw error;
    }
    resetRemissionForm();
    render();
    toast(`${remissions.length} remisiones importadas`);
  } catch (error) {
    const message = error.status === 401 || error.message === "No autorizado"
      ? "Tu sesión venció o no está activa. Inicia sesión de nuevo y vuelve a cargar la plantilla."
      : error.message;
    alert(`No se pudo importar la plantilla:\n\n${message}`);
  } finally {
    event.target.value = "";
  }
});

document.querySelector("#exportPaymentsButton").addEventListener("click", () => {
  exportCsv(
    "pagos.csv",
    state.payments.map((payment) => ({
      id_pago: payment.folio || payment.id,
      fecha: payment.date,
      cliente: clientById(payment.clientId)?.name || "",
      clave_vendedor: clientById(payment.clientId)?.sellerKey || "",
      vendedor: clientById(payment.clientId)?.sellerName || "",
      remision: remissionById(payment.remissionId)?.folio || "Cuenta",
      metodo: payment.method,
      referencia: payment.reference,
      monto: payment.amount,
    })),
  );
});

document.querySelector("#exportAdjustmentsButton").addEventListener("click", () => {
  exportCsv(
    "descuentos-devoluciones.csv",
    effectiveAdjustments().map((adjustment) => ({
      fecha: adjustment.date,
      clave_cliente: clientById(adjustment.clientId)?.clave || "",
      cliente: clientById(adjustment.clientId)?.name || "",
      remision: remissionById(adjustment.remissionId)?.folio || "",
      solicitud: adjustment.reference || "",
      tipo: adjustment.label || adjustmentLabel(adjustment.type),
      monto: adjustment.amount,
      notas: adjustment.notes || "",
      creado_por: adjustment.createdBy || "",
    })),
  );
});

document.querySelector("#exportJsonButton").addEventListener("click", () => {
  const payload = encodeURIComponent(JSON.stringify(state, null, 2));
  download(`respaldo-remisiones-${today()}.json`, `data:application/json;charset=utf-8,${payload}`);
});

document.querySelector("#importJsonInput").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  if (!can("manageData")) {
    toast("Solo el administrador puede restaurar respaldos");
    event.target.value = "";
    return;
  }

  try {
    const imported = JSON.parse(await file.text());
    state = {
      clients: imported.clients || [],
      remissions: imported.remissions || [],
      payments: imported.payments || [],
      paymentRequests: imported.paymentRequests || [],
      adjustments: imported.adjustments || [],
    };
    await saveState();
    resetClientForm();
    resetRemissionForm();
    resetPaymentRequestForm();
    resetPaymentForm();
    render();
    toast("Respaldo restaurado");
  } catch (error) {
    toast(error.message || "El archivo no es válido");
  } finally {
    event.target.value = "";
  }
});

boot();
