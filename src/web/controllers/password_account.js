var express = require('express'),
    router = express.Router(),
    nodemailer = require('nodemailer');

// metodo de server - GET
// Muestra algo
// ruta account/password/resetPass
router.get('/accounts/password/reset/', function (req, res) {
    // renderizar una plantilla html
    res.render('recuperarContrasena');
});
// metodo de server - POST
// Recibo algo y hace algo
// ruta account/password/resetPass
router.post('/accounts/password/reset/', async function (req, res) {
	const correoDelUzuario = req.body.email;
	await enviarCorreo(correoDelUzuario);
	// enviar un texto en pantalla
	res.render('password_done2')
});

const enviarCorreo = (email)=>{
	return new Promise((resolve,reject)=>{
	 if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
	    console.log("SMTP_USER/SMTP_PASS no configurados: no se envía el correo");
	    return resolve(false);
	 }
	 let transporter = nodemailer.createTransport({
	    service: 'gmail',
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS
            }
	 });
	var mailOptions = {
	   from: process.env.SMTP_USER,
            to: email,
            subject: 'Password reset on dragonbound.net',
            text: '[ES] Te hemos enviado un correo con las instrucciones de reseteo de tu contraseña al correo electrónico que nos has indicado.El correo tomará unas horas en ser enviado, por favor espere y revise su correo electrónico más tarde.'
	};
	let resp=false;

	transporter.sendMail(mailOptions, function(error, info){
	    if (error) {
	        console.log("error is "+error);
	       resolve(false); // or use rejcet(false) but then you will have to handle errors
	    } 
	   else {
	       console.log('Email sent: ' + info.response);
	       resolve(true);
	    }
	   });
	 })  
}

module.exports = router;