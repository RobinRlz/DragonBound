var express = require('express'),
    router = express.Router();

router.get('/', function (req, res) {
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify([]));
});

router.get('/get_status', function (req, res) {
    res.setHeader('Content-Type', 'application/json');
    var data = [1, 0, 0];
    res.send(JSON.stringify(data));
});

module.exports = router;