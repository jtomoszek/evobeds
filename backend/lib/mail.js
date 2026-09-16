/* Potvrzovací e-maily k objednávce: zákazníkovi i obchodu. */

'use strict';

const nodemailer = require('nodemailer');

function transport() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: +(process.env.SMTP_PORT || 465),
    secure: (process.env.SMTP_PORT || '465') === '465',
    auth: { user: process.env.SMTP_UZIVATEL, pass: process.env.SMTP_HESLO }
  });
}

/* Bezplatný Mailtrap Sandbox přijme jen jeden e-mail za 10 sekund.
   Prodleva se proto použije pouze při lokálním testování přes jeho SMTP host. */
async function mailtrapProdleva() {
  if (process.env.SMTP_HOST === 'sandbox.smtp.mailtrap.io') {
    await new Promise(resolve => setTimeout(resolve, 11000));
  }
}

function fmt(n) { return n.toLocaleString('cs-CZ') + ' Kč'; }

function textSouhrnu(o, platbaProbehla) {
  const k = o.konfigurace;
  const z = o.zakaznik;
  const r = [
    `Objednávka č. ${o.cislo}`,
    '',
    'KONFIGURACE',
    `Postel evobeds One, ${k.material}, ${k.barva}: ${fmt(k.zakladKc)}`,
    `Matrace: ${k.matrace}${k.matraceKc ? ' (+ ' + fmt(k.matraceKc) + ')' : ''}`
  ];
  for (const d of k.doplnky) r.push(`Příslušenství: ${d.nazev} (+ ${fmt(d.cena)})`);
  r.push(`CELKEM: ${fmt(o.celkemKc)} včetně DPH, doprava a montáž v ceně`);
  r.push('', platbaProbehla
    ? 'Platba: zaplaceno online přes GP webpay'
    : 'Platba a doprava: podrobnosti s Vámi domluví obchodní oddělení');
  r.push('', 'ZÁKAZNÍK');
  r.push(`Jméno: ${z.jmeno}`, `Telefon: ${z.telefon}`, `E-mail: ${z.email}`);
  r.push('', 'DORUČENÍ', `${z.ulice}, ${z.mesto}, ${z.psc}`);
  if (z.patro) r.push(`Patro a výtah: ${z.patro}`);
  if (z.firma) r.push('', `FAKTURACE: ${z.firma}, IČ ${z.ic || 'neuvedeno'}, DIČ ${z.dic || 'neuvedeno'}`);
  if (z.fakturacniadresa) r.push(`Fakturační adresa: ${z.fakturacniadresa}`);
  if (z.poznamka) r.push('', `POZNÁMKA: ${z.poznamka}`);
  return r.join('\n');
}

/* Po přijetí objednávky bez online platby: obchodu samostatný e-mail
   s objednávkou a potom zákazníkovi potvrzení. Na dokončení obou se čeká. */
async function posliPotvrzeniPrijeti(o) {
  const t = transport();
  const souhrn = textSouhrnu(o, false);
  const odesilatel = `"evobeds" <${process.env.SMTP_ODESILATEL || process.env.SMTP_UZIVATEL}>`;

  await t.sendMail({
    from: odesilatel,
    to: process.env.EMAIL_OBCHOD || 'info@evobeds.com',
    replyTo: o.zakaznik.email,
    subject: `Nová objednávka č. ${o.cislo}, ${o.zakaznik.jmeno}`,
    text: souhrn
  });

  await mailtrapProdleva();

  await t.sendMail({
    from: odesilatel,
    to: o.zakaznik.email,
    subject: `Děkujeme za objednávku č. ${o.cislo}`,
    text:
`Dobrý den,

děkujeme za Vaši objednávku a potvrzujeme její přijetí. Naše obchodní oddělení se Vám ozve do dvou pracovních dnů telefonicky nebo e-mailem, potvrdí konfiguraci a domluví s Vámi způsob platby a dopravy.

${souhrn}

V případě dotazů volejte +420 773 030 533 (pracovní dny 8 až 16 hod).

evobeds s.r.o.`
  });
}

/* Po úspěšné platbě: obchodu kopie objednávky a zákazníkovi poděkování. */
async function posliPotvrzeni(o) {
  const t = transport();
  const souhrn = textSouhrnu(o, true);
  const odesilatel = `"evobeds" <${process.env.SMTP_ODESILATEL || process.env.SMTP_UZIVATEL}>`;

  await t.sendMail({
    from: odesilatel,
    to: process.env.EMAIL_OBCHOD || 'info@evobeds.com',
    replyTo: o.zakaznik.email,
    subject: `Nová zaplacená objednávka č. ${o.cislo}, ${o.zakaznik.jmeno}`,
    text: souhrn
  });

  await mailtrapProdleva();

  await t.sendMail({
    from: odesilatel,
    to: o.zakaznik.email,
    subject: `Děkujeme za objednávku č. ${o.cislo}, platba proběhla`,
    text:
`Dobrý den,

děkujeme za Vaši objednávku a potvrzujeme přijetí platby. Naše obchodní oddělení se Vám ozve do dvou pracovních dnů, potvrdí konfiguraci a domluví termín doručení.

${souhrn}

V případě dotazů volejte +420 773 030 533 (pracovní dny 8 až 16 hod).

evobeds s.r.o.`
  });
}

module.exports = { posliPotvrzeni, posliPotvrzeniPrijeti };
