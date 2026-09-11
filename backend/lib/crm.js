/* CRM evobeds: jednotná správa zakázek (B2C objednávky z webu i ruční B2B obchody).
   Úložiště drží linii zbytku backendu: jeden JSON soubor na zakázku ve složce
   data/zakazky, žádná databáze. Objem zakázek je malý, soubory jdou zálohovat
   i číst ručně a seznam se drží v paměti. */

'use strict';

const fs = require('fs');
const path = require('path');

const SLOZKA = path.join(__dirname, '..', 'data', 'zakazky');

/* ---------- Pipeline ----------
   Každý typ zakázky má vlastní posloupnost stavů. Změna stavu se vždy
   zapisuje do historie události, takže je zpětně vidět celý průběh. */
const PIPELINE = {
  b2c: [
    { id: 'prijata',     nazev: 'Přijatá' },
    { id: 'zaplacena',   nazev: 'Zaplacená' },
    { id: 'vyroba',      nazev: 'Ve výrobě' },
    { id: 'sklad',       nazev: 'Ze skladu' },
    { id: 'expedice',    nazev: 'Expedice a montáž' },
    { id: 'dorucena',    nazev: 'Doručená' },
    { id: 'fakturovana', nazev: 'Fakturovaná' }
  ],
  /* Obchod je jen obchodní fáze; výhrou obchod končí a automaticky
     se z něj založí zakázka, která projde výrobou a dodáním. */
  b2b: [
    { id: 'potencial',   nazev: 'Potenciál' },
    { id: 'jednani',     nazev: 'Jednání' },
    { id: 'nabidka',     nazev: 'Nabídka' },
    { id: 'vyhrano',     nazev: 'Vyhráno' }
  ],
  reklamace: [
    { id: 'prijata',     nazev: 'Přijatá' },
    { id: 'posouzeni',   nazev: 'Posouzení' },
    { id: 'servis',      nazev: 'Servisní zásah' },
    { id: 'vyrizena',    nazev: 'Vyřízená' }
  ]
};

/* Koncové stavy mimo pipeline (prohraný obchod, stornovaná objednávka). */
const KONECNE = [
  { id: 'storno',    nazev: 'Storno' },
  { id: 'ztraceno',  nazev: 'Ztraceno' },
  { id: 'zamitnuta', nazev: 'Zamítnutá' }
];

function vsechnyStavy(typ) {
  return [...(PIPELINE[typ] || []), ...KONECNE].map(s => s.id);
}

/* ---------- Úložiště ---------- */
function cesta(id) {
  if (!/^\d+$/.test(String(id))) throw new Error('Neplatné číslo zakázky');
  return path.join(SLOZKA, id + '.json');
}

function uloz(z) {
  fs.mkdirSync(SLOZKA, { recursive: true });
  const docasny = cesta(z.id) + '.tmp';
  fs.writeFileSync(docasny, JSON.stringify(z, null, 2));
  fs.renameSync(docasny, cesta(z.id));
}

function nacti(id) {
  try {
    return JSON.parse(fs.readFileSync(cesta(id), 'utf8'));
  } catch {
    return null;
  }
}

function seznam() {
  let soubory = [];
  try {
    soubory = fs.readdirSync(SLOZKA).filter(f => /^\d+\.json$/.test(f));
  } catch {
    return [];
  }
  const zakazky = [];
  for (const f of soubory) {
    try {
      zakazky.push(JSON.parse(fs.readFileSync(path.join(SLOZKA, f), 'utf8')));
    } catch (e) {
      console.error('Poškozený soubor zakázky:', f, e.message);
    }
  }
  zakazky.sort((a, b) => b.id - a.id);
  return zakazky;
}

/* ---------- Události (historie zakázky) ---------- */
function pridejUdalost(z, typ, text, kdo) {
  z.udalosti = z.udalosti || [];
  z.udalosti.push({
    kdy: new Date().toISOString(),
    typ,
    kdo: String(kdo || '').slice(0, 120),
    text: String(text || '').slice(0, 2000)
  });
}

/* ---------- Vytváření a úpravy ---------- */
function ocisti(text, max) {
  return String(text == null ? '' : text).trim().slice(0, max);
}

function vytvor(vstup) {
  const typ = ['b2b', 'reklamace'].includes(vstup.typ) ? vstup.typ : 'b2c';
  const stav = vsechnyStavy(typ).includes(vstup.stav) ? vstup.stav : PIPELINE[typ][0].id;
  const polozky = (Array.isArray(vstup.polozky) ? vstup.polozky : [])
    .slice(0, 50)
    .map(p => ({
      nazev: ocisti(p.nazev, 160),
      pocet: Math.max(1, Math.min(999, Math.round(+p.pocet || 1))),
      cenaKc: Math.max(0, Math.min(10000000, Math.round(+p.cenaKc || 0)))
    }))
    .filter(p => p.nazev);
  const celkemKc = vstup.celkemKc != null
    ? Math.max(0, Math.round(+vstup.celkemKc || 0))
    : polozky.reduce((s, p) => s + p.pocet * p.cenaKc, 0);

  const z = {
    id: vstup.id || Date.now(),
    vytvoreno: new Date().toISOString(),
    typ,
    stav,
    zdroj: ['web', 'obchod'].includes(vstup.zdroj) ? vstup.zdroj : 'rucni',
    nazev: ocisti(vstup.nazev, 200) || (typ === 'b2b' ? 'Nový obchod' : (typ === 'reklamace' ? 'Reklamace' : 'Objednávka')),
    vazba: ocisti(vstup.vazba, 30),   /* číslo související zakázky (hlavně u reklamací) */
    zakaznik: {
      jmeno: ocisti(vstup.zakaznik && vstup.zakaznik.jmeno, 120),
      firma: ocisti(vstup.zakaznik && vstup.zakaznik.firma, 160),
      telefon: ocisti(vstup.zakaznik && vstup.zakaznik.telefon, 40),
      email: ocisti(vstup.zakaznik && vstup.zakaznik.email, 120),
      adresa: ocisti(vstup.zakaznik && vstup.zakaznik.adresa, 300),
      ic: ocisti(vstup.zakaznik && vstup.zakaznik.ic, 20),
      dic: ocisti(vstup.zakaznik && vstup.zakaznik.dic, 20)
    },
    polozky,
    celkemKc,
    /* U B2B potenciálu ještě nemusí být položky, jen odhad hodnoty. */
    hodnotaKc: Math.max(0, Math.round(+vstup.hodnotaKc || 0)) || celkemKc,
    vyroba: { rezim: '', termin: '' },
    dorucenoDne: '',          /* den předání zákazníkovi (RRRR-MM-DD), od něj běží záruka */
    zarukaMesicu: 24,
    prirazeno: null,          /* { id, jmeno, barva } zodpovědného uživatele */
    ukoly: [],                /* [{ id, text, komu, termin, hotovo, vytvoreno }] */
    pohoda: { zalozeno: false },
    udalosti: []
  };
  pridejUdalost(z, 'vznik',
    z.zdroj === 'web' ? 'Zakázka přijata z webu.' :
    z.zdroj === 'obchod' ? `Zakázka vznikla z vyhraného obchodu ${z.vazba}.` : 'Zakázka založena ručně.', vstup.kdo);
  uloz(z);
  return z;
}

/* Povolené úpravy z administrace. Vrací upravenou zakázku, nebo vyhodí chybu. */
function uprav(id, zmeny, kdo) {
  const z = nacti(id);
  if (!z) throw new Error('Zakázka nenalezena');
  z.ukoly = z.ukoly || [];

  if (zmeny.stav && zmeny.stav !== z.stav) {
    if (!vsechnyStavy(z.typ).includes(zmeny.stav)) throw new Error('Neznámý stav: ' + zmeny.stav);
    const nazvy = Object.fromEntries([...PIPELINE[z.typ], ...KONECNE].map(s => [s.id, s.nazev]));
    pridejUdalost(z, 'stav', `Stav změněn: ${nazvy[z.stav] || z.stav} → ${nazvy[zmeny.stav]}`, kdo);
    z.stav = zmeny.stav;
    /* Předání zákazníkovi: datum se zapíše samo při prvním dosažení
       doručeného stavu a od něj běží záruka. Jde kdykoli ručně upravit. */
    if (z.typ === 'b2c' && ['dorucena', 'fakturovana'].includes(z.stav) && !z.dorucenoDne) {
      z.dorucenoDne = new Date().toISOString().slice(0, 10);
      pridejUdalost(z, 'zaruka', `Zapsáno datum předání ${z.dorucenoDne}, záruka ${z.zarukaMesicu || 24} měsíců.`, kdo);
    }
    /* Vyhraný obchod: automaticky se založí zakázka s položkami i kontakty
       a obě strany se provážou. Založí se jen jednou. */
    if (z.typ === 'b2b' && z.stav === 'vyhrano' && !z.zakazkaZVyhry) {
      const nova = vytvor({
        typ: 'b2c',
        zdroj: 'obchod',
        nazev: z.nazev,
        vazba: String(z.id),
        zakaznik: { ...z.zakaznik },
        polozky: z.polozky,
        celkemKc: z.celkemKc || z.hodnotaKc,
        kdo
      });
      if (z.prirazeno) {
        nova.prirazeno = { ...z.prirazeno };
        pridejUdalost(nova, 'prirazeni', `Zakázku převzal(a): ${nova.prirazeno.jmeno} (z obchodu).`, kdo);
        uloz(nova);
      }
      z.zakazkaZVyhry = nova.id;
      if (!z.vazba) z.vazba = String(nova.id);
      pridejUdalost(z, 'vyhrano', `Obchod vyhrán, automaticky založena zakázka ${nova.id}.`, kdo);
    }
  }
  if (zmeny.nazev != null) z.nazev = ocisti(zmeny.nazev, 200) || z.nazev;
  if (zmeny.vazba != null) z.vazba = ocisti(zmeny.vazba, 30);
  if (zmeny.dorucenoDne != null) z.dorucenoDne = /^\d{4}-\d{2}-\d{2}$/.test(zmeny.dorucenoDne) ? zmeny.dorucenoDne : '';
  if (zmeny.zarukaMesicu != null) z.zarukaMesicu = Math.max(0, Math.min(120, Math.round(+zmeny.zarukaMesicu || 0))) || 24;
  if (zmeny.hodnotaKc != null) z.hodnotaKc = Math.max(0, Math.round(+zmeny.hodnotaKc || 0));
  if (zmeny.zakaznik && typeof zmeny.zakaznik === 'object') {
    for (const pole of ['jmeno', 'firma', 'telefon', 'email', 'adresa', 'ic', 'dic']) {
      if (zmeny.zakaznik[pole] != null) z.zakaznik[pole] = ocisti(zmeny.zakaznik[pole], pole === 'adresa' ? 300 : 160);
    }
  }
  if (Array.isArray(zmeny.polozky)) {
    z.polozky = zmeny.polozky.slice(0, 50).map(p => ({
      nazev: ocisti(p.nazev, 160),
      pocet: Math.max(1, Math.min(999, Math.round(+p.pocet || 1))),
      cenaKc: Math.max(0, Math.min(10000000, Math.round(+p.cenaKc || 0)))
    })).filter(p => p.nazev);
    z.celkemKc = z.polozky.reduce((s, p) => s + p.pocet * p.cenaKc, 0);
  }
  if (zmeny.vyroba && typeof zmeny.vyroba === 'object') {
    const rezim = ['vyroba', 'sklad', ''].includes(zmeny.vyroba.rezim) ? zmeny.vyroba.rezim : z.vyroba.rezim;
    if (rezim !== z.vyroba.rezim) {
      pridejUdalost(z, 'vyroba', rezim === 'sklad' ? 'Zakázka půjde ze skladu.' : (rezim === 'vyroba' ? 'Zakázka zadána do výroby.' : 'Režim výroby zrušen.'), kdo);
      z.vyroba.rezim = rezim;
    }
    if (zmeny.vyroba.termin != null) z.vyroba.termin = ocisti(zmeny.vyroba.termin, 40);
  }
  if (zmeny.prirazeno !== undefined) {
    const nove = zmeny.prirazeno
      ? { id: +zmeny.prirazeno.id, jmeno: ocisti(zmeny.prirazeno.jmeno, 120), barva: ocisti(zmeny.prirazeno.barva, 20) }
      : null;
    const puvodni = z.prirazeno ? z.prirazeno.id : null;
    if ((nove ? nove.id : null) !== puvodni) {
      pridejUdalost(z, 'prirazeni', nove ? `Zakázku převzal(a): ${nove.jmeno}` : 'Zakázka je bez zodpovědné osoby.', kdo);
      z.prirazeno = nove;
    }
  }
  if (zmeny.ukolPridat && zmeny.ukolPridat.text) {
    const ukol = {
      id: Date.now() + Math.floor(Math.random() * 1000),
      text: ocisti(zmeny.ukolPridat.text, 300),
      komu: zmeny.ukolPridat.komu
        ? { id: +zmeny.ukolPridat.komu.id, jmeno: ocisti(zmeny.ukolPridat.komu.jmeno, 120), barva: ocisti(zmeny.ukolPridat.komu.barva, 20) }
        : null,
      termin: ocisti(zmeny.ukolPridat.termin, 40),
      hotovo: false,
      vytvoreno: new Date().toISOString()
    };
    z.ukoly.push(ukol);
    pridejUdalost(z, 'ukol', `Nový úkol: ${ukol.text}` + (ukol.komu ? ` (${ukol.komu.jmeno})` : ''), kdo);
  }
  if (zmeny.ukolHotovo) {
    const ukol = z.ukoly.find(u => u.id === +zmeny.ukolHotovo.id);
    if (ukol) {
      ukol.hotovo = !!zmeny.ukolHotovo.hotovo;
      pridejUdalost(z, 'ukol', (ukol.hotovo ? 'Úkol splněn: ' : 'Úkol vrácen k dořešení: ') + ukol.text, kdo);
    }
  }
  if (zmeny.ukolSmazat) {
    const ukol = z.ukoly.find(u => u.id === +zmeny.ukolSmazat);
    if (ukol) {
      z.ukoly = z.ukoly.filter(u => u.id !== ukol.id);
      pridejUdalost(z, 'ukol', 'Úkol odstraněn: ' + ukol.text, kdo);
    }
  }
  if (zmeny.poznamka) {
    pridejUdalost(z, 'poznamka', zmeny.poznamka, kdo);
  }
  uloz(z);
  return z;
}

/* ---------- Napojení na objednávky z webu ---------- */
/* Z webové objednávky (formát ulozeni.js) vytvoří zakázku se stejným číslem. */
function zWebu(o) {
  if (nacti(o.cislo)) return nacti(o.cislo);
  const polozky = [
    { nazev: `Postel evobeds One, ${o.konfigurace.material}, ${o.konfigurace.barva}`, pocet: 1, cenaKc: o.konfigurace.zakladKc },
    ...(o.konfigurace.matraceKc > 0 ? [{ nazev: o.konfigurace.matrace, pocet: 1, cenaKc: o.konfigurace.matraceKc }] : []),
    ...o.konfigurace.doplnky.map(d => ({ nazev: d.nazev, pocet: 1, cenaKc: d.cena }))
  ];
  return vytvor({
    id: o.cislo,
    typ: 'b2c',
    zdroj: 'web',
    nazev: `Objednávka z webu, ${o.zakaznik.jmeno}`,
    zakaznik: {
      jmeno: o.zakaznik.jmeno,
      firma: o.zakaznik.firma,
      telefon: o.zakaznik.telefon,
      email: o.zakaznik.email,
      adresa: `${o.zakaznik.ulice}, ${o.zakaznik.psc} ${o.zakaznik.mesto}`,
      ic: o.zakaznik.ic,
      dic: o.zakaznik.dic
    },
    polozky,
    celkemKc: o.celkemKc
  });
}

/* Zápis událostí platby k zakázce z webu (volá se z platebních cest). */
function udalostPlatby(cislo, typ, text) {
  const z = nacti(cislo);
  if (!z) return;
  if (typ === 'zaplaceno' && z.stav === 'prijata') {
    pridejUdalost(z, 'stav', 'Stav změněn: Přijatá → Zaplacená (platba na bráně).');
    z.stav = 'zaplacena';
  }
  pridejUdalost(z, 'platba', text);
  uloz(z);
}

/* ---------- Klienti ---------- */
/* Konec záruky: datum předání plus délka záruky (výchozí 24 měsíců). */
function zarukaDo(z) {
  if (!z.dorucenoDne) return null;
  const d = new Date(z.dorucenoDne + 'T12:00:00');
  if (isNaN(d)) return null;
  d.setMonth(d.getMonth() + (z.zarukaMesicu || 24));
  return d.toISOString().slice(0, 10);
}

/* Klienti se nevedou zvlášť, skládají se ze zakázek. Stejný klient se pozná
   podle IČ, jinak e-mailu, jinak telefonu, jinak jména; nic se nezadává dvakrát
   a přehled nikdy nemůže rozjet od skutečných zakázek. */
function klientKlic(zak) {
  const z = zak.zakaznik || {};
  if (z.ic) return 'ic:' + z.ic.replace(/\s/g, '');
  if (z.email) return 'em:' + z.email.toLowerCase();
  if (z.telefon) return 'tel:' + z.telefon.replace(/\D/g, '');
  const jmeno = (z.firma || z.jmeno || '').toLowerCase().trim();
  return jmeno ? 'jm:' + jmeno : 'zak:' + zak.id;
}

function klienti() {
  const zakazky = seznam();
  const mapa = new Map();
  const klicPodleCisla = new Map();   /* číslo zakázky → klíč klienta */

  const zarad = (klic, zak) => {
    let k = mapa.get(klic);
    if (!k) {
      k = { klic, typ: 'b2c', jmeno: '', firma: '', email: '', telefon: '', adresa: '', ic: '', dic: '',
            zakazky: [], celkemKc: 0, otevrenychReklamaci: 0, posledni: zak.vytvoreno };
      mapa.set(klic, k);
    }
    for (const pole of ['jmeno', 'firma', 'email', 'telefon', 'adresa', 'ic', 'dic']) {
      if (!k[pole] && zak.zakaznik && zak.zakaznik[pole]) k[pole] = zak.zakaznik[pole];
    }
    if (zak.typ === 'b2b') k.typ = 'b2b';
    k.zakazky.push({
      id: zak.id, typ: zak.typ, nazev: zak.nazev, stav: zak.stav, vytvoreno: zak.vytvoreno,
      castkaKc: (zak.typ === 'b2b' ? zak.hodnotaKc : zak.celkemKc) || 0,
      vazba: zak.vazba || '', dorucenoDne: zak.dorucenoDne || '',
      zarukaMesicu: zak.zarukaMesicu || 24, zarukaDo: zarukaDo(zak)
    });
    if (zak.typ !== 'reklamace' && !['storno', 'ztraceno'].includes(zak.stav) &&
        !(zak.typ === 'b2b' && zak.stav === 'vyhrano')) {
      k.celkemKc += (zak.typ === 'b2b' ? zak.hodnotaKc : zak.celkemKc) || 0;
    }
    if (zak.typ === 'reklamace' && !['vyrizena', 'zamitnuta', 'storno', 'ztraceno'].includes(zak.stav)) {
      k.otevrenychReklamaci++;
    }
    if (zak.vytvoreno > k.posledni) k.posledni = zak.vytvoreno;
    return k;
  };

  for (const zak of zakazky) {
    if (zak.typ === 'reklamace') continue;
    zarad(klientKlic(zak), zak);
    klicPodleCisla.set(String(zak.id), klientKlic(zak));
  }
  /* Reklamace patří ke klientovi související zakázky; bez vazby se přiřadí podle kontaktů. */
  for (const zak of zakazky) {
    if (zak.typ !== 'reklamace') continue;
    zarad((zak.vazba && klicPodleCisla.get(String(zak.vazba))) || klientKlic(zak), zak);
  }

  return [...mapa.values()].sort((a, b) => String(b.posledni).localeCompare(String(a.posledni)));
}

/* ---------- Vývoj v čase pro grafy na nástěnce ---------- */
/* Měsíční řady za posledních 12 měsíců: nové zakázky (počet, Kč, zdroje),
   vyhrané a ztracené obchody, doručené postele a přijaté reklamace.
   Okamžik výhry či prohry se bere z historie událostí. */
function vyvoj(mesicu) {
  mesicu = mesicu || 12;
  const zakazky = seznam();
  const ted = new Date();
  const mapa = new Map();
  for (let i = mesicu - 1; i >= 0; i--) {
    const d = new Date(ted.getFullYear(), ted.getMonth() - i, 15);
    const klic = d.toISOString().slice(0, 7);
    mapa.set(klic, { mesic: klic, zakazkyPocet: 0, zakazkyKc: 0, webPocet: 0, obchodPocet: 0, rucniPocet: 0,
                     vyhranoPocet: 0, vyhranoKc: 0, ztracenoPocet: 0, dorucenoPocet: 0, reklamacePocet: 0 });
  }
  const m = (iso) => String(iso || '').slice(0, 7);

  const zdroje = { web: 0, obchod: 0, rucni: 0 };
  let b2cKcCelkem = 0, b2cPocetCelkem = 0, vyhranoCelkem = 0, ztracenoCelkem = 0, dorucenoCelkem = 0, reklamaciCelkem = 0;

  for (const z of zakazky) {
    if (z.typ === 'b2c') {
      if (z.stav !== 'storno') {
        zdroje[z.zdroj] = (zdroje[z.zdroj] || 0) + 1;
        b2cKcCelkem += z.celkemKc || 0;
        b2cPocetCelkem++;
        const b = mapa.get(m(z.vytvoreno));
        if (b) {
          b.zakazkyPocet++;
          b.zakazkyKc += z.celkemKc || 0;
          if (z.zdroj === 'web') b.webPocet++;
          else if (z.zdroj === 'obchod') b.obchodPocet++;
          else b.rucniPocet++;
        }
      }
      if (z.dorucenoDne) {
        dorucenoCelkem++;
        const bd = mapa.get(m(z.dorucenoDne));
        if (bd) bd.dorucenoPocet++;
      }
    } else if (z.typ === 'b2b') {
      if (z.stav === 'vyhrano' || z.zakazkaZVyhry) {
        vyhranoCelkem++;
        const u = (z.udalosti || []).find(u => u.typ === 'vyhrano') ||
                  (z.udalosti || []).find(u => u.typ === 'stav' && /Vyhráno$/.test(u.text));
        const b = mapa.get(m(u ? u.kdy : z.vytvoreno));
        if (b) { b.vyhranoPocet++; b.vyhranoKc += z.hodnotaKc || 0; }
      } else if (z.stav === 'ztraceno') {
        ztracenoCelkem++;
        const u = [...(z.udalosti || [])].reverse().find(u => u.typ === 'stav' && /Ztraceno$/.test(u.text));
        const b = mapa.get(m(u ? u.kdy : z.vytvoreno));
        if (b) b.ztracenoPocet++;
      }
    } else if (z.typ === 'reklamace') {
      reklamaciCelkem++;
      const b = mapa.get(m(z.vytvoreno));
      if (b) b.reklamacePocet++;
    }
  }

  return {
    mesice: [...mapa.values()],
    zdroje,
    vyhranoCelkem,
    ztracenoCelkem,
    dorucenoCelkem,
    reklamaciCelkem,
    prumernaZakazkaKc: b2cPocetCelkem ? Math.round(b2cKcCelkem / b2cPocetCelkem) : 0
  };
}

/* ---------- Souhrn pro nástěnku ---------- */
function statistiky() {
  const zakazky = seznam();
  const out = { b2c: {}, b2b: {}, reklamace: {}, celkemKc: { b2c: 0, b2b: 0 }, posledni: [] };
  for (const typ of ['b2c', 'b2b', 'reklamace']) {
    for (const s of [...PIPELINE[typ], ...KONECNE]) out[typ][s.id] = 0;
  }
  for (const z of zakazky) {
    if (out[z.typ][z.stav] != null) out[z.typ][z.stav]++;
    /* Vyhraný obchod se do peněz nepočítá, jeho hodnotu už nese založená zakázka. */
    if (z.typ !== 'reklamace' && !['storno', 'ztraceno'].includes(z.stav) &&
        !(z.typ === 'b2b' && z.stav === 'vyhrano')) {
      out.celkemKc[z.typ] += (z.typ === 'b2b' ? z.hodnotaKc : z.celkemKc) || 0;
    }
  }
  out.posledni = zakazky.slice(0, 8).map(z => ({ id: z.id, nazev: z.nazev, typ: z.typ, stav: z.stav }));
  /* Souhrn podle lidí: kolik zakázek a otevřených úkolů kdo vede. */
  const lide = {};
  for (const z of zakazky) {
    if (['storno', 'ztraceno', 'zamitnuta', 'fakturovana', 'vyhrano', 'dorucena', 'vyrizena'].includes(z.stav)) continue;
    if (z.prirazeno) {
      const l = lide[z.prirazeno.id] = lide[z.prirazeno.id] || { jmeno: z.prirazeno.jmeno, barva: z.prirazeno.barva, zakazek: 0, ukolu: 0 };
      l.zakazek++;
    }
    for (const u of (z.ukoly || [])) {
      if (u.hotovo || !u.komu) continue;
      const l = lide[u.komu.id] = lide[u.komu.id] || { jmeno: u.komu.jmeno, barva: u.komu.barva, zakazek: 0, ukolu: 0 };
      l.ukolu++;
    }
  }
  out.lide = lide;
  return out;
}

module.exports = { PIPELINE, KONECNE, vytvor, uprav, nacti, seznam, zWebu, udalostPlatby, statistiky, vyvoj, klienti, zarukaDo, uloz, pridejUdalost };
