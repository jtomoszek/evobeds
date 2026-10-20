/* Generátor produktových feedů evobeds.
   Zdroj dat: tools/produkty.json. Výstupy ve složce feed/:
     - google.xml   (Google Merchant Center, formát RSS 2.0 s g: atributy)
     - heureka.xml  (Heureka.cz)
     - zbozi.xml    (Zboží.cz)
   Spuštění: node tools/generuj-feedy.mjs
   Po změně domény stačí upravit konstantu WEB a feedy přegenerovat. */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/* Základní adresa webu. Po nasazení na vlastní doménu změňte např. na 'https://www.evobeds.cz'. */
const WEB = 'https://jtomoszek.github.io/evobeds';
const MENA = 'CZK';
const ZNACKA = 'evobeds';

const koren = join(dirname(fileURLToPath(import.meta.url)), '..');
const { produkty } = JSON.parse(readFileSync(join(koren, 'tools', 'produkty.json'), 'utf8'));

const unik = (s) => String(s)
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&apos;');
const adresa = (cesta) => WEB + '/' + cesta;

/* ---------- Google Merchant Center ---------- */
const googlePolozky = produkty.map((p) => `    <item>
      <g:id>${unik(p.id)}</g:id>
      <g:title>${unik(p.nazev)}</g:title>
      <g:description>${unik(p.popis)}</g:description>
      <g:link>${unik(adresa(p.url))}</g:link>
      <g:image_link>${unik(adresa(p.obrazek))}</g:image_link>
      <g:availability>in_stock</g:availability>
      <g:price>${p.cenaKc}.00 ${MENA}</g:price>
      <g:condition>new</g:condition>
      <g:brand>${unik(ZNACKA)}</g:brand>
      <g:identifier_exists>no</g:identifier_exists>
${p.kategorieGoogle ? `      <g:google_product_category>${p.kategorieGoogle}</g:google_product_category>\n` : ''}      <g:product_type>${unik(p.typProduktu)}</g:product_type>
    </item>`).join('\n');

const google = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
  <channel>
    <title>evobeds</title>
    <link>${unik(WEB)}/</link>
    <description>Chytré elektrické polohovací postele evobeds a příslušenství. Česká výroba.</description>
${googlePolozky}
  </channel>
</rss>
`;

/* ---------- Heureka.cz ---------- */
const heurekaPolozky = produkty.map((p) => `  <SHOPITEM>
    <ITEM_ID>${unik(p.id)}</ITEM_ID>
    <PRODUCTNAME>${unik(p.nazev)}</PRODUCTNAME>
    <DESCRIPTION>${unik(p.popis)}</DESCRIPTION>
    <URL>${unik(adresa(p.url))}</URL>
    <IMGURL>${unik(adresa(p.obrazek))}</IMGURL>
    <PRICE_VAT>${p.cenaKc}</PRICE_VAT>
    <MANUFACTURER>${unik(ZNACKA)}</MANUFACTURER>
    <CATEGORYTEXT>${unik(p.kategorieHeureka)}</CATEGORYTEXT>
    <DELIVERY_DATE>${p.dodaniDni}</DELIVERY_DATE>
  </SHOPITEM>`).join('\n');

const heureka = `<?xml version="1.0" encoding="UTF-8"?>
<SHOP>
${heurekaPolozky}
</SHOP>
`;

/* ---------- Zboží.cz ---------- */
const zboziPolozky = produkty.map((p) => `  <SHOPITEM>
    <ITEM_ID>${unik(p.id)}</ITEM_ID>
    <PRODUCTNAME>${unik(p.nazev)}</PRODUCTNAME>
    <DESCRIPTION>${unik(p.popis)}</DESCRIPTION>
    <URL>${unik(adresa(p.url))}</URL>
    <IMGURL>${unik(adresa(p.obrazek))}</IMGURL>
    <PRICE_VAT>${p.cenaKc}</PRICE_VAT>
    <MANUFACTURER>${unik(ZNACKA)}</MANUFACTURER>
    <CATEGORYTEXT>${unik(p.typProduktu)}</CATEGORYTEXT>
    <DELIVERY_DATE>${p.dodaniDni}</DELIVERY_DATE>
  </SHOPITEM>`).join('\n');

const zbozi = `<?xml version="1.0" encoding="UTF-8"?>
<SHOP xmlns="http://www.zbozi.cz/ns/offer/1.0">
${zboziPolozky}
</SHOP>
`;

mkdirSync(join(koren, 'feed'), { recursive: true });
writeFileSync(join(koren, 'feed', 'google.xml'), google);
writeFileSync(join(koren, 'feed', 'heureka.xml'), heureka);
writeFileSync(join(koren, 'feed', 'zbozi.xml'), zbozi);
console.log(`Hotovo: ${produkty.length} produktů -> feed/google.xml, feed/heureka.xml, feed/zbozi.xml (základ ${WEB})`);
