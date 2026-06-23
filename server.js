const crypto = require("node:crypto");
const { execFile } = require("node:child_process");
const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
const { promisify } = require("node:util");

const PORT = Number(process.env.PORT || 8000);
const HOST = process.env.HOST || "0.0.0.0";
const ROOT = __dirname;
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, "data"));
const STORE_FILE = path.join(DATA_DIR, "store.json");
const DB_FILE = path.resolve(process.env.DB_FILE || path.join(DATA_DIR, "remisiones.db"));
const POSTGRES_URL = process.env.POSTGRES_URL || process.env.DATABASE_URL || "";
const USE_POSTGRES = Boolean(POSTGRES_URL);
const SESSION_SECRET = process.env.SESSION_SECRET || "";
const RUNNING_ON_VERCEL = Boolean(process.env.VERCEL);
const SESSION_TTL_MS = 1000 * 60 * 60 * 10;
const LOGIN_WINDOW_MS = 1000 * 60 * 15;
const MAX_LOGIN_ATTEMPTS = 5;
const MAX_JSON_BYTES = 1024 * 1024;
const PRODUCTION = process.env.NODE_ENV === "production";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

const sessions = new Map();
const loginAttempts = new Map();
const ALLOWED_STATIC = new Set(["/index.html", "/styles.css", "/app.js"]);
const execFileAsync = promisify(execFile);
let storeReadyPromise = null;
let pgPool = null;

const blankBusinessData = () => ({ clients: [], remissions: [], payments: [], paymentRequests: [] });

async function ensureStore() {
  if (!storeReadyPromise) storeReadyPromise = initializeStore();
  try {
    return await storeReadyPromise;
  } catch (error) {
    storeReadyPromise = null;
    throw error;
  }
}

async function initializeStore() {
  if (!USE_POSTGRES) await fs.mkdir(DATA_DIR, { recursive: true });
  await sqliteExec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      salt TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      must_change_password INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT,
      updated_by TEXT
    );

    CREATE TABLE IF NOT EXISTS clients (
      id TEXT PRIMARY KEY,
      clave TEXT,
      name TEXT NOT NULL,
      contact TEXT,
      phone TEXT,
      address TEXT,
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS remissions (
      id TEXT PRIMARY KEY,
      folio TEXT NOT NULL,
      client_id TEXT NOT NULL,
      date TEXT NOT NULL,
      delivery_date TEXT,
      total REAL NOT NULL DEFAULT 0,
      notes TEXT,
      items_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      folio TEXT,
      client_id TEXT NOT NULL,
      remission_id TEXT,
      date TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      method TEXT,
      reference TEXT,
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS payment_requests (
      id TEXT PRIMARY KEY,
      folio TEXT,
      client_id TEXT NOT NULL,
      date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      notes TEXT,
      items_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      created_by TEXT,
      confirmed_at TEXT,
      confirmed_by TEXT,
      received_amount REAL NOT NULL DEFAULT 0
    );

  `);
  await ensureColumn("clients", "clave", "TEXT");
  await ensureColumn("clients", "contact", "TEXT");
  await ensureColumn("remissions", "delivery_date", "TEXT");
  await ensureColumn("remissions", "total", "REAL NOT NULL DEFAULT 0");
  await ensureColumn("payments", "folio", "TEXT");
  await ensureColumn("payment_requests", "folio", "TEXT");
  await ensureColumn("payment_requests", "received_amount", "REAL NOT NULL DEFAULT 0");
  await migratePaymentFolios();
  await migratePaymentRequestFolios();
  await sqliteExec("UPDATE clients SET clave = id WHERE clave IS NULL OR clave = '';");
  await migrateRemissionTotals();
  await sqliteExec("CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_clave ON clients(clave) WHERE clave IS NOT NULL AND clave <> '';");

  const [{ count }] = await sqliteJson("SELECT COUNT(*) AS count FROM users;");
  if (Number(count) === 0) {
    const migrated = await readJsonStoreIfPresent();
    if (migrated?.users?.length) {
      await writeStore(migrated);
      return;
    }
    const admin = await makeUser("admin", "Administrador", "admin123", "admin", true);
    await writeStore({ ...blankBusinessData(), users: [admin] });
    console.log("Usuario inicial: admin / admin123");
  }
}

async function readStore() {
  await ensureStore();
  const [clients, remissions, payments, paymentRequests, users] = await Promise.all([
    sqliteJson("SELECT id, clave, name, contact, phone, address, notes FROM clients ORDER BY name;"),
    sqliteJson("SELECT id, folio, client_id AS clientId, date, delivery_date AS deliveryDate, total, notes, items_json AS itemsJson FROM remissions ORDER BY date DESC, folio;"),
    sqliteJson("SELECT id, folio, client_id AS clientId, remission_id AS remissionId, date, amount, method, reference, notes FROM payments ORDER BY date DESC;"),
    sqliteJson(`
      SELECT
        id,
        folio,
        client_id AS clientId,
        date,
        status,
        notes,
        items_json AS itemsJson,
        created_at AS createdAt,
        created_by AS createdBy,
        confirmed_at AS confirmedAt,
        confirmed_by AS confirmedBy,
        received_amount AS receivedAmount
      FROM payment_requests
      ORDER BY date DESC, id DESC;
    `),
    sqliteJson(`
      SELECT
        id,
        username,
        name,
        role,
        salt,
        password_hash AS passwordHash,
        must_change_password AS mustChangePassword,
        created_at AS createdAt,
        updated_at AS updatedAt,
        updated_by AS updatedBy
      FROM users
      ORDER BY name;
    `),
  ]);

  return {
    clients: clients.map((client) => ({
      ...client,
      clave: client.clave || client.id,
      contact: client.contact || "",
      phone: client.phone || "",
      address: client.address || "",
      notes: client.notes || "",
    })),
    remissions: remissions.map((remission) => {
      const items = safeParseItems(remission.itemsJson);
      return {
        id: remission.id,
        folio: remission.folio,
        clientId: remission.clientId,
        date: remission.date,
        deliveryDate: remission.deliveryDate || "",
        total: Number(remission.total || totalFromItems(items)),
        notes: remission.notes || "",
        items,
      };
    }),
    payments: payments.map((payment) => ({
      ...payment,
      folio: payment.folio || payment.id,
      amount: Number(payment.amount || 0),
      remissionId: payment.remissionId || "",
      method: payment.method || "",
      reference: payment.reference || "",
      notes: payment.notes || "",
    })),
    paymentRequests: paymentRequests.map((request) => ({
      ...request,
      folio: request.folio || request.id,
      status: request.status || "pending",
      notes: request.notes || "",
      items: safeParseItems(request.itemsJson),
      createdAt: request.createdAt || "",
      createdBy: request.createdBy || "",
      confirmedAt: request.confirmedAt || "",
      confirmedBy: request.confirmedBy || "",
      receivedAmount: Number(request.receivedAmount || 0),
    })),
    users: users.map((user) => ({
      ...user,
      mustChangePassword: Boolean(user.mustChangePassword),
    })),
  };
}

async function writeStore(store) {
  if (!USE_POSTGRES) await fs.mkdir(DATA_DIR, { recursive: true });
  validateClientKeys(store.clients || []);
  const payments = withSequentialFolios(store.payments || [], "P");
  const paymentRequests = withSequentialFolios(store.paymentRequests || [], "SP");
  const sql = [
    "BEGIN IMMEDIATE;",
    "DELETE FROM payments;",
    "DELETE FROM payment_requests;",
    "DELETE FROM remissions;",
    "DELETE FROM clients;",
    "DELETE FROM users;",
    ...(store.users || []).map((user) => `
      INSERT INTO users (id, username, name, role, salt, password_hash, must_change_password, created_at, updated_at, updated_by)
      VALUES (
        ${sqlValue(user.id)},
        ${sqlValue(user.username)},
        ${sqlValue(user.name)},
        ${sqlValue(user.role)},
        ${sqlValue(user.salt)},
        ${sqlValue(user.passwordHash)},
        ${sqlBool(user.mustChangePassword)},
        ${sqlValue(user.createdAt || new Date().toISOString())},
        ${sqlValue(user.updatedAt || null)},
        ${sqlValue(user.updatedBy || null)}
      );
    `),
    ...(store.clients || []).map((client) => `
      INSERT INTO clients (id, clave, name, contact, phone, address, notes)
      VALUES (
        ${sqlValue(client.id)},
        ${sqlValue(client.clave || client.id)},
        ${sqlValue(client.name)},
        ${sqlValue(client.contact || "")},
        ${sqlValue(client.phone || "")},
        ${sqlValue(client.address || "")},
        ${sqlValue(client.notes || "")}
      );
    `),
    ...(store.remissions || []).map((remission) => `
      INSERT INTO remissions (id, folio, client_id, date, delivery_date, total, notes, items_json)
      VALUES (
        ${sqlValue(remission.id)},
        ${sqlValue(remission.folio)},
        ${sqlValue(remission.clientId)},
        ${sqlValue(remission.date)},
        ${sqlValue(remission.deliveryDate || "")},
        ${sqlNumber(remission.total || totalFromItems(remission.items || []))},
        ${sqlValue(remission.notes || "")},
        ${sqlValue(JSON.stringify(remission.items || []))}
      );
    `),
    ...payments.map((payment) => `
      INSERT INTO payments (id, folio, client_id, remission_id, date, amount, method, reference, notes)
      VALUES (
        ${sqlValue(payment.id)},
        ${sqlValue(payment.folio || payment.id)},
        ${sqlValue(payment.clientId)},
        ${sqlValue(payment.remissionId || "")},
        ${sqlValue(payment.date)},
        ${sqlNumber(payment.amount)},
        ${sqlValue(payment.method || "")},
        ${sqlValue(payment.reference || "")},
        ${sqlValue(payment.notes || "")}
      );
    `),
    ...paymentRequests.map((request) => `
      INSERT INTO payment_requests (id, folio, client_id, date, status, notes, items_json, created_at, created_by, confirmed_at, confirmed_by, received_amount)
      VALUES (
        ${sqlValue(request.id)},
        ${sqlValue(request.folio || request.id)},
        ${sqlValue(request.clientId)},
        ${sqlValue(request.date)},
        ${sqlValue(request.status || "pending")},
        ${sqlValue(request.notes || "")},
        ${sqlValue(JSON.stringify(request.items || []))},
        ${sqlValue(request.createdAt || new Date().toISOString())},
        ${sqlValue(request.createdBy || "")},
        ${sqlValue(request.confirmedAt || "")},
        ${sqlValue(request.confirmedBy || "")},
        ${sqlNumber(request.receivedAmount || 0)}
      );
    `),
    "COMMIT;",
  ].join("\n");

  await sqliteExec(sql);
}

function withSequentialFolios(items, prefix) {
  const used = new Set();
  let nextNumber = (items || []).reduce((max, item) => {
    const match = String(item.folio || "").match(/(\d+)$/);
    return Math.max(max, match ? Number(match[1]) : 0);
  }, 0);

  return (items || []).map((item) => {
    let folio = String(item.folio || "").trim();
    if (!folio || used.has(folio.toLowerCase())) {
      do {
        nextNumber += 1;
        folio = `${prefix}-${String(nextNumber).padStart(4, "0")}`;
      } while (used.has(folio.toLowerCase()));
    }
    used.add(folio.toLowerCase());
    return { ...item, folio };
  });
}

function validateClientKeys(clients) {
  const keys = new Set();
  for (const client of clients) {
    const key = String(client.clave || client.id || "").trim().toLowerCase();
    if (!key) {
      const error = new Error("Todos los clientes deben tener clave");
      error.status = 400;
      throw error;
    }
    if (keys.has(key)) {
      const error = new Error("Ya existe un cliente con esa clave");
      error.status = 409;
      throw error;
    }
    keys.add(key);
  }
}

async function readJsonStoreIfPresent() {
  if (USE_POSTGRES) return null;
  try {
    const raw = await fs.readFile(STORE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return {
      clients: parsed.clients || [],
      remissions: parsed.remissions || [],
      payments: parsed.payments || [],
      paymentRequests: parsed.paymentRequests || [],
      users: parsed.users || [],
    };
  } catch {
    return null;
  }
}

async function sqliteExec(sql) {
  if (USE_POSTGRES) {
    await pgQuery(sql);
    return;
  }
  await execFileAsync("sqlite3", ["-batch", "-cmd", ".timeout 5000", DB_FILE, sql], { maxBuffer: 1024 * 1024 * 20 });
}

async function sqliteJson(sql) {
  if (USE_POSTGRES) {
    const result = await pgQuery(sql);
    return normalizePgRows(result.rows || []);
  }
  const { stdout } = await execFileAsync("sqlite3", ["-json", "-cmd", ".timeout 5000", DB_FILE, sql], { maxBuffer: 1024 * 1024 * 20 });
  return stdout.trim() ? JSON.parse(stdout) : [];
}

async function ensureColumn(table, column, definition) {
  if (USE_POSTGRES) {
    const columns = await sqliteJson(`
      SELECT column_name AS name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = ${sqlValue(table)}
        AND column_name = ${sqlValue(column)};
    `);
    if (!columns.some((item) => item.name === column)) {
      await sqliteExec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
    }
    return;
  }
  const columns = await sqliteJson(`PRAGMA table_info(${table});`);
  if (!columns.some((item) => item.name === column)) {
    await sqliteExec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
  }
}

async function pgQuery(sql) {
  if (!pgPool) {
    const { Pool } = require("pg");
    pgPool = new Pool({
      connectionString: POSTGRES_URL,
      ssl: process.env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: false },
    });
  }
  return pgPool.query(sqlForPostgres(sql));
}

function sqlForPostgres(sql) {
  return sql
    .replace(/PRAGMA[^;]+;/gi, "")
    .replace(/\bBEGIN\s+IMMEDIATE\b/gi, "BEGIN")
    .replace(/\bREAL\b/gi, "DOUBLE PRECISION")
    .trim();
}

function normalizePgRows(rows) {
  const aliases = {
    clientid: "clientId",
    deliverydate: "deliveryDate",
    itemsjson: "itemsJson",
    passwordhash: "passwordHash",
    mustchangepassword: "mustChangePassword",
    createdat: "createdAt",
    updatedat: "updatedAt",
    updatedby: "updatedBy",
    confirmedat: "confirmedAt",
    confirmedby: "confirmedBy",
    receivedamount: "receivedAmount",
  };
  return rows.map((row) =>
    Object.fromEntries(Object.entries(row).map(([key, value]) => [aliases[key] || key, value])),
  );
}

function safeDatabaseError(error) {
  const message = String(error?.message || "No se pudo conectar a la base de datos");
  if (/password|auth|authentication/i.test(message)) return "No se pudo autenticar con la base de datos";
  if (/ENOTFOUND|getaddrinfo|timeout|ECONNREFUSED|network/i.test(message)) return "No se pudo conectar con el host de la base de datos";
  if (/does not exist|relation|syntax/i.test(message)) return message.slice(0, 160);
  return message.slice(0, 160);
}

async function migrateRemissionTotals() {
  const remissions = await sqliteJson("SELECT id, total, items_json AS itemsJson FROM remissions;");
  const updates = remissions
    .map((remission) => ({
      id: remission.id,
      total: Number(remission.total || 0),
      calculatedTotal: totalFromItems(safeParseItems(remission.itemsJson)),
    }))
    .filter((remission) => remission.total === 0 && remission.calculatedTotal > 0)
    .map(
      (remission) => `
        UPDATE remissions
        SET total = ${sqlNumber(remission.calculatedTotal)}
        WHERE id = ${sqlValue(remission.id)};
      `,
    );

  if (updates.length) await sqliteExec(updates.join("\n"));
}

async function migratePaymentRequestFolios() {
  const requests = await sqliteJson("SELECT id, folio, date FROM payment_requests ORDER BY date, id;");
  let nextNumber = requests.reduce((max, request) => {
    const match = String(request.folio || "").match(/(\d+)$/);
    return Math.max(max, match ? Number(match[1]) : 0);
  }, 0);
  const updates = requests
    .filter((request) => !request.folio)
    .map((request) => {
      nextNumber += 1;
      return `
        UPDATE payment_requests
        SET folio = ${sqlValue(`SP-${String(nextNumber).padStart(4, "0")}`)}
        WHERE id = ${sqlValue(request.id)};
      `;
    });

  if (updates.length) await sqliteExec(updates.join("\n"));
  await sqliteExec("CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_requests_folio ON payment_requests(folio) WHERE folio IS NOT NULL AND folio <> '';");
}

async function migratePaymentFolios() {
  const payments = await sqliteJson("SELECT id, folio, date FROM payments ORDER BY date, id;");
  let nextNumber = payments.reduce((max, payment) => {
    const match = String(payment.folio || "").match(/(\d+)$/);
    return Math.max(max, match ? Number(match[1]) : 0);
  }, 0);
  const updates = payments
    .filter((payment) => !payment.folio)
    .map((payment) => {
      nextNumber += 1;
      return `
        UPDATE payments
        SET folio = ${sqlValue(`P-${String(nextNumber).padStart(4, "0")}`)}
        WHERE id = ${sqlValue(payment.id)};
      `;
    });

  if (updates.length) await sqliteExec(updates.join("\n"));
  await sqliteExec("CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_folio ON payments(folio) WHERE folio IS NOT NULL AND folio <> '';");
}

function sqlValue(value) {
  if (value === null || value === undefined) return "NULL";
  return `'${String(value).replaceAll("'", "''")}'`;
}

function sqlNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? String(number) : "0";
}

function sqlBool(value) {
  return value ? "1" : "0";
}

function safeParseItems(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function totalFromItems(items) {
  return (items || []).reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.price || 0), 0);
}

async function makeUser(username, name, password, role, mustChangePassword = false) {
  const salt = crypto.randomBytes(16).toString("hex");
  return {
    id: crypto.randomUUID(),
    username,
    name,
    role,
    salt,
    passwordHash: await hashPassword(password, salt),
    mustChangePassword,
    createdAt: new Date().toISOString(),
  };
}

function hashPassword(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(password, salt, 120000, 64, "sha512", (error, key) => {
      if (error) reject(error);
      else resolve(key.toString("hex"));
    });
  });
}

async function verifyPassword(password, user) {
  const hash = await hashPassword(password, user.salt);
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(user.passwordHash, "hex"));
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
    createdAt: user.createdAt,
    mustChangePassword: Boolean(user.mustChangePassword),
  };
}

function clientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) return String(forwarded).split(",")[0].trim();
  return req.socket.remoteAddress || "unknown";
}

function loginKey(req, username) {
  return `${clientIp(req)}:${String(username || "").toLowerCase()}`;
}

function loginStatus(key) {
  const entry = loginAttempts.get(key);
  if (!entry) return { blocked: false };
  if (entry.blockedUntil && entry.blockedUntil > Date.now()) {
    return { blocked: true, retryAfter: Math.ceil((entry.blockedUntil - Date.now()) / 1000) };
  }
  if (entry.firstAttemptAt + LOGIN_WINDOW_MS < Date.now()) {
    loginAttempts.delete(key);
    return { blocked: false };
  }
  return { blocked: false };
}

function recordLoginFailure(key) {
  const now = Date.now();
  const entry = loginAttempts.get(key);
  const next = entry && entry.firstAttemptAt + LOGIN_WINDOW_MS > now
    ? { ...entry, count: entry.count + 1 }
    : { count: 1, firstAttemptAt: now };

  if (next.count >= MAX_LOGIN_ATTEMPTS) {
    next.blockedUntil = now + LOGIN_WINDOW_MS;
  }

  loginAttempts.set(key, next);
}

function recordLoginSuccess(key) {
  loginAttempts.delete(key);
}

function isSecureRequest(req) {
  return Boolean(req.socket.encrypted) || req.headers["x-forwarded-proto"] === "https";
}

function sessionCookie(req, sessionId, maxAgeSeconds) {
  const secure = PRODUCTION || isSecureRequest(req);
  return [
    `session=${encodeURIComponent(sessionId)}`,
    "HttpOnly",
    "SameSite=Strict",
    "Path=/",
    `Max-Age=${maxAgeSeconds}`,
    secure ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

function signedSessionToken(user) {
  const payload = Buffer.from(JSON.stringify({
    user,
    exp: Date.now() + SESSION_TTL_MS,
  })).toString("base64url");
  const signature = crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function verifiedSessionToken(token) {
  if (!SESSION_SECRET || !token || !token.includes(".")) return null;
  const [payload, signature] = token.split(".");
  const expected = crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("base64url");
  try {
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!parsed?.user || !parsed.exp || parsed.exp < Date.now()) return null;
    return { user: parsed.user, expiresAt: parsed.exp };
  } catch {
    return null;
  }
}

function securityHeaders(req) {
  const headers = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    "Cache-Control": "no-store",
  };

  if (PRODUCTION && isSecureRequest(req)) {
    headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains";
  }

  return headers;
}

function parseCookies(header = "") {
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim().split("="))
      .filter(([key, value]) => key && value)
      .map(([key, value]) => [key, decodeURIComponent(value)]),
  );
}

function sessionFromRequest(req) {
  const sessionId = parseCookies(req.headers.cookie).session;
  if (!sessionId) return null;

  if (SESSION_SECRET) return verifiedSessionToken(sessionId);

  const session = sessions.get(sessionId);
  if (!session || session.expiresAt < Date.now()) {
    sessions.delete(sessionId);
    return null;
  }

  session.expiresAt = Date.now() + SESSION_TTL_MS;
  return session;
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_JSON_BYTES) {
      const error = new Error("Payload demasiado grande");
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function send(req, res, status, body, headers = {}) {
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": typeof body === "string" ? "text/plain; charset=utf-8" : "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    ...securityHeaders(req),
    ...headers,
  });
  res.end(payload);
}

function sendJson(req, res, status, body, headers = {}) {
  send(req, res, status, body, headers);
}

function requireSession(req, res) {
  const session = sessionFromRequest(req);
  if (!session) {
    sendJson(req, res, 401, { error: "No autorizado" });
    return null;
  }
  return session;
}

function requireAdmin(req, res) {
  const session = requireSession(req, res);
  if (!session) return null;
  if (session.user.role !== "admin") {
    sendJson(req, res, 403, { error: "Solo el administrador puede gestionar usuarios" });
    return null;
  }
  return session;
}

function normalizeRole(role) {
  const allowedRoles = new Set(["admin", "captura", "cobranza", "consulta"]);
  return allowedRoles.has(role) ? role : "captura";
}

function userIdFromPath(pathname) {
  const match = pathname.match(/^\/api\/users\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : "";
}

function sameData(left, right) {
  return JSON.stringify(left || []) === JSON.stringify(right || []);
}

function changedSections(store, incoming) {
  return {
    clients: !sameData(store.clients, incoming.clients),
    remissions: !sameData(store.remissions, incoming.remissions),
    payments: !sameData(store.payments, incoming.payments),
    paymentRequests: !sameData(store.paymentRequests, incoming.paymentRequests),
  };
}

function canUpdateState(role, changes) {
  if (!changes.clients && !changes.remissions && !changes.payments && !changes.paymentRequests) return true;
  if (role === "admin") return true;
  if (role === "consulta") return !changes.clients && !changes.remissions && !changes.payments && !changes.paymentRequests;
  if (role === "captura") return (changes.clients || changes.remissions || changes.paymentRequests) && !changes.payments;
  if (role === "cobranza") return (changes.payments || changes.paymentRequests) && !changes.clients && !changes.remissions;
  return false;
}

function rolePermissionMessage(role) {
  return {
    captura: "Captura solo puede modificar clientes, remisiones y solicitudes",
    cobranza: "Cobranza solo puede modificar pagos y solicitudes",
    consulta: "Consulta no puede modificar información",
  }[role] || "Tu rol no tiene permiso para esta acción";
}

async function handleApi(req, res, pathname) {
  if (pathname === "/api/health" && req.method === "GET") {
    if (RUNNING_ON_VERCEL && !USE_POSTGRES) {
      return sendJson(req, res, 500, {
        ok: false,
        error: "Falta DATABASE_URL o POSTGRES_URL en Vercel",
        storage: "not-configured",
        environment: PRODUCTION ? "production" : "development",
      });
    }
    try {
      await ensureStore();
      const [{ ok }] = await sqliteJson("SELECT 1 AS ok;");
      return sendJson(req, res, 200, {
        ok: Number(ok) === 1,
        storage: USE_POSTGRES ? "postgres" : "sqlite",
        environment: PRODUCTION ? "production" : "development",
      });
    } catch (error) {
      return sendJson(req, res, 500, {
        ok: false,
        error: safeDatabaseError(error),
        storage: USE_POSTGRES ? "postgres" : "sqlite",
        environment: PRODUCTION ? "production" : "development",
      });
    }
  }

  if (pathname === "/api/session" && req.method === "GET") {
    const session = sessionFromRequest(req);
    if (!session) return sendJson(req, res, 401, { user: null });
    return sendJson(req, res, 200, { user: session.user });
  }

  if (pathname === "/api/login" && req.method === "POST") {
    const { username, password } = await readJson(req);
    const key = loginKey(req, username);
    const status = loginStatus(key);
    if (status.blocked) {
      return sendJson(req, res, 429, { error: "Demasiados intentos. Intenta más tarde" }, {
        "Retry-After": String(status.retryAfter),
      });
    }

    const store = await readStore();
    const user = store.users.find((item) => item.username.toLowerCase() === String(username || "").toLowerCase());

    if (!user || !(await verifyPassword(String(password || ""), user))) {
      recordLoginFailure(key);
      return sendJson(req, res, 401, { error: "Usuario o contraseña incorrectos" });
    }

    recordLoginSuccess(key);
    const safeUser = publicUser(user);
    if (user.username === "admin" && !user.mustChangePassword && (await verifyPassword("admin123", user))) {
      safeUser.mustChangePassword = true;
    }
    const sessionId = SESSION_SECRET ? signedSessionToken(safeUser) : crypto.randomBytes(32).toString("hex");
    if (!SESSION_SECRET) sessions.set(sessionId, { user: safeUser, expiresAt: Date.now() + SESSION_TTL_MS });

    return sendJson(req, res, 200, { user: safeUser }, {
      "Set-Cookie": sessionCookie(req, sessionId, SESSION_TTL_MS / 1000),
    });
  }

  if (pathname === "/api/logout" && req.method === "POST") {
    const sessionId = parseCookies(req.headers.cookie).session;
    if (sessionId) sessions.delete(sessionId);
    return sendJson(req, res, 200, { ok: true }, {
      "Set-Cookie": sessionCookie(req, "", 0),
    });
  }

  const session = requireSession(req, res);
  if (!session) return;

  if (pathname === "/api/change-password" && req.method === "POST") {
    const incoming = await readJson(req);
    const currentPassword = String(incoming.currentPassword || "");
    const newPassword = String(incoming.newPassword || "");

    if (newPassword.length < 6) {
      return sendJson(req, res, 400, { error: "La nueva contraseña debe tener al menos 6 caracteres" });
    }

    const store = await readStore();
    const index = store.users.findIndex((user) => user.id === session.user.id);
    if (index < 0) return sendJson(req, res, 404, { error: "Usuario no encontrado" });

    const user = store.users[index];
    if (!(await verifyPassword(currentPassword, user))) {
      return sendJson(req, res, 401, { error: "La contraseña actual no es correcta" });
    }

    const nextUser = {
      ...user,
      salt: crypto.randomBytes(16).toString("hex"),
      mustChangePassword: false,
      updatedAt: new Date().toISOString(),
      updatedBy: session.user.username,
    };
    nextUser.passwordHash = await hashPassword(newPassword, nextUser.salt);

    const users = store.users.slice();
    users[index] = nextUser;
    await writeStore({ ...store, users });

    for (const activeSession of sessions.values()) {
      if (activeSession.user.id === nextUser.id) activeSession.user = publicUser(nextUser);
    }

    const cookieHeaders = SESSION_SECRET
      ? { "Set-Cookie": sessionCookie(req, signedSessionToken(publicUser(nextUser)), SESSION_TTL_MS / 1000) }
      : {};
    return sendJson(req, res, 200, { ok: true, user: publicUser(nextUser) }, cookieHeaders);
  }

  if (pathname === "/api/users" && req.method === "GET") {
    const adminSession = requireAdmin(req, res);
    if (!adminSession) return;
    const store = await readStore();
    return sendJson(req, res, 200, { users: store.users.map(publicUser) });
  }

  if (pathname === "/api/users" && req.method === "POST") {
    const adminSession = requireAdmin(req, res);
    if (!adminSession) return;
    const incoming = await readJson(req);
    const username = String(incoming.username || "").trim();
    const name = String(incoming.name || "").trim();
    const password = String(incoming.password || "");
    const role = normalizeRole(String(incoming.role || ""));

    if (!username || !name || password.length < 6) {
      return sendJson(req, res, 400, { error: "Captura nombre, usuario y una contraseña de al menos 6 caracteres" });
    }

    const store = await readStore();
    if (store.users.some((user) => user.username.toLowerCase() === username.toLowerCase())) {
      return sendJson(req, res, 409, { error: "Ese usuario ya existe" });
    }

    const user = await makeUser(username, name, password, role);
    await writeStore({ ...store, users: [...store.users, user] });
    return sendJson(req, res, 201, { user: publicUser(user) });
  }

  const userId = userIdFromPath(pathname);
  if (userId && req.method === "PUT") {
    const adminSession = requireAdmin(req, res);
    if (!adminSession) return;
    const incoming = await readJson(req);
    const username = String(incoming.username || "").trim();
    const name = String(incoming.name || "").trim();
    const password = String(incoming.password || "");
    const role = normalizeRole(String(incoming.role || ""));

    if (!username || !name) {
      return sendJson(req, res, 400, { error: "Captura nombre y usuario" });
    }
    if (password && password.length < 6) {
      return sendJson(req, res, 400, { error: "La nueva contraseña debe tener al menos 6 caracteres" });
    }

    const store = await readStore();
    const index = store.users.findIndex((user) => user.id === userId);
    if (index < 0) return sendJson(req, res, 404, { error: "Usuario no encontrado" });
    if (store.users.some((user) => user.id !== userId && user.username.toLowerCase() === username.toLowerCase())) {
      return sendJson(req, res, 409, { error: "Ese usuario ya existe" });
    }
    if (store.users[index].role === "admin" && role !== "admin") {
      const otherAdmins = store.users.filter((user) => user.id !== userId && user.role === "admin");
      if (!otherAdmins.length) return sendJson(req, res, 400, { error: "Debe existir al menos un administrador" });
    }

    const nextUser = {
      ...store.users[index],
      username,
      name,
      role,
      updatedAt: new Date().toISOString(),
      updatedBy: adminSession.user.username,
    };

    if (password) {
      nextUser.salt = crypto.randomBytes(16).toString("hex");
      nextUser.passwordHash = await hashPassword(password, nextUser.salt);
    }

    const users = store.users.slice();
    users[index] = nextUser;
    await writeStore({ ...store, users });

    for (const activeSession of sessions.values()) {
      if (activeSession.user.id === nextUser.id) activeSession.user = publicUser(nextUser);
    }

    const cookieHeaders = SESSION_SECRET && nextUser.id === adminSession.user.id
      ? { "Set-Cookie": sessionCookie(req, signedSessionToken(publicUser(nextUser)), SESSION_TTL_MS / 1000) }
      : {};
    return sendJson(req, res, 200, { user: publicUser(nextUser) }, cookieHeaders);
  }

  if (pathname === "/api/state" && req.method === "GET") {
    const store = await readStore();
    return sendJson(req, res, 200, {
      clients: store.clients,
      remissions: store.remissions,
      payments: store.payments,
      paymentRequests: store.paymentRequests,
    });
  }

  if (pathname === "/api/state" && req.method === "PUT") {
    const incoming = await readJson(req);
    const store = await readStore();
    const nextState = {
      clients: incoming.clients || [],
      remissions: incoming.remissions || [],
      payments: incoming.payments || [],
      paymentRequests: incoming.paymentRequests || [],
    };
    const changes = changedSections(store, nextState);

    if (!canUpdateState(session.user.role, changes)) {
      return sendJson(req, res, 403, { error: rolePermissionMessage(session.user.role) });
    }

    await writeStore({
      ...store,
      ...nextState,
      updatedAt: new Date().toISOString(),
      updatedBy: session.user.username,
    });
    const saved = await readStore();
    return sendJson(req, res, 200, {
      ok: true,
      clients: saved.clients,
      remissions: saved.remissions,
      payments: saved.payments,
      paymentRequests: saved.paymentRequests,
    });
  }

  sendJson(req, res, 404, { error: "Ruta no encontrada" });
}

async function serveStatic(req, res, pathname) {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(ROOT, safePath));

  if (filePath !== ROOT && !filePath.startsWith(`${ROOT}${path.sep}`)) {
    return send(req, res, 403, "Acceso denegado");
  }

  if (!ALLOWED_STATIC.has(safePath)) {
    return send(req, res, 404, "Archivo no encontrado");
  }

  try {
    const content = await fs.readFile(filePath);
    const ext = path.extname(filePath);
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
      ...securityHeaders(req),
      "Cache-Control": safePath === "/index.html" ? "no-store" : "public, max-age=300",
    });
    res.end(content);
  } catch {
    send(req, res, 404, "Archivo no encontrado");
  }
}

async function requestHandler(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url.pathname);
      return;
    }
    await serveStatic(req, res, url.pathname);
  } catch (error) {
    console.error(error);
    sendJson(req, res, error.status || 500, { error: error.message || "Error interno" });
  }
}

if (require.main === module) {
  const server = http.createServer(requestHandler);

  ensureStore().then(() => {
    server.listen(PORT, HOST, () => {
      console.log(`Control de remisiones disponible en http://${HOST}:${PORT}`);
    });
  });

  function shutdown() {
    server.close(() => {
      process.exit(0);
    });
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

module.exports = requestHandler;
