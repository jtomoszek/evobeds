# Web evobeds

## Lokální spuštění frontendu

Obě jazykové mutace spustí jediný příkaz:

```bash
node dev-server.js
```

- čeština: http://127.0.0.1:8000/
- angličtina: http://127.0.0.1:8001/

Server používá české HTML z kořene projektu a anglické HTML ze složky `en`.
Obě mutace sdílejí složky `assets`, `css` a `js`. Produkční odkazy mezi
doménami při lokálním načtení automaticky přepíše na odpovídající port.

Lokální `backend/.env` musí povolit oba zdroje:

```env
FRONTEND_PUVODY=http://127.0.0.1:8000,http://localhost:8000,http://127.0.0.1:8001,http://localhost:8001
```

## Produkční domény

Příklad konfigurace je v `deploy/nginx-frontend.conf.example`. Obě domény
mohou používat stejný checkout v `/var/www/evobeds`:

- `evobeds.cz` servíruje české stránky z kořene,
- `evobeds.com` servíruje anglické stránky ze složky `en`, ale v URL se
  složka `en` nezobrazuje,
- statické soubory z `assets`, `css` a `js` jsou sdílené.

Produkční `backend/.env` musí obsahovat všechny čtyři HTTPS varianty:

```env
FRONTEND_PUVODY=https://evobeds.cz,https://www.evobeds.cz,https://evobeds.com,https://www.evobeds.com
```

Backend může dál běžet samostatně na `objednavky.evobeds.cz`.
