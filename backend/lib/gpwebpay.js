/* GP webpay: vytvoření platby a ověření návratu z brány.
   Podpis požadavku: hodnoty parametrů v předepsaném pořadí spojené svislítkem,
   podepsané privátním klíčem obchodníka (RSA-SHA1, Base64).
   Ověření odpovědi: stejné spojení vrácených parametrů, podpis brány
   se ověřuje veřejným certifikátem GPE. */

'use strict';

const crypto = require('crypto');
const fs = require('fs');

/* Předepsané pořadí parametrů požadavku pro výpočet podpisu (DIGEST).
   Vychází z dokumentace GP webpay HTTP API; do podpisu vstupují jen
   parametry, které skutečně odesíláme, v tomto pořadí. LANG se nepodepisuje. */
const PORADI_POZADAVKU = [
  'MERCHANTNUMBER', 'OPERATION', 'ORDERNUMBER', 'AMOUNT', 'CURRENCY',
  'DEPOSITFLAG', 'MERORDERNUM', 'URL', 'DESCRIPTION', 'MD',
  'USERPARAM1', 'FASTPAYID', 'PAYMETHOD', 'DISABLEPAYMETHOD',
  'PAYMETHODS', 'EMAIL', 'REFERENCENUMBER', 'ADDINFO'
];

function nactiPrivatniKlic() {
  return {
    key: fs.readFileSync(process.env.GPW_PRIVATNI_KLIC, 'utf8'),
    passphrase: process.env.GPW_HESLO_KLICE || ''
  };
}

function podepis(text) {
  const s = crypto.createSign('RSA-SHA1');
  s.update(text, 'utf8');
  return s.sign(nactiPrivatniKlic(), 'base64');
}

function overPodpis(text, digest) {
  const v = crypto.createVerify('RSA-SHA1');
  v.update(text, 'utf8');
  return v.verify(fs.readFileSync(process.env.GPW_VEREJNY_CERT, 'utf8'), digest, 'base64');
}

/* Sestaví URL, na kterou se zákazník přesměruje k zaplacení.
   castkaKc je v korunách, brána chce nejmenší jednotky (haléře). */
function vytvorPlatbu(objednavka) {
  const parametry = new Map();
  parametry.set('MERCHANTNUMBER', process.env.GPW_CISLO_OBCHODNIKA);
  parametry.set('OPERATION', 'CREATE_ORDER');
  parametry.set('ORDERNUMBER', String(objednavka.cislo));
  parametry.set('AMOUNT', String(Math.round(objednavka.celkemKc * 100)));
  parametry.set('CURRENCY', '203');
  parametry.set('DEPOSITFLAG', '1');
  parametry.set('URL', process.env.BACKEND_URL.replace(/\/$/, '') + '/api/platba/navrat');
  parametry.set('MD', String(objednavka.cislo));

  const kPodpisu = PORADI_POZADAVKU
    .filter(k => parametry.has(k))
    .map(k => parametry.get(k))
    .join('|');
  parametry.set('DIGEST', podepis(kPodpisu));
  parametry.set('LANG', 'cz');

  const dotaz = [...parametry.entries()]
    .map(([k, v]) => k + '=' + encodeURIComponent(v))
    .join('&');
  return process.env.GPW_BRANA_URL + '?' + dotaz;
}

/* Ověří návrat z brány. surovyDotaz je query string přesně v pořadí,
   v jakém jej brána poslala; na pořadí polí podpis stojí. */
function overNavrat(surovyDotaz) {
  const pole = [];
  for (const cast of surovyDotaz.split('&')) {
    const i = cast.indexOf('=');
    pole.push([
      decodeURIComponent(cast.slice(0, i)),
      decodeURIComponent(cast.slice(i + 1).replace(/\+/g, ' '))
    ]);
  }
  const bezPodpisu = pole.filter(([k]) => k !== 'DIGEST' && k !== 'DIGEST1');
  const hodnoty = bezPodpisu.map(([, v]) => v).join('|');
  const data = Object.fromEntries(pole);

  const digestOk = data.DIGEST && overPodpis(hodnoty, data.DIGEST);
  const digest1Ok = data.DIGEST1 &&
    overPodpis(hodnoty + '|' + process.env.GPW_CISLO_OBCHODNIKA, data.DIGEST1);

  return {
    overeno: !!(digestOk && digest1Ok),
    zaplaceno: data.PRCODE === '0' && data.SRCODE === '0',
    cislo: data.ORDERNUMBER || data.MD || '',
    prcode: data.PRCODE,
    srcode: data.SRCODE,
    text: data.RESULTTEXT || ''
  };
}

module.exports = { vytvorPlatbu, overNavrat };
