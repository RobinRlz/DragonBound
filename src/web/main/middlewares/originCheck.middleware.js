/**
 * Protección CSRF para toda petición que modifica datos (POST, PUT, PATCH, DELETE).
 *
 * Un navegador siempre envía `Origin` (o `Referer`) en una petición cruzada; si no coincide
 * con el host de esta web, se rechaza. Va junto con la cookie de sesión SameSite=Lax.
 * No hace falta tocar los formularios ni el cliente del juego.
 *
 * Otros orígenes permitidos (por ejemplo un front en otro dominio): ALLOWED_ORIGINS=https://a.com,https://b.com
 */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

function originOf(value) {
  try {
    return new URL(value).origin;
  } catch (e) {
    return null;
  }
}

module.exports = () =>
  function originCheck(req, res, next) {
    if (SAFE_METHODS.has(req.method)) return next();

    const header = req.headers.origin || req.headers.referer;
    // Sin Origin ni Referer: no es una petición cruzada de navegador (curl, apps, etc.).
    if (!header) return next();

    const origin = originOf(header);
    if (origin) {
      if (new URL(origin).host === req.headers.host) return next();
      if (allowedOrigins.includes(origin)) return next();
    }

    res.status(403).send("Forbidden (origin)");
  };
