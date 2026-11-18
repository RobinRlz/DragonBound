const crypto = require("crypto");
const dotenv = require("dotenv");

dotenv.config();

// Si falta el secreto se genera uno aleatorio (las sesiones se pierden al reiniciar,
// pero nunca se usa un valor por defecto conocido).
const randomSecret = () => crypto.randomBytes(32).toString("hex");

module.exports = {
  PORT: process.env.WEB_PORT || 80,
  COOKIE: {
    SECRET: process.env.COOKIE_SECRET || randomSecret(),
  },
  DB: {
    HOST: process.env.DB_HOST || "localhost",
    USER: process.env.DB_USER || "root",
    PASSWORD: process.env.DB_PASSWORD || "",
    DATABASE: process.env.DB_DATABASE || "database-name-xxx",
    PORT: process.env.DB_PORT || 3306,
  },
  SESSION: {
    SECRET: process.env.SESSION_SECRET || randomSecret(),
  },
};
