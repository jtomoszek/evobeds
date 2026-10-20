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
  const pocet = Math.max(1, Math.round(+k.pocet || 1));
  const krat = pocet > 1 ? `${pocet}× ` : '';
  const r = [
    `Objednávka č. ${o.cislo}`,
    '',
    'KONFIGURACE'
  ];
  if (k.zakladKc > 0) r.push(`${krat}Postel evobeds One, ${k.material}, ${k.barva}: ${fmt(k.zakladKc * pocet)}`);
  if (k.zakladKc > 0 || k.matraceKc) r.push(`${krat}Matrace: ${k.matrace}${k.matraceKc ? ' (+ ' + fmt(k.matraceKc * pocet) + ')' : ''}`);
  for (const d of k.doplnky) r.push(`${krat}Příslušenství: ${d.nazev} (+ ${fmt(d.cena * pocet)})`);
  r.push(`CELKEM: ${fmt(o.celkemKc)} včetně DPH${k.zakladKc > 0 ? ', doprava a montáž v ceně' : ''}`);
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

/* Zpráva z veřejných kontaktních a newsletterových formulářů. */
async function posliFormular(f) {
  const predmety = {
    newsletter: 'Nové přihlášení k newsletteru',
    kontakt: 'Nová zpráva z kontaktního formuláře',
    prezentace: 'Nová poptávka po prezentaci',
    cenik: 'Nová žádost o B2B ceník'
  };
  const popisky = {
    jmeno: 'Jméno',
    organizace: 'Organizace',
    telefon: 'Telefon',
    email: 'E-mail',
    tema: 'Téma',
    zprava: 'Zpráva'
  };
  const text = [
    predmety[f.typ],
    '',
    `Jazyk formuláře: ${f.jazyk === 'en' ? 'angličtina' : 'čeština'}`,
    `Stránka: ${f.stranka}`,
    ''
  ];
  for (const klic of Object.keys(popisky)) {
    if (f.udaje[klic]) text.push(`${popisky[klic]}: ${f.udaje[klic]}`);
  }

  const zprava = {
    from: `"evobeds web" <${process.env.SMTP_ODESILATEL || process.env.SMTP_UZIVATEL}>`,
    to: process.env.EMAIL_OBCHOD || 'info@evobeds.com',
    subject: predmety[f.typ],
    text: text.join('\n')
  };
  if (f.udaje.email) zprava.replyTo = f.udaje.email;
  await transport().sendMail(zprava);
}

module.exports = { posliPotvrzeni, posliPotvrzeniPrijeti, posliFormular };
