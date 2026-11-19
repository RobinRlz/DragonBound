/**
 * Panel de administración web: /admin
 *
 * - Solo accesible para cuentas con rango 31 (se consulta en la base de datos en cada petición,
 *   no se confía en lo guardado en la sesión).
 * - Buscar jugadores y editar cash, oro, GP, megáfonos, flores, rango, GM y país.
 * - Cada POST lleva un token CSRF propio además de la comprobación de Origin global.
 * - Todo va con consultas parametrizadas; los nombres de columna salen de una lista fija.
 */
var express = require("express"),
  router = express.Router();
var crypto = require("crypto");

var Logger = require("../../game/lib/logger");
var auth = require("../middlewares/auth");

var ADMIN_RANK = 31;
var INT_MAX = 2147483647;

// Campos numéricos editables: nombre del formulario -> columna de users
var NUMERIC_FIELDS = {
  cash: { column: "cash", label: "Cash" },
  gold: { column: "gold", label: "Oro" },
  gp: { column: "gp", label: "GP" },
  megaphones: { column: "megaphones", label: "Megáfonos" },
  flowers: { column: "flowers", label: "Flores" },
};

function fmt(n) {
  return Number(n || 0).toLocaleString("en-US");
}

function csrfToken(req) {
  if (!req.session.adminCsrf) {
    req.session.adminCsrf = crypto.randomBytes(24).toString("hex");
  }
  return req.session.adminCsrf;
}

function csrfValid(req) {
  var sent = String(req.body._csrf || "");
  var real = String(req.session.adminCsrf || "");
  if (!sent || sent.length !== real.length) return false;
  return crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(real));
}

function takeFlash(req) {
  var flash = req.session.adminFlash || null;
  delete req.session.adminFlash;
  return flash;
}

// Solo rango 31. Devuelve 404 a los demás para no revelar que el panel existe.
function requireAdmin(req, res, next) {
  req.db.connection
    .query("SELECT IdAcc, game_id, `rank` FROM users WHERE IdAcc = ?", [req.session.account_id])
    .then(function (result) {
      var me = result[0][0];
      if (!me || me.rank !== ADMIN_RANK) {
        res.status(404).send("Not found");
        return;
      }
      req.admin = me;
      next();
    })
    .catch(function (err) {
      Logger.debug("Admin auth error: " + err.stack);
      res.status(500).send("Error");
    });
}

router.use(auth, requireAdmin);

function mapUser(u) {
  return {
    id: u.IdAcc,
    name: u.game_id,
    rank: u.rank,
    gm: u.gm === 1,
    cash: fmt(u.cash),
    gold: fmt(u.gold),
    gp: fmt(u.gp),
    online: u.IsOnline === 1,
    banned: u.banned === 1,
  };
}

var USER_SELECT =
  "SELECT u.IdAcc, u.game_id, u.`rank`, u.gm, u.cash, u.gold, u.gp, u.megaphones, u.flowers, u.country, u.banned, a.IsOnline " +
  "FROM users u LEFT JOIN accounts a ON a.Id = u.IdAcc ";

// ---------- Buscar ----------
router.get("/", function (req, res) {
  var q = String(req.query.q || "").trim().slice(0, 45);
  var sql, params;
  if (q === "") {
    sql = USER_SELECT + "ORDER BY u.IdAcc DESC LIMIT 25";
    params = [];
  } else {
    var like = "%" + q.replace(/[\\%_]/g, "\\$&") + "%";
    sql = USER_SELECT + "WHERE u.game_id LIKE ? OR u.IdAcc = ? ORDER BY u.IdAcc DESC LIMIT 25";
    params = [like, /^\d+$/.test(q) ? Number(q) : -1];
  }
  req.db.connection
    .query(sql, params)
    .then(function (result) {
      res.render("admin", {
        layout: false,
        view_search: true,
        admin_name: req.admin.game_id,
        q: q,
        users: result[0].map(mapUser),
        searched: q !== "",
        flash: takeFlash(req),
      });
    })
    .catch(function (err) {
      Logger.debug("Admin search error: " + err.stack);
      res.status(500).send("Error");
    });
});

// ---------- Ver/editar un jugador ----------
router.get("/user/:id", function (req, res) {
  if (!/^\d+$/.test(req.params.id)) return res.redirect("/admin");
  req.db.connection
    .query(USER_SELECT + "WHERE u.IdAcc = ?", [Number(req.params.id)])
    .then(function (result) {
      var u = result[0][0];
      if (!u) {
        req.session.adminFlash = { type: "error", msg: "No existe un jugador con ese ID." };
        return res.redirect("/admin");
      }
      var ranks = [];
      for (var r = 0; r <= 31; r++) ranks.push({ value: r, selected: r === u.rank });
      res.render("admin", {
        layout: false,
        view_edit: true,
        admin_name: req.admin.game_id,
        u: mapUser(u),
        country: u.country || "",
        megaphones: fmt(u.megaphones),
        flowers: fmt(u.flowers),
        ranks: ranks,
        is_self: u.IdAcc === req.admin.IdAcc,
        csrf: csrfToken(req),
        flash: takeFlash(req),
      });
    })
    .catch(function (err) {
      Logger.debug("Admin user error: " + err.stack);
      res.status(500).send("Error");
    });
});

function parseIntStrict(value) {
  var s = String(value === undefined ? "" : value).trim().replace(/[ ,_]/g, "");
  if (!/^-?\d{1,10}$/.test(s)) return null;
  var n = Number(s);
  return Number.isSafeInteger(n) ? n : null;
}

router.post("/user/:id", function (req, res) {
  var id = req.params.id;
  var back = "/admin/user/" + encodeURIComponent(id);
  var fail = function (msg) {
    req.session.adminFlash = { type: "error", msg: msg };
    res.redirect(back);
  };

  if (!/^\d+$/.test(id)) return res.redirect("/admin");
  id = Number(id);
  if (!csrfValid(req)) return fail("La sesión del formulario caducó. Vuelve a intentarlo.");

  var sets = [];
  var params = [];
  var changes = [];

  // Cash, oro, GP, megáfonos, flores: "sumar" o "establecer"
  var names = Object.keys(NUMERIC_FIELDS);
  for (var i = 0; i < names.length; i++) {
    var name = names[i];
    var field = NUMERIC_FIELDS[name];
    var raw = req.body[name + "_value"];
    if (raw === undefined || String(raw).trim() === "") continue;
    var amount = parseIntStrict(raw);
    if (amount === null) return fail("Valor no válido en " + field.label + ".");
    var mode = req.body[name + "_mode"] === "set" ? "set" : "add";
    if (mode === "set") {
      if (amount < 0 || amount > INT_MAX) return fail(field.label + ": el valor debe estar entre 0 y " + fmt(INT_MAX) + ".");
      sets.push("`" + field.column + "` = ?");
      params.push(amount);
      changes.push(field.label + " = " + amount);
    } else {
      // Suma con tope: nunca baja de 0 ni pasa del máximo del tipo int
      sets.push("`" + field.column + "` = LEAST(GREATEST(COALESCE(`" + field.column + "`, 0) + ?, 0), " + INT_MAX + ")");
      params.push(amount);
      changes.push(field.label + " " + (amount >= 0 ? "+" : "") + amount);
    }
  }

  // Rango
  var rankRaw = req.body.rank;
  if (rankRaw !== undefined && String(rankRaw) !== "") {
    var rank = parseIntStrict(rankRaw);
    if (rank === null || rank < 0 || rank > 31) return fail("Rango no válido (0 a 31).");
    if (id === req.admin.IdAcc && rank !== ADMIN_RANK) {
      return fail("No puedes quitarte a ti mismo el rango 31 (te quedarías sin acceso al panel).");
    }
    sets.push("`rank` = ?");
    params.push(rank);
    changes.push("Rango = " + rank);
  }

  // GM
  var gmRaw = req.body.gm;
  if (gmRaw === "0" || gmRaw === "1") {
    sets.push("`gm` = ?");
    params.push(Number(gmRaw));
    changes.push("GM = " + gmRaw);
  }

  // País
  var countryRaw = String(req.body.country || "").trim();
  if (countryRaw !== "") {
    if (!/^[A-Za-z]{2,3}$/.test(countryRaw)) return fail("País no válido (2 o 3 letras, por ejemplo PE).");
    sets.push("`country` = ?");
    params.push(countryRaw.toUpperCase());
    changes.push("País = " + countryRaw.toUpperCase());
  }

  if (sets.length === 0) return fail("No indicaste ningún cambio.");

  req.db.connection
    .query("SELECT IdAcc, game_id FROM users WHERE IdAcc = ?", [id])
    .then(function (result) {
      var target = result[0][0];
      if (!target) return fail("No existe un jugador con ese ID.");
      params.push(id);
      return req.db.connection.query("UPDATE users SET " + sets.join(", ") + " WHERE IdAcc = ?", params).then(function () {
        Logger.info("[ADMIN] " + req.admin.game_id + " modificó a " + target.game_id + " (" + id + "): " + changes.join(", "));
        req.session.adminFlash = { type: "ok", msg: "Guardado para " + target.game_id + ": " + changes.join(", ") + "." };
        res.redirect(back);
      });
    })
    .catch(function (err) {
      Logger.debug("Admin update error: " + err.stack);
      fail("Error al guardar en la base de datos.");
    });
});

module.exports = router;
