const crypto = require("node:crypto");
const { execFile } = require("node:child_process");
const path = require("node:path");
const { promisify } = require("node:util");

const ROOT = path.join(__dirname, "..");
const DB_FILE = path.join(ROOT, "data", "remisiones.db");
const execFileAsync = promisify(execFile);

const [username, name, password, role = "captura"] = process.argv.slice(2);

if (!username || !name || !password) {
  console.error("Uso: node scripts/add-user.js usuario \"Nombre\" contraseña [rol]");
  process.exit(1);
}

async function hashPassword(value, salt) {
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(value, salt, 120000, 64, "sha512", (error, key) => {
      if (error) reject(error);
      else resolve(key.toString("hex"));
    });
  });
}

async function main() {
  const users = await sqliteJson("SELECT username FROM users;");

  if (users.some((user) => user.username.toLowerCase() === username.toLowerCase())) {
    console.error(`El usuario "${username}" ya existe.`);
    process.exit(1);
  }

  const salt = crypto.randomBytes(16).toString("hex");
  await sqliteExec(`
    INSERT INTO users (id, username, name, role, salt, password_hash, must_change_password, created_at)
    VALUES (
      ${sqlValue(crypto.randomUUID())},
      ${sqlValue(username)},
      ${sqlValue(name)},
      ${sqlValue(role)},
      ${sqlValue(salt)},
      ${sqlValue(await hashPassword(password, salt))},
      0,
      ${sqlValue(new Date().toISOString())}
    );
  `);
  console.log(`Usuario creado: ${username} (${role})`);
}

async function sqliteExec(sql) {
  await execFileAsync("sqlite3", ["-batch", "-cmd", ".timeout 5000", DB_FILE, sql], { maxBuffer: 1024 * 1024 * 20 });
}

async function sqliteJson(sql) {
  const { stdout } = await execFileAsync("sqlite3", ["-json", "-cmd", ".timeout 5000", DB_FILE, sql], { maxBuffer: 1024 * 1024 * 20 });
  return stdout.trim() ? JSON.parse(stdout) : [];
}

function sqlValue(value) {
  if (value === null || value === undefined) return "NULL";
  return `'${String(value).replaceAll("'", "''")}'`;
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
