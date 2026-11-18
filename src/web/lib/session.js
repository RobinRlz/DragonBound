const crypto = require("crypto");

/** Token de sesión de juego aleatorio (32 caracteres hex; cabe en accounts.Session varchar(45)). */
function newSessionToken() {
  return crypto.randomBytes(16).toString("hex");
}

/**
 * Genera un token nuevo para la cuenta y lo guarda. Se llama en cada inicio de sesión:
 * así un token filtrado o antiguo deja de servir y nunca se deriva del nombre de usuario.
 */
async function rotateAccountSession(db, accountId) {
  const token = newSessionToken();
  await db.connection.query("UPDATE accounts SET Session = ? WHERE Id = ?", [token, accountId]);
  return token;
}

module.exports = { newSessionToken, rotateAccountSession };
