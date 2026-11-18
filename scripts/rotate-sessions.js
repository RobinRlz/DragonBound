/**
 * Reemplaza el token de sesión de juego (accounts.Session) de TODAS las cuentas por uno aleatorio.
 *
 * Las sesiones antiguas eran md5(usuario:género): cualquiera que conociera el nombre y el género
 * de una cuenta podía calcularlas y entrar al servidor de juego como ella. Ejecuta este script
 * una vez al desplegar la corrección; los jugadores tendrán que volver a iniciar sesión.
 *
 * Uso:
 *   docker cp scripts web_dragonbound:/app/scripts
 *   docker exec web_dragonbound node scripts/rotate-sessions.js
 */
require("dotenv").config();
const crypto = require("crypto");
const mysql = require("mysql2/promise");

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || "localhost",
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_DATABASE,
  });

  const [rows] = await conn.query("SELECT Id FROM accounts");
  for (const row of rows) {
    await conn.query("UPDATE accounts SET Session = ? WHERE Id = ?", [
      crypto.randomBytes(16).toString("hex"),
      row.Id,
    ]);
  }

  console.log(`Sesiones rotadas: ${rows.length}`);
  await conn.end();
})().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
