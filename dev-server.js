/* Lokální náhled obou jazykových mutací:
   http://127.0.0.1:8000/ — čeština
   http://127.0.0.1:8001/ — angličtina */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const KOREN = __dirname;
const HOST = '127.0.0.1';
const SDILENE_SLOZKY = new Set(['assets', 'css', 'js']);
const MIME = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mp4': 'video/mp4',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp'
};

function cestaPozadavku(req) {
  try {
    return decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch (_) {
    return null;
  }
}

function souborPro(urlCesta, jazyk) {
  let relativni = urlCesta === '/' ? 'index.html' : urlCesta.replace(/^\/+/, '');
  if (relativni.endsWith('/')) relativni += 'index.html';

  if (jazyk === 'en') {
    const prvniSlozka = relativni.split('/')[0];
    if (!SDILENE_SLOZKY.has(prvniSlozka)) relativni = path.join('en', relativni);
  }

  const absolutni = path.resolve(KOREN, relativni);
  return absolutni === KOREN || absolutni.startsWith(KOREN + path.sep) ? absolutni : null;
}

function upravLokalniOdkazy(obsah) {
  return obsah
    .split('https://evobeds.cz/').join('http://127.0.0.1:8000/')
    .split('https://evobeds.com/').join('http://127.0.0.1:8001/');
}

function server(jazyk, port) {
  return http.createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' });
      return res.end();
    }

    const urlCesta = cestaPozadavku(req);
    if (urlCesta === '/en' || urlCesta.startsWith('/en/')) {
      const cil = urlCesta === '/en' ? '/' : urlCesta.slice(3);
      res.writeHead(302, { Location: `http://${HOST}:8001${cil}` });
      return res.end();
    }

    const soubor = urlCesta && souborPro(urlCesta, jazyk);
    if (!soubor) {
      res.writeHead(400);
      return res.end('Neplatná cesta.');
    }

    fs.readFile(soubor, (chyba, data) => {
      if (chyba) {
        res.writeHead(chyba.code === 'ENOENT' ? 404 : 500, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end(chyba.code === 'ENOENT' ? 'Stránka nebyla nalezena.' : 'Soubor se nepodařilo načíst.');
      }

      const pripona = path.extname(soubor).toLowerCase();
      if (pripona === '.html') data = Buffer.from(upravLokalniOdkazy(data.toString('utf8')));
      res.writeHead(200, {
        'Content-Type': MIME[pripona] || 'application/octet-stream',
        'Content-Length': data.length,
        'Cache-Control': 'no-store'
      });
      if (req.method === 'HEAD') return res.end();
      res.end(data);
    });
  }).listen(port, HOST, () => {
    console.log(`${jazyk === 'cs' ? 'Čeština' : 'Angličtina'}: http://${HOST}:${port}/`);
  });
}

const servery = [server('cs', 8000), server('en', 8001)];

function ukonci() {
  servery.forEach(s => s.close());
}

process.on('SIGINT', ukonci);
process.on('SIGTERM', ukonci);
