/**
 * /settings — Configuración de la cuenta (foto de perfil, fondo de la página, seguridad).
 *
 *   GET  /settings               página de configuración
 *   POST /settings               guarda el fondo de la página (y la foto por URL, si se usa)
 *   POST /settings/photo         sube la foto de perfil (cuerpo = imagen JPG/PNG/WebP)
 *   POST /settings/photo/remove  quita la foto de perfil
 */
var express = require("express"),
  router = express.Router();

var fs = require("fs");
var path = require("path");
var crypto = require("crypto");
var Logger = require("../../game/lib/logger");
var auth = require("../middlewares/auth");
var csrf = require("csurf");
var { createRateLimiter } = require("../lib/rateLimit");
var csrfProtection = csrf({
  cookie: true,
});

// Fotos subidas: se sirven en /static/uploads/avatars/ (ver publicResources.middleware.js)
var AVATAR_DIR = path.join(__dirname, "../public_html/data/uploads/avatars");
var AVATAR_URL = "/static/uploads/avatars/";
var MAX_PHOTO_BYTES = 600 * 1024; // el navegador ya la reduce a 256x256, sobra margen
var DEFAULT_BG = "https://i.imgur.com/KWpHdJD.jpg";
var MAX_URL = 200; // tamaño de las columnas photo_url / bg_url

// Máximo 10 subidas de foto cada 10 minutos por cuenta
var photoLimiter = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 10,
  keyFn: function (req) {
    return "acc:" + req.session.account_id;
  },
  onLimit: function (req, res) {
    res.status(429).json({ ok: false, error: "Demasiadas subidas seguidas. Espera unos minutos." });
  },
});

/** Tipo real de la imagen por sus primeros bytes (no se confía en lo que diga el navegador). */
function detectImageType(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buf.slice(0, 4).toString("ascii") === "RIFF" && buf.slice(8, 12).toString("ascii") === "WEBP") return "webp";
  return null;
}

/** URL válida para foto/fondo: vacía, http(s) externa, o una foto subida a esta web. */
function isAllowedUrl(value) {
  if (value === "") return true;
  if (value.length > MAX_URL || /\s/.test(value)) return false;
  if (value.indexOf(AVATAR_URL) === 0) return /^[\w.\-\/]+$/.test(value);
  try {
    var u = new URL(value);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch (e) {
    return false;
  }
}

/** Borra el archivo de una foto subida anteriormente por esta cuenta (si lo era). */
function removeOwnUpload(photoUrl, accId) {
  if (typeof photoUrl !== "string" || photoUrl.indexOf(AVATAR_URL + accId + "-") !== 0) return;
  var name = path.basename(photoUrl);
  fs.unlink(path.join(AVATAR_DIR, name), function () {});
}

function setFlash(req, type, msg) {
  req.session.settingsFlash = { type: type, msg: msg };
}

/** Redirige a /settings después de guardar la sesión (el aviso vive en la sesión, que está en MySQL). */
function back(req, res) {
  req.session.save(function () {
    res.redirect("/settings");
  });
}

router.get("/", auth, csrfProtection, function (req, res) {
  var acc_id = req.session.account_id;
  var flash = req.session.settingsFlash;
  delete req.session.settingsFlash;
  Promise.all([
    req.db.getSettingsByIdAcc(acc_id),
    req.db.connection.query("SELECT Email FROM accounts WHERE Id = ?", [acc_id]),
  ])
    .then(function (r) {
      var u = r[0][0][0];
      var acc = (r[1][0] || [])[0] || {};
      var photo = u.photo_url || "";
      res.render("settings", {
        game_id: u.game_id,
        user_id: u.IdAcc,
        photo_url: photo,
        photo_uploaded: photo.indexOf(AVATAR_URL) === 0,
        bg_url: u.bg_url || "",
        correo: acc.Email || "",
        flash: flash,
        csrfToken: req.csrfToken(),
      });
    })
    .catch(function (err) {
      Logger.debug("settings: " + err.stack);
      res.redirect("/");
    });
});

router.post("/", auth, csrfProtection, function (req, res) {
  var acc_id = req.session.account_id;
  var page_bg_url = String(req.body.page_bg_url || "").trim();
  var photo_url_in = req.body.photo_url; // opcional: solo si el formulario lo envía

  if (!isAllowedUrl(page_bg_url)) {
    setFlash(req, "error", "La URL del fondo no es válida (debe empezar por https:// y tener como máximo 200 caracteres).");
    return back(req, res);
  }
  if (page_bg_url === "") page_bg_url = DEFAULT_BG;

  req.db
    .getSettingsByIdAcc(acc_id)
    .then(function (r) {
      var current = r[0][0];
      var photo_url = current.photo_url || "";
      if (typeof photo_url_in === "string") {
        var p = photo_url_in.trim();
        if (!isAllowedUrl(p)) {
          setFlash(req, "error", "La URL de la foto no es válida (debe empezar por https://).");
          return back(req, res);
        }
        if (p !== photo_url) removeOwnUpload(photo_url, acc_id);
        photo_url = p;
      }
      return req.db.updateSettingsByIdAcc(photo_url, page_bg_url, acc_id).then(function () {
        setFlash(req, "ok", "Cambios guardados.");
        back(req, res);
      });
    })
    .catch(function (err) {
      Logger.debug("settings save: " + err.stack);
      setFlash(req, "error", "No se pudieron guardar los cambios. Inténtalo de nuevo.");
      back(req, res);
    });
});

router.post(
  "/photo",
  auth,
  photoLimiter,
  express.raw({ type: ["image/jpeg", "image/png", "image/webp"], limit: MAX_PHOTO_BYTES }),
  csrfProtection,
  function (req, res) {
    var acc_id = parseInt(req.session.account_id, 10);
    var buf = req.body;
    var ext = Buffer.isBuffer(buf) ? detectImageType(buf) : null;
    if (!ext) {
      return res.status(400).json({ ok: false, error: "El archivo no es una imagen JPG, PNG o WebP válida." });
    }
    var name = acc_id + "-" + crypto.randomBytes(8).toString("hex") + "." + ext;
    var url = AVATAR_URL + name;

    fs.promises
      .mkdir(AVATAR_DIR, { recursive: true })
      .then(function () {
        return fs.promises.writeFile(path.join(AVATAR_DIR, name), buf, { flag: "wx" });
      })
      .then(function () {
        return req.db.getSettingsByIdAcc(acc_id);
      })
      .then(function (r) {
        var current = r[0][0];
        return req.db.updateSettingsByIdAcc(url, current.bg_url || DEFAULT_BG, acc_id).then(function () {
          removeOwnUpload(current.photo_url, acc_id);
        });
      })
      .then(function () {
        Logger.info("[settings] " + req.session.account_id + " subió nueva foto de perfil (" + buf.length + " bytes)");
        res.json({ ok: true, url: url });
      })
      .catch(function (err) {
        Logger.debug("settings photo: " + err.stack);
        fs.unlink(path.join(AVATAR_DIR, name), function () {});
        res.status(500).json({ ok: false, error: "No se pudo guardar la foto. Inténtalo de nuevo." });
      });
  }
);

router.post("/photo/remove", auth, csrfProtection, function (req, res) {
  var acc_id = req.session.account_id;
  req.db
    .getSettingsByIdAcc(acc_id)
    .then(function (r) {
      var current = r[0][0];
      return req.db.updateSettingsByIdAcc("", current.bg_url || DEFAULT_BG, acc_id).then(function () {
        removeOwnUpload(current.photo_url, acc_id);
      });
    })
    .then(function () {
      setFlash(req, "ok", "Foto de perfil eliminada.");
      back(req, res);
    })
    .catch(function (err) {
      Logger.debug("settings photo remove: " + err.stack);
      setFlash(req, "error", "No se pudo quitar la foto.");
      back(req, res);
    });
});

// Errores de la subida (archivo demasiado grande, token CSRF caducado...) en JSON para el formulario
router.use(function (err, req, res, next) {
  if (req.path !== "/photo") return next(err);
  if (err.type === "entity.too.large") {
    return res.status(413).json({ ok: false, error: "La imagen es demasiado grande." });
  }
  if (err.code === "EBADCSRFTOKEN") {
    return res.status(403).json({ ok: false, error: "La sesión caducó. Recarga la página e inténtalo de nuevo." });
  }
  next(err);
});

module.exports = router;
