/* Uložení objednávek: jeden JSON soubor na objednávku ve složce data/objednavky.
   Záměrně bez databáze, objem objednávek je malý a soubory jdou snadno
   zálohovat i ručně prohlížet. */

'use strict';

const fs = require('fs');
const path = require('path');

const SLOZKA = path.join(__dirname, '..', 'data', 'objednavky');

function cesta(cislo) {
  /* Číslo objednávky je vždy jen číslice, brání průchodu jinam v souborovém systému. */
  if (!/^\d+$/.test(String(cislo))) throw new Error('Neplatné číslo objednávky');
  return path.join(SLOZKA, cislo + '.json');
}

function uloz(objednavka) {
  fs.mkdirSync(SLOZKA, { recursive: true });
  fs.writeFileSync(cesta(objednavka.cislo), JSON.stringify(objednavka, null, 2));
}

function nacti(cislo) {
  try {
    return JSON.parse(fs.readFileSync(cesta(cislo), 'utf8'));
  } catch {
    return null;
  }
}

module.exports = { uloz, nacti };
