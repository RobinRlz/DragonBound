const session = require("express-session");
const expressMysqlSession = require("express-mysql-session");

const config = require("@web/main/config/env");

var options = {
  host: config.DB.HOST,
  port: config.DB.PORT,
  user: config.DB.USER,
  password: config.DB.PASSWORD,
  database: config.DB.DATABASE,
  schema: {
    tableName: "account_sessions",
    columnNames: {
      session_id: "session_id",
      expires: "expires_time",
      data: "data_acc",
    },
  },
};

var MySQLStore = expressMysqlSession(session);
var sessionStore = new MySQLStore(options);

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

module.exports = () =>
  session({
    key: "sessionid",
    secret: config.SESSION.SECRET,
    store: sessionStore,
    // No guardar sesiones vacías de visitantes anónimos ni reescribir sin cambios.
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      // "auto": Secure cuando la petición llega por HTTPS (detrás de un proxy hay que definir TRUST_PROXY).
      secure: process.env.COOKIE_SECURE === "true" ? true : "auto",
      maxAge: ONE_DAY_MS,
    },
  });
