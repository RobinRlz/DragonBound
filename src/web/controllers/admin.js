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
var shotSimulator = require("../lib/shotSimulator");
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

// Cuentas con acceso al panel además del rango 31 (ADMIN_USER_IDS=634,12 en .env).
// Permite que una cuenta de administración tenga cualquier rango/nivel, por ejemplo Dragon.
var ADMIN_IDS = (process.env.ADMIN_USER_IDS || "")
  .split(",")
  .map(function (v) { return parseInt(v, 10); })
  .filter(function (v) { return Number.isInteger(v); });

function isAdminAccount(id, rank) {
  return rank === ADMIN_RANK || ADMIN_IDS.indexOf(id) !== -1;
}

// ---- Móvil favorito para "Random" (se guarda en users.favorite_mobiles; el servidor de juego lo lee)
// NULL = valor por defecto del .env, 'none' = sin favorito, '8,10' = lista de ids de móvil.
var FAV_CHOICES = [
  [0, "Armor"], [1, "Ice"], [2, "Aduka"], [3, "Lightning"], [4, "Bigfoot"], [5, "J.D"], [6, "A.Sate"],
  [8, "Knight (unicornio)"], [10, "Barney (dragón)"], [11, "Nak"], [12, "Trico"], [13, "Mage"],
  [14, "Turtle"], [15, "Boomer"],
];
var FAV_NAMES = {};
FAV_CHOICES.forEach(function (c) { FAV_NAMES[c[0]] = c[1]; });

function parseFav(value) {
  if (value === null || value === undefined) return { mode: "default", ids: [] };
  if (value === "none") return { mode: "none", ids: [] };
  var ids = String(value).split(",").map(function (v) { return parseInt(v, 10); })
    .filter(function (v) { return FAV_NAMES[v] !== undefined; });
  return { mode: "custom", ids: ids };
}

function favText(fav) {
  if (fav.mode === "default") return "por defecto (según el .env del servidor)";
  if (fav.mode === "none" || fav.ids.length === 0) return "ninguno";
  return fav.ids.map(function (id) { return FAV_NAMES[id]; }).join(", ");
}

// ---- Niveles según GP (mismos umbrales que src/game/account.js y src/ranking/rankingscript.js)
// Niveles 0-11: umbral fijo de GP. Niveles 12-24: dependen del puesto en el ranking de GP
// (Silver Dragon = el nº 1, Red Dragon = los 4 siguientes, Blue Dragon = los 16 siguientes, etc.).
var FIXED_GP = { 0: 1000, 1: 1100, 2: 1200, 3: 1500, 4: 1800, 5: 2300, 6: 2800, 7: 3500, 8: 4200, 9: 5100, 10: 6000, 11: 6900 };
var RANK_NAMES = {
  12: "Battle Axe Plus", 13: "Silver Battle Axe", 14: "Silver Battle Axe Plus", 15: "Gold Battle Axe",
  16: "Gold Battle Axe Plus", 17: "Violet Wand", 18: "Sapphire Wand", 19: "Ruby Wand", 20: "Diamond Wand",
  22: "Blue Dragon", 23: "Red Dragon", 24: "Silver Dragon",
};
// Orden en el que el ranking reparte puestos, con el tamaño de cada grupo.
var BRACKETS = [
  [24, function () { return 1; }], [23, function () { return 4; }], [22, function () { return 16; }],
  [20, function (n) { return Math.ceil(n * 0.01); }], [19, function (n) { return Math.ceil(n * 0.03); }],
  [18, function (n) { return Math.ceil(n * 0.06); }], [17, function (n) { return Math.ceil(n * 0.12); }],
  [16, function (n) { return Math.ceil(n * 0.2); }], [15, function (n) { return Math.ceil(n * 0.32); }],
  [14, function (n) { return Math.ceil(n * 0.46); }], [13, function (n) { return Math.ceil(n * 0.62); }],
  [12, function (n) { return Math.ceil(n * 0.8); }],
];

/** `others`: GP (> 8746) de los demás jugadores, de mayor a menor. `total`: jugadores en total. */
function computeLevels(others, total) {
  var levels = [];
  var l;
  for (l = 0; l <= 11; l++) levels.push({ level: l, name: "Nivel " + l, gp: FIXED_GP[l], dynamic: false });
  var start = 0;
  var dyn = [];
  BRACKETS.forEach(function (b) {
    dyn.push({ level: b[0], start: start });
    start += b[1](total);
  });
  dyn.sort(function (a, b) { return a.level - b.level; });
  dyn.forEach(function (d) {
    var better = others[d.start];
    var gp = better !== undefined ? Math.min(better + 1, INT_MAX) : 8747;
    levels.push({ level: d.level, name: RANK_NAMES[d.level], gp: gp, dynamic: true });
  });
  return levels;
}

function loadLevels(db, targetId) {
  return Promise.all([
    db.query("SELECT gp FROM users WHERE IdAcc <> ? AND (gm IS NULL OR gm <> 1) AND gp > 8746 ORDER BY gp DESC", [targetId]),
    db.query("SELECT COUNT(*) AS c FROM users"),
  ]).then(function (r) {
    var others = r[0][0].map(function (row) { return row.gp; });
    return computeLevels(others, r[1][0][0].c);
  });
}

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

// Solo rango 31 (o ids de ADMIN_USER_IDS). Devuelve 404 a los demás para no revelar que el panel existe.
function requireAdmin(req, res, next) {
  req.db.connection
    .query("SELECT IdAcc, game_id, `rank` FROM users WHERE IdAcc = ?", [req.session.account_id])
    .then(function (result) {
      var me = result[0][0];
      if (!me || !isAdminAccount(me.IdAcc, me.rank)) {
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
  "SELECT u.IdAcc, u.game_id, u.`rank`, u.gm, u.cash, u.gold, u.gp, u.megaphones, u.flowers, u.country, u.banned, u.favorite_mobiles, a.IsOnline " +
  "FROM users u LEFT JOIN accounts a ON a.Id = u.IdAcc ";

// ---------- Simulador de disparos (banco de pruebas de la física, sin partida real) ----------
router.get("/simulador", function (req, res) {
  res.render("admin-sim", {
    layout: false,
    admin_name: req.admin.game_id,
    mobiles: shotSimulator.mobileList(),
  });
});

function numParam(q, name, min, max, def) {
  var raw = q[name];
  if (raw === undefined || raw === "") return def;
  var n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, n));
}

router.get("/simulador/calc", function (req, res) {
  var q = req.query;
  var mobile = numParam(q, "mobile", 0, 99, 0);
  if (mobile === null || !shotSimulator.isPlayable(Math.round(mobile))) {
    return res.status(400).json({ error: "Móvil no válido." });
  }
  var input = {
    mobile: Math.round(mobile),
    type: Math.round(numParam(q, "type", 0, 2, 0)),
    ang: numParam(q, "ang", 0, 90, 45),
    power: numParam(q, "power", 0, 400, 250),
    look: q.look === "0" ? 0 : 1,
    wind_power: numParam(q, "wind_power", 0, 100, 0),
    wind_ang: numParam(q, "wind_ang", 0, 359, 90),
    x: numParam(q, "x", 50, shotSimulator.FIELD.w - 50, 300),
    y: numParam(q, "y", 150, shotSimulator.FIELD.h - 50, 700),
    forces: [],
  };
  for (var k in input) {
    if (input[k] === null) return res.status(400).json({ error: "Parámetro no válido: " + k });
  }
  if (q.tornado === "1") {
    var tpx = numParam(q, "tornado_px", 0, shotSimulator.FIELD.w, 900);
    var tsz = numParam(q, "tornado_size", 100, 280, 150);
    if (tpx === null || tsz === null) return res.status(400).json({ error: "Tornado no válido." });
    input.forces.push({ kind: "tornado", px: tpx, size: tsz });
  }
  if (q.mirror === "1") {
    var mpx = numParam(q, "mirror_px", 0, shotSimulator.FIELD.w, 1200);
    if (mpx === null) return res.status(400).json({ error: "Pared no válida." });
    input.forces.push({ kind: "mirror", px: mpx, size: 20 });
  }
  try {
    res.json(shotSimulator.simulate(input));
  } catch (e) {
    Logger.debug("Simulador error: " + e.stack);
    res.status(500).json({ error: "No se pudo simular este disparo." });
  }
});

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
      return loadLevels(req.db.connection, u.IdAcc).then(function (levels) {
      var fav = parseFav(u.favorite_mobiles);
      var favChoices = FAV_CHOICES.map(function (c) {
        return { id: c[0], name: c[1], checked: fav.ids.indexOf(c[0]) !== -1 };
      });
      var levelRows = levels.map(function (lv) {
        return {
          level: lv.level,
          name: lv.name,
          gp: fmt(lv.gp),
          dynamic: lv.dynamic,
          current: lv.level === u.rank,
          label: lv.level + " · " + lv.name + " — GP " + (lv.dynamic ? "≥ " : "") + fmt(lv.gp),
        };
      });
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
        levels: levelRows,
        fav_text: favText(fav),
        fav_choices: favChoices,
        csrf: csrfToken(req),
        flash: takeFlash(req),
      });
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

  var levelRaw = req.body.level;
  var wantsLevel = levelRaw !== undefined && String(levelRaw) !== "";
  var levelNumber = wantsLevel ? parseIntStrict(levelRaw) : null;
  if (wantsLevel) {
    var gpTyped = req.body.gp_value !== undefined && String(req.body.gp_value).trim() !== "";
    var rankTyped = req.body.rank !== undefined && String(req.body.rank) !== "";
    if (gpTyped || rankTyped) return fail("Elige un nivel o escribe GP/rango a mano, no las dos cosas a la vez.");
    if (levelNumber === null || levelNumber < 0 || levelNumber > 24 || levelNumber === 21) return fail("Nivel no válido.");
  }

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
    if (id === req.admin.IdAcc && !isAdminAccount(id, rank)) {
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

  // Móvil favorito para Random: no cambiar / por defecto / ninguno / los marcados
  var favMode = String(req.body.favmode || "keep");
  if (favMode === "default") {
    sets.push("`favorite_mobiles` = NULL");
    changes.push("Móvil favorito = por defecto");
  } else if (favMode === "none") {
    sets.push("`favorite_mobiles` = ?");
    params.push("none");
    changes.push("Móvil favorito = ninguno");
  } else if (favMode === "custom") {
    var picked = [].concat(req.body.favmobile || []);
    var favIds = [];
    for (var fi = 0; fi < picked.length; fi++) {
      var fid = parseIntStrict(picked[fi]);
      if (fid === null || FAV_NAMES[fid] === undefined) return fail("Móvil favorito no válido.");
      if (favIds.indexOf(fid) === -1) favIds.push(fid);
    }
    if (favIds.length === 0) return fail("Marca al menos un móvil, o elige «Ninguno» / «Por defecto».");
    favIds.sort(function (a, b) { return a - b; });
    sets.push("`favorite_mobiles` = ?");
    params.push(favIds.join(","));
    changes.push("Móvil favorito = " + favText({ mode: "custom", ids: favIds }));
  }

  if (sets.length === 0 && !wantsLevel) return fail("No indicaste ningún cambio.");

  req.db.connection
    .query("SELECT IdAcc, game_id FROM users WHERE IdAcc = ?", [id])
    .then(function (result) {
      var target = result[0][0];
      if (!target) return fail("No existe un jugador con ese ID.");
      if (!wantsLevel) return target;
      if (id === req.admin.IdAcc && !isAdminAccount(id, levelNumber)) {
        fail("Esta cuenta perdería el acceso al panel con ese nivel. Añade su ID a ADMIN_USER_IDS en .env o usa otra cuenta.");
        return null;
      }
      return loadLevels(req.db.connection, id).then(function (levels) {
        var lv = levels.filter(function (x) { return x.level === levelNumber; })[0];
        sets.push("`gp` = ?", "`rank` = ?");
        params.push(lv.gp, lv.level);
        changes.push("Nivel " + lv.level + " (" + lv.name + "): GP = " + lv.gp + ", rango = " + lv.level);
        return target;
      });
    })
    .then(function (target) {
      if (!target) return;
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
