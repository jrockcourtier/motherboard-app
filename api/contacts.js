// CRM : contacts (table « contacts ») · ?kind=sessions → temps de prospection (table « sessions »)
// (même fonction pour rester sous la limite de 12 fonctions Vercel)
const R = require('./_records');
const contacts = R('contacts'), sessions = R('sessions');
module.exports = (req, res) => (/[?&]kind=sessions(&|$)/.test(req.url || '') ? sessions : contacts)(req, res);
