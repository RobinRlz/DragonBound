/**
 * Limitadores en memoria (sin dependencias). Suficientes para una sola instancia;
 * con varias instancias hay que moverlos a Redis o a la base de datos.
 */

function startCleanup(map, windowMs) {
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of map) {
      if (entry.resetAt <= now) map.delete(key);
    }
  }, Math.max(windowMs, 60 * 1000));
  if (timer.unref) timer.unref();
}

/**
 * Middleware: como máximo `max` peticiones por `windowMs` y por clave (IP por defecto).
 * `onLimit(req, res)` permite responder en el formato que espera el cliente.
 */
function createRateLimiter({ windowMs, max, keyFn, onLimit }) {
  const hits = new Map();
  startCleanup(hits, windowMs);
  const getKey = keyFn || ((req) => req.ip);

  return function rateLimiter(req, res, next) {
    const now = Date.now();
    const key = getKey(req);
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }
    entry.count++;
    if (entry.count > max) {
      res.setHeader("Retry-After", Math.ceil((entry.resetAt - now) / 1000));
      if (onLimit) return onLimit(req, res);
      return res.status(429).send("Too many requests");
    }
    next();
  };
}

/**
 * Cuenta intentos FALLIDOS por clave (usuario, cuenta...). Tras `max` fallos la clave
 * queda bloqueada hasta que termina la ventana; un éxito la reinicia.
 */
class FailureTracker {
  constructor({ windowMs, max }) {
    this.windowMs = windowMs;
    this.max = max;
    this.entries = new Map();
    startCleanup(this.entries, windowMs);
  }

  isBlocked(key) {
    const entry = this.entries.get(key);
    if (!entry) return false;
    if (entry.resetAt <= Date.now()) {
      this.entries.delete(key);
      return false;
    }
    return entry.count >= this.max;
  }

  fail(key) {
    const now = Date.now();
    let entry = this.entries.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + this.windowMs };
      this.entries.set(key, entry);
    }
    entry.count++;
  }

  reset(key) {
    this.entries.delete(key);
  }
}

module.exports = { createRateLimiter, FailureTracker };
