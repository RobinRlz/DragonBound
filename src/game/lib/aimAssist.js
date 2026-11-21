/**
 * Asistente de puntería del SERVIDOR (solo para pruebas en tu propio servidor).
 *
 * El cálculo lo hace el servidor de juego con su propia física (lib/shotTrace.js -> clase Shoot), su
 * viento, su clima activo y el terreno real del mapa. El cliente no calcula nada: solo recibe un
 * mensaje de chat. Por eso no funciona fuera de este servidor.
 *
 * Comandos de chat (solo cuentas de AIM_ASSIST_USER_IDS en el .env):
 *   /apuntar [1|2|ss]       marca ángulo y fuerza para darle al enemigo más cercano
 *   /autodisparo            activa o desactiva que el servidor dispare solo en tu turno
 *
 * Cómo se busca el disparo:
 *   1. Se elige al enemigo vivo más cercano (otro equipo).
 *   2. Para tu ángulo actual se prueban fuerzas de 0 a 400 (la barra) y se simula cada disparo
 *      hasta que choca con el terreno o con la caja del enemigo; se queda la que cae más cerca.
 *   3. Lo mismo para ángulos de 5° a 85° y se elige el mejor (menor distancia al enemigo).
 */
var Types = require("../gametypes");
var shotTrace = require("./shotTrace");

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

var allowedIds = parseIds(process.env.AIM_ASSIST_USER_IDS);

// Caja de impacto aproximada de un móvil, relativa a su posición (x = centro, y = pies)
var TARGET_HALF_W = 18;
var TARGET_HALF_H = 18;
var TARGET_RAISE = 18;
var HIT_DISTANCE = 22;

// El cliente NO avisa al servidor cuando cambias de bala (1, 2, SS): solo la envía al empezar a cargar la
// barra o al disparar. Por eso el bot no puede "ver" el botón seleccionado antes de tu disparo y hay que
// decirle qué bala usar (/apuntar 2, /autodisparo ss) o dejar que use la última que disparaste.
var TYPE_NAMES = ["1", "2", "SS"];

/** "1" -> 0, "2" -> 1, "ss" -> 2. Devuelve null si el texto no es una bala válida. */
function parseShotType(arg) {
  var a = String(arg === undefined || arg === null ? "" : arg).trim().toLowerCase();
  if (a === "1") return 0;
  if (a === "2") return 1;
  if (a === "ss") return 2;
  return null;
}

/** Última bala que usó el jugador (la guarda el servidor al empezar a cargar o al disparar); 1 si no hay. */
function defaultShotType(player) {
  var t = player && player.shotType;
  return t === 0 || t === 1 || t === 2 ? t : 0;
}

function shotTypeName(type) {
  return TYPE_NAMES[type] || "1";
}

function isAllowed(account) {
  return !!(account && account.player && allowedIds.indexOf(Number(account.player.user_id)) !== -1);
}

function findEnemy(game, account) {
  var me = account.player;
  var best = null;
  game.room.forPlayers(function (acc) {
    if (!acc || acc === account) return;
    var p = acc.player;
    if (!p || p.is_alive !== 1 || p.team === me.team) return;
    var d = Math.abs(p.x - me.x);
    if (!best || d < best.distance) best = { account: acc, player: p, distance: d };
  });
  return best;
}

function mobileOf(account) {
  var m = account.player.mobile;
  if (m === Types.MOBILE.RANDOM || m === Types.MOBILE.RANDOMIZER || !Types.MOBILES[m]) return Types.MOBILE.ARMOR;
  return m;
}

/** Simula un disparo y devuelve la distancia del impacto al enemigo (Infinity si se sale del mapa). */
function shotError(game, account, enemy, look, ang, power, type) {
  var me = account.player;
  var mobileId = mobileOf(account);
  var start = shotTrace.launch(mobileId, me.x, me.y, me.body || 0, look, ang, power);
  var shots = shotTrace.createShots(
    mobileId,
    type,
    start,
    { power: game.wind_power, angle: game.wind_angle },
    { player: { mobile: mobileId, avaAttack: 0, check_my_ava: 0 } }
  );
  var target = { x: enemy.x, y: enemy.y - TARGET_RAISE, hw: TARGET_HALF_W, hh: TARGET_HALF_H };
  var r = shotTrace.trace(shots[0], {
    map: game.map,
    target: target,
    forces: shotTrace.forcesFromWeather(game.weather && game.weather.active),
    step: 2,
  });
  if (!r.impact) return { error: Infinity, impact: null };
  if (r.impact.hitPlayer) return { error: 0, impact: r.impact };
  var dx = r.impact.x - target.x;
  var dy = r.impact.y - target.y;
  return { error: Math.sqrt(dx * dx + dy * dy), impact: r.impact };
}

/** Mejor fuerza (0-400) para un ángulo: búsqueda gruesa cada 5 y fina alrededor de la mejor. */
function bestPowerForAngle(game, account, enemy, look, ang, type) {
  var best = { power: null, error: Infinity, impact: null };
  var p, r;
  for (p = 0; p <= 400; p += 5) {
    r = shotError(game, account, enemy, look, ang, p, type);
    if (r.error < best.error) best = { power: p, error: r.error, impact: r.impact };
  }
  if (best.power === null) return best;
  var from = Math.max(0, best.power - 5);
  var to = Math.min(400, best.power + 5);
  for (p = from; p <= to; p++) {
    r = shotError(game, account, enemy, look, ang, p, type);
    if (r.error < best.error) best = { power: p, error: r.error, impact: r.impact };
  }
  return best;
}

/**
 * Calcula el disparo para darle al enemigo más cercano.
 * Devuelve null si no hay partida o enemigo.
 */
function solve(game, account, type) {
  if (!game || !game.map || !account || !account.player) return null;
  var enemy = findEnemy(game, account);
  if (!enemy) return null;
  var me = account.player;
  var look = enemy.player.x >= me.x ? 1 : 0; // 1 = derecha, 0 = izquierda (como en gameShoot)
  type = type || 0;
  var mobileShots = Types.MOBILES[mobileOf(account)].shoots.length;
  if (type > mobileShots - 1) type = mobileShots - 1;

  var current = null;
  var myAng = Number(me.ang);
  if (Number.isFinite(myAng) && myAng >= 0 && myAng <= 90) {
    var c = bestPowerForAngle(game, account, enemy.player, look, myAng, type);
    if (c.power !== null) current = { ang: myAng, power: c.power, error: c.error };
  }

  var best = null;
  for (var a = 5; a <= 85; a += 5) {
    var b = bestPowerForAngle(game, account, enemy.player, look, a, type);
    if (b.power === null) continue;
    // Ante errores parecidos, mejor menos fuerza (disparo más estable)
    if (!best || b.error < best.error - 1 || (Math.abs(b.error - best.error) <= 1 && b.power < best.power)) {
      best = { ang: a, power: b.power, error: b.error };
    }
  }

  return {
    enemy: { name: enemy.player.game_id, x: enemy.player.x, y: enemy.player.y, distance: Math.round(enemy.distance) },
    look: look,
    type: type,
    wind: { power: game.wind_power, angle: game.wind_angle },
    current: current,
    best: best,
  };
}

function pct(power) {
  return Math.round((power / 400) * 100);
}

function describe(result) {
  if (!result) return "No hay enemigo vivo para apuntar.";
  var lines = [];
  var dir = result.look === 1 ? "derecha" : "izquierda";
  lines.push(
    "Bala " + shotTypeName(result.type) + " | Objetivo: " + result.enemy.name + " a " + result.enemy.distance +
      " px (" + dir + "). Viento " + result.wind.power + " (ángulo " + result.wind.angle + ")."
  );
  var fmt = function (s) {
    var hit = s.error <= HIT_DISTANCE ? "impacto" : "queda a " + Math.round(s.error) + " px";
    return "ángulo " + Math.round(s.ang) + "° → fuerza " + s.power + " (" + pct(s.power) + "% de la barra), " + hit;
  };
  if (result.current) lines.push("Con tu ángulo actual: " + fmt(result.current));
  if (result.best) lines.push("Mejor opción: " + fmt(result.best));
  if (!result.current && !result.best) lines.push("Ningún disparo llega al objetivo (¿muy lejos o tapado?).");
  return lines.join(" | ");
}

module.exports = {
  parseShotType: parseShotType,
  defaultShotType: defaultShotType,
  shotTypeName: shotTypeName,
  isAllowed: isAllowed,
  solve: solve,
  describe: describe,
  HIT_DISTANCE: HIT_DISTANCE,
  allowedIds: allowedIds,
};
