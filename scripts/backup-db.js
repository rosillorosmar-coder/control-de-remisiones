const { execFile } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);
const ROOT = path.join(__dirname, "..");
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, "data"));
const DB_FILE = path.resolve(process.env.DB_FILE || path.join(DATA_DIR, "remisiones.db"));
const BACKUP_DIR = path.resolve(process.env.BACKUP_DIR || path.join(ROOT, "backups"));

function stamp() {
  return new Date().toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z");
}

async function main() {
  await fs.mkdir(BACKUP_DIR, { recursive: true });
  const output = path.join(BACKUP_DIR, `remisiones-${stamp()}.db`);
  await execFileAsync("sqlite3", [DB_FILE, `.backup '${output.replaceAll("'", "''")}'`]);
  console.log(output);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
