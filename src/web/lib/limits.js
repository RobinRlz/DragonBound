const { createRateLimiter, FailureTracker } = require("./rateLimit");

const FIFTEEN_MIN = 15 * 60 * 1000;
const ONE_HOUR = 60 * 60 * 1000;

const TOO_MANY = "Demasiados intentos. Espera unos minutos e inténtalo de nuevo.";

// Las rutas ajax del cliente responden con un array JSON cuyo primer elemento es el mensaje.
const jsonMessage = (req, res) => res.send(JSON.stringify([TOO_MANY]));

// Clave por cuenta si hay sesión; si no, por IP.
const accountKey = (req) => String((req.session && req.session.account_id) || req.ip);

// Intentos fallidos de contraseña por nombre de usuario (frena la fuerza bruta sin bloquear a toda una IP compartida).
const loginFailures = new FailureTracker({ windowMs: FIFTEEN_MIN, max: 8 });

const loginIpLimiter = createRateLimiter({ windowMs: FIFTEEN_MIN, max: 100, onLimit: jsonMessage });
const registerLimiter = createRateLimiter({ windowMs: ONE_HOUR, max: 10, onLimit: jsonMessage });
const accountLimiter = createRateLimiter({ windowMs: FIFTEEN_MIN, max: 10, keyFn: accountKey });

function apply(app) {
  app.post("/ajaxLogin", loginIpLimiter);
  app.post("/login", loginIpLimiter);
  app.post("/f", loginIpLimiter);
  app.post("/ajaxRegister", registerLimiter);
  app.post("/bid", registerLimiter);
  app.post("/pin", accountLimiter);
  app.post("/accounts/password/change", accountLimiter);
}

module.exports = { apply, loginFailures };
