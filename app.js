// Halvliter — Oslo Beer Tracker
// Main application logic

import {
  VENUES,
  NEIGHBORHOODS,
  AMENITIES,
  tierForPricePerLiter,
  computePricePerLiter,
  computeHalfLiter,
} from './data.js';

// =========================================================
// State
// =========================================================
const state = {
  view: 'map',
  sort: 'price',
  happyOnly: false,
  maxPrice: 150,
  neighborhoods: new Set(),
  amenities: new Set(),
  selectedId: null,
  submissions: [], // local-state crowdsourced suggestions (would be backend-persisted)
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

// =========================================================
// Theme toggle (inline, see 01-design-tokens)
// =========================================================
(function () {
  const t = document.querySelector('[data-theme-toggle]');
  const r = document.documentElement;
  let d = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';

  const apply = () => {
    r.setAttribute('data-theme', d);
    t.setAttribute('aria-label', 'Switch to ' + (d === 'dark' ? 'light' : 'dark') + ' mode');
    t.innerHTML =
      d === 'dark'
        ? '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>'
        : '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
    // Re-style map if loaded
    if (window.__map) {
      document.getElementById('map').classList.toggle('dark-tiles', d === 'dark');
    }
  };
  apply();
  t.addEventListener('click', () => {
    d = d === 'dark' ? 'light' : 'dark';
    apply();
  });
})();

// =========================================================
// Helpers
// =========================================================
const fmtDate = (iso) => {
  const d = new Date(iso);
  const now = Date.now();
  const diff = (now - d.getTime()) / 86400000;
  if (diff < 1) return 'today';
  if (diff < 2) return 'yesterday';
  if (diff < 30) return `${Math.floor(diff)} days ago`;
  if (diff < 60) return '1 month ago';
  return `${Math.floor(diff / 30)} months ago`;
};

const isHappyHourActive = (v) => {
  if (!v.happyHour) return false;
  const now = new Date();
  const day = now.getDay(); // 0=Sun
  const time = now.getHours() * 100 + now.getMinutes();
  const days = v.happyHour.days.toLowerCase();

  // Simple parser for demo
  const dayMatches =
    days === 'mon–sun' ||
    (days === 'thu' && day === 4) ||
    (days === 'wed' && day === 3) ||
    (days === 'mon' && day === 1) ||
    (days.includes('tue') && day === 2) ||
    (days.includes('fri') && day === 5) ||
    (days.includes('sat') && day === 6) ||
    (days.includes('sun') && day === 0);

  if (!dayMatches) return false;

  const until = v.happyHour.until;
  if (until === 'all day' || until === 'all evening') return true;
  const m = until.match(/(\d{1,2}):(\d{2})/);
  if (!m) return true;
  const untilTime = parseInt(m[1]) * 100 + parseInt(m[2]);
  return time <= untilTime;
};

const effectivePrice = (v) => {
  // Returns {price, volume, isHappy}
  if (state.happyOnly && v.happyHour) {
    return { ...v.happyHour, isHappy: true };
  }
  if (v.happyHour && isHappyHourActive(v)) {
    return { ...v.happyHour, isHappy: true };
  }
  return { ...v.beer, isHappy: false };
};

const effectiveHalfLiter = (v) => {
  const p = effectivePrice(v);
  return Math.round((p.price / p.volume) * 0.5);
};

const iconFor = (amenityId) => {
  const a = AMENITIES.find((x) => x.id === amenityId);
  return a ? a.icon : 'tag';
};

const labelFor = (amenityId) => {
  const a = AMENITIES.find((x) => x.id === amenityId);
  return a ? a.label : amenityId;
};

// =========================================================
// Filtering + sorting
// =========================================================
function getFilteredVenues() {
  return VENUES.filter((v) => {
    const halfL = effectiveHalfLiter(v);
    if (halfL > state.maxPrice) return false;
    if (state.happyOnly && !v.happyHour) return false;
    if (state.neighborhoods.size > 0 && !state.neighborhoods.has(v.neighborhood)) return false;
    if (state.amenities.size > 0) {
      for (const a of state.amenities) {
        if (!v.amenities.includes(a)) return false;
      }
    }
    return true;
  });
}

function getSortedVenues(venues) {
  const list = [...venues];
  switch (state.sort) {
    case 'price':
      list.sort((a, b) => effectiveHalfLiter(a) - effectiveHalfLiter(b));
      break;
    case 'ppl':
      list.sort((a, b) => computePricePerLiter(a) - computePricePerLiter(b));
      break;
    case 'name':
      list.sort((a, b) => a.name.localeCompare(b.name));
      break;
    case 'updated':
      list.sort((a, b) => b.lastUpdated.localeCompare(a.lastUpdated));
      break;
  }
  return list;
}

// =========================================================
// MAP
// =========================================================
let map;
const markers = new Map(); // id -> {el, marker, popup}

function showMapFallback(reason) {
  const mapEl = document.getElementById('map');
  if (!mapEl) return;
  mapEl.innerHTML = `
    <div class="map-fallback">
      <div class="map-fallback-inner">
        <strong>Map couldn’t load</strong>
        <p>Switch to the <button class="fallback-link" onclick="document.querySelector('[data-testid=tab-list]').click()">list view</button> to browse all 24 bars.</p>
        <p class="map-fallback-debug">Reason: ${String(reason).slice(0,120)}</p>
      </div>
    </div>`;
  console.warn('Map fallback:', reason);
}

function initMap() {
  const mapEl = document.getElementById('map');

  if (typeof maplibregl === 'undefined') {
    showMapFallback('maplibregl not loaded');
    return;
  }

  try {
    map = new maplibregl.Map({
      container: 'map',
      style: 'https://tiles.openfreemap.org/styles/positron',
      center: [10.7522, 59.9139], // Oslo
      zoom: 12.5,
      maxBounds: [
        [10.55, 59.82],
        [10.92, 60.02],
      ],
    });
  } catch (err) {
    showMapFallback('constructor threw: ' + err.message);
    return;
  }
  window.__map = map;

  map.on('error', (e) => {
    // Don’t show fallback for tile errors — only catastrophic style/webgl failures
    console.warn('Map error:', e?.error?.message || e);
  });

  // Apply dark tint if in dark mode
  if (document.documentElement.getAttribute('data-theme') === 'dark') {
    mapEl.classList.add('dark-tiles');
  }

  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');

  map.on('load', () => {
    renderMarkers();
    // Force resize in case container was 0-height at init (common in iframe wrappers)
    setTimeout(() => map.resize(), 50);
    setTimeout(() => map.resize(), 500);
  });

  // Re-resize whenever container dimensions change (iframe layout shifts)
  if (window.ResizeObserver) {
    const ro = new ResizeObserver(() => { try { map.resize(); } catch(e) {} });
    ro.observe(mapEl);
  }

  // Handle page visibility — iOS sometimes pauses rendering
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && map) setTimeout(() => map.resize(), 100);
  });
}

function createMarkerElement(v) {
  const halfL = effectiveHalfLiter(v);
  const tier = tierForPricePerLiter(computePricePerLiter(v));
  const el = document.createElement('div');
  el.className = 'map-marker';
  el.dataset.tier = tier;
  el.dataset.id = v.id;
  el.setAttribute('role', 'button');
  el.setAttribute('aria-label', `${v.name}, ${halfL} kr per halvliter`);
  el.innerHTML = `
    <div class="map-marker-inner">
      <svg viewBox="0 0 34 40" xmlns="http://www.w3.org/2000/svg">
        <path class="pin-bg" d="M17 0C7.6 0 0 7.3 0 16.4 0 28.5 15 39.4 16 39.9c.3.2.7.2 1 0C18 39.4 34 28.5 34 16.4 34 7.3 26.4 0 17 0z"/>
        <circle cx="17" cy="16" r="11" fill="white" opacity="0.95"/>
        <text class="pin-price" x="17" y="16" fill="#0b1d2a">${halfL}</text>
      </svg>
    </div>
  `;
  return el;
}

function renderMarkers() {
  // Remove old
  for (const { marker } of markers.values()) marker.remove();
  markers.clear();

  const venues = getFilteredVenues();
  for (const v of venues) {
    const el = createMarkerElement(v);
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      selectVenue(v.id);
    });
    const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
      .setLngLat([v.lng, v.lat])
      .addTo(map);
    markers.set(v.id, { el, marker });
  }

  updateResultsCount(venues.length);
}

function flyToVenue(v) {
  map.flyTo({ center: [v.lng, v.lat], zoom: 15.2, speed: 1.2, curve: 1.4 });
}

// Selected card (persistent side panel when a pin is selected)
function renderSelectedCard(v) {
  const sc = $('#selected-card');
  if (!v) {
    sc.hidden = true;
    sc.innerHTML = '';
    return;
  }
  const eff = effectivePrice(v);
  const halfL = effectiveHalfLiter(v);
  const ppl = computePricePerLiter(v);
  const tier = tierForPricePerLiter(ppl);

  sc.hidden = false;
  sc.innerHTML = `
    <div class="selected-head" style="position:relative;padding:var(--space-4) var(--space-5) var(--space-3);border-bottom:1px solid var(--color-divider)">
      <button class="icon-btn" data-close-selected aria-label="Close" style="position:absolute;top:8px;right:8px;width:32px;height:32px"><i data-lucide="x"></i></button>
      <div style="font-size:var(--text-xs);color:var(--color-text-muted);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:3px">${v.neighborhood}</div>
      <h3 style="font-family:var(--font-display);font-weight:800;font-size:1.2rem;line-height:1.2;padding-right:24px">${v.name}</h3>
      ${eff.isHappy ? `<span class="happy-badge" style="margin-top:6px"><i data-lucide="clock-3"></i> Happy hour now</span>` : ''}
    </div>
    <div style="padding:var(--space-4) var(--space-5);display:flex;flex-direction:column;gap:var(--space-3)">
      <div style="display:flex;align-items:baseline;gap:10px">
        <span style="font-family:var(--font-display);font-weight:800;font-size:2rem;color:var(--color-text);line-height:1">${halfL}<sup style="font-size:0.7rem;color:var(--color-text-muted);font-weight:500;margin-left:2px">kr</sup></span>
        <span style="font-size:var(--text-sm);color:var(--color-text-muted)">per 0.5L</span>
      </div>
      <div style="font-size:var(--text-xs);color:var(--color-text-muted)">
        Menu price: ${eff.price} kr for ${eff.volume}L · ${ppl} kr/L
      </div>
      <p style="font-size:var(--text-sm);color:var(--color-text-muted);line-height:1.5">${v.blurb}</p>
    </div>
    <div style="padding:var(--space-3) var(--space-5) var(--space-4);display:flex;gap:8px;border-top:1px solid var(--color-divider)">
      <button class="btn btn-primary" style="flex:1" data-view-details="${v.id}">View details</button>
      <a class="btn btn-ghost" href="https://www.google.com/maps/dir/?api=1&destination=${v.lat},${v.lng}" target="_blank" rel="noopener" aria-label="Get directions"><i data-lucide="navigation"></i></a>
    </div>
  `;
  lucide.createIcons();

  sc.querySelector('[data-close-selected]').addEventListener('click', () => {
    state.selectedId = null;
    renderSelectedCard(null);
    markers.forEach(({ el }) => el.classList.remove('active'));
  });
  sc.querySelector('[data-view-details]').addEventListener('click', () => {
    openVenueSheet(v.id);
  });
}

function selectVenue(id) {
  state.selectedId = id;
  const v = VENUES.find((x) => x.id === id);
  markers.forEach(({ el }) => el.classList.remove('active'));
  const m = markers.get(id);
  if (m) m.el.classList.add('active');
  flyToVenue(v);
  renderSelectedCard(v);
}

function updateResultsCount(n) {
  $('#results-count').textContent = n;
}

// =========================================================
// LIST VIEW
// =========================================================
function renderList() {
  const list = $('#venue-list');
  const venues = getSortedVenues(getFilteredVenues());
  const empty = $('#list-empty');

  if (venues.length === 0) {
    list.innerHTML = '';
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  list.innerHTML = venues
    .map((v) => {
      const eff = effectivePrice(v);
      const halfL = effectiveHalfLiter(v);
      const ppl = computePricePerLiter(v);
      const tier = tierForPricePerLiter(ppl);
      const isHappyNow = eff.isHappy;

      const amenityChips = v.amenities
        .slice(0, 4)
        .map(
          (a) => `<span class="amenity-chip"><i data-lucide="${iconFor(a)}"></i>${labelFor(a)}</span>`,
        )
        .join('');

      return `
      <article class="venue-card" data-tier="${tier}" data-id="${v.id}" data-testid="card-venue-${v.id}">
        <span class="tier-stripe"></span>
        <div class="venue-card-header">
          <div>
            <h3>${v.name}</h3>
            <div class="neighborhood">${v.neighborhood}</div>
          </div>
          <div class="price-block">
            <div class="main-price">${halfL}<sup>kr</sup></div>
            <div class="sub-price">${eff.price} kr / ${eff.volume}L</div>
          </div>
        </div>
        <p class="blurb">${v.blurb}</p>
        <div class="meta-row">
          ${isHappyNow ? `<span class="happy-badge"><i data-lucide="clock-3"></i>Happy hour now</span>` : ''}
          ${v.happyHour && !isHappyNow ? `<span class="happy-badge" style="background:var(--color-surface-offset);color:var(--color-text-muted)"><i data-lucide="clock-3"></i>HH ${v.happyHour.price} kr</span>` : ''}
          ${amenityChips}
        </div>
      </article>
    `;
    })
    .join('');

  list.querySelectorAll('.venue-card').forEach((card) => {
    card.addEventListener('click', () => openVenueSheet(card.dataset.id));
  });

  lucide.createIcons();
  updateResultsCount(venues.length);
}

// =========================================================
// VIEW TOGGLE
// =========================================================
function setView(v) {
  state.view = v;
  $$('.view-tab').forEach((t) => {
    const active = t.dataset.view === v;
    t.classList.toggle('active', active);
    t.setAttribute('aria-selected', active);
  });
  $('#map-view').classList.toggle('active', v === 'map');
  $('#map-view').hidden = v !== 'map';
  $('#list-view').classList.toggle('active', v === 'list');
  $('#list-view').hidden = v !== 'list';
  if (v === 'list') renderList();
  if (v === 'map' && map) {
    setTimeout(() => map.resize(), 50);
    renderMarkers();
  }
}

// =========================================================
// VENUE DETAIL SHEET
// =========================================================
function openVenueSheet(id) {
  const v = VENUES.find((x) => x.id === id);
  if (!v) return;
  const eff = effectivePrice(v);
  const halfL = effectiveHalfLiter(v);
  const ppl = computePricePerLiter(v);
  const isHappyNow = eff.isHappy;

  const sheet = $('#venue-sheet');
  sheet.innerHTML = `
    <button class="icon-btn close-sheet" data-close-sheet aria-label="Close"><i data-lucide="x"></i></button>
    <header class="sheet-header">
      <div>
        <div class="neighborhood">${v.neighborhood}</div>
        <h2>${v.name}</h2>
      </div>
    </header>
    <div class="sheet-body">
      <div class="big-price">
        <div class="price-cell">
          <h4>Standard price</h4>
          <div class="value">${computeHalfLiter(v)}<sup>kr</sup></div>
          <div class="note">per 0.5L · ${v.beer.brand}</div>
        </div>
        <div class="price-cell">
          <h4>Price per liter</h4>
          <div class="value">${ppl}<sup>kr</sup></div>
          <div class="note">${v.beer.price} kr for ${v.beer.volume}L</div>
        </div>
      </div>

      ${
        v.happyHour
          ? `<div class="happy-hour-banner">
        <i data-lucide="clock-3"></i>
        <div class="hh-text">
          <strong>${isHappyNow ? 'Happy hour now' : 'Happy hour'} · ${v.happyHour.price} kr</strong>
          <div class="hh-detail">${v.happyHour.volume}L · ${v.happyHour.days}${v.happyHour.until !== 'all day' && v.happyHour.until !== 'all evening' ? ` · until ${v.happyHour.until}` : ` · ${v.happyHour.until}`}</div>
        </div>
      </div>`
          : ''
      }

      <p style="font-size:var(--text-base);color:var(--color-text);line-height:1.55">${v.blurb}</p>

      <div style="display:flex;flex-direction:column;gap:var(--space-4)">
        <div class="info-row">
          <i data-lucide="map-pin"></i>
          <div>
            <div class="label">Address</div>
            ${v.address}
          </div>
        </div>
        <div class="info-row">
          <i data-lucide="clock"></i>
          <div>
            <div class="label">Hours</div>
            ${v.hours}
          </div>
        </div>
        <div class="info-row">
          <i data-lucide="refresh-cw"></i>
          <div>
            <div class="label">Price last updated</div>
            ${fmtDate(v.lastUpdated)}
          </div>
        </div>
      </div>

      ${
        v.amenities.length
          ? `<div>
        <div class="label" style="font-size:var(--text-xs);color:var(--color-text-muted);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px;font-weight:600">Atmosphere</div>
        <div class="amenities-list">
          ${v.amenities.map((a) => `<span class="amenity-chip"><i data-lucide="${iconFor(a)}"></i>${labelFor(a)}</span>`).join('')}
        </div>
      </div>`
          : ''
      }
    </div>
    <footer class="sheet-footer">
      <button class="btn btn-ghost" data-suggest="${v.id}" data-testid="button-suggest-${v.id}">
        <i data-lucide="edit-3"></i>
        Update price
      </button>
      <a class="btn btn-primary" style="flex:1" href="https://www.google.com/maps/dir/?api=1&destination=${v.lat},${v.lng}" target="_blank" rel="noopener" data-testid="link-directions-${v.id}">
        <i data-lucide="navigation"></i>
        Directions
      </a>
    </footer>
  `;
  openDialog(sheet, '#sheet-backdrop');
  lucide.createIcons();

  sheet.querySelector('[data-close-sheet]').addEventListener('click', () => closeAllDialogs());
  sheet.querySelector('[data-suggest]').addEventListener('click', () => {
    closeAllDialogs();
    setTimeout(() => openSubmitSheet(v.id), 180);
  });
}

// =========================================================
// PRICE SUBMIT SHEET
// =========================================================
function openSubmitSheet(venueId) {
  const v = VENUES.find((x) => x.id === venueId);
  const sheet = $('#submit-sheet');
  sheet.innerHTML = `
    <button class="icon-btn close-sheet" data-close-sheet aria-label="Close"><i data-lucide="x"></i></button>
    <header class="sheet-header">
      <div>
        <div class="neighborhood">Suggest an edit</div>
        <h2>${v.name}</h2>
      </div>
    </header>
    <form id="submit-form" class="sheet-body">
      <div class="form-hint">
        <i data-lucide="info"></i>
        <span>Your submission goes to a moderator for review before going live. Current price: <strong>${v.beer.price} kr for ${v.beer.volume}L</strong>.</span>
      </div>
      <div class="form-field">
        <label for="f-volume">Volume</label>
        <select id="f-volume" required>
          <option value="0.3">0.3L</option>
          <option value="0.4">0.4L</option>
          <option value="0.5" selected>0.5L</option>
          <option value="0.6">0.6L</option>
          <option value="1.5">1.5L (mugge)</option>
        </select>
      </div>
      <div class="form-field">
        <label for="f-price">Price in NOK</label>
        <input id="f-price" type="number" min="20" max="400" step="1" placeholder="e.g. 89" required />
      </div>
      <div class="form-field">
        <label><input type="checkbox" id="f-happy" style="width:auto;margin-right:6px" /> This is a happy hour price</label>
      </div>
      <div class="form-field">
        <label for="f-notes">Notes (optional)</label>
        <textarea id="f-notes" rows="3" placeholder="Brand, day/time restrictions, receipt reference..."></textarea>
      </div>
    </form>
    <footer class="sheet-footer">
      <button class="btn btn-ghost" data-close-sheet>Cancel</button>
      <button class="btn btn-primary" style="flex:1" type="submit" form="submit-form" data-testid="button-submit-price">
        <i data-lucide="send"></i>
        Submit for review
      </button>
    </footer>
  `;
  openDialog(sheet, '#submit-backdrop');
  lucide.createIcons();

  sheet.querySelectorAll('[data-close-sheet]').forEach((b) =>
    b.addEventListener('click', () => closeAllDialogs()),
  );

  sheet.querySelector('#submit-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const payload = {
      id: `sub-${Date.now()}`,
      venueId,
      volume: parseFloat($('#f-volume').value),
      price: parseFloat($('#f-price').value),
      isHappyHour: $('#f-happy').checked,
      notes: $('#f-notes').value,
      submittedAt: new Date().toISOString(),
      status: 'pending',
    };
    state.submissions.push(payload);
    closeAllDialogs();
    showToast(`Thanks — your update for ${v.name} is pending review.`);
  });
}

// =========================================================
// FILTERS DRAWER
// =========================================================
function renderFilterChips() {
  const nhContainer = $('#neighborhood-chips');
  nhContainer.innerHTML = NEIGHBORHOODS.map(
    (n) => `<button type="button" class="chip ${state.neighborhoods.has(n) ? 'active' : ''}" data-nh="${n}">${n}</button>`,
  ).join('');
  nhContainer.querySelectorAll('[data-nh]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const nh = btn.dataset.nh;
      if (state.neighborhoods.has(nh)) state.neighborhoods.delete(nh);
      else state.neighborhoods.add(nh);
      btn.classList.toggle('active');
    });
  });

  const amContainer = $('#amenity-chips');
  amContainer.innerHTML = AMENITIES.map(
    (a) =>
      `<button type="button" class="chip ${state.amenities.has(a.id) ? 'active' : ''}" data-am="${a.id}"><i data-lucide="${a.icon}"></i>${a.label}</button>`,
  ).join('');
  amContainer.querySelectorAll('[data-am]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.am;
      if (state.amenities.has(id)) state.amenities.delete(id);
      else state.amenities.add(id);
      btn.classList.toggle('active');
    });
  });
  lucide.createIcons();
}

function updateFilterCount() {
  const n =
    state.neighborhoods.size +
    state.amenities.size +
    (state.maxPrice < 150 ? 1 : 0) +
    (state.happyOnly ? 1 : 0);
  const badge = $('#filter-count');
  if (n > 0) {
    badge.hidden = false;
    badge.textContent = n;
  } else {
    badge.hidden = true;
  }
}

function applyFilters() {
  updateFilterCount();
  if (state.view === 'map') {
    renderMarkers();
    // Close selected card if that venue no longer matches
    if (state.selectedId) {
      const stillIn = getFilteredVenues().find((v) => v.id === state.selectedId);
      if (!stillIn) {
        state.selectedId = null;
        renderSelectedCard(null);
      }
    }
  } else {
    renderList();
  }
}

function resetFilters() {
  state.neighborhoods.clear();
  state.amenities.clear();
  state.maxPrice = 150;
  state.happyOnly = false;
  $('#price-slider').value = 150;
  $('#price-output').textContent = '150 kr';
  $('#happy-toggle').checked = false;
  renderFilterChips();
  applyFilters();
}

// =========================================================
// DIALOG helpers
// =========================================================
function openDialog(sheet, backdropSel) {
  sheet.hidden = false;
  $(backdropSel).hidden = false;
  document.body.style.overflow = 'hidden';
  // Force reflow then allow animation
}

function closeAllDialogs() {
  ['#filters-drawer', '#venue-sheet', '#submit-sheet'].forEach((s) => ($(s).hidden = true));
  ['#drawer-backdrop', '#sheet-backdrop', '#submit-backdrop'].forEach(
    (s) => ($(s).hidden = true),
  );
}

// =========================================================
// Toast
// =========================================================
let toastTimer;
function showToast(msg) {
  const t = $('#toast');
  t.innerHTML = `<i data-lucide="check-circle-2"></i><span>${msg}</span>`;
  t.hidden = false;
  lucide.createIcons();
  requestAnimationFrame(() => t.classList.add('visible'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    t.classList.remove('visible');
    setTimeout(() => (t.hidden = true), 240);
  }, 3200);
}

// =========================================================
// GEOLOCATION
// =========================================================
function locateMe() {
  if (!navigator.geolocation) {
    showToast('Geolocation not available in this browser.');
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords;
      if (state.view !== 'map') setView('map');
      setTimeout(() => {
        map.flyTo({ center: [longitude, latitude], zoom: 14.5 });
        // Add or update "you are here" marker
        if (window.__meMarker) window.__meMarker.remove();
        const el = document.createElement('div');
        el.style.cssText =
          'width:18px;height:18px;border-radius:50%;background:#2196f3;border:3px solid white;box-shadow:0 0 0 4px rgba(33,150,243,0.25);';
        window.__meMarker = new maplibregl.Marker({ element: el })
          .setLngLat([longitude, latitude])
          .addTo(map);
      }, 200);
    },
    () => {
      showToast('Could not get your location. Check browser permissions.');
    },
    { enableHighAccuracy: true, timeout: 6000 },
  );
}

// =========================================================
// EVENT WIRING
// =========================================================
function wire() {
  // View tabs
  $$('.view-tab').forEach((t) => t.addEventListener('click', () => setView(t.dataset.view)));

  // Sort
  $('#sort-select').addEventListener('change', (e) => {
    state.sort = e.target.value;
    if (state.view === 'list') renderList();
  });

  // Happy toggle
  $('#happy-toggle').addEventListener('change', (e) => {
    state.happyOnly = e.target.checked;
    applyFilters();
  });

  // Filters
  $('#open-filters').addEventListener('click', () => {
    $('#filters-drawer').hidden = false;
    $('#drawer-backdrop').hidden = false;
    document.body.style.overflow = 'hidden';
  });
  $('#close-filters').addEventListener('click', () => {
    closeAllDialogs();
    document.body.style.overflow = '';
  });
  $('#drawer-backdrop').addEventListener('click', () => {
    closeAllDialogs();
    document.body.style.overflow = '';
  });
  $('#apply-filters').addEventListener('click', () => {
    closeAllDialogs();
    document.body.style.overflow = '';
    applyFilters();
  });
  $('#reset-filters').addEventListener('click', resetFilters);
  $('#reset-filters-empty').addEventListener('click', resetFilters);

  $('#price-slider').addEventListener('input', (e) => {
    state.maxPrice = parseInt(e.target.value);
    $('#price-output').textContent = `${state.maxPrice} kr`;
  });
  $('#price-slider').addEventListener('change', applyFilters);

  // Sheet backdrops
  $('#sheet-backdrop').addEventListener('click', () => {
    closeAllDialogs();
    document.body.style.overflow = '';
  });
  $('#submit-backdrop').addEventListener('click', () => {
    closeAllDialogs();
    document.body.style.overflow = '';
  });

  // Locate
  $('#locate-btn').addEventListener('click', locateMe);

  // Escape key closes dialogs
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeAllDialogs();
      document.body.style.overflow = '';
    }
  });
}

// =========================================================
// BOOT
// =========================================================
function boot() {
  lucide.createIcons();
  renderFilterChips();
  wire();
  initMap();
  // Populate results count immediately
  updateResultsCount(VENUES.length);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
