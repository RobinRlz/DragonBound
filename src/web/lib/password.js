const crypto = require("crypto");
const { promisify } = require("util");

const scrypt = promisify(crypto.scrypt);

const PREFIX = "scrypt$";
const KEY_LENGTH = 64;

/**
 * Hash con scrypt (incluido en Node, sin dependencias nuevas).
 * Formato guardado: scrypt$<sal base64>$<hash base64>  (cabe en varchar(255)).
 */
async function hashPassword(plain) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(String(plain), salt, KEY_LENGTH);
  return `${PREFIX}${salt.toString("base64")}$${key.toString("base64")}`;
}

function isHashed(stored) {
  return typeof stored === "string" && stored.startsWith(PREFIX);
}

/**
 * Compara una contraseña con lo guardado en la base de datos.
 * Acepta contraseñas antiguas en texto plano (legacy: true) para poder
 * migrarlas a hash en el momento en que el usuario inicia sesión.
 * @returns {Promise<{ok: boolean, legacy: boolean}>}
 */
async function verifyPassword(plain, stored) {
  if (typeof plain !== "string" || typeof stored !== "string" || stored === "") {
    return { ok: false, legacy: false };
  }

  if (isHashed(stored)) {
    const [, saltB64, keyB64] = stored.split("$");
    if (!saltB64 || !keyB64) return { ok: false, legacy: false };
    const expected = Buffer.from(keyB64, "base64");
    const actual = await scrypt(plain, Buffer.from(saltB64, "base64"), expected.length);
    return { ok: crypto.timingSafeEqual(actual, expected), legacy: false };
  }

  // Texto plano antiguo: comparación en tiempo constante vía SHA-256.
  const a = crypto.createHash("sha256").update(plain).digest();
  const b = crypto.createHash("sha256").update(stored).digest();
  return { ok: crypto.timingSafeEqual(a, b), legacy: true };
}

module.exports = { hashPassword, verifyPassword, isHashed };
