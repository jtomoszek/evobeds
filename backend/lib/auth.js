/* Přihlášení do administrace: ověření řeší modul uzivatele (e-mail + heslo),
   tady se vydávají a kontrolují podepsané tokeny s platností 12 hodin.
   Podpis je HMAC s tajným klíčem, žádné závislosti navíc. */

'use strict';

const crypto = require('crypto');
const uzivatele = require('./uzivatele');

/* Tajný klíč podpisu: z .env, jinak náhodný na dobu běhu procesu
   (po restartu serveru se administrátoři znovu přihlásí, což nevadí). */
const KLIC = process.env.ADMIN_TAJEMSTVI || crypto.randomBytes(32).toString('hex');
const PLATNOST_MS = 12 * 60 * 60 * 1000;

/* ---------- Omezení pokusů: max 10 za 15 minut z jedné adresy ---------- */
const pokusy = new Map();
function povolenPokus(ip) {
  const ted = Date.now();
  const zaznam = pokusy.get(ip) || { pocet: 0, od: ted };
  if (ted - zaznam.od > 15 * 60 * 1000) { zaznam.pocet = 0; zaznam.od = ted; }
  zaznam.pocet++;
  pokusy.set(ip, zaznam);
  return zaznam.pocet <= 10;
}

function podepis(data) {
  return crypto.createHmac('sha256', KLIC).update(data).digest('base64url');
}

function stejne(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

function prihlas(email, heslo, ip) {
  if (!povolenPokus(ip)) throw new Error('Příliš mnoho pokusů. Zkuste to za čtvrt hodiny.');
  const uzivatel = uzivatele.prihlas(email, heslo);
  const telo = Buffer.from(JSON.stringify({ uid: uzivatel.id, do: Date.now() + PLATNOST_MS })).toString('base64url');
  return { token: telo + '.' + podepis(telo), uzivatel };
}

/* Vrací přihlášeného uživatele, nebo null. */
function overToken(token) {
  if (!token || typeof token !== 'string') return null;
  const [telo, podpis] = token.split('.');
  if (!telo || !podpis || !stejne(podpis, podepis(telo))) return null;
  try {
    const data = JSON.parse(Buffer.from(telo, 'base64url').toString('utf8'));
    if (Date.now() >= data.do) return null;
    const u = uzivatele.najdi(data.uid);
    if (!u || !u.aktivni) return null;
    return uzivatele.verejny(u);
  } catch {
    return null;
  }
}

/* Express middleware: pustí dál jen přihlášené a připojí req.uzivatel. */
function vyzadujPrihlaseni(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const uzivatel = overToken(token);
  if (!uzivatel) return res.status(401).json({ chyba: 'Přihlaste se prosím.' });
  req.uzivatel = uzivatel;
  next();
}

/* Middleware navíc pro správu uživatelů: jen role admin. */
function vyzadujAdmina(req, res, next) {
  if (!req.uzivatel || req.uzivatel.role !== 'admin') {
    return res.status(403).json({ chyba: 'Na tuto akci je potřeba role administrátora.' });
  }
  next();
}

module.exports = { prihlas, overToken, vyzadujPrihlaseni, vyzadujAdmina };
