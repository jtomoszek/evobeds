/* Serverová část e-shopu evobeds.
   Přijímá objednávky z webu, posílá zákazníka na platební bránu GP webpay,
   po zaplacení zakládá objednávku do Pohody (mServer) a rozesílá e-maily.

   Spuštění: node server.js (nastavení v souboru .env, vzor je .env.example) */

'use strict';

require('dotenv').config();
const express = require('express');
const gpwebpay = require('./lib/gpwebpay');
const pohoda = require('./lib/pohoda');
const mail = require('./lib/mail');
const sklad = require('./lib/ulozeni');

const app = express();
app.use(express.json({ limit: '100kb' }));

/* ---------- CORS: web běží na jiné doméně než backend ---------- */
const POVOLENE_PUVODY = (process.env.FRONTEND_PUVODY ||
  'https://jtomoszek.github.io,https://evobeds.cz,https://www.evobeds.cz')
  .split(',').map(s => s.trim());

app.use((req, res, next) => {
  const puvod = req.headers.origin;
  if (puvod && POVOLENE_PUVODY.includes(puvod)) {
    res.setHeader('Access-Control-Allow-Origin', puvod);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

/* ---------- Pomocné ---------- */
function chybaKlienta(res, zprava) {
  return res.status(400).json({ chyba: zprava });
}

function adresaNavratu(parametry) {
  const url = new URL((process.env.FRONTEND_URL || 'https://jtomoszek.github.io/evobeds') + '/objednavka.html');
  for (const [k, v] of Object.entries(parametry)) url.searchParams.set(k, v);
  return url.toString();
}

/* Po zaplacení: e-maily a založení do Pohody. Selhání jednoho kroku
   nesmí zastavit ostatní; všechno se poznamená do objednávky. */
async function poZaplaceni(o) {
  try {
    await mail.posliPotvrzeni(o);
    o.emailOdeslan = true;
  } catch (e) {
    o.emailOdeslan = false;
    o.emailChyba = String(e.message || e);
    console.error(`Objednávka ${o.cislo}: e-mail se nepodařilo odeslat:`, e.message);
  }
  try {
    await pohoda.zalozObjednavku(o);
    o.pohodaZalozeno = true;
  } catch (e) {
    o.pohodaZalozeno = false;
    o.pohodaChyba = String(e.message || e);
    console.error(`Objednávka ${o.cislo}: založení do Pohody selhalo:`, e.message);
  }
  sklad.uloz(o);
}

/* ---------- Přijetí objednávky z webu ---------- */
app.post('/api/objednavka', (req, res) => {
  const t = req.body || {};
  const z = t.zakaznik || {};
  const k = t.konfigurace || {};

  /* Základní kontrola vstupu; podrobná validace proběhla už ve formuláři. */
  for (const pole of ['jmeno', 'telefon', 'email', 'ulice', 'mesto', 'psc']) {
    if (!z[pole] || String(z[pole]).trim() === '') {
      return chybaKlienta(res, 'Chybí povinné pole: ' + pole);
    }
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(z.email)) return chybaKlienta(res, 'Neplatný e-mail');

  /* Cena se počítá na serveru, ceně z prohlížeče se nevěří. */
  const zakladKc = 39900;
  const matraceKc = Math.max(0, Math.min(20000, +k.matraceKc || 0));
  const doplnky = (Array.isArray(k.doplnky) ? k.doplnky : [])
    .slice(0, 10)
    .map(d => ({ nazev: String(d.nazev || '').slice(0, 120), cena: Math.max(0, Math.min(20000, +d.cena || 0)) }));
  const celkemKc = zakladKc + matraceKc + doplnky.reduce((s, d) => s + d.cena, 0);

  const objednavka = {
    cislo: Date.now(),
    vytvoreno: new Date().toISOString(),
    stav: 'ceka-na-platbu',
    celkemKc,
    konfigurace: {
      material: String(k.material || '').slice(0, 80),
      barva: String(k.barva || '').slice(0, 80),
      matrace: String(k.matrace || 'Bez matrace').slice(0, 120),
      matraceKc,
      doplnky,
      zakladKc
    },
    zakaznik: {
      jmeno: String(z.jmeno).slice(0, 120),
      telefon: String(z.telefon).slice(0, 40),
      email: String(z.email).slice(0, 120),
      ulice: String(z.ulice).slice(0, 160),
      mesto: String(z.mesto).slice(0, 80),
      psc: String(z.psc).slice(0, 12),
      patro: String(z.patro || '').slice(0, 160),
      firma: String(z.firma || '').slice(0, 160),
      ic: String(z.ic || '').slice(0, 20),
      dic: String(z.dic || '').slice(0, 20),
      fakturacniadresa: String(z.fakturacniadresa || '').slice(0, 240),
      poznamka: String(z.poznamka || '').slice(0, 1000)
    }
  };

  try {
    const platbaUrl = gpwebpay.vytvorPlatbu(objednavka);
    sklad.uloz(objednavka);
    console.log(`Objednávka ${objednavka.cislo} přijata, ${celkemKc} Kč, přesměrování na bránu.`);
    res.json({ cislo: objednavka.cislo, platbaUrl });
  } catch (e) {
    console.error('Vytvoření platby selhalo:', e);
    res.status(500).json({ chyba: 'Platbu se nepodařilo připravit. Zavolejte nám prosím na +420 773 030 533.' });
  }
});

/* ---------- Návrat z platební brány ---------- */
app.get('/api/platba/navrat', async (req, res) => {
  const surovyDotaz = req.url.split('?')[1] || '';
  let vysledek;
  try {
    vysledek = gpwebpay.overNavrat(surovyDotaz);
  } catch (e) {
    console.error('Ověření návratu z brány selhalo:', e);
    return res.redirect(adresaNavratu({ platba: 'chyba' }));
  }

  if (!vysledek.overeno) {
    console.error('Návrat z brány má neplatný podpis, dotaz:', surovyDotaz);
    return res.redirect(adresaNavratu({ platba: 'chyba' }));
  }

  const o = sklad.nacti(vysledek.cislo);
  if (!o) {
    console.error('Návrat z brány pro neznámou objednávku:', vysledek.cislo);
    return res.redirect(adresaNavratu({ platba: 'chyba' }));
  }

  if (vysledek.zaplaceno) {
    /* Brána může návrat poslat i opakovaně, e-maily a Pohodu spouštíme jen jednou. */
    if (o.stav !== 'zaplacena') {
      o.stav = 'zaplacena';
      o.zaplaceno = new Date().toISOString();
      sklad.uloz(o);
      await poZaplaceni(o);
    }
    return res.redirect(adresaNavratu({ platba: 'ok', cislo: o.cislo }));
  }

  o.stav = 'platba-neuspesna';
  o.platbaChyba = `PRCODE=${vysledek.prcode} SRCODE=${vysledek.srcode} ${vysledek.text}`;
  sklad.uloz(o);
  console.warn(`Objednávka ${o.cislo}: platba neprošla (${o.platbaChyba}).`);
  return res.redirect(adresaNavratu({ platba: 'chyba', cislo: o.cislo }));
});

/* ---------- Opakování platby po neúspěchu ---------- */
app.get('/api/platba/znovu/:cislo', (req, res) => {
  const o = sklad.nacti(req.params.cislo);
  if (!o) return res.status(404).send('Objednávka nenalezena.');
  if (o.stav === 'zaplacena') return res.redirect(adresaNavratu({ platba: 'ok', cislo: o.cislo }));
  try {
    res.redirect(gpwebpay.vytvorPlatbu(o));
  } catch (e) {
    console.error('Opakování platby selhalo:', e);
    res.redirect(adresaNavratu({ platba: 'chyba', cislo: o.cislo }));
  }
});

/* ---------- Ruční doslání objednávky do Pohody (např. když mServer neběžel) ---------- */
app.post('/api/pohoda/znovu/:cislo', async (req, res) => {
  if (!process.env.ADMIN_TOKEN || req.headers['x-admin-token'] !== process.env.ADMIN_TOKEN) {
    return res.sendStatus(401);
  }
  const o = sklad.nacti(req.params.cislo);
  if (!o) return res.status(404).json({ chyba: 'Objednávka nenalezena' });
  try {
    await pohoda.zalozObjednavku(o);
    o.pohodaZalozeno = true;
    delete o.pohodaChyba;
    sklad.uloz(o);
    res.json({ ok: true });
  } catch (e) {
    res.status(502).json({ chyba: String(e.message || e) });
  }
});

/* ---------- Kontrola běhu ---------- */
app.get('/api/zdravi', (req, res) => res.json({ ok: true }));

const port = +(process.env.PORT || 3400);
app.listen(port, () => console.log(`Backend evobeds běží na portu ${port}.`));
