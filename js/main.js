/* EvoBeds — sdílené chování webu */
(function () {
  'use strict';

  /* ---------- Header: stále viditelný, po odscrollování vystoupí jako skleněná vrstva ---------- */
  const header = document.querySelector('.site-header');

  function onScroll() {
    if (header) header.classList.toggle('scrolled', window.scrollY > 24);
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* ---------- Mobilní menu ---------- */
  const toggle = document.querySelector('.mobile-toggle');
  if (toggle) {
    toggle.addEventListener('click', () => document.body.classList.toggle('menu-open'));
    document.querySelectorAll('.mobile-menu a').forEach(a =>
      a.addEventListener('click', () => document.body.classList.remove('menu-open'))
    );
  }

  /* ---------- Jazykový přepínač ---------- */
  const lang = document.querySelector('.lang');
  if (lang) {
    lang.querySelector('.lang-toggle').addEventListener('click', (e) => {
      e.stopPropagation();
      lang.classList.toggle('open');
    });
    document.addEventListener('click', () => lang.classList.remove('open'));
  }

  /* ---------- Reveal on scroll ---------- */
  const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (en.isIntersecting) {
        en.target.classList.add('visible');
        revealObserver.unobserve(en.target);
      }
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
  document.querySelectorAll('.reveal').forEach(el => revealObserver.observe(el));

  /* ---------- Feature taby (auto-rotace s progress barem) ---------- */
  document.querySelectorAll('[data-tabs]').forEach((root) => {
    const tabs = [...root.querySelectorAll('.feature-tab')];
    const imgs = [...root.querySelectorAll('.feature-media img')];
    if (!tabs.length) return;
    let idx = 0;
    let timer = null;
    const DURATION = 7000;

    function activate(i, auto) {
      idx = i;
      tabs.forEach((t, k) => {
        t.classList.toggle('active', k === i);
        const bar = t.querySelector('.bar');
        if (bar) {
          bar.style.transition = 'none';
          bar.style.width = '0';
          if (k === i) {
            void bar.offsetWidth; /* restart animace */
            bar.style.transition = 'width ' + DURATION + 'ms linear';
            bar.style.width = '100%';
          }
        }
      });
      imgs.forEach((im, k) => im.classList.toggle('active', k === i));
      clearTimeout(timer);
      timer = setTimeout(() => activate((idx + 1) % tabs.length, true), DURATION);
    }
    tabs.forEach((t, i) => t.addEventListener('click', () => activate(i, false)));

    const io = new IntersectionObserver((en) => {
      if (en[0].isIntersecting) { activate(0, true); io.disconnect(); }
    }, { threshold: 0.3 });
    io.observe(root);
  });

  /* ---------- Hotspoty: overlay + vysouvací detail zprava ---------- */
  const hotspots = [...document.querySelectorAll('.hotspot[data-title]')];
  if (hotspots.length) {
    /* Jednorázové vytvoření overlay vrstvy a panelu */
    const overlay = document.createElement('div');
    overlay.className = 'detail-overlay';
    const drawer = document.createElement('aside');
    drawer.className = 'detail-drawer';
    drawer.setAttribute('role', 'dialog');
    drawer.setAttribute('aria-modal', 'true');
    drawer.innerHTML =
      '<div class="d-img">' +
        '<button class="detail-close" aria-label="Zavřít">' +
          '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>' +
        '</button>' +
        '<img alt="">' +
      '</div>' +
      '<div class="detail-body">' +
        '<div class="detail-content"><h2></h2><p class="p1"></p><p class="p2"></p></div>' +
        '<div class="detail-foot">' +
          '<a class="btn btn-dark" href="eshop.html#konfigurace">Prohlédnout v e-shopu</a>' +
          '<div class="detail-nav">' +
            '<button class="d-prev" aria-label="Předchozí"><svg width="30" height="18" viewBox="0 0 32 18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 1 1 9l8 8M1 9h30"/></svg></button>' +
            '<button class="d-next" aria-label="Další"><svg width="30" height="18" viewBox="0 0 32 18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M23 1l8 8-8 8M31 9H1"/></svg></button>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.append(overlay, drawer);

    const dImg = drawer.querySelector('.d-img img');
    const dContent = drawer.querySelector('.detail-content');
    let current = 0;

    /* Naplnění panelu daty z klíčového bodu */
    function fill(i) {
      const d = hotspots[i].dataset;
      drawer.querySelector('h2').textContent = d.title;
      drawer.querySelector('.p1').textContent = d.text || '';
      drawer.querySelector('.p2').textContent = d.text2 || '';
      dImg.src = d.img;
      dImg.alt = d.title;
    }
    function open(i) {
      current = i;
      fill(i);
      document.body.classList.add('detail-open');
      drawer.scrollTop = 0;
    }
    function close() { document.body.classList.remove('detail-open'); }
    /* Přechod na další/předchozí detail s jemným prolnutím obsahu */
    function go(dir) {
      current = (current + dir + hotspots.length) % hotspots.length;
      dContent.classList.add('fading');
      dImg.style.opacity = '0';
      setTimeout(() => {
        fill(current);
        dContent.classList.remove('fading');
        dImg.style.opacity = '';
      }, 280);
    }

    hotspots.forEach((h, i) => h.addEventListener('click', () => open(i)));
    overlay.addEventListener('click', close);
    drawer.querySelector('.detail-close').addEventListener('click', close);
    drawer.querySelector('.d-prev').addEventListener('click', () => go(-1));
    drawer.querySelector('.d-next').addEventListener('click', () => go(1));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  }

  /* ---------- Vrstvící se karty: překryté karty se plynule zmenšují ---------- */
  document.querySelectorAll('[data-stack]').forEach((root) => {
    const cards = [...root.querySelectorAll('.stack-card')];
    if (cards.length < 2) return;
    let ticking = false;

    function progress(card) {
      /* Jak daleko karta dojela od spodní hrany okna ke své kotvě (0 až 1) */
      const rect = card.getBoundingClientRect();
      const anchor = parseFloat(getComputedStyle(card).top) || 0;
      const start = window.innerHeight;
      return Math.min(1, Math.max(0, (start - rect.top) / (start - anchor)));
    }

    function update() {
      ticking = false;
      cards.forEach((card, i) => {
        let cover = 0;
        for (let j = i + 1; j < cards.length; j++) cover += progress(cards[j]);
        const scale = Math.max(.86, 1 - cover * .05);
        card.style.transform = 'scale(' + scale + ')';
      });
    }
    function onScrollStack() {
      if (!ticking) { ticking = true; requestAnimationFrame(update); }
    }
    window.addEventListener('scroll', onScrollStack, { passive: true });
    window.addEventListener('resize', onScrollStack);
    update();
  });

  /* ---------- Výroba: ukotvené video, texty kroků projíždějí zespodu nahoru ---------- */
  document.querySelectorAll('[data-craft]').forEach((root) => {
    const sticky = root.querySelector('.craft-sticky');
    const steps = [...root.querySelectorAll('.craft-step')];
    const vids = [...root.querySelectorAll('.craft-video video')];
    if (!steps.length) return;
    let ticking = false;
    let aktivni = -1;

    function update() {
      ticking = false;
      const rect = root.getBoundingClientRect();
      const drahaCelkem = rect.height - sticky.offsetHeight;
      const p = Math.min(1, Math.max(0, -rect.top / drahaCelkem));
      const x = p * steps.length;
      const idx = Math.min(steps.length - 1, Math.floor(x));
      if (idx !== aktivni) {
        aktivni = idx;
        vids.forEach((v, i) => {
          v.classList.toggle('active', i === idx);
          if (i !== idx) v.pause();
        });
      }
      /* Aktivní video se vždy dohraje, i kdyby dřívější spuštění prohlížeč zablokoval */
      const av = vids[idx];
      if (av && av.paused) { const pl = av.play(); if (pl) pl.catch(() => {}); }
      steps.forEach((st, i) => {
        /* local: 0 = krok začíná (text dole), 0.5 = uprostřed, 1 = končí (text nahoře) */
        const local = Math.min(1.4, Math.max(-0.4, x - i));
        const y = (0.5 - local) * 110;
        const op = Math.max(0, 1 - Math.abs(local - 0.5) * 2);
        st.style.transform = 'translateY(' + y.toFixed(2) + '%)';
        st.style.opacity = op.toFixed(3);
      });
    }
    function onScrollCraft() {
      if (!ticking) { ticking = true; requestAnimationFrame(update); }
    }
    window.addEventListener('scroll', onScrollCraft, { passive: true });
    window.addEventListener('resize', onScrollCraft);
    update();
  });

  /* ---------- Chytrý obrázek: polohy postele ---------- */
  document.querySelectorAll('[data-positions]').forEach((root) => {
    const btns = [...root.querySelectorAll('.pos-btn')];
    const imgs = [...root.querySelectorAll('.positions-stage img')];
    const label = root.querySelector('.pos-label');
    if (!btns.length) return;
    let idx = 0;
    let timer = null;
    const DURATION = 3500;

    function activate(i) {
      idx = i;
      btns.forEach((b, k) => {
        b.classList.toggle('active', k === i);
        const fill = b.querySelector('.fill');
        if (fill) {
          fill.style.transition = 'none';
          fill.style.width = '0';
          if (k === i) {
            void fill.offsetWidth;
            fill.style.transition = 'width ' + DURATION + 'ms linear';
            fill.style.width = '100%';
          }
        }
      });
      imgs.forEach((im, k) => im.classList.toggle('active', k === i));
      if (label) label.textContent = btns[i].dataset.label || btns[i].textContent.trim();
      clearTimeout(timer);
      timer = setTimeout(() => activate((idx + 1) % btns.length), DURATION);
    }
    btns.forEach((b, i) => b.addEventListener('click', () => activate(i)));

    const io = new IntersectionObserver((en) => {
      if (en[0].isIntersecting) { activate(0); io.disconnect(); }
    }, { threshold: 0.3 });
    io.observe(root);
  });

  /* ---------- Rentgenové šoupátko ---------- */
  document.querySelectorAll('.xray-wrap').forEach((wrap) => {
    const top = wrap.querySelector('.xray-top');
    const handle = wrap.querySelector('.xray-handle');
    let dragging = false;

    function setPos(clientX) {
      const r = wrap.getBoundingClientRect();
      let p = ((clientX - r.left) / r.width) * 100;
      p = Math.max(2, Math.min(98, p));
      top.style.clipPath = 'inset(0 ' + (100 - p) + '% 0 0)';
      handle.style.left = p + '%';
    }
    function start(e) { dragging = true; setPos(e.touches ? e.touches[0].clientX : e.clientX); }
    function move(e) { if (dragging) setPos(e.touches ? e.touches[0].clientX : e.clientX); }
    function end() { dragging = false; }

    wrap.addEventListener('mousedown', start);
    wrap.addEventListener('touchstart', start, { passive: true });
    window.addEventListener('mousemove', move);
    window.addEventListener('touchmove', move, { passive: true });
    window.addEventListener('mouseup', end);
    window.addEventListener('touchend', end);

    /* jemná úvodní animace, ať je jasné, že se dá táhnout */
    const io = new IntersectionObserver((en) => {
      if (!en[0].isIntersecting) return;
      io.disconnect();
      let t = 0;
      const iv = setInterval(() => {
        t += 0.03;
        const p = 50 + Math.sin(t * Math.PI) * 12;
        if (t >= 1 || dragging) { clearInterval(iv); return; }
        top.style.clipPath = 'inset(0 ' + (100 - p) + '% 0 0)';
        handle.style.left = p + '%';
      }, 16);
    }, { threshold: 0.4 });
    io.observe(wrap);
  });

  /* ---------- Karusely se šipkami ---------- */
  document.querySelectorAll('[data-rail]').forEach((wrap) => {
    const rail = wrap.querySelector('.cards-rail');
    /* Šipky jsou v hlavičce sekce (rail-head), ne uvnitř obalu karet —
       hledáme je proto v rámci celé nadřazené sekce */
    const scope = wrap.closest('section') || wrap.parentElement;
    const prev = scope.querySelector('.rail-prev');
    const next = scope.querySelector('.rail-next');
    if (!rail) return;
    const step = () => Math.min(rail.clientWidth * 0.8, 460);
    function update() {
      if (prev) prev.disabled = rail.scrollLeft < 10;
      if (next) next.disabled = rail.scrollLeft > rail.scrollWidth - rail.clientWidth - 10;
    }
    if (prev) prev.addEventListener('click', () => rail.scrollBy({ left: -step(), behavior: 'smooth' }));
    if (next) next.addEventListener('click', () => rail.scrollBy({ left: step(), behavior: 'smooth' }));
    rail.addEventListener('scroll', update, { passive: true });
    update();
  });

  /* ---------- Animované čítače ---------- */
  const counterObserver = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (!en.isIntersecting) return;
      counterObserver.unobserve(en.target);
      const el = en.target;
      const target = parseFloat(el.dataset.count);
      const dur = 2000;
      const t0 = performance.now();
      function tick(now) {
        const p = Math.min((now - t0) / dur, 1);
        const eased = 1 - Math.pow(1 - p, 3);
        el.textContent = Math.round(target * eased).toLocaleString('cs-CZ');
        if (p < 1) requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    });
  }, { threshold: 0.5 });
  document.querySelectorAll('[data-count]').forEach(el => counterObserver.observe(el));

  /* ---------- Marquee: zdvojení obsahu pro plynulou smyčku ---------- */
  document.querySelectorAll('.marquee-track').forEach((track) => {
    track.innerHTML += track.innerHTML;
  });

  /* ---------- Taby recenzí ---------- */
  document.querySelectorAll('[data-review-tabs]').forEach((root) => {
    const tabs = [...root.querySelectorAll('.review-tab')];
    const groups = [...root.querySelectorAll('[data-review-group]')];
    tabs.forEach((t, i) => t.addEventListener('click', () => {
      tabs.forEach((x, k) => x.classList.toggle('active', k === i));
      groups.forEach((g) => {
        g.style.display = g.dataset.reviewGroup === t.dataset.group ? '' : 'none';
      });
    }));
  });

  /* ---------- FAQ ---------- */
  document.querySelectorAll('.faq-item').forEach((item) => {
    const q = item.querySelector('.faq-q');
    const a = item.querySelector('.faq-a');
    q.addEventListener('click', () => {
      const open = item.classList.toggle('open');
      a.style.maxHeight = open ? a.scrollHeight + 'px' : '0';
    });
  });

  /* ---------- Newsletter / formuláře (zatím bez backendu) ---------- */
  document.querySelectorAll('form[data-demo]').forEach((f) => {
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const btn = f.querySelector('button');
      if (btn) { btn.textContent = 'Děkujeme ✓'; btn.disabled = true; }
    });
  });
})();
