/* Přihlášení do administrace: heslo z .env (ADMIN_HESLO), po ověření se vydá
   podepsaný token s platností 12 hodin. Podpis je HMAC s tajným klíčem,
   žádné závislosti navíc. Pokusy o přihlášení jsou omezené proti hádání hesla. */

'use strict';

const crypto = require('crypto');

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

function stejne(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

function podepis(data) {
  return crypto.createHmac('sha256', KLIC).update(data).digest('base64url');
}

function prihlas(heslo, ip) {
  if (!process.env.ADMIN_HESLO) throw new Error('V .env není nastaveno ADMIN_HESLO, administrace je vypnutá.');
  if (!povolenPokus(ip)) throw new Error('Příliš mnoho pokusů. Zkuste to za čtvrt hodiny.');
  if (!stejne(heslo, process.env.ADMIN_HESLO)) throw new Error('Nesprávné heslo.');
  const telo = Buffer.from(JSON.stringify({ do: Date.now() + PLATNOST_MS })).toString('base64url');
  return telo + '.' + podepis(telo);
}

function overToken(token) {
  if (!token || typeof token !== 'string') return false;
  const [telo, podpis] = token.split('.');
  if (!telo || !podpis || !stejne(podpis, podepis(telo))) return false;
  try {
    const data = JSON.parse(Buffer.from(telo, 'base64url').toString('utf8'));
    return Date.now() < data.do;
  } catch {
    return false;
  }
}

/* Express middleware: pustí dál jen požadavky s platným tokenem. */
function vyzadujPrihlaseni(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!overToken(token)) return res.status(401).json({ chyba: 'Přihlaste se prosím.' });
  next();
}

module.exports = { prihlas, overToken, vyzadujPrihlaseni };
