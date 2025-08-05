import nodemailer from 'nodemailer'

// Create your account at: https://ethereal.email/
// Mailbox for below account is available at: https://ethereal.email/messages
const transporter = nodemailer.createTransport({
  host: 'smtp.ethereal.email',
  port: 587,
  auth: {
      user: 'elza.stamm98@ethereal.email',
      pass: 'Vw3q12qedYSqWxVQ8e'
  }
});

transporter.sendMail({
  from: '"Sidharth Ramesh 👻" <learn@medblocks.com>', // sender address
  to: "participant-bootcamp@test.com", // list of receivers
  subject: "Hello from FHIR Bootcamp 🔥", // Subject line
  html: "Your Patient Camila Lopez is <b>completely fine</b>.<br/>Or <em>is she?</em>", // html body
}).then(info => console.log(info))