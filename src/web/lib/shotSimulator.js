/**
 * Simulador de disparos para pruebas (panel de administración, /admin/simulador).
 *
 * Usa el mismo motor que el servidor de juego (src/game/lib/shotTrace.js, que a su vez usa la clase Shoot
 * real). Diferencias con una partida, a propósito para poder probar la física aislada:
 *   - El suelo es una línea recta a la altura del móvil (no hay terreno del mapa).
 *   - No hay jugadores ni ítems; no se simulan rayos, sol ni agujero negro.
 */
// lib/map.js del juego hace `Map = ...` (variable global) y eso rompe el Map nativo del proceso web
// (express-handlebars, rate limit...). Se guarda el Map nativo y se restaura tras cargar el código del juego.
var NativeMap = global.Map;
var Types = require("../../game/gametypes");
var shotTrace = require("../../game/lib/shotTrace");
global.Map = NativeMap;

var FIELD = { w: 1800, h: 900 };

function isPlayable(id) {
  var m = Types.MOBILES[id];
  return !!(m && m.name && Array.isArray(m.shoots) && id !== Types.MOBILE.RANDOM && id !== Types.MOBILE.RANDOMIZER);
}

function mobileList() {
  var list = [];
  for (var i = 0; i < Types.MOBILES.length; i++) {
    if (isPlayable(i)) list.push({ id: i, name: Types.MOBILES[i].name, types: Types.MOBILES[i].shoots.length });
  }
  return list;
}

function simulate(input) {
  var mobile = Types.MOBILES[input.mobile];
  var account = { player: { mobile: input.mobile, avaAttack: 0, check_my_ava: 0 } };
  var start = shotTrace.launch(input.mobile, input.x, input.y, 0, input.look, input.ang, input.power);
  var wind = { power: input.wind_power, angle: input.wind_ang };

  var bullets = [];
  var shots;
  try {
    shots = shotTrace.createShots(input.mobile, input.type, start, wind, account);
  } catch (e) {
    shots = [];
  }
  shots.forEach(function (shot, i) {
    try {
      var r = shotTrace.trace(shot, {
        groundY: input.y,
        forces: input.forces,
        width: FIELD.w,
        height: FIELD.h,
        points: true,
      });
      bullets.push({
        index: i,
        segments: r.segments,
        landing: r.impact,
        maxHeight: Math.round(input.y - r.topY),
        physics: {
          angle: Math.round(shot.ang * 100) / 100,
          power: Math.round(shot.power),
          gravity: shot.weight, // ya incluye el efecto del viento
          horizontalAccel: shot.friccion, // ya incluye el efecto del viento
          vx: Math.round(shot.v.x),
          vy: Math.round(shot.v.y),
        },
      });
    } catch (e) {
      bullets.push({ index: i, error: "Esta bala usa una mecánica que el simulador no reproduce." });
    }
  });

  return {
    field: FIELD,
    origin: start.origin,
    player: { x: input.x, y: input.y },
    mobile: { id: input.mobile, name: mobile.name },
    type: Math.min(input.type, mobile.shoots.length - 1),
    scaledPower: start.power,
    bullets: bullets,
  };
}

module.exports = { simulate: simulate, mobileList: mobileList, isPlayable: isPlayable, FIELD: FIELD };
