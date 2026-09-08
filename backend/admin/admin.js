/* Administrace evobeds: nástěnka, kanban zakázek (B2C i B2B),
   detail s historií, poznámkami, výrobou a založením do Pohody. */

'use strict';

(function () {
  const $ = (sel, kde) => (kde || document).querySelector(sel);
  const $$ = (sel, kde) => [...(kde || document).querySelectorAll(sel)];

  let token = localStorage.getItem('evobeds-admin-token') || '';
  let pipeline = null;   /* { pipeline: {b2c: [...], b2b: [...]}, konecne: [...] } */
  let pohled = 'nastenka';
  let hledani = '';
  let zakazky = [];

  /* ---------- API ---------- */
  async function api(cesta, moznosti) {
    const odpoved = await fetch(cesta, {
      ...moznosti,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token,
        ...(moznosti && moznosti.headers)
      }
    });
    if (odpoved.status === 401) { ukazPrihlaseni(); throw new Error('Přihlaste se prosím.'); }
    const data = await odpoved.json().catch(() => ({}));
    if (!odpoved.ok) throw new Error(data.chyba || ('Chyba serveru (' + odpoved.status + ')'));
    return data;
  }

  function oznam(text) {
    const el = document.createElement('div');
    el.className = 'oznameni';
    el.textContent = text;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2600);
  }

  const Kc = n => (n || 0).toLocaleString('cs-CZ') + ' Kč';
  const datum = iso => new Date(iso).toLocaleDateString('cs-CZ') + ' ' +
    new Date(iso).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' });

  function nazevStavu(typ, id) {
    const vse = [...pipeline.pipeline[typ], ...pipeline.konecne];
    const s = vse.find(x => x.id === id);
    return s ? s.nazev : id;
  }

  /* ---------- Přihlášení ---------- */
  function ukazPrihlaseni() {
    $('#prihlaseni').hidden = false;
    $('#aplikace').hidden = true;
  }

  async function start() {
    if (!token) return ukazPrihlaseni();
    try {
      pipeline = await api('/api/admin/pipeline');
      $('#prihlaseni').hidden = true;
      $('#aplikace').hidden = false;
      await prekresli();
    } catch {
      /* neplatný token, zůstane přihlašovací obrazovka */
    }
  }

  $('#login-form').addEventListener('submit', async (u) => {
    u.preventDefault();
    $('#login-chyba').hidden = true;
    try {
      const odpoved = await fetch('/api/admin/prihlaseni', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ heslo: $('#heslo').value })
      });
      const data = await odpoved.json();
      if (!odpoved.ok) throw new Error(data.chyba || 'Přihlášení se nepodařilo.');
      token = data.token;
      localStorage.setItem('evobeds-admin-token', token);
      $('#heslo').value = '';
      await start();
    } catch (e) {
      $('#login-chyba').textContent = e.message;
      $('#login-chyba').hidden = false;
    }
  });

  $('#odhlasit').addEventListener('click', () => {
    localStorage.removeItem('evobeds-admin-token');
    token = '';
    ukazPrihlaseni();
  });

  /* ---------- Přepínání pohledů ---------- */
  $$('.zalozky button').forEach(b => b.addEventListener('click', () => {
    pohled = b.dataset.pohled;
    $$('.zalozky button').forEach(x => x.classList.toggle('active', x === b));
    prekresli();
  }));

  let hledaniCasovac;
  $('#hledani').addEventListener('input', (u) => {
    clearTimeout(hledaniCasovac);
    hledaniCasovac = setTimeout(() => { hledani = u.target.value.trim(); prekresli(); }, 250);
  });

  async function prekresli() {
    if (pohled === 'nastenka') return kresliNastenku();
    return kresliKanban(pohled);
  }

  /* ---------- Nástěnka ---------- */
  async function kresliNastenku() {
    const [stat, seznamData] = await Promise.all([
      api('/api/admin/statistiky'),
      api('/api/admin/zakazky')
    ]);
    zakazky = seznamData.zakazky;
    const otevreneB2c = Object.entries(stat.b2c).filter(([id]) => !['dorucena', 'fakturovana', 'storno', 'ztraceno'].includes(id)).reduce((s, [, n]) => s + n, 0);
    const rozjednane = Object.entries(stat.b2b).filter(([id]) => ['potencial', 'jednani', 'nabidka'].includes(id)).reduce((s, [, n]) => s + n, 0);
    const veVyrobe = (stat.b2c.vyroba || 0) + (stat.b2b.vyroba || 0);

    $('#obsah').innerHTML = `
      <div class="dlazdice">
        <div class="karta"><div class="cislo">${otevreneB2c}</div><div class="popis">otevřené objednávky B2C</div></div>
        <div class="karta"><div class="cislo">${rozjednane}</div><div class="popis">rozjednané obchody B2B</div></div>
        <div class="karta"><div class="cislo">${veVyrobe}</div><div class="popis">zakázek ve výrobě</div></div>
        <div class="karta"><div class="cislo">${Kc(stat.celkemKc.b2c + stat.celkemKc.b2b)}</div><div class="popis">hodnota všech aktivních zakázek</div></div>
      </div>
      <div class="nastenka-sloupce">
        <div class="karta">
          <h3>Poslední zakázky</h3>
          ${stat.posledni.map(z => `
            <div class="mini-radek" data-id="${z.id}">
              <span>${utec(z.nazev)}</span>
              <span class="stitek">${nazevStavu(z.typ, z.stav)}</span>
            </div>`).join('') || '<p class="popis">Zatím žádné zakázky.</p>'}
        </div>
        <div class="karta">
          <h3>Pipeline B2B (hodnota)</h3>
          ${pipeline.pipeline.b2b.map(s => {
            const castka = zakazky.filter(z => z.typ === 'b2b' && z.stav === s.id)
              .reduce((sum, z) => sum + (z.hodnotaKc || 0), 0);
            return `<div class="mini-radek"><span>${s.nazev} (${stat.b2b[s.id] || 0})</span><span class="stitek">${Kc(castka)}</span></div>`;
          }).join('')}
        </div>
      </div>`;
    $$('.mini-radek[data-id]').forEach(r => r.addEventListener('click', () => otevriDetail(r.dataset.id)));
  }

  /* ---------- Kanban ---------- */
  async function kresliKanban(typ) {
    const params = new URLSearchParams({ typ });
    if (hledani) params.set('q', hledani);
    zakazky = (await api('/api/admin/zakazky?' + params)).zakazky;

    const sloupce = [...pipeline.pipeline[typ], ...pipeline.konecne.filter(s =>
      (typ === 'b2b' ? s.id === 'ztraceno' : s.id === 'storno'))];

    $('#obsah').innerHTML = `<div class="kanban">` + sloupce.map(s => {
      const veSloupci = zakazky.filter(z => z.stav === s.id);
      return `
        <div class="sloupec" data-stav="${s.id}">
          <h3><span>${s.nazev}</span><span>${veSloupci.length}</span></h3>
          ${veSloupci.map(kartaZakazky).join('')}
        </div>`;
    }).join('') + `</div>`;

    /* Otevření detailu */
    $$('.zakazka').forEach(k => k.addEventListener('click', () => otevriDetail(k.dataset.id)));

    /* Přetahování mezi sloupci */
    $$('.zakazka').forEach(k => {
      k.draggable = true;
      k.addEventListener('dragstart', (u) => u.dataTransfer.setData('text/plain', k.dataset.id));
    });
    $$('.sloupec').forEach(sl => {
      sl.addEventListener('dragover', (u) => { u.preventDefault(); sl.classList.add('pretahovani'); });
      sl.addEventListener('dragleave', () => sl.classList.remove('pretahovani'));
      sl.addEventListener('drop', async (u) => {
        u.preventDefault();
        sl.classList.remove('pretahovani');
        const id = u.dataTransfer.getData('text/plain');
        try {
          await api('/api/admin/zakazky/' + id, { method: 'PATCH', body: JSON.stringify({ stav: sl.dataset.stav }) });
          await prekresli();
        } catch (e) { oznam(e.message); }
      });
    });
  }

  function kartaZakazky(z) {
    const dni = Math.floor((Date.now() - new Date(z.vytvoreno)) / 86400000);
    return `
      <div class="zakazka" data-id="${z.id}">
        <div class="nazev">${utec(z.nazev)}</div>
        <div class="meta">
          <span>${utec(z.zakaznik.firma || z.zakaznik.jmeno || '')}</span>
          <span class="castka">${Kc(z.typ === 'b2b' ? z.hodnotaKc : z.celkemKc)}</span>
        </div>
        <div class="stitky">
          ${z.zdroj === 'web' ? '<span class="stitek-mini web">web</span>' : ''}
          ${z.vyroba.rezim === 'vyroba' ? '<span class="stitek-mini vyroba">výroba</span>' : ''}
          ${z.vyroba.rezim === 'sklad' ? '<span class="stitek-mini vyroba">sklad</span>' : ''}
          ${z.pohoda && z.pohoda.zalozeno ? '<span class="stitek-mini pohoda">pohoda</span>' : ''}
          <span class="stitek-mini">${dni === 0 ? 'dnes' : dni + ' d'}</span>
        </div>
      </div>`;
  }

  function utec(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  /* ---------- Detail zakázky ---------- */
  async function otevriDetail(id) {
    const { zakazka: z } = await api('/api/admin/zakazky/' + id);
    const vsechnyStavy = [...pipeline.pipeline[z.typ], ...pipeline.konecne];

    $('#detail').innerHTML = `
      <div class="detail-hlava">
        <h2>${utec(z.nazev)} <span style="color:var(--gray-400);font-weight:400">#${z.id}</span></h2>
        <button class="zavrit" aria-label="Zavřít">×</button>
      </div>
      <div class="detail-telo">
        <div class="sekce">
          <h3>Stav zakázky</h3>
          <select id="d-stav">
            ${vsechnyStavy.map(s => `<option value="${s.id}" ${s.id === z.stav ? 'selected' : ''}>${s.nazev}</option>`).join('')}
          </select>
          <div class="pole-rada">
            <label>Režim<select id="d-rezim">
              <option value="" ${!z.vyroba.rezim ? 'selected' : ''}>Nerozhodnuto</option>
              <option value="vyroba" ${z.vyroba.rezim === 'vyroba' ? 'selected' : ''}>Do výroby</option>
              <option value="sklad" ${z.vyroba.rezim === 'sklad' ? 'selected' : ''}>Ze skladu</option>
            </select></label>
            <label>Termín dodání<input id="d-termin" value="${utec(z.vyroba.termin)}" placeholder="např. 15. 10. 2026"></label>
          </div>
        </div>

        <div class="sekce">
          <h3>Zákazník</h3>
          <div class="pole-rada">
            <label>Firma<input id="d-firma" value="${utec(z.zakaznik.firma)}"></label>
            <label>Jméno<input id="d-jmeno" value="${utec(z.zakaznik.jmeno)}"></label>
          </div>
          <div class="pole-rada">
            <label>Telefon<input id="d-telefon" value="${utec(z.zakaznik.telefon)}"></label>
            <label>E-mail<input id="d-email" value="${utec(z.zakaznik.email)}"></label>
          </div>
          <label>Adresa<input id="d-adresa" value="${utec(z.zakaznik.adresa)}"></label>
          <div class="pole-rada">
            <label>IČ<input id="d-ic" value="${utec(z.zakaznik.ic)}"></label>
            <label>DIČ<input id="d-dic" value="${utec(z.zakaznik.dic)}"></label>
          </div>
        </div>

        <div class="sekce">
          <h3>Položky</h3>
          <div id="d-polozky">
            ${z.polozky.map(p => radekPolozky(p)).join('')}
          </div>
          <button class="btn btn-sm" id="d-pridat-polozku" type="button">+ Přidat položku</button>
          ${z.typ === 'b2b' ? `<label>Odhad hodnoty obchodu (Kč)<input id="d-hodnota" type="number" min="0" value="${z.hodnotaKc || 0}"></label>` : ''}
          <div class="souhrn-cena"><span>Celkem za položky</span><span id="d-celkem">${Kc(z.celkemKc)}</span></div>
        </div>

        <div class="detail-akce">
          <button class="btn btn-dark" id="d-ulozit">Uložit změny</button>
          <button class="btn" id="d-pohoda">${z.pohoda && z.pohoda.zalozeno ? 'Znovu do Pohody' : 'Založit do Pohody'}</button>
        </div>
        ${z.pohoda && z.pohoda.chyba ? `<p class="chyba">Pohoda: ${utec(z.pohoda.chyba)}</p>` : ''}

        <div class="sekce">
          <h3>Nová poznámka</h3>
          <textarea id="d-poznamka" rows="2" placeholder="Např. Volal ředitel, chtějí nabídku na 8 lůžek…"></textarea>
          <button class="btn btn-sm" id="d-poznamka-ulozit" type="button">Přidat poznámku</button>
        </div>

        <div class="sekce">
          <h3>Historie</h3>
          ${[...(z.udalosti || [])].reverse().map(u => `
            <div class="udalost"><span class="kdy">${datum(u.kdy)}</span><span>${utec(u.text)}</span></div>`).join('')}
        </div>
      </div>`;

    $('#detail').hidden = false;
    $('#detail-pozadi').hidden = false;

    const zavri = () => { $('#detail').hidden = true; $('#detail-pozadi').hidden = true; };
    $('#detail .zavrit').addEventListener('click', zavri);
    $('#detail-pozadi').onclick = zavri;

    $('#d-pridat-polozku').addEventListener('click', () => {
      $('#d-polozky').insertAdjacentHTML('beforeend', radekPolozky({ nazev: '', pocet: 1, cenaKc: 0 }));
      napojMazani();
    });
    napojMazani();

    function napojMazani() {
      $$('#d-polozky .polozka-radek button').forEach(b => b.onclick = () => b.closest('.polozka-radek').remove());
    }

    function sesbirej() {
      return {
        stav: $('#d-stav').value,
        vyroba: { rezim: $('#d-rezim').value, termin: $('#d-termin').value },
        zakaznik: {
          firma: $('#d-firma').value, jmeno: $('#d-jmeno').value,
          telefon: $('#d-telefon').value, email: $('#d-email').value,
          adresa: $('#d-adresa').value, ic: $('#d-ic').value, dic: $('#d-dic').value
        },
        polozky: $$('#d-polozky .polozka-radek').map(r => ({
          nazev: $('.p-nazev', r).value,
          pocet: +$('.p-pocet', r).value || 1,
          cenaKc: +$('.p-cena', r).value || 0
        })).filter(p => p.nazev.trim()),
        ...($('#d-hodnota') ? { hodnotaKc: +$('#d-hodnota').value || 0 } : {})
      };
    }

    $('#d-ulozit').addEventListener('click', async () => {
      try {
        await api('/api/admin/zakazky/' + z.id, { method: 'PATCH', body: JSON.stringify(sesbirej()) });
        oznam('Zakázka uložena.');
        zavri();
        await prekresli();
      } catch (e) { oznam(e.message); }
    });

    $('#d-poznamka-ulozit').addEventListener('click', async () => {
      const text = $('#d-poznamka').value.trim();
      if (!text) return;
      try {
        await api('/api/admin/zakazky/' + z.id, { method: 'PATCH', body: JSON.stringify({ poznamka: text }) });
        await otevriDetail(z.id);
      } catch (e) { oznam(e.message); }
    });

    $('#d-pohoda').addEventListener('click', async () => {
      try {
        await api('/api/admin/zakazky/' + z.id + '/pohoda', { method: 'POST' });
        oznam('Zakázka založena do Pohody.');
        await otevriDetail(z.id);
      } catch (e) {
        oznam(e.message);
        await otevriDetail(z.id);
      }
    });
  }

  function radekPolozky(p) {
    return `
      <div class="polozka-radek">
        <input class="p-nazev" value="${utec(p.nazev)}" placeholder="Název položky">
        <input class="p-pocet" type="number" min="1" value="${p.pocet || 1}" title="Počet kusů">
        <input class="p-cena" type="number" min="0" value="${p.cenaKc || 0}" title="Cena za kus v Kč">
        <button type="button" title="Odebrat">×</button>
      </div>`;
  }

  /* ---------- Nová zakázka ---------- */
  const otevriNovou = () => { $('#nova').hidden = false; $('#nova-pozadi').hidden = false; };
  const zavriNovou = () => { $('#nova').hidden = true; $('#nova-pozadi').hidden = true; };
  $('#nova-zakazka').addEventListener('click', otevriNovou);
  $('[data-zavri-novou]').addEventListener('click', zavriNovou);
  $('#nova-pozadi').addEventListener('click', zavriNovou);

  $('#nova-form').addEventListener('submit', async (u) => {
    u.preventDefault();
    const f = new FormData(u.target);
    try {
      const { zakazka } = await api('/api/admin/zakazky', {
        method: 'POST',
        body: JSON.stringify({
          typ: f.get('typ'),
          nazev: f.get('nazev'),
          hodnotaKc: +f.get('hodnotaKc') || 0,
          zakaznik: {
            firma: f.get('firma'), jmeno: f.get('jmeno'),
            telefon: f.get('telefon'), email: f.get('email'),
            adresa: f.get('adresa'), ic: f.get('ic'), dic: f.get('dic')
          }
        })
      });
      const poznamka = String(f.get('poznamka') || '').trim();
      if (poznamka) {
        await api('/api/admin/zakazky/' + zakazka.id, { method: 'PATCH', body: JSON.stringify({ poznamka }) });
      }
      u.target.reset();
      zavriNovou();
      pohled = zakazka.typ;
      $$('.zalozky button').forEach(x => x.classList.toggle('active', x.dataset.pohled === pohled));
      await prekresli();
      oznam('Zakázka založena.');
    } catch (e) {
      $('#nova-chyba').textContent = e.message;
      $('#nova-chyba').hidden = false;
    }
  });

  start();
})();
