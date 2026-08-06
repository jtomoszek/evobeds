# Backend e-shopu evobeds

Serverová část, která propojuje objednávkový formulář webu s platební bránou
GP webpay a účetnictvím Pohoda (mServer). Po zaplacení rozesílá potvrzovací
e-maily zákazníkovi i obchodu.

## Jak to funguje

1. Zákazník na webu vyplní objednávku a klikne na Objednat a zaplatit.
2. Web pošle objednávku na `POST /api/objednavka`. Backend cenu přepočítá
   ze svého ceníku (ceně z prohlížeče nevěří), objednávku uloží a vrátí
   adresu platební brány.
3. Zákazník zaplatí na stránkách GP webpay a brána ho vrátí na
   `GET /api/platba/navrat`. Backend ověří podpis brány.
4. Po úspěšné platbě backend odešle e-maily (zákazník + obchod) a založí
   přijatou objednávku do Pohody přes mServer. Když některý krok selže,
   zaznamená se to k objednávce a lze jej spustit znovu.
5. Zákazník je přesměrován zpět na web s výsledkem platby.

Objednávky se ukládají jako JSON soubory ve složce `data/objednavky/`.

## Zprovoznění na VPS

```bash
cd backend
npm install
cp .env.example .env   # a doplnit hodnoty
mkdir keys             # sem patří klíče GP webpay
node server.js         # zkušební spuštění
```

Pro trvalý běh použijte systemd nebo pm2 (`pm2 start server.js --name evobeds`).
Před backend postavte nginx s HTTPS (Let's Encrypt) a nasměrujte na něj
subdoménu, například `objednavky.evobeds.cz`:

```
server {
    server_name objednavky.evobeds.cz;
    location / { proxy_pass http://127.0.0.1:3400; proxy_set_header Host $host; }
}
```

Nakonec na webu v `objednavka.html` vyplňte
`var BACKEND_URL = 'https://objednavky.evobeds.cz';`. Dokud je prázdný,
formulář jede postaru (e-mailem) a nic se nerozbije.

## GP webpay: co zařídit

1. V portálu GP webpay (https://portal.gpwebpay.com) vygenerujte privátní
   klíč obchodníka, nastavte mu heslo a nahrajte veřejnou část do portálu.
   Privátní klíč uložte na server do `backend/keys/gpwebpay-privatni.pem`.
2. Z portálu stáhněte podpisový certifikát brány (`gpe.signing_prod.pem`,
   pro testovací prostředí `gpe.signing_test.pem`) do `backend/keys/`.
3. Do `.env` doplňte číslo obchodníka (merchant number) a heslo klíče.
4. V portálu nastavte návratovou adresu na
   `https://objednavky.evobeds.cz/api/platba/navrat`.
5. Nejdřív vše vyzkoušejte proti testovacímu prostředí
   (`GPW_BRANA_URL=https://test.3dsecure.gpwebpay.com/pgw/order.do`,
   testovací karty jsou v dokumentaci GP webpay), pak přepněte na produkci.

Poznámka: přesné pořadí polí pro podpis požadavku je dané dokumentací
GP webpay HTTP API. Tento backend posílá záměrně jen základní sadu polí
(MERCHANTNUMBER, OPERATION, ORDERNUMBER, AMOUNT, CURRENCY, DEPOSITFLAG,
URL, MD), se kterou je podpis jednoznačný. Při prvním testu na testovací
bráně se případná odchylka projeví okamžitě chybou digestu.

## Pohoda mServer: co zařídit s IT

1. Na serveru s Pohodou spusťte mServer: Pohoda → Nastavení → mServer,
   založit nový, zvolit port (např. 4444) a spustit. Ideálně nastavit
   automatický start jako služba Windows.
2. V Pohodě založte uživatele pro e-shop s právem XML importu do agendy
   Přijaté objednávky. Jeho jméno a heslo patří do `.env`.
3. Síťové propojení VPS ↔ server s Pohodou. mServer nikdy nevystavujte
   přímo do internetu. Doporučené možnosti:
   - WireGuard/OpenVPN mezi VPS a firemním serverem (nejčistší),
   - trvalý SSH tunel z firemního serveru na VPS
     (`ssh -N -R 4444:127.0.0.1:4444 uzivatel@vps`), pak je v `.env`
     `POHODA_MSERVER_URL=http://127.0.0.1:4444`.
4. Sazbu DPH položek potvrďte s účetní (`POHODA_SAZBA_DPH`: `high` = 21 %,
   `low` = 12 %). Polohovací postele jako zdravotnický prostředek mohou
   spadat do snížené sazby.

Když mServer zrovna neběží, objednávka se neztratí: zůstane uložená
s příznakem chyby a lze ji doslat ručně:

```bash
curl -X POST -H "X-Admin-Token: VAS_TOKEN" \
  https://objednavky.evobeds.cz/api/pohoda/znovu/CISLO_OBJEDNAVKY
```

## E-maily

Do `.env` patří SMTP údaje schránky, ze které se posílají potvrzení
(např. info@evobeds.com u vašeho poskytovatele pošty). Obchodní kopie
chodí na `EMAIL_OBCHOD` (výchozí info@evobeds.com).

## Kontrolní seznam před spuštěním

- [ ] `GET /api/zdravi` vrací `{"ok":true}` přes HTTPS
- [ ] Testovací platba na testovací bráně projde a vrátí se na web s `platba=ok`
- [ ] Objednávka se objeví v Pohodě v Přijatých objednávkách
- [ ] Přišly oba e-maily (zákazník i obchod)
- [ ] Neúspěšná platba vrátí `platba=chyba` a jde zopakovat
- [ ] `GPW_BRANA_URL` přepnuto na produkci
- [ ] Na webu vyplněno `BACKEND_URL`
