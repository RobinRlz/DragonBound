/**
 * Móvil favorito para el modo "Random".
 *
 * Normalmente, al elegir "Random" el servidor sortea entre Types.MOBILE_R. Para las cuentas indicadas en
 * FAVORITE_MOBILE_USER_IDS, "Random" se resuelve siempre con uno de los móviles de FAVORITE_MOBILES.
 *
 *   FAVORITE_MOBILE_USER_IDS=634,12     ids de cuenta (IdAcc, el mismo número que ves en /admin)
 *   FAVORITE_MOBILES=8,10               8 = Knight (unicornio), 10 = Barney (dragón morado)
 *
 * Si FAVORITE_MOBILE_USER_IDS está vacío no cambia nada para nadie.
 */
var Types = require("../gametypes");

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

var userIds = parseIds(process.env.FAVORITE_MOBILE_USER_IDS);
var mobiles = parseIds(process.env.FAVORITE_MOBILES || "8,10").filter(function (id) {
  // Solo móviles que existan en el servidor y que no sean "Random"
  return id !== Types.MOBILE.RANDOM && Types.MOBILES[id] !== undefined && Types.MOBILES[id] !== null;
});

/** Devuelve el id de móvil que le toca a esa cuenta, o null si no tiene móvil favorito. */
function pickFavoriteMobile(userId) {
  if (mobiles.length === 0 || userIds.indexOf(Number(userId)) === -1) return null;
  return mobiles[Math.floor(Math.random() * mobiles.length)];
}

module.exports = { pickFavoriteMobile: pickFavoriteMobile, userIds: userIds, mobiles: mobiles };
