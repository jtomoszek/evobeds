/* Administrace evobeds: nástěnka, kanban zakázek (B2C i B2B), uživatelé,
   přiřazování zodpovědnosti, úkoly, historie a založení do Pohody. */

'use strict';

(function () {
  const $ = (sel, kde) => (kde || document).querySelector(sel);
  const $$ = (sel, kde) => [...(kde || document).querySelectorAll(sel)];

  let token = localStorage.getItem('evobeds-admin-token') || '';
  let ja = null;             /* přihlášený uživatel */
  let tym = [];              /* seznam uživatelů */
  let pipeline = null;       /* { pipeline: {b2c, b2b}, konecne } */
  let pohled = 'nastenka';
  let hledani = '';
  let filtrClovek = null;    /* id uživatele z lišty avatarů */
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

  function utec(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  function inicialy(jmeno) {
    return String(jmeno || '?').split(/\s+/).map(c => c[0] || '').join('').slice(0, 2).toUpperCase();
  }

  function avatar(osoba, extra) {
    if (!osoba) return '';
    return `<span class="avatar ${extra || ''}" style="background:${utec(osoba.barva || '#9a9aa6')}" title="${utec(osoba.jmeno)}">${utec(inicialy(osoba.jmeno))}</span>`;
  }

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
      const [me, pl] = await Promise.all([api('/api/admin/ja'), api('/api/admin/pipeline')]);
      ja = me.uzivatel;
      pipeline = pl;
      $('#prihlaseni').hidden = true;
      $('#aplikace').hidden = false;
      $$('[data-jen-admin]').forEach(el => el.hidden = ja.role !== 'admin');
      await nactiTym();
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
        body: JSON.stringify({ email: $('#login-email').value, heslo: $('#heslo').value })
      });
      const data = await odpoved.json();
      if (!odpoved.ok) throw new Error(data.chyba || 'Přihlášení se nepodařilo.');
      token = data.token;
      localStorage.setItem('evobeds-admin-token', token);
      $('#heslo').value = '';
      await start();
      oznam('Vítejte, ' + data.uzivatel.jmeno + '.');
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

  /* ---------- Tým v horní liště ---------- */
  async function nactiTym() {
    tym = (await api('/api/admin/uzivatele')).uzivatele.filter(u => u.aktivni);
    kresliTym();
  }

  function kresliTym(pocty) {
    $('#tym').innerHTML = tym.map(u => `
      <button class="tym-avatar ${filtrClovek === u.id ? 'aktivni' : ''}" data-uid="${u.id}" title="${utec(u.jmeno)}">
        ${avatar(u)}
        ${pocty && pocty[u.id] ? `<span class="tym-pocet">${pocty[u.id]}</span>` : ''}
      </button>`).join('');
    $$('#tym .tym-avatar').forEach(b => b.addEventListener('click', () => {
      const uid = +b.dataset.uid;
      filtrClovek = filtrClovek === uid ? null : uid;
      if (pohled === 'nastenka' || pohled === 'uzivatele') pohled = 'b2b';
      $$('.zalozky button').forEach(x => x.classList.toggle('active', x.dataset.pohled === pohled));
      prekresli();
    }));
  }

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
    if (pohled === 'uzivatele') return kresliUzivatele();
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
    const pocty = {};
    for (const [uid, l] of Object.entries(stat.lide || {})) pocty[uid] = l.zakazek + l.ukolu;
    kresliTym(pocty);

    /* Otevřené úkoly napříč zakázkami */
    const ukoly = [];
    for (const z of zakazky) {
      for (const u of (z.ukoly || [])) {
        if (!u.hotovo) ukoly.push({ ...u, zakazka: z });
      }
    }

    $('#obsah').innerHTML = `
      <div class="dlazdice">
        <div class="karta"><div class="cislo">${otevreneB2c}</div><div class="popis">otevřené objednávky B2C</div></div>
        <div class="karta"><div class="cislo">${rozjednane}</div><div class="popis">rozjednané obchody B2B</div></div>
        <div class="karta"><div class="cislo">${veVyrobe}</div><div class="popis">zakázek ve výrobě</div></div>
        <div class="karta"><div class="cislo">${Kc(stat.celkemKc.b2c + stat.celkemKc.b2b)}</div><div class="popis">hodnota všech aktivních zakázek</div></div>
      </div>
      <div class="nastenka-sloupce">
        <div class="karta">
          <h3>Otevřené úkoly (${ukoly.length})</h3>
          ${ukoly.slice(0, 10).map(u => `
            <div class="mini-radek" data-id="${u.zakazka.id}">
              <span class="mini-ukol">${avatar(u.komu)}<span>${utec(u.text)}</span></span>
              <span class="stitek">${u.termin ? utec(u.termin) : utec(u.zakazka.nazev).slice(0, 26)}</span>
            </div>`).join('') || '<p class="popis">Žádné otevřené úkoly. Přidávají se v detailu zakázky.</p>'}
        </div>
        <div class="karta">
          <h3>Kdo co vede</h3>
          ${Object.entries(stat.lide || {}).map(([uid, l]) => `
            <div class="mini-radek">
              <span class="mini-ukol">${avatar(l)}<span>${utec(l.jmeno)}</span></span>
              <span class="stitek">${l.zakazek} zak. · ${l.ukolu} úkolů</span>
            </div>`).join('') || '<p class="popis">Zatím nikdo nemá přiřazenou zakázku.</p>'}
        </div>
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
    if (filtrClovek) {
      zakazky = zakazky.filter(z =>
        (z.prirazeno && z.prirazeno.id === filtrClovek) ||
        (z.ukoly || []).some(u => u.komu && u.komu.id === filtrClovek && !u.hotovo));
    }
    kresliTym();

    const clovek = filtrClovek ? tym.find(u => u.id === filtrClovek) : null;
    const sloupce = [...pipeline.pipeline[typ], ...pipeline.konecne.filter(s =>
      (typ === 'b2b' ? s.id === 'ztraceno' : s.id === 'storno'))];

    $('#obsah').innerHTML =
      (clovek ? `<p class="filtr-info">Zobrazeny zakázky, které vede ${utec(clovek.jmeno)}. Kliknutím na avatar filtr zrušíte.</p>` : '') +
      `<div class="kanban">` + sloupce.map(s => {
        const veSloupci = zakazky.filter(z => z.stav === s.id);
        return `
          <div class="sloupec" data-stav="${s.id}">
            <h3><span>${s.nazev}</span><span>${veSloupci.length}</span></h3>
            ${veSloupci.map(kartaZakazky).join('')}
          </div>`;
      }).join('') + `</div>`;

    $$('.zakazka').forEach(k => k.addEventListener('click', () => otevriDetail(k.dataset.id)));

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
    const ukolu = (z.ukoly || []).filter(u => !u.hotovo).length;
    return `
      <div class="zakazka" data-id="${z.id}">
        <div class="zakazka-rada">
          ${z.prirazeno ? avatar(z.prirazeno) : '<span class="avatar avatar-prazdny" title="Bez zodpovědné osoby">?</span>'}
          <div class="zakazka-texty">
            <div class="nazev">${utec(z.nazev)}</div>
            <div class="meta">
              <span>${utec(z.zakaznik.firma || z.zakaznik.jmeno || '')}</span>
              <span class="castka">${Kc(z.typ === 'b2b' ? z.hodnotaKc : z.celkemKc)}</span>
            </div>
          </div>
        </div>
        <div class="stitky">
          ${z.zdroj === 'web' ? '<span class="stitek-mini web">web</span>' : ''}
          ${z.vyroba.rezim === 'vyroba' ? '<span class="stitek-mini vyroba">výroba</span>' : ''}
          ${z.vyroba.rezim === 'sklad' ? '<span class="stitek-mini vyroba">sklad</span>' : ''}
          ${ukolu ? `<span class="stitek-mini ukoly">${ukolu} úkol${ukolu > 1 ? 'y' : ''}</span>` : ''}
          ${z.pohoda && z.pohoda.zalozeno ? '<span class="stitek-mini pohoda">pohoda</span>' : ''}
          <span class="stitek-mini">${dni === 0 ? 'dnes' : dni + ' d'}</span>
        </div>
      </div>`;
  }

  /* ---------- Uživatelé ---------- */
  async function kresliUzivatele() {
    const vsichni = (await api('/api/admin/uzivatele')).uzivatele;
    $('#obsah').innerHTML = `
      <div class="nastenka-sloupce">
        <div class="karta">
          <h3>Uživatelé (${vsichni.length})</h3>
          ${vsichni.map(u => `
            <div class="uzivatel-radek" data-uid="${u.id}">
              ${avatar(u)}
              <div class="uzivatel-info">
                <div class="nazev">${utec(u.jmeno)} ${u.id === ja.id ? '<span class="stitek-mini">to jste vy</span>' : ''}</div>
                <div class="popis">${utec(u.email)}</div>
              </div>
              <select class="u-role" ${u.id === ja.id ? 'disabled title="Vlastní roli si nezměníte"' : ''}>
                <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin</option>
                <option value="clen" ${u.role === 'clen' ? 'selected' : ''}>Člen týmu</option>
              </select>
              <button class="btn btn-sm u-aktivni">${u.aktivni ? 'Deaktivovat' : 'Aktivovat'}</button>
              <button class="btn btn-sm u-heslo">Nové heslo</button>
            </div>`).join('')}
        </div>
        <div class="karta">
          <h3>Přidat uživatele</h3>
          <form id="novy-uzivatel" class="novy-uzivatel">
            <label>Jméno a příjmení<input name="jmeno" required></label>
            <label>E-mail<input name="email" type="email" required></label>
            <label>Heslo (min. 8 znaků)<input name="heslo" type="password" minlength="8" required></label>
            <label>Role<select name="role">
              <option value="clen">Člen týmu</option>
              <option value="admin">Admin</option>
            </select></label>
            <button class="btn btn-dark" type="submit">Založit účet</button>
          </form>
          <p class="popis">Role Admin může spravovat uživatele. Členové týmu vidí a spravují zakázky a úkoly.</p>
        </div>
      </div>`;

    $$('.uzivatel-radek').forEach(r => {
      const uid = r.dataset.uid;
      $('.u-role', r).addEventListener('change', async (u) => {
        try {
          await api('/api/admin/uzivatele/' + uid, { method: 'PATCH', body: JSON.stringify({ role: u.target.value }) });
          oznam('Role uložena.');
          await nactiTym();
        } catch (e) { oznam(e.message); kresliUzivatele(); }
      });
      $('.u-aktivni', r).addEventListener('click', async (u) => {
        const aktivovat = u.target.textContent === 'Aktivovat';
        try {
          await api('/api/admin/uzivatele/' + uid, { method: 'PATCH', body: JSON.stringify({ aktivni: aktivovat }) });
          await nactiTym();
          kresliUzivatele();
        } catch (e) { oznam(e.message); }
      });
      $('.u-heslo', r).addEventListener('click', async () => {
        const heslo = prompt('Nové heslo (min. 8 znaků):');
        if (!heslo) return;
        try {
          await api('/api/admin/uzivatele/' + uid, { method: 'PATCH', body: JSON.stringify({ heslo }) });
          oznam('Heslo změněno.');
        } catch (e) { oznam(e.message); }
      });
    });

    $('#novy-uzivatel').addEventListener('submit', async (u) => {
      u.preventDefault();
      const f = new FormData(u.target);
      try {
        await api('/api/admin/uzivatele', {
          method: 'POST',
          body: JSON.stringify({ jmeno: f.get('jmeno'), email: f.get('email'), heslo: f.get('heslo'), role: f.get('role') })
        });
        oznam('Uživatel založen.');
        await nactiTym();
        kresliUzivatele();
      } catch (e) { oznam(e.message); }
    });
  }

  /* ---------- Detail zakázky ---------- */
  function volbyLidi(vybrany) {
    return '<option value="">Bez zodpovědné osoby</option>' + tym.map(u =>
      `<option value="${u.id}" ${vybrany && vybrany.id === u.id ? 'selected' : ''}>${utec(u.jmeno)}</option>`).join('');
  }

  function osobaPodleId(id) {
    const u = tym.find(x => x.id === +id);
    return u ? { id: u.id, jmeno: u.jmeno, barva: u.barva } : null;
  }

  async function otevriDetail(id) {
    const { zakazka: z } = await api('/api/admin/zakazky/' + id);
    const vsechnyStavy = [...pipeline.pipeline[z.typ], ...pipeline.konecne];
    z.ukoly = z.ukoly || [];

    $('#detail').innerHTML = `
      <div class="detail-hlava">
        <h2>${utec(z.nazev)} <span class="detail-cislo">#${z.id}</span></h2>
        <button class="zavrit" aria-label="Zavřít">×</button>
      </div>
      <div class="detail-telo">
        <div class="sekce">
          <h3>Stav a zodpovědnost</h3>
          <div class="pole-rada">
            <label>Stav<select id="d-stav">
              ${vsechnyStavy.map(s => `<option value="${s.id}" ${s.id === z.stav ? 'selected' : ''}>${s.nazev}</option>`).join('')}
            </select></label>
            <label>Zodpovídá<select id="d-prirazeno">${volbyLidi(z.prirazeno)}</select></label>
          </div>
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
          <h3>Úkoly (${z.ukoly.filter(u => !u.hotovo).length} otevřených)</h3>
          <div id="d-ukoly">
            ${z.ukoly.map(u => `
              <div class="ukol-radek ${u.hotovo ? 'hotovo' : ''}" data-ukol="${u.id}">
                <input type="checkbox" class="ukol-hotovo" ${u.hotovo ? 'checked' : ''} title="Hotovo">
                ${u.komu ? avatar(u.komu) : '<span class="avatar avatar-prazdny">?</span>'}
                <div class="ukol-text">
                  <span>${utec(u.text)}</span>
                  ${u.termin ? `<span class="ukol-termin">${utec(u.termin)}</span>` : ''}
                </div>
                <button class="ukol-smazat" title="Odstranit úkol">×</button>
              </div>`).join('') || '<p class="popis">Zatím žádné úkoly.</p>'}
          </div>
          <div class="ukol-novy">
            <input id="d-ukol-text" placeholder="Nový úkol, např. Připravit nabídku na 8 lůžek">
            <select id="d-ukol-komu">${volbyLidi(null)}</select>
            <input id="d-ukol-termin" placeholder="Termín">
            <button class="btn btn-sm" id="d-ukol-pridat" type="button">Přidat</button>
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
          <div class="souhrn-cena"><span>Celkem za položky</span><span>${Kc(z.celkemKc)}</span></div>
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
            <div class="udalost">
              <span class="kdy">${datum(u.kdy)}</span>
              <span>${u.kdo ? '<strong>' + utec(u.kdo) + '</strong> · ' : ''}${utec(u.text)}</span>
            </div>`).join('')}
        </div>
      </div>`;

    $('#detail').hidden = false;
    $('#detail-pozadi').hidden = false;

    const zavri = () => { $('#detail').hidden = true; $('#detail-pozadi').hidden = true; };
    $('#detail .zavrit').addEventListener('click', zavri);
    $('#detail-pozadi').onclick = zavri;

    /* Úkoly: hotovo / smazat / přidat se ukládají hned */
    $$('#d-ukoly .ukol-radek').forEach(r => {
      const ukolId = r.dataset.ukol;
      $('.ukol-hotovo', r).addEventListener('click', async (u) => {
        u.stopPropagation();
        try {
          await api('/api/admin/zakazky/' + z.id, { method: 'PATCH', body: JSON.stringify({ ukolHotovo: { id: ukolId, hotovo: u.target.checked } }) });
          await otevriDetail(z.id);
        } catch (e) { oznam(e.message); }
      });
      $('.ukol-smazat', r).addEventListener('click', async (u) => {
        u.stopPropagation();
        try {
          await api('/api/admin/zakazky/' + z.id, { method: 'PATCH', body: JSON.stringify({ ukolSmazat: ukolId }) });
          await otevriDetail(z.id);
        } catch (e) { oznam(e.message); }
      });
    });
    $('#d-ukol-pridat').addEventListener('click', async () => {
      const text = $('#d-ukol-text').value.trim();
      if (!text) return;
      try {
        await api('/api/admin/zakazky/' + z.id, {
          method: 'PATCH',
          body: JSON.stringify({ ukolPridat: { text, komu: osobaPodleId($('#d-ukol-komu').value), termin: $('#d-ukol-termin').value } })
        });
        await otevriDetail(z.id);
      } catch (e) { oznam(e.message); }
    });

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
        prirazeno: osobaPodleId($('#d-prirazeno').value),
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
  const otevriNovou = () => {
    $('#nova-prirazeno').innerHTML = volbyLidi(ja ? { id: ja.id } : null);
    $('#nova').hidden = false;
    $('#nova-pozadi').hidden = false;
  };
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
      const prirazeno = osobaPodleId(f.get('prirazeno'));
      const poznamka = String(f.get('poznamka') || '').trim();
      if (prirazeno || poznamka) {
        await api('/api/admin/zakazky/' + zakazka.id, {
          method: 'PATCH',
          body: JSON.stringify({ ...(prirazeno ? { prirazeno } : {}), ...(poznamka ? { poznamka } : {}) })
        });
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
