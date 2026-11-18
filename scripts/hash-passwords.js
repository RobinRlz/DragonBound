/**
 * Migra todas las contraseñas en texto plano de `accounts` a hash scrypt.
 * Es idempotente: las que ya tienen hash (prefijo "scrypt$") se omiten.
 *
 * Uso (desde la raíz del proyecto, con las variables DB_* del .env):
 *   node scripts/hash-passwords.js
 * Dentro de Docker:
 *   docker cp scripts web_dragonbound:/app/scripts
 *   docker exec web_dragonbound node scripts/hash-passwords.js
 */
require("dotenv").config();
const mysql = require("mysql2/promise");
const { hashPassword, isHashed } = require("../src/web/lib/password");

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || "localhost",
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_DATABASE,
  });

  const [rows] = await conn.query("SELECT Id, Password FROM accounts");
  let migrated = 0;
  let skipped = 0;

  for (const row of rows) {
    if (!row.Password || isHashed(row.Password)) {
      skipped++;
      continue;
    }
    const hash = await hashPassword(row.Password);
    await conn.query("UPDATE accounts SET Password = ? WHERE Id = ?", [hash, row.Id]);
    migrated++;
  }

  console.log(`Cuentas migradas: ${migrated}, omitidas: ${skipped}, total: ${rows.length}`);
  await conn.end();
})().catch((err) => {
  console.error("Error en la migración:", err.message);
  process.exit(1);
});
