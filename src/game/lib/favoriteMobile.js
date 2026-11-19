/**
 * Móvil favorito para el modo "Random".
 *
 * Normalmente, al elegir "Random" el servidor sortea entre Types.MOBILE_R. Para las cuentas con móvil
 * favorito, "Random" se resuelve siempre con uno de los móviles configurados.
 *
 * Dónde se configura (de más a menos prioridad):
 *   1. Panel de administración (/admin): se guarda en users.favorite_mobiles
 *        NULL      -> usa el valor por defecto de abajo
 *        'none'    -> esa cuenta NO tiene móvil favorito
 *        '8,10'    -> lista de ids de móvil (8 = Knight/unicornio, 10 = Barney/dragón)
 *   2. Valor por defecto en el .env (cuentas sin configurar en el panel):
 *        FAVORITE_MOBILE_USER_IDS=634,12     ids de cuenta (IdAcc)
 *        FAVORITE_MOBILES=8,10
 *
 * Los cambios hechos en el panel se aplican en unos segundos (se relee la base de datos periódicamente).
 */
var Types = require("../gametypes");
var config = require("../env");

var REFRESH_MS = 5000;

function parseIds(value) {
  return String(value || "")
    .split(",")
    .map(function (v) {
      return parseInt(v, 10);
    })
    .filter(function (v) {
      return Number.isInteger(v);
    });
}

// Solo móviles que existan en el servidor y que no sean "Random"
function validMobiles(list) {
  return list.filter(function (id) {
    return id !== Types.MOBILE.RANDOM && Types.MOBILES[id] !== undefined && Types.MOBILES[id] !== null;
  });
}

// ----- Valor por defecto (.env)
var userIds = parseIds(process.env.FAVORITE_MOBILE_USER_IDS);
var mobiles = validMobiles(parseIds(process.env.FAVORITE_MOBILES || "8,10"));

// ----- Configuración por cuenta (panel de administración), en caché y releída cada pocos segundos
// OJO: no usar `new Map()` aquí. lib/map.js sobrescribe la variable global Map con la clase de mapas del
// juego, así que en el servidor de juego `new Map()` NO es el Map nativo. Se usa un objeto simple.
var perAccount = Object.create(null); // IdAcc -> array de móviles ([] = sin favorito)
var pool = null;

function refresh() {
  try {
    if (!pool) {
      pool = require("mysql2/promise").createPool({
        host: config.DB.HOST,
        port: config.DB.PORT,
        user: config.DB.USER,
        password: config.DB.PASSWORD,
        database: config.DB.DATABASE,
        connectionLimit: 1,
      });
    }
    pool
      .query("SELECT IdAcc, favorite_mobiles FROM users WHERE favorite_mobiles IS NOT NULL")
      .then(function (result) {
        var next = Object.create(null);
        result[0].forEach(function (row) {
          next[row.IdAcc] =
            row.favorite_mobiles === "none" ? [] : validMobiles(parseIds(row.favorite_mobiles));
        });
        perAccount = next;
      })
      .catch(function () {
        // Sin conexión o sin la columna: se mantiene lo último que se leyó
      });
  } catch (e) {}
}

refresh();
var timer = setInterval(refresh, REFRESH_MS);
if (timer.unref) timer.unref();

/** Devuelve el id de móvil que le toca a esa cuenta, o null si no tiene móvil favorito. */
function pickFavoriteMobile(userId) {
  var id = Number(userId);
  var list;
  if (Object.prototype.hasOwnProperty.call(perAccount, id)) list = perAccount[id];
  else if (userIds.indexOf(id) !== -1) list = mobiles;
  else return null;
  if (!list || list.length === 0) return null;
  return list[Math.floor(Math.random() * list.length)];
}

module.exports = { pickFavoriteMobile: pickFavoriteMobile, userIds: userIds, mobiles: mobiles };
