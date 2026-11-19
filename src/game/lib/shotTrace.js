/**
 * Motor de trayectorias compartido (simulador del panel y asistente de puntería del servidor).
 *
 * Usa la clase Shoot REAL del servidor (lib/shoot.js), así que la posición de la bala en cada instante es
 * exactamente la que calcula el juego:
 *
 *   x(t) = x0 + vx·a + friccion·a²/2        a = t / 485   (t = "ticks" del mundo)
 *   y(t) = y0 + vy·a + weight·a²/2          (y crece hacia abajo)
 *
 *   vx =  cos(ángulo)·fuerza,  vy = -sin(ángulo)·fuerza
 *   weight   = gravedad del móvil (p. ej. 398 Armor, 396 Barney, 360 Mage)
 *   friccion = aceleración horizontal (0 sin viento)
 *
 * El viento (Shoot.setWindEfect) NO mueve la bala directamente: cambia esas dos aceleraciones:
 *   friccion -= cos(ángulo_viento) · fuerza_viento · weight / 100
 *   weight   += sin(ángulo_viento) · fuerza_viento · weight / 100
 *
 * Eventos del clima que desvían la bala (world.js):
 *   - Pared / espejo (id 7): al tocarla, la bala se refleja en horizontal y conserva su rapidez.
 *   - Tornado (id 8): columna de ancho = su "power"; la bala se refleja al salir por el lado contrario.
 */
var Types = require("../gametypes");
var Shoot = require("./shoot");

var WEATHER_MIRROR = 7;
var WEATHER_TORNADO = 8;
var MAX_REFLECTIONS = 10;

function deg(rad) {
  return (rad * 180) / Math.PI;
}

function rotatePoint(point, center, angle) {
  // Igual que game.js -> rotatePoint
  var a = angle * (Math.PI / 180);
  return {
    x: Math.floor(Math.cos(a) * (point.x - center.x) - Math.sin(a) * (point.y - center.y) + center.x),
    y: Math.floor(Math.sin(a) * (point.x - center.x) + Math.cos(a) * (point.y - center.y) + center.y),
  };
}

/**
 * Igual que el inicio de game.js -> gameShoot(): escala la fuerza (0-400 de la barra -> unidades del
 * servidor), invierte el ángulo si el móvil mira a la izquierda (look 0), resta la inclinación del
 * terreno (body) y calcula el punto de salida del cañón.
 */
function launch(mobileId, x, y, body, look, ang, power) {
  var adukaNak = mobileId === Types.MOBILE.ADUKA || mobileId === Types.MOBILE.NAK;
  var scaled = parseInt((power * 234) / 100, 10);
  var a = ang;
  var dis;
  if (look === 0) {
    a = 180 - a;
    dis = adukaNak ? 26 : -11;
  } else {
    dis = adukaNak ? -26 : 11;
  }
  a -= body || 0;
  var point = { x: x + dis, y: adukaNak ? y - 31 : y - 28 };
  var origin = rotatePoint(point, { x: x, y: y }, body || 0);
  return { origin: origin, ang: a, power: scaled };
}

/** Igual que game.js -> setShoots(): una Shoot por cada bala del tipo de disparo del móvil. */
function createShots(mobileId, type, start, wind, account) {
  var mobile = Types.MOBILES[mobileId];
  var t = Math.min(type, mobile.shoots.length - 1);
  return mobile.shoots[t].map(function (cfg, i) {
    var data = {
      x0: start.origin.x,
      y0: start.origin.y,
      ang: start.ang,
      power: start.power,
      type: t,
      wind_ang: wind.angle,
      wind_power: wind.power,
      stime: cfg.addtime || 0,
      account: account,
      shootId: i,
    };
    data = Object.assign(data, cfg);
    if (Array.isArray(data.addOrbit) && Array.isArray(data.addOrbit[1])) {
      data.orbit = [data.addOrbit[0], data.addOrbit[1][start.ang > 90 && start.ang < 270 ? 0 : 1], data.addOrbit[2], data.addOrbit[3]];
    }
    return new Shoot(data);
  });
}

/** Convierte los climas activos de la partida (weatherControl.active) en fuerzas que entiende trace(). */
function forcesFromWeather(activeWeather) {
  var forces = [];
  (activeWeather || []).forEach(function (w) {
    if (w.id === WEATHER_TORNADO) forces.push({ kind: "tornado", px: w.px, size: w.power });
    else if (w.id === WEATHER_MIRROR) forces.push({ kind: "mirror", px: w.px, size: 20 });
  });
  return forces;
}

function inBox(p, box) {
  return Math.abs(p.x - box.x) <= box.hw && Math.abs(p.y - box.y) <= box.hh;
}

/**
 * Recorre una bala hasta que impacta.
 *   opts.map      mapa del servidor (lib/map.js): colisión con el terreno real (IsPixel)
 *   opts.groundY  alternativa sin mapa: suelo plano a esa altura
 *   opts.target   caja {x, y, hw, hh} de un jugador: impacto directo
 *   opts.forces   [{kind: "mirror"|"tornado", px, size}]
 *   opts.points   true para devolver los puntos del recorrido (para dibujar)
 */
function trace(firstShot, opts) {
  var step = opts.step || 4;
  var maxTicks = opts.maxTicks || 4000;
  var forces = opts.forces || [];
  var w = opts.map ? opts.map.w : opts.width || 1800;
  var h = opts.map ? opts.map.h : opts.height || 900;
  var account = firstShot.account;

  var shot = firstShot;
  var state = { lastMirror: null, countMirror: 0, lastTornado: null, sideTornado: null, countTornado: 0 };
  var segments = [];
  var points = opts.points ? [] : null;
  var kind = "shot";
  var elapsed = 0;
  var topY = Infinity;
  var impact = null;

  for (var t = 0; t <= maxTicks; t += step) {
    var p = shot.getPosAtTime(t);
    if (points) points.push([p.x, p.y]);
    if (p.y < topY) topY = p.y;
    var total = elapsed + t;

    if (total > 20) {
      if (opts.target && inBox(p, opts.target)) {
        impact = { x: p.x, y: p.y, ticks: total, hitPlayer: true };
        break;
      }
      if (opts.map) {
        var ix = Math.round(p.x);
        var iy = Math.round(p.y);
        if (ix >= 0 && ix < w && iy >= 0 && iy < h && opts.map.IsPixel(ix, iy)) {
          impact = { x: p.x, y: p.y, ticks: total, hitPlayer: false };
          break;
        }
      } else if (opts.groundY !== undefined && p.y >= opts.groundY) {
        impact = { x: p.x, y: opts.groundY, ticks: total, hitPlayer: false };
        break;
      }
    }
    if (p.x < -400 || p.x > w + 400 || p.y > h + 200) break;

    var reflect = null;
    for (var i = 0; i < forces.length && !reflect; i++) {
      var f = forces[i];
      var half = f.kind === "tornado" ? f.size / 2 : 10;
      if (!(p.x <= f.px + half && p.x >= f.px - half)) continue;
      if (f.kind === "mirror") {
        if (state.lastMirror !== f.px && state.countMirror < MAX_REFLECTIONS) {
          var v = shot.getVelocityAtTime(t);
          reflect = { ang: deg(Math.atan2(-v.y, -v.x)), power: Math.sqrt(v.x * v.x + v.y * v.y), kind: "mirror", px: f.px };
        }
      } else {
        var side = p.x > f.px ? "R" : "L";
        if (state.lastTornado !== f.px) {
          state.lastTornado = f.px;
          state.sideTornado = side;
          state.countTornado = 2;
        }
        var nearEdge = !(p.x <= f.px + half - 10 && p.x >= f.px - half + 10);
        if (nearEdge && state.sideTornado !== side && state.countTornado > 0) {
          state.countTornado--;
          state.countMirror = 0;
          state.lastMirror = null;
          var vt = shot.getVelocityAtTime(t);
          reflect = { ang: deg(Math.atan2(-vt.y, -vt.x)), power: shot.power, kind: "tornado", px: f.px };
        }
      }
    }

    if (reflect) {
      if (points) segments.push({ kind: kind, points: points });
      if (reflect.kind === "mirror") {
        state.lastMirror = reflect.px;
        state.countMirror++;
      }
      // Igual que world.js: nueva bala desde el punto del rebote, con la gravedad y la aceleración
      // horizontal ya afectadas por el viento (no se aplica el viento otra vez).
      shot = new Shoot({
        x0: p.x,
        y0: p.y,
        ang: reflect.ang,
        power: reflect.power,
        weight: shot.weight,
        friccion: shot.friccion,
        account: account,
      });
      elapsed += t;
      t = 0;
      if (points) points = [[p.x, p.y]];
      kind = reflect.kind;
    }
  }
  if (points) segments.push({ kind: kind, points: points });
  return { segments: segments, impact: impact, topY: topY };
}

module.exports = {
  launch: launch,
  createShots: createShots,
  forcesFromWeather: forcesFromWeather,
  trace: trace,
  WEATHER_MIRROR: WEATHER_MIRROR,
  WEATHER_TORNADO: WEATHER_TORNADO,
};
