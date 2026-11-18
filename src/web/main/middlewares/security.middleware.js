const helmet = require("helmet");

/**
 * Cabeceras de seguridad. El cliente del juego y varias páginas usan scripts y estilos en línea,
 * así que NO se activa una CSP restrictiva de scripts; se aplican solo las directivas que no los rompen:
 * sin plugins, sin <base> ajeno, formularios solo hacia esta web (y PayPal) y sin ser embebida en otros sitios.
 */
module.exports = () =>
  helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        // Sin default-src a propósito (no restringe scripts/estilos en línea del juego).
        "default-src": helmet.contentSecurityPolicy.dangerouslyDisableDefaultSrc,
        "object-src": ["'none'"],
        "base-uri": ["'self'"],
        "form-action": ["'self'", "https://www.paypal.com"],
        "frame-ancestors": ["'self'"],
      },
    },
    // Estas tres romperían popups (login de Facebook) y recursos compartidos entre dominios.
    crossOriginOpenerPolicy: false,
    crossOriginResourcePolicy: false,
    crossOriginEmbedderPolicy: false,
    // El código usa req.header('Referer') para volver a la página anterior.
    referrerPolicy: { policy: "same-origin" },
    // Solo tiene efecto sobre HTTPS; sin includeSubDomains para no afectar a otros subdominios.
    strictTransportSecurity: { maxAge: 15552000, includeSubDomains: false },
  });
