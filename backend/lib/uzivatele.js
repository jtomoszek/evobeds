/* Uživatelé administrace: jména, e-maily, role a hesla.
   Úložiště je jeden JSON soubor data/uzivatele.json, hesla se ukládají
   jen jako scrypt otisky. Role: admin (spravuje uživatele) a clen. */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SOUBOR = path.join(__dirname, '..', 'data', 'uzivatele.json');

/* Barvy avatarů se přidělují postupně, ať se lidé v kanbanu dobře rozliší. */
const BARVY = ['#3d6b8f', '#7d5a8c', '#2e7d4f', '#8a6233', '#a4443f', '#33707b', '#5b5f8a', '#846043'];

function nactiVse() {
  try {
    return JSON.parse(fs.readFileSync(SOUBOR, 'utf8'));
  } catch {
    return [];
  }
}

function ulozVse(uzivatele) {
  fs.mkdirSync(path.dirname(SOUBOR), { recursive: true });
  const docasny = SOUBOR + '.tmp';
  fs.writeFileSync(docasny, JSON.stringify(uzivatele, null, 2));
  fs.renameSync(docasny, SOUBOR);
}

function otiskHesla(heslo) {
  const sul = crypto.randomBytes(16).toString('hex');
  const otisk = crypto.scryptSync(String(heslo), sul, 64).toString('hex');
  return sul + ':' + otisk;
}

function overHeslo(heslo, ulozeny) {
  const [sul, otisk] = String(ulozeny || '').split(':');
  if (!sul || !otisk) return false;
  const kontrola = crypto.scryptSync(String(heslo), sul, 64).toString('hex');
  const a = Buffer.from(otisk);
  const b = Buffer.from(kontrola);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* Bez hesla ven: tohle je podoba uživatele pro API a tokeny. */
function verejny(u) {
  if (!u) return null;
  return { id: u.id, jmeno: u.jmeno, email: u.email, role: u.role, barva: u.barva, aktivni: u.aktivni };
}

function seznam() {
  return nactiVse().map(verejny);
}

function najdi(id) {
  return nactiVse().find(u => u.id === id) || null;
}

function najdiPodleEmailu(email) {
  const hledany = String(email || '').trim().toLowerCase();
  return nactiVse().find(u => u.email.toLowerCase() === hledany) || null;
}

function zadnyUzivatel() {
  return nactiVse().length === 0;
}

function vytvor({ jmeno, email, heslo, role }) {
  const uzivatele = nactiVse();
  jmeno = String(jmeno || '').trim().slice(0, 120);
  email = String(email || '').trim().toLowerCase().slice(0, 120);
  if (!jmeno) throw new Error('Chybí jméno uživatele.');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Neplatný e-mail.');
  if (String(heslo || '').length < 8) throw new Error('Heslo musí mít aspoň 8 znaků.');
  if (uzivatele.some(u => u.email.toLowerCase() === email)) throw new Error('Uživatel s tímto e-mailem už existuje.');
  const u = {
    id: Date.now(),
    jmeno,
    email,
    role: role === 'admin' ? 'admin' : 'clen',
    barva: BARVY[uzivatele.length % BARVY.length],
    aktivni: true,
    vytvoreno: new Date().toISOString(),
    hesloOtisk: otiskHesla(heslo)
  };
  uzivatele.push(u);
  ulozVse(uzivatele);
  return verejny(u);
}

function uprav(id, zmeny) {
  const uzivatele = nactiVse();
  const u = uzivatele.find(x => x.id === +id);
  if (!u) throw new Error('Uživatel nenalezen.');
  if (zmeny.jmeno != null) u.jmeno = String(zmeny.jmeno).trim().slice(0, 120) || u.jmeno;
  if (zmeny.role != null) {
    const noveRole = zmeny.role === 'admin' ? 'admin' : 'clen';
    /* Poslední aktivní admin o roli přijít nesmí, jinak by se nikdo nedostal ke správě. */
    const jinychAdminu = uzivatele.filter(x => x.id !== u.id && x.role === 'admin' && x.aktivni).length;
    if (u.role === 'admin' && noveRole !== 'admin' && jinychAdminu === 0) {
      throw new Error('Poslední administrátor nemůže o roli přijít.');
    }
    u.role = noveRole;
  }
  if (zmeny.aktivni != null) {
    const jinychAdminu = uzivatele.filter(x => x.id !== u.id && x.role === 'admin' && x.aktivni).length;
    if (u.role === 'admin' && !zmeny.aktivni && jinychAdminu === 0) {
      throw new Error('Poslední administrátor nejde deaktivovat.');
    }
    u.aktivni = !!zmeny.aktivni;
  }
  if (zmeny.heslo) {
    if (String(zmeny.heslo).length < 8) throw new Error('Heslo musí mít aspoň 8 znaků.');
    u.hesloOtisk = otiskHesla(zmeny.heslo);
  }
  ulozVse(uzivatele);
  return verejny(u);
}

/* Přihlášení: e-mail + heslo. Dokud neexistuje žádný uživatel, přijímá se
   místo toho hlavní heslo ADMIN_HESLO z .env a prvním přihlášením se
   automaticky založí účet administrátora. */
function prihlas(email, heslo) {
  if (zadnyUzivatel()) {
    if (!process.env.ADMIN_HESLO) throw new Error('V .env není nastaveno ADMIN_HESLO, administrace je vypnutá.');
    const a = Buffer.from(String(heslo));
    const b = Buffer.from(process.env.ADMIN_HESLO);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new Error('Nesprávné heslo.');
    return vytvor({
      jmeno: 'Administrátor',
      email: /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email || '') ? email : 'admin@evobeds.cz',
      heslo: process.env.ADMIN_HESLO.length >= 8 ? process.env.ADMIN_HESLO : (process.env.ADMIN_HESLO + '-evobeds'),
      role: 'admin'
    });
  }
  const u = najdiPodleEmailu(email);
  if (!u || !u.aktivni || !overHeslo(heslo, u.hesloOtisk)) throw new Error('Nesprávný e-mail nebo heslo.');
  return verejny(u);
}

module.exports = { seznam, najdi, najdiPodleEmailu, vytvor, uprav, prihlas, zadnyUzivatel, verejny };
