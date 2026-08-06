/* Pohoda mServer: založení přijaté objednávky přes XML rozhraní.
   Backend pošle dataPack na mServer (HTTP POST), Pohoda objednávku
   založí do agendy Přijaté objednávky. Kódování Windows-1250 podle
   konvence Stormware. */

'use strict';

const iconv = require('iconv-lite');

function xmlEscape(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/* Jedna položka objednávky: text, množství, jednotková cena s DPH. */
function polozkaXml(text, cenaKc, sazba) {
  return `      <ord:orderItem>
        <ord:text>${xmlEscape(text)}</ord:text>
        <ord:quantity>1</ord:quantity>
        <ord:delivered>0</ord:delivered>
        <ord:rateVAT>${sazba}</ord:rateVAT>
        <ord:payVAT>true</ord:payVAT>
        <ord:homeCurrency>
          <typ:unitPrice>${cenaKc}</typ:unitPrice>
        </ord:homeCurrency>
      </ord:orderItem>`;
}

/* Sestaví dataPack s přijatou objednávkou z uložené objednávky e-shopu. */
function sestavXml(o) {
  const sazba = process.env.POHODA_SAZBA_DPH || 'high';
  const z = o.zakaznik;
  const dnes = new Date().toISOString().slice(0, 10);

  const polozky = [polozkaXml(
    `Postel evobeds One, ${o.konfigurace.material}, ${o.konfigurace.barva}`,
    o.konfigurace.zakladKc, sazba
  )];
  if (o.konfigurace.matraceKc > 0) {
    polozky.push(polozkaXml(`Matrace ${o.konfigurace.matrace}`, o.konfigurace.matraceKc, sazba));
  }
  for (const d of o.konfigurace.doplnky) {
    polozky.push(polozkaXml(d.nazev, d.cena, sazba));
  }

  const fakturace = z.firma
    ? `
          <typ:company>${xmlEscape(z.firma)}</typ:company>
          <typ:ico>${xmlEscape(z.ic || '')}</typ:ico>
          <typ:dic>${xmlEscape(z.dic || '')}</typ:dic>`
    : '';

  return `<?xml version="1.0" encoding="Windows-1250"?>
<dat:dataPack id="es${o.cislo}" ico="${xmlEscape(process.env.POHODA_ICO || '07754523')}" application="evobeds-eshop" version="2.0" note="Objednávka z e-shopu evobeds"
  xmlns:dat="http://www.stormware.cz/schema/version_2/data.xsd"
  xmlns:ord="http://www.stormware.cz/schema/version_2/order.xsd"
  xmlns:typ="http://www.stormware.cz/schema/version_2/type.xsd">
  <dat:dataPackItem id="es${o.cislo}-1" version="2.0">
    <ord:order version="2.0">
      <ord:orderHeader>
        <ord:orderType>receivedOrder</ord:orderType>
        <ord:numberOrder>${xmlEscape(String(o.cislo))}</ord:numberOrder>
        <ord:date>${dnes}</ord:date>
        <ord:text>Objednávka z e-shopu č. ${xmlEscape(String(o.cislo))}, zaplaceno online (GP webpay)</ord:text>
        <ord:partnerIdentity>
          <typ:address>
            <typ:name>${xmlEscape(z.jmeno)}</typ:name>${fakturace}
            <typ:street>${xmlEscape(z.ulice)}</typ:street>
            <typ:city>${xmlEscape(z.mesto)}</typ:city>
            <typ:zip>${xmlEscape(z.psc)}</typ:zip>
            <typ:phone>${xmlEscape(z.telefon)}</typ:phone>
            <typ:email>${xmlEscape(z.email)}</typ:email>
          </typ:address>
        </ord:partnerIdentity>
        <ord:note>${xmlEscape([z.poznamka, z.patro ? 'Patro a výtah: ' + z.patro : '', z.fakturacniadresa ? 'Fakturační adresa: ' + z.fakturacniadresa : ''].filter(Boolean).join(' | '))}</ord:note>
        <ord:intNote>Zaplaceno kartou přes GP webpay, e-shop evobeds.</ord:intNote>
      </ord:orderHeader>
      <ord:orderDetail>
${polozky.join('\n')}
      </ord:orderDetail>
    </ord:order>
  </dat:dataPackItem>
</dat:dataPack>`;
}

/* Odešle objednávku na mServer. Vrací {ok, odpoved}; při chybě vyhodí výjimku
   se srozumitelnou zprávou, volající ji zaloguje a označí objednávku k opakování. */
async function zalozObjednavku(o) {
  if (!process.env.POHODA_MSERVER_URL) {
    throw new Error('POHODA_MSERVER_URL není nastaveno, objednávku dosud nelze založit do Pohody.');
  }
  const telo = iconv.encode(sestavXml(o), 'win1250');
  const auth = Buffer.from(
    `${process.env.POHODA_UZIVATEL}:${process.env.POHODA_HESLO}`
  ).toString('base64');

  const odpoved = await fetch(process.env.POHODA_MSERVER_URL.replace(/\/$/, '') + '/xml', {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=Windows-1250',
      'STW-Authorization': 'Basic ' + auth,
      'Authorization': 'Basic ' + auth
    },
    body: telo,
    signal: AbortSignal.timeout(30000)
  });

  const surove = Buffer.from(await odpoved.arrayBuffer());
  const text = iconv.decode(surove, 'win1250');
  if (!odpoved.ok) {
    throw new Error(`mServer vrátil HTTP ${odpoved.status}: ${text.slice(0, 300)}`);
  }
  if (!/state="ok"/.test(text)) {
    throw new Error('Pohoda objednávku nepřijala: ' + text.slice(0, 500));
  }
  return { ok: true, odpoved: text };
}

module.exports = { zalozObjednavku, sestavXml };
