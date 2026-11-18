var express = require('express'),
    router = express.Router();
var { verifyPassword, hashPassword } = require('../lib/password');
var { loginFailures } = require('../lib/limits');
var { rotateAccountSession } = require('../lib/session');

router.post('/', async (req, res) => {
    const { username, pass } = req.body;
    const sendError = () => {
        res.render('login', { error: true });
    }
    const loginKey = String(username).toLowerCase();
    if (loginFailures.isBlocked(loginKey)) return sendError();
    try {
        const responseUsername = await req.db.getAccountByUsername(username);
        const currentUsername = await responseUsername[0][0];
        const check = await verifyPassword(pass, currentUsername.Password);
        if (check.ok) {
            loginFailures.reset(loginKey);
            currentUsername.Session = await rotateAccountSession(req.db, currentUsername.Id);
            if (check.legacy) {
                // Migra la contraseña antigua (texto plano) a hash.
                await req.db.updatePasswordByNameId(await hashPassword(pass), currentUsername.Id).catch(() => {});
            }
            const responseUserById = await req.db.getUserByIdAcc(currentUsername.Id);
            const dataUserById = await responseUserById[0][0];
            if (responseUserById[0].length > 0) {
                req.session.cookie.maxAge = 60 * 1000 * 1440;
                req.session.account_id = currentUsername.Id;
                req.session.rank = dataUserById.rank;
                req.session.acc_session = currentUsername.Session;
                req.session.game_id = dataUserById.game_id;
                res.redirect('user/' + dataUserById.game_id);
            } else {
                sendError();
            }
        } else {
            loginFailures.fail(loginKey);
            sendError();
        }
    }
    catch (ex) {
        loginFailures.fail(loginKey);
        sendError();
    }

});

module.exports = router;