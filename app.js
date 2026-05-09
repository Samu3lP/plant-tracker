// ============================================================
// DATA LAYER
// ============================================================
const APP_VERSION = '1.5';
const STORAGE_KEY = 'garden_v1';
const APIKEY_KEY = 'garden_apikey';
const DEFAULT_DATA = { plants: [], logs: [] };

let data = loadData();

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return JSON.parse(JSON.stringify(DEFAULT_DATA));
    return { ...DEFAULT_DATA, ...JSON.parse(raw) };
  } catch { return JSON.parse(JSON.stringify(DEFAULT_DATA)); }
}
function saveData() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}
function getApiKey() { return localStorage.getItem(APIKEY_KEY) || ''; }
function saveApiKey() {
  const k = document.getElementById('apiKeyInput').value.trim();
  localStorage.setItem(APIKEY_KEY, k);
  toast('API key saved');
}
function uid() { return Math.random().toString(36).slice(2, 11); }
function today() { return new Date().toISOString().slice(0, 10); }
function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
function daysAgo(iso) {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  return Math.floor(ms / 86400000);
}
function daysBetween(isoA, isoB) {
  return Math.floor((new Date(isoB) - new Date(isoA)) / 86400000);
}
function relativeDay(iso) {
  const n = daysAgo(iso);
  if (n === null) return 'Never';
  if (n === 0) return 'Today';
  if (n === 1) return 'Yesterday';
  if (n < 7) return `${n} days ago`;
  if (n < 30) return `${Math.floor(n/7)} weeks ago`;
  return `${Math.floor(n/30)} months ago`;
}

// ============================================================
// HELPERS
// ============================================================
function getMistSlots(n, w) {
  const slots = [];
  for (let weekStart = 0; weekStart < w; weekStart += 7) {
    for (let a = 1; a <= n; a++) {
      const slot = weekStart + Math.max(1, Math.round(a * 7 / (n + 1)));
      if (slot <= w) slots.push(slot);
    }
  }
  if (slots.length === 0) {
    for (let a = 1; a <= n; a++) slots.push(Math.max(1, Math.round(a * w / (n + 1))));
  }
  return slots;
}

function getLastLog(plantId, type) {
  return data.logs
    .filter(l => l.plantId === plantId && (!type || l.type === type))
    .sort((a, b) => b.date.localeCompare(a.date))[0];
}
function computeHealth(plant, atDate, visualScore) {
  // Watering: 10 if on schedule, lose 1 per excess day overdue
  let waterScore = 10;
  if (plant.wateringDays) {
    const lastWater = data.logs
      .filter(l => l.plantId === plant.id && l.type === 'water' && l.date <= atDate)
      .sort((a, b) => b.date.localeCompare(a.date))[0];
    const since = lastWater ? daysBetween(lastWater.date, atDate) : daysBetween(plant.acquired || atDate, atDate);
    if (since > plant.wateringDays) waterScore = Math.max(0, 10 - (since - plant.wateringDays));
  }
  // Misting: 10 if on schedule, lose 1 per day past the first missed slot
  let mistScore = 10;
  if (plant.mistsPerWeek) {
    const n = plant.mistsPerWeek;
    const w = plant.wateringDays || 7;
    const lastWater = data.logs
      .filter(l => l.plantId === plant.id && l.type === 'water' && l.date <= atDate)
      .sort((a, b) => b.date.localeCompare(a.date))[0];
    if (lastWater) {
      const cycleEnd = new Date(new Date(lastWater.date + 'T00:00:00').getTime() + w * 86400000).toISOString().slice(0, 10);
      const daysSinceCycle = Math.min(daysBetween(lastWater.date, atDate), w);
      const mistsInCycle = data.logs.filter(l =>
        l.plantId === plant.id && l.type === 'fertilise' &&
        l.date >= lastWater.date && l.date <= cycleEnd && l.date <= atDate
      ).length;
      const slots = getMistSlots(n, w);
      const firstMissed = slots.find((s, i) => i >= mistsInCycle && daysSinceCycle >= s);
      if (firstMissed !== undefined) mistScore = Math.max(0, 10 - (daysSinceCycle - firstMissed));
    }
  }
  return Math.round(((waterScore + mistScore + visualScore) / 3) * 10);
}
function getLatestHealth(plantId) {
  const plant = data.plants.find(p => p.id === plantId);
  if (!plant) return null;
  const hc = data.logs
    .filter(l => l.plantId === plantId && l.type === 'health-check' && l.visualScore != null)
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  if (!hc) return null;
  return computeHealth(plant, today(), hc.visualScore);
}
function getOverdueTasks() {
  const tasks = [];
  for (const p of data.plants) {
    if (p.wateringDays) {
      const last = getLastLog(p.id, 'water');
      if (!last) {
        tasks.push({ plant: p, type: 'water', since: 9999, interval: p.wateringDays, neverDone: true });
      } else {
        const since = daysAgo(last.date);
        if (since != null && since >= p.wateringDays)
          tasks.push({ plant: p, type: 'water', since, interval: p.wateringDays });
      }
    }
    if (p.mistsPerWeek) {
      const n = p.mistsPerWeek;
      const w = p.wateringDays || 7;
      const lastWater = getLastLog(p.id, 'water');
      if (!lastWater) continue; // no watering cycle to reference yet
      const cycleStart = lastWater.date;
      const cycleEnd = new Date(new Date(cycleStart + 'T00:00:00').getTime() + w * 86400000).toISOString().slice(0, 10);
      const daysSinceCycle = Math.min(daysAgo(cycleStart) || 0, w);
      const mistsInCycle = data.logs.filter(l =>
        l.plantId === p.id && l.type === 'fertilise' && l.date >= cycleStart && l.date <= cycleEnd
      ).length;
      const slots = getMistSlots(n, w);
      const slotsPassed = slots.filter(s => daysSinceCycle >= s).length;
      if (slotsPassed > mistsInCycle) {
        const oldestSlotDay = slots.find(s => daysSinceCycle >= s) || 0;
        const hasEverMisted = data.logs.some(l => l.plantId === p.id && l.type === 'fertilise');
        tasks.push({ plant: p, type: 'fertilise', since: daysSinceCycle, interval: oldestSlotDay, neverDone: !hasEverMisted });
      }
    }
  }
  return tasks.sort((a, b) => {
    const va = a.neverDone ? 9999 : a.since - a.interval;
    const vb = b.neverDone ? 9999 : b.since - b.interval;
    return vb - va;
  });
}
function healthClass(score) {
  if (score == null) return '';
  if (score > 75) return 'health-good';
  if (score >= 25) return 'health-mid';
  return 'health-low';
}
function healthBarHTML(score, small = false) {
  if (score == null) return '';
  const pct = Math.max(0, Math.min(100, score));
  const cls = score > 75 ? 'good' : score >= 25 ? 'mid' : 'low';
  return small
    ? `<div class="plant-health-bar"><div class="health-bar-fill ${cls}" style="width:${pct}%"></div></div>`
    : `<div class="health-bar"><div class="health-bar-fill ${cls}" style="width:${pct}%"></div></div>`;
}
function logTypeLabel(t) {
  return { water: 'Watered', fertilise: 'Misted', 'health-check': 'Health check', observation: 'Observation', repot: 'Repotted' }[t] || t;
}
function logIcon(type) {
  return type === 'water' ? icons.water : type === 'fertilise' ? icons.fert : type === 'health-check' ? icons.healthcheck : icons.obs;
}
function logCls(type) {
  return type === 'water' ? 'water' : type === 'fertilise' ? 'fert' : type === 'health-check' ? 'health-check' : '';
}
function logScoreBadge(l) {
  if (l.type === 'health-check' && l.visualScore != null) return `<div class="log-score">${l.visualScore}</div>`;
  if (l.healthScore != null) return `<div class="log-score">${l.healthScore}</div>`;
  return '';
}

// ============================================================
// ICONS
// ============================================================
const icons = {
  leaf: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M11 20A7 7 0 014 13V8a8 8 0 018-8h0a8 8 0 018 8 13 13 0 01-9 12.5"/><path d="M2 22c0-3 6-7 10-7"/></svg>',
  water: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.5l5 6.5a6.5 6.5 0 11-10 0z"/></svg>',
  fert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8 12h8M12 8v8"/></svg>',
  mist: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 17.58A5 5 0 0018 8h-1.26A8 8 0 104 15.25"/><line x1="8" y1="19" x2="8" y2="21"/><line x1="12" y1="17" x2="12" y2="19"/><line x1="16" y1="19" x2="16" y2="21"/></svg>',
  obs: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  healthcheck: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
  chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 18l6-6-6-6"/></svg>',
  camera: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>',
  download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>',
  upload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>',
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
  more: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
};

// ============================================================
// AI
// ============================================================
async function rateHealthFromImage(base64Image, withDiagnosis = false) {
  const key = getApiKey();
  if (!key) throw new Error('no-key');
  const mediaType = base64Image.match(/data:([^;]+);base64,/)?.[1] || 'image/jpeg';
  const imgData = base64Image.split(',')[1];
  const prompt = withDiagnosis
    ? 'Rate this plant\'s visual health and provide a diagnosis. Reply with raw JSON only (no markdown):\n{"score":<integer 1-10>,"notes":"<one sentence observation>","diagnosis":"<1-2 sentences: what you observe and the likely cause>","cure":"<2-3 concrete actionable steps the owner can take right now to help the plant recover or maintain health>"}\n10 = thriving, 1 = severely struggling. Consider leaf colour, wilting, yellowing, pests, and overall vigour.'
    : 'Rate this plant\'s visual health out of 10. Reply with raw JSON only (no markdown):\n{"score":<integer 1-10>,"notes":"<one sentence describing what you observe>"}\n10 = thriving, 1 = severely struggling. Consider leaf colour, wilting, yellowing, pests, and overall vigour.';
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: withDiagnosis ? 512 : 128,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: imgData } },
          { type: 'text', text: prompt }
        ]
      }]
    })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `API error ${res.status}`);
  }
  const json = await res.json();
  const text = json.content[0].text.replace(/```[a-z]*\n?/gi, '').trim();
  const parsed = JSON.parse(text);
  return {
    score: Math.min(10, Math.max(1, Math.round(parsed.score))),
    notes: parsed.notes || '',
    diagnosis: parsed.diagnosis || '',
    cure: parsed.cure || ''
  };
}

async function identifyPlant(base64Image) {
  const key = getApiKey();
  if (!key) { alert('Add your Claude API key in Settings first.'); return null; }
  const mediaType = base64Image.match(/data:([^;]+);base64,/)?.[1] || 'image/jpeg';
  const data = base64Image.split(',')[1];
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data } },
          { type: 'text', text: 'Identify this plant and reply with raw JSON only (no markdown, no explanation):\n{"commonName":"<common name>","scientificName":"<latin name>","wateringDays":<number>,"mistsPerWeek":<number>,"notes":"<one sentence care tip>"}\nmistsPerWeek is how many times per week this plant should be misted (0 if it does not benefit from misting). Best guess is fine. Only set commonName to null if the image contains no plant at all.' }
        ]
      }]
    })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `API error ${res.status}`);
  }
  const json = await res.json();
  const text = json.content[0].text.replace(/```[a-z]*\n?/gi, '').trim();
  return JSON.parse(text);
}

// ============================================================
// ROUTING
// ============================================================
function getRoute() {
  return window.location.hash.slice(1) || 'home';
}
function go(route) { window.location.hash = route; }
window.addEventListener('hashchange', render);

// ============================================================
// VIEWS / RENDER
// ============================================================
function render() {
  const route = getRoute();
  const [name, param, subpage] = route.split('/');
  document.querySelectorAll('.tab').forEach(t => {
    t.classList.toggle('active', t.dataset.route === name);
  });
  switch (name) {
    case 'plants': renderPlants(); break;
    case 'plant':
      if (subpage === 'health') renderPlantHealth(param);
      else renderPlantDetail(param);
      break;
    case 'logs': renderLogs(); break;
    case 'settings': renderSettings(); break;
    default: renderHome();
  }
}

// --- Home ---
function renderHome() {
  const hr = new Date().getHours();
  const greet = hr < 5 ? 'Late night' : hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
  const tasks = getOverdueTasks();
  const tasksHTML = tasks.length === 0
    ? `<div class="card" style="text-align:center;padding:24px;"><div style="font-family:'Fraunces',serif;color:var(--ink-soft);font-size:18px;">All caught up</div><div style="font-size:13px;color:var(--ink-faint);margin-top:4px;">Nothing needs your attention today.</div></div>`
    : tasks.map(t => {
        const isWater = t.type === 'water';
        const overdueDays = t.neverDone ? null : t.since - t.interval;
        const meta = t.neverDone
          ? (isWater ? 'Never watered' : 'Never misted')
          : overdueDays > 0 ? `${overdueDays}d overdue` : 'due today';
        return `
        <div class="task-card ${isWater ? 'water-task' : 'mist-task'}" onclick="go('plant/${t.plant.id}')">
          <div class="task-icon ${isWater ? 'water' : 'mist'}">${isWater ? icons.water : icons.mist}</div>
          <div class="task-body">
            <div class="task-title">${isWater ? 'Water' : 'Mist'} ${escape(t.plant.name)}</div>
            <div class="task-meta">${meta}</div>
          </div>
          <button class="task-action" onclick="event.stopPropagation(); quickLog('${t.plant.id}', '${t.type}')">Done</button>
        </div>`;
      }).join('');

  const recent = [...data.logs].reverse().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
  const recentHTML = recent.length === 0 ? '' : recent.map(l => {
    const p = data.plants.find(p => p.id === l.plantId);
    if (!p) return '';
    return `
      <div class="log-entry" onclick="go('plant/${p.id}')">
        <div class="log-icon ${logCls(l.type)}">${logIcon(l.type)}</div>
        <div class="log-body">
          <div class="log-type">${logTypeLabel(l.type)} · ${escape(p.name)}</div>
          <div class="log-date">${relativeDay(l.date)}</div>
          ${l.notes ? `<div class="log-notes">"${escape(l.notes)}"</div>` : ''}
        </div>
        ${logScoreBadge(l)}
      </div>`;
  }).join('');

  const sortedPlants = [...data.plants].sort((a, b) => {
    const sa = getLatestHealth(a.id), sb = getLatestHealth(b.id);
    if (sa == null && sb == null) return 0;
    if (sa == null) return 1;
    if (sb == null) return -1;
    return sa - sb;
  });
  const plantsHTML = sortedPlants.map(p => {
    const score = getLatestHealth(p.id);
    const thumb = p.photo ? `style="background-image:url('${p.photo}')"` : '';
    return `
      <div class="home-plant-row" onclick="go('plant/${p.id}')">
        <div class="home-plant-thumb" ${thumb}>${!p.photo ? icons.leaf : ''}</div>
        <div style="flex:1;min-width:0;">
          <div style="font-weight:600;font-size:13px;margin-bottom:5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escape(p.name)}</div>
          ${healthBarHTML(score, true)}
        </div>
        <div class="home-health-num">${score != null ? score : '—'}</div>
      </div>`;
  }).join('');

  setHeader(`<div><div class="header-sub">${new Date().toLocaleDateString('en-GB', { weekday: 'long' })}</div><div class="header-title">Garden</div></div>`);

  document.getElementById('view').innerHTML = `
    <div class="greeting">
      <h1>${greet}, Samuel</h1>
      <div class="date">${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</div>
    </div>

    <div class="section-title">Today's tasks</div>
    ${tasksHTML}

    ${data.plants.length > 0 ? `<div class="section-title">Plants</div><div class="card" style="padding:4px 0;">${plantsHTML}</div>` : `
      <div class="empty">
        <div class="empty-icon">🌱</div>
        <h3>No plants yet</h3>
        <p>Tap the + button below to add your first one.</p>
      </div>`}

    ${recent.length > 0 ? `<div class="section-title">Recent activity</div><div class="card" style="padding:4px 16px;">${recentHTML}</div>` : ''}
  `;
}

// --- Plants ---
function renderPlants() {
  setHeader(`<div><div class="header-sub">${data.plants.length} ${data.plants.length === 1 ? 'plant' : 'plants'}</div><div class="header-title">My plants</div></div>`);

  if (data.plants.length === 0) {
    document.getElementById('view').innerHTML = `
      <div class="empty" style="margin-top:60px;">
        <div class="empty-icon">🌿</div>
        <h3>Your collection is empty</h3>
        <p>Add a plant with the + button to start tracking it.</p>
      </div>`;
    return;
  }

  const locationGroups = {};
  data.plants.forEach(p => {
    const loc = p.location || '';
    (locationGroups[loc] = locationGroups[loc] || []).push(p);
  });
  const sortedLocs = Object.keys(locationGroups).sort((a, b) => {
    if (!a) return 1;
    if (!b) return -1;
    return a.localeCompare(b);
  });

  const plantCard = p => {
    const score = getLatestHealth(p.id);
    const lastWater = getLastLog(p.id, 'water');
    const photo = p.photo ? `style="background-image:url('${p.photo}')"` : '';
    return `
      <div class="plant-card" onclick="go('plant/${p.id}')">
        <div class="plant-thumb" ${photo}>${!p.photo ? icons.leaf : ''}</div>
        <div class="plant-info">
          <div class="plant-name">${escape(p.name)}</div>
          ${p.species ? `<div class="plant-species">${escape(p.species)}</div>` : ''}
          <div class="plant-tags">
            ${lastWater ? `<span class="tag">💧 ${relativeDay(lastWater.date)}</span>` : ''}
          </div>
          ${score != null ? `<div style="display:flex;align-items:center;gap:8px;margin-top:6px;"><span style="font-size:11px;font-weight:600;color:var(--ink-faint);min-width:28px;">Health</span>${healthBarHTML(score, true)}<span style="font-size:11px;font-weight:700;color:var(--ink-soft);">${score}</span></div>` : ''}
        </div>
      </div>`;
  };

  const html = sortedLocs.map(loc =>
    `<div class="section-title">${loc ? escape(loc) : 'No location'}</div>` +
    locationGroups[loc].map(plantCard).join('')
  ).join('');

  document.getElementById('view').innerHTML = html;
}

// --- Plant Detail ---
function getNextWaterLabel(plant) {
  if (!plant.wateringDays) return { label: '—', warn: false };
  const lastWater = getLastLog(plant.id, 'water');
  if (!lastWater) return { label: 'Now', warn: true };
  const daysLeft = plant.wateringDays - (daysAgo(lastWater.date) || 0);
  if (daysLeft <= 0) return { label: 'Overdue', warn: true };
  if (daysLeft === 1) return { label: 'Tomorrow', warn: false };
  return { label: `in ${daysLeft}d`, warn: false };
}

function getNextMistLabel(plant) {
  const n = plant.mistsPerWeek;
  if (!n) return { label: '—', warn: false };
  const w = plant.wateringDays || 7;
  const lastWater = getLastLog(plant.id, 'water');
  if (!lastWater) return { label: '—', warn: false }; // no cycle yet
  const cycleStart = lastWater.date;
  const cycleEnd = new Date(new Date(cycleStart + 'T00:00:00').getTime() + w * 86400000).toISOString().slice(0, 10);
  const daysSinceCycle = Math.min(daysAgo(cycleStart) || 0, w);
  const mistsInCycle = data.logs.filter(l =>
    l.plantId === plant.id && l.type === 'fertilise' && l.date >= cycleStart && l.date <= cycleEnd
  ).length;
  const slots = getMistSlots(n, w);
  if (slots.filter(s => daysSinceCycle >= s).length > mistsInCycle) return { label: 'Overdue', warn: true };
  const nextSlot = slots[mistsInCycle];
  const daysLeft = nextSlot !== undefined
    ? nextSlot - daysSinceCycle
    : Math.max(0, w - daysSinceCycle) + getMistSlots(n, w)[0];
  if (daysLeft <= 0) return { label: 'Now', warn: true };
  if (daysLeft === 1) return { label: 'Tomorrow', warn: false };
  return { label: `in ${daysLeft}d`, warn: false };
}

function openPlantMenu() {
  document.getElementById('plantMenuOverlay').classList.add('open');
  document.getElementById('plantSideMenu').classList.add('open');
}
function closePlantMenu() {
  document.getElementById('plantMenuOverlay').classList.remove('open');
  document.getElementById('plantSideMenu').classList.remove('open');
}

function renderPlantDetail(id) {
  const p = data.plants.find(p => p.id === id);
  if (!p) { go('plants'); return; }
  setHeader('');
  const score = getLatestHealth(p.id);
  const logs = [...data.logs].filter(l => l.plantId === p.id).reverse().sort((a, b) => b.date.localeCompare(a.date));
  const photo = p.photo ? `style="background-image:url('${p.photo}')"` : '';
  const nextWater = getNextWaterLabel(p);
  const nextMist = getNextMistLabel(p);

  document.getElementById('view').innerHTML = `
    <div class="detail-hero">
      <a class="back-btn" onclick="go('plants')">${icons.back} Plants</a>
      <div class="detail-photo" ${photo}>${!p.photo ? icons.leaf : ''}</div>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
        <div class="detail-name" style="margin-bottom:0;flex:1;">${escape(p.name)}</div>
        <button class="plant-menu-btn" onclick="openPlantMenu()">${icons.more}</button>
      </div>
      ${p.species ? `<div class="detail-species">${escape(p.species)}</div>` : ''}

      <div class="stats-grid">
        <div class="stat" onclick="go('plant/${p.id}/health')" style="cursor:pointer;"><div class="stat-label">Health</div><div class="stat-value ${score != null && score < 25 ? 'warn' : ''}">${score != null ? score : '—'}</div>${healthBarHTML(score)}</div>
        <div class="stat"><div class="stat-label">Location</div><div class="stat-value" style="font-size:14px;">${escape(p.location || '—')}</div></div>
        <div class="stat"><div class="stat-label">Next water</div><div class="stat-value ${nextWater.warn ? 'warn' : ''}" style="font-size:14px;">${nextWater.label}</div></div>
        <div class="stat"><div class="stat-label">Next mist</div><div class="stat-value ${nextMist.warn ? 'warn' : ''}" style="font-size:14px;">${nextMist.label}</div></div>
      </div>
    </div>

    <div class="plant-menu-overlay" id="plantMenuOverlay" onclick="closePlantMenu()"></div>
    <div class="plant-side-menu" id="plantSideMenu">
      <div class="menu-action" onclick="closePlantMenu(); quickLog('${p.id}', 'water')">${icons.water}<span>Watered</span></div>
      <div class="menu-action" onclick="closePlantMenu(); quickLog('${p.id}', 'fertilise')">${icons.mist}<span>Misted</span></div>
      <div class="menu-action" onclick="closePlantMenu(); openHealthCheckSheet('${p.id}')">${icons.healthcheck}<span>Health check</span></div>
      <div class="menu-action" onclick="closePlantMenu(); openLogSheet('${p.id}')">${icons.obs}<span>Add note</span></div>
      <div class="menu-action" onclick="closePlantMenu(); openPlantSheet('${p.id}')">${icons.edit}<span>Edit details</span></div>
      <div class="menu-action danger" onclick="closePlantMenu(); deletePlant('${p.id}')">${icons.trash}<span>Delete plant</span></div>
    </div>

    ${p.notes ? `<div class="section-title">Notes</div><div class="card" style="margin-bottom:20px;"><div style="font-family:'Fraunces',serif;color:var(--ink-soft);font-variation-settings:'opsz' 18;">${escape(p.notes)}</div></div>` : ''}

    ${p.acquired ? `<div style="text-align:center;color:var(--ink-faint);font-size:12px;margin-top:4px;margin-bottom:20px;">Acquired ${fmtDate(p.acquired)}</div>` : ''}

    <div class="section-title">History</div>
    ${logs.length === 0 ? `<div class="empty" style="padding:30px 0;"><p>No log entries yet.</p></div>` :
      `<div class="card" style="padding:4px 16px;">${logs.map(l => {
        return `<div class="log-entry">
          <div class="log-icon ${logCls(l.type)}">${logIcon(l.type)}</div>
          <div class="log-body">
            <div class="log-type">${logTypeLabel(l.type)}</div>
            <div class="log-date">${fmtDate(l.date)}</div>
            ${l.notes ? `<div class="log-notes">"${escape(l.notes)}"</div>` : ''}
          </div>
          ${logScoreBadge(l)}
        </div>`;
      }).join('')}</div>`
    }
  `;
}

// --- Plant Health ---
function renderPlantHealth(id) {
  const p = data.plants.find(p => p.id === id);
  if (!p) { go('plant/' + id); return; }
  setHeader(`<div><div class="header-sub">${escape(p.name)}</div><div class="header-title">Health</div></div>`);

  const logs = [...data.logs].filter(l => l.plantId === id).sort((a, b) => b.date.localeCompare(a.date));
  const chartLogs = [...data.logs].filter(l => l.plantId === id && l.type === 'health-check' && l.visualScore != null).sort((a, b) => a.date.localeCompare(b.date));

  let chartHTML = '<div style="text-align:center;color:var(--ink-faint);font-size:13px;padding:24px 0;">Log a health check to start tracking the trend.</div>';
  if (chartLogs.length >= 1) {
    const svgW = 320, svgH = 150;
    const padL = 26, padR = 10, padT = 10, padB = 26;
    const plotW = svgW - padL - padR, plotH = svgH - padT - padB;

    const yPos = v => padT + plotH * (1 - v / 10);
    const timestamps = chartLogs.map(l => +new Date(l.date + 'T00:00:00'));
    const minT = timestamps[0];
    const maxT = chartLogs.length === 1 ? minT + 86400000 * 7 : timestamps[timestamps.length - 1];
    const xPos = t => padL + ((t - minT) / (maxT - minT)) * plotW;

    const pts = chartLogs.map((l, i) => ({ x: xPos(timestamps[i]), y: yPos(l.visualScore) }));

    const gridVals = [2, 4, 6, 8, 10];
    const grid = gridVals.map(v => {
      const y = yPos(v).toFixed(1);
      return `<line x1="${padL}" y1="${y}" x2="${svgW - padR}" y2="${y}" stroke="rgba(0,0,0,0.07)" stroke-width="1"/>
              <text x="${padL - 4}" y="${y}" text-anchor="end" dominant-baseline="middle" fill="var(--ink-faint)" font-size="9">${v}</text>`;
    }).join('');

    const fmtD = iso => { const d = new Date(iso + 'T00:00:00'); return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); };
    const xLabelIdxs = chartLogs.length === 1 ? [0] : [0, chartLogs.length - 1];
    if (chartLogs.length > 4) xLabelIdxs.splice(1, 0, Math.floor((chartLogs.length - 1) / 2));
    const xLabels = xLabelIdxs.map((idx, li) => {
      const anchor = li === 0 ? 'start' : li === xLabelIdxs.length - 1 ? 'end' : 'middle';
      return `<text x="${pts[idx].x.toFixed(1)}" y="${svgH - 4}" text-anchor="${anchor}" fill="var(--ink-faint)" font-size="9">${fmtD(chartLogs[idx].date)}</text>`;
    }).join('');

    const pathStr = pts.length >= 2 ? pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ') : '';
    const areaStr = pts.length >= 2 ? `M${pts[0].x.toFixed(1)},${(padT + plotH).toFixed(1)} L` + pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' L') + ` L${pts[pts.length-1].x.toFixed(1)},${(padT + plotH).toFixed(1)} Z` : '';

    chartHTML = `<svg class="chart-svg" viewBox="0 0 ${svgW} ${svgH}" preserveAspectRatio="xMidYMid meet">
      <defs><linearGradient id="g2" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="var(--moss)" stop-opacity="0.25"/><stop offset="100%" stop-color="var(--moss)" stop-opacity="0"/></linearGradient></defs>
      <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + plotH}" stroke="rgba(0,0,0,0.12)" stroke-width="1"/>
      <line x1="${padL}" y1="${padT + plotH}" x2="${svgW - padR}" y2="${padT + plotH}" stroke="rgba(0,0,0,0.12)" stroke-width="1"/>
      ${grid}
      ${areaStr ? `<path d="${areaStr}" fill="url(#g2)"/>` : ''}
      ${pathStr ? `<path d="${pathStr}" stroke="var(--moss)" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>` : ''}
      ${pts.map(p => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.5" fill="var(--moss)"/>`).join('')}
      ${xLabels}
    </svg>`;
  }

  const checkLogs = logs.filter(l => l.type === 'health-check');
  const latestDiagnosis = checkLogs.find(l => l.diagnosis || l.cure);

  // Build photo timeline: profile photo + health check photos, chronological
  const photoEntries = [];
  if (p.photo) photoEntries.push({ src: p.photo, date: p.acquired || '', label: p.acquired ? fmtDate(p.acquired) : 'Profile', tag: 'Profile' });
  [...checkLogs].reverse().forEach(l => {
    if (l.photo) photoEntries.push({ src: l.photo, date: l.date, label: fmtDate(l.date), tag: null });
  });
  photoEntries.sort((a, b) => a.date.localeCompare(b.date));
  const photosHTML = photoEntries.length === 0 ? '' : `
    <div class="section-title">Photos</div>
    <div class="photo-timeline">
      ${photoEntries.map(ph => `
        <div class="photo-item">
          <div class="photo-thumb" style="background-image:url('${ph.src}')" onclick="openPhotoLightbox('${ph.src}')"></div>
          ${ph.tag ? `<div class="photo-thumb-tag">${ph.tag}</div>` : ''}
          <div class="photo-thumb-label">${ph.label}</div>
        </div>`).join('')}
    </div>`;

  document.getElementById('view').innerHTML = `
    <a class="back-btn" onclick="go('plant/${id}')">${icons.back} ${escape(p.name)}</a>

    ${photosHTML}

    <div class="chart-wrap">
      <h4>Trend</h4>
      ${chartHTML}
    </div>

    <button onclick="openHealthCheckSheet('${id}')" style="width:100%;padding:11px;background:var(--moss);color:var(--surface);border-radius:var(--radius-sm);font-weight:600;font-size:14px;margin-bottom:20px;">Add health check</button>

    ${latestDiagnosis ? `
    <div class="section-title">Latest Diagnosis · ${fmtDate(latestDiagnosis.date)}</div>
    <div class="card" style="margin-bottom:20px;padding:0;overflow:hidden;">
      <div class="diag-table-wrap" style="margin:0;border:none;"><table class="diag-table"><thead><tr><th>Diagnosis</th><th>Cure</th></tr></thead><tbody><tr><td>${escape(latestDiagnosis.diagnosis || '')}</td><td>${escape(latestDiagnosis.cure || '')}</td></tr></tbody></table></div>
    </div>` : ''}

    <div class="section-title">Health checks</div>
    ${checkLogs.length === 0 ? `<div class="empty" style="padding:30px 0;"><p>No health checks yet.</p></div>` :
      `<div class="card" style="padding:4px 16px;">${checkLogs.map(l => {
        return `<div class="log-entry" style="flex-wrap:wrap;cursor:pointer;" onclick="openHealthCheckDetail('${l.id}')">
          <div class="log-icon ${logCls(l.type)}">${logIcon(l.type)}</div>
          <div class="log-body">
            <div class="log-type">${logTypeLabel(l.type)}</div>
            <div class="log-date">${fmtDate(l.date)}</div>
            ${l.notes ? `<div class="log-notes">"${escape(l.notes)}"</div>` : ''}
          </div>
          ${logScoreBadge(l)}
        </div>`;
      }).join('')}</div>`
    }
  `;
}

// --- Logs ---
function renderLogs() {
  setHeader(`<div><div class="header-sub">All entries</div><div class="header-title">Log</div></div>`);
  const logs = [...data.logs].reverse().sort((a, b) => b.date.localeCompare(a.date));
  if (logs.length === 0) {
    document.getElementById('view').innerHTML = `<div class="empty" style="margin-top:60px;"><div class="empty-icon">📓</div><h3>No entries yet</h3><p>Log a watering or observation from a plant's page.</p></div>`;
    return;
  }
  // group by date
  const groups = {};
  logs.forEach(l => { (groups[l.date] = groups[l.date] || []).push(l); });
  const html = Object.keys(groups).sort((a, b) => b.localeCompare(a)).map(date => {
    return `<div class="section-title" style="margin-top:18px;">${fmtDate(date)}</div>
      <div class="card" style="padding:4px 16px;">${groups[date].map(l => {
        const p = data.plants.find(p => p.id === l.plantId);
        return `<div class="log-entry" onclick="${p ? `go('plant/${p.id}')` : ''}">
          <div class="log-icon ${logCls(l.type)}">${logIcon(l.type)}</div>
          <div class="log-body">
            <div class="log-type">${logTypeLabel(l.type)} · ${p ? escape(p.name) : 'deleted plant'}</div>
            ${l.notes ? `<div class="log-notes">"${escape(l.notes)}"</div>` : ''}
          </div>
          ${logScoreBadge(l)}
        </div>`;
      }).join('')}</div>`;
  }).join('');
  document.getElementById('view').innerHTML = html;
}

// --- Settings ---
function renderSettings() {
  setHeader(`<div><div class="header-sub">App</div><div class="header-title">Settings</div></div>`);
  document.getElementById('view').innerHTML = `
    <div class="section-title">AI</div>
    <div class="card" style="padding:16px;">
      <div class="field" style="margin-bottom:10px;">
        <label>Claude API Key</label>
        <input type="password" id="apiKeyInput" value="${getApiKey()}" placeholder="sk-ant-…" autocomplete="off">
      </div>
      <button onclick="saveApiKey()" style="width:100%;padding:11px;background:var(--moss);color:var(--surface);border-radius:var(--radius-sm);font-weight:600;font-size:14px;">Save key</button>
      <div style="font-size:12px;color:var(--ink-faint);margin-top:10px;">Used to identify plants from photos. Key is stored locally on this device only. Get one at console.anthropic.com.</div>
    </div>

    <div class="section-title">Data</div>
    <button class="setting-row" onclick="exportData()">
      <span><strong>Export backup</strong><br><span style="font-size:13px;color:var(--ink-faint);">Download as JSON</span></span>
      ${icons.download}
    </button>
    <button class="setting-row" onclick="document.getElementById('importInput').click()">
      <span><strong>Import backup</strong><br><span style="font-size:13px;color:var(--ink-faint);">Replace current data</span></span>
      ${icons.upload}
    </button>
    <input type="file" id="importInput" accept=".json,application/json" style="display:none" onchange="importData(event)">

    <div class="section-title">Stats</div>
    <div class="card">
      <div style="display:flex;justify-content:space-between;padding:6px 0;"><span>Plants tracked</span><strong>${data.plants.length}</strong></div>
      <div style="display:flex;justify-content:space-between;padding:6px 0;border-top:1px solid var(--divider);"><span>Total log entries</span><strong>${data.logs.length}</strong></div>
      <div style="display:flex;justify-content:space-between;padding:6px 0;border-top:1px solid var(--divider);"><span>Storage used</span><strong>${(JSON.stringify(data).length/1024).toFixed(1)} KB</strong></div>
    </div>

    <div class="section-title">Danger zone</div>
    <button class="setting-row danger" onclick="resetAll()">
      <span><strong>Reset all data</strong><br><span style="font-size:13px;color:var(--ink-faint);">Delete all plants and logs</span></span>
      ${icons.trash}
    </button>

    <div style="text-align:center;color:var(--ink-faint);font-size:12px;margin-top:32px;font-family:'Fraunces',serif;">Garden · v${APP_VERSION}</div>
  `;
}

// ============================================================
// ACTIONS
// ============================================================
function quickLog(plantId, type) {
  data.logs.push({ id: uid(), plantId, type, date: today(), notes: '', healthScore: null });
  saveData();
  toast(type === 'water' ? '💧 Watered' : type === 'fertilise' ? '💦 Misted' : 'Logged');
  render();
}

function deletePlant(id) {
  const p = data.plants.find(p => p.id === id);
  if (!p) return;
  if (!confirm(`Delete "${p.name}" and all its log entries?`)) return;
  data.plants = data.plants.filter(x => x.id !== id);
  data.logs = data.logs.filter(l => l.plantId !== id);
  saveData();
  toast('Plant removed');
  go('plants');
}

function exportData() {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `garden-backup-${today()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast('Exported');
}
function importData(e) {
  const f = e.target.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = ev => {
    try {
      const parsed = JSON.parse(ev.target.result);
      if (!parsed.plants || !parsed.logs) throw new Error('Invalid');
      if (!confirm('This will replace all current data. Continue?')) return;
      data = parsed;
      saveData();
      toast('Imported');
      render();
    } catch { alert('Invalid backup file.'); }
  };
  r.readAsText(f);
  e.target.value = '';
}
function resetAll() {
  if (!confirm('This permanently deletes all plants and logs. Are you sure?')) return;
  if (!confirm('Really? This cannot be undone.')) return;
  data = JSON.parse(JSON.stringify(DEFAULT_DATA));
  saveData();
  toast('Reset complete');
  render();
}

// ============================================================
// SHEETS
// ============================================================
const sheet = document.getElementById('sheet');
const backdrop = document.getElementById('backdrop');
function openSheet() { sheet.classList.add('open'); backdrop.classList.add('open'); }
function closeSheet() { sheet.classList.remove('open'); backdrop.classList.remove('open'); }
backdrop.addEventListener('click', closeSheet);

function openPlantSheet(id) {
  const editing = id ? data.plants.find(p => p.id === id) : null;
  const p = editing || { name: '', species: '', location: '', acquired: today(), wateringDays: 7, mistsPerWeek: 2, notes: '', photo: '' };
  document.getElementById('sheetHeader').innerHTML = `
    <button class="sheet-close" onclick="closeSheet()">Cancel</button>
    <h2>${editing ? 'Edit plant' : 'New plant'}</h2>
    <button class="sheet-save" onclick="savePlant('${id || ''}')">Save</button>`;
  document.getElementById('sheetBody').innerHTML = `
    <div class="field">
      <div class="photo-input ${p.photo ? 'has-photo' : ''}" id="photoInput" style="${p.photo ? `background-image:url('${p.photo}')` : ''}">
        ${!p.photo ? `${icons.camera}<span>Add photo</span>` : ''}
      </div>
      <input type="file" id="photoFile" accept="image/*" capture="environment" style="display:none">
      <button id="identifyBtn" style="${p.photo ? '' : 'display:none;'}margin-top:8px;width:100%;padding:11px;background:var(--moss);color:var(--surface);border-radius:var(--radius-sm);font-weight:600;font-size:14px;">Identify plant</button>
    </div>
    <div class="field"><label>Name</label><input type="text" id="f_name" value="${escape(p.name)}" placeholder="e.g. Living room monstera"></div>
    <div class="field"><label>Species (optional)</label><input type="text" id="f_species" value="${escape(p.species)}" placeholder="e.g. Monstera deliciosa"></div>
    <div class="field"><label>Location</label><input type="text" id="f_location" value="${escape(p.location)}" placeholder="e.g. Kitchen window"></div>
    <div class="field-row">
      <div class="field"><label>Water every (days)</label><input type="number" id="f_water" value="${p.wateringDays || ''}" min="0" placeholder="7"></div>
      <div class="field"><label>Mists per week</label><input type="number" id="f_fert" value="${p.mistsPerWeek || ''}" min="0" placeholder="2"></div>
    </div>
    <div class="field"><label>Acquired</label><input type="date" id="f_acquired" value="${p.acquired || today()}"></div>
    <div class="field"><label>Notes</label><textarea id="f_notes" placeholder="Any care preferences, sources, etc.">${escape(p.notes)}</textarea></div>
  `;
  // photo handler
  const photoInput = document.getElementById('photoInput');
  const photoFile = document.getElementById('photoFile');
  let currentPhoto = p.photo || '';
  photoInput.onclick = () => photoFile.click();
  photoFile.onchange = async () => {
    const f = photoFile.files[0];
    if (!f) return;
    currentPhoto = await compressImage(f);
    photoInput.style.backgroundImage = `url('${currentPhoto}')`;
    photoInput.classList.add('has-photo');
    photoInput.innerHTML = '';
    document.getElementById('identifyBtn').style.display = '';
  };
  // identify handler
  document.getElementById('identifyBtn').onclick = async function() {
    if (!currentPhoto) return;
    this.textContent = 'Identifying…';
    this.disabled = true;
    try {
      const result = await identifyPlant(currentPhoto);
      if (result && result.commonName) {
        document.getElementById('f_name').value = result.commonName;
        if (result.scientificName) document.getElementById('f_species').value = result.scientificName;
        if (result.wateringDays) document.getElementById('f_water').value = result.wateringDays;
        if (result.mistsPerWeek) document.getElementById('f_fert').value = result.mistsPerWeek;
        if (result.notes) document.getElementById('f_notes').value = result.notes;
        toast(`Identified: ${result.commonName}`);
      } else {
        toast('Could not identify — try a clearer photo');
      }
    } catch(e) {
      alert('Identification failed: ' + e.message);
    } finally {
      this.textContent = 'Identify plant';
      this.disabled = false;
    }
  };
  // expose
  window.__photoVal = () => currentPhoto;
  openSheet();
}

function savePlant(id) {
  const v = sel => document.getElementById(sel).value.trim();
  const name = v('f_name');
  if (!name) { alert('Please enter a name.'); return; }
  const obj = {
    id: id || uid(),
    name,
    species: v('f_species'),
    location: v('f_location'),
    acquired: v('f_acquired') || today(),
    wateringDays: parseInt(v('f_water')) || 0,
    mistsPerWeek: parseInt(v('f_fert')) || 0,
    notes: v('f_notes'),
    photo: window.__photoVal ? window.__photoVal() : ''
  };
  if (id) {
    const i = data.plants.findIndex(p => p.id === id);
    if (i !== -1) data.plants[i] = obj;
  } else {
    data.plants.push(obj);
  }
  saveData();
  closeSheet();
  toast(id ? 'Updated' : 'Plant added');
  if (!id) go('plant/' + obj.id);
  else render();
}

function openHealthCheckSheet(plantId) {
  const p = data.plants.find(p => p.id === plantId);
  if (!p) return;
  document.getElementById('sheetHeader').innerHTML = `
    <button class="sheet-close" onclick="closeSheet()">Cancel</button>
    <h2>Health check</h2>
    <button class="sheet-save" onclick="saveHealthCheck('${plantId}')">Save</button>`;
  document.getElementById('sheetBody').innerHTML = `
    <div style="font-family:'Fraunces',serif;color:var(--ink-soft);margin-bottom:18px;text-align:center;">for ${escape(p.name)}</div>
    <div class="field">
      <label>Photo for AI rating (optional)</label>
      <div id="hcPhoto" class="photo-input">
        ${icons.camera}<span>Tap to photograph your plant</span>
      </div>
      <input type="file" id="hcFile" accept="image/*" capture="environment" style="display:none">
      <div id="hcStatus" style="display:none;text-align:center;padding:10px 0;font-size:13px;color:var(--ink-faint);">Analysing with AI…</div>
      <div id="hcError" style="display:none;text-align:center;padding:6px 0;font-size:12px;color:var(--terracotta);"></div>
    </div>
    <div class="field">
      <label>Visual health score</label>
      <div class="health-slider-wrap">
        <div class="health-slider-val" id="hcVal">7</div>
        <input type="range" id="hc_health" min="1" max="10" value="7">
        <div class="slider-scale"><span>Struggling</span><span>Thriving</span></div>
      </div>
    </div>
    <div id="hcDiagnosisPreview" style="display:none;"></div>
    <div class="field"><label>Notes</label><textarea id="hc_notes" placeholder="Anything you noticed…"></textarea></div>
    <input type="hidden" id="hc_diagnosis" value="">
    <input type="hidden" id="hc_cure" value="">
    <input type="hidden" id="hc_photo" value="">
  `;
  const photoEl = document.getElementById('hcPhoto');
  const fileEl  = document.getElementById('hcFile');
  const status  = document.getElementById('hcStatus');
  const errEl   = document.getElementById('hcError');
  const slider  = document.getElementById('hc_health');
  const valEl   = document.getElementById('hcVal');
  slider.oninput = () => valEl.textContent = slider.value;
  photoEl.onclick = () => fileEl.click();
  fileEl.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const b64 = await compressImage(file);
    document.getElementById('hc_photo').value = b64;
    photoEl.style.cssText += `;background-image:url('${b64}');background-size:cover;background-position:center;`;
    photoEl.innerHTML = '';
    errEl.style.display = 'none';
    status.textContent = 'Analysing with AI…';
    status.style.display = 'block';
    try {
      const result = await rateHealthFromImage(b64, true);
      slider.value = result.score;
      valEl.textContent = result.score;
      if (result.notes) document.getElementById('hc_notes').value = result.notes;
      document.getElementById('hc_diagnosis').value = result.diagnosis || '';
      document.getElementById('hc_cure').value = result.cure || '';
      const diagEl = document.getElementById('hcDiagnosisPreview');
      diagEl.innerHTML = `<div class="diag-table-wrap"><table class="diag-table"><thead><tr><th>Diagnosis</th><th>Cure</th></tr></thead><tbody><tr><td>${escape(result.diagnosis||'')}</td><td>${escape(result.cure||'')}</td></tr></tbody></table></div>`;
      diagEl.style.display = 'block';
    } catch (err) {
      errEl.textContent = err.message === 'no-key' ? 'Add a Claude API key in Settings to use AI rating.' : 'AI rating failed — set score manually.';
      errEl.style.display = 'block';
    } finally {
      status.style.display = 'none';
    }
  };
  openSheet();
}

function saveHealthCheck(plantId) {
  const visualScore = parseInt(document.getElementById('hc_health').value);
  const notes = document.getElementById('hc_notes').value.trim();
  const diagnosis = document.getElementById('hc_diagnosis')?.value.trim() || '';
  const cure = document.getElementById('hc_cure')?.value.trim() || '';
  const photo = document.getElementById('hc_photo')?.value || '';
  const entry = { id: uid(), plantId, type: 'health-check', date: today(), visualScore, notes };
  if (diagnosis) entry.diagnosis = diagnosis;
  if (cure) entry.cure = cure;
  if (photo) entry.photo = photo;
  data.logs.push(entry);
  saveData();
  closeSheet();
  toast('❤️ Health check saved');
  render();
}

function openHealthCheckDetail(logId) {
  const l = data.logs.find(l => l.id === logId);
  if (!l) return;
  const scoreColor = l.visualScore >= 7 ? 'var(--moss)' : l.visualScore >= 4 ? '#c8820a' : 'var(--terracotta)';
  document.getElementById('sheetHeader').innerHTML = `
    <button class="sheet-close" style="color:var(--terracotta);" onclick="deleteHealthCheck('${l.id}','${l.plantId}')">Delete</button>
    <h2>Health check</h2>
    <button class="sheet-close" onclick="closeSheet()">Done</button>`;
  document.getElementById('sheetBody').innerHTML = `
    <div style="text-align:center;margin-bottom:20px;">
      <div style="font-size:52px;font-weight:700;color:${scoreColor};font-family:'Fraunces',serif;line-height:1;">${l.visualScore}</div>
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:var(--ink-faint);margin-top:2px;">out of 10</div>
      <div style="font-size:14px;color:var(--ink-soft);margin-top:6px;">${fmtDate(l.date)}</div>
    </div>
    ${l.photo ? `<div onclick="openPhotoLightbox('${l.photo}')" style="width:100%;aspect-ratio:4/3;background-image:url('${l.photo}');background-size:cover;background-position:center;border-radius:var(--radius-sm);margin-bottom:16px;cursor:pointer;"></div>` : ''}
    ${(l.diagnosis || l.cure) ? `<div class="diag-table-wrap" style="margin-bottom:16px;"><table class="diag-table"><thead><tr><th>Diagnosis</th><th>Cure</th></tr></thead><tbody><tr><td>${escape(l.diagnosis||'')}</td><td>${escape(l.cure||'')}</td></tr></tbody></table></div>` : ''}
    ${l.notes ? `<div class="field" style="margin-bottom:0;"><label>Notes</label><div style="font-size:14px;color:var(--ink);line-height:1.6;padding:10px 12px;background:var(--surface-2,#f5f5f0);border-radius:var(--radius-sm);">${escape(l.notes)}</div></div>` : ''}
  `;
  openSheet();
}

function deleteHealthCheck(logId, plantId) {
  if (!confirm('Delete this health check?')) return;
  data.logs = data.logs.filter(l => l.id !== logId);
  saveData();
  closeSheet();
  toast('Health check deleted');
  renderPlantHealth(plantId);
}

function openLogSheet(plantId) {
  const p = data.plants.find(p => p.id === plantId);
  if (!p) return;
  document.getElementById('sheetHeader').innerHTML = `
    <button class="sheet-close" onclick="closeSheet()">Cancel</button>
    <h2>New entry</h2>
    <button class="sheet-save" onclick="saveLog('${plantId}')">Save</button>`;
  document.getElementById('sheetBody').innerHTML = `
    <div style="font-family:'Fraunces',serif;color:var(--ink-soft);margin-bottom:18px;text-align:center;">for ${escape(p.name)}</div>
    <div class="field">
      <label>Type</label>
      <div class="seg" id="logType">
        <button data-v="water">Water</button>
        <button data-v="fertilise">Mist</button>
        <button data-v="health-check" class="active">Health</button>
        <button data-v="observation">Observe</button>
        <button data-v="repot">Repot</button>
      </div>
    </div>
    <div class="field"><label>Date</label><input type="date" id="f_date" value="${today()}"></div>
    <div class="field" id="healthSliderField">
      <label>Visual health score</label>
      <div class="health-slider-wrap">
        <div class="health-slider-val" id="healthVal">7</div>
        <input type="range" id="f_health" min="1" max="10" value="7">
        <div class="slider-scale"><span>Struggling</span><span>Thriving</span></div>
      </div>
    </div>
    <div class="field"><label>Notes</label><textarea id="f_lognotes" placeholder="New leaf, soil moisture, pests, anything you noticed..."></textarea></div>
  `;
  let logType = 'health-check';
  const sliderField = document.getElementById('healthSliderField');
  const updateSliderVisibility = () => { sliderField.style.display = logType === 'health-check' ? '' : 'none'; };
  document.querySelectorAll('#logType button').forEach(b => {
    b.onclick = () => {
      document.querySelectorAll('#logType button').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      logType = b.dataset.v;
      updateSliderVisibility();
    };
  });
  window.__logType = () => logType;
  const slider = document.getElementById('f_health');
  const valDisplay = document.getElementById('healthVal');
  slider.oninput = () => valDisplay.textContent = slider.value;
  openSheet();
}

function saveLog(plantId) {
  const type = window.__logType();
  const date = document.getElementById('f_date').value || today();
  const notes = document.getElementById('f_lognotes').value.trim();
  const visualScore = type === 'health-check' ? parseInt(document.getElementById('f_health').value) : null;
  data.logs.push({ id: uid(), plantId, type, date, visualScore, notes });
  saveData();
  closeSheet();
  toast(type === 'health-check' ? '❤️ Health check saved' : 'Entry saved');
  render();
}

// ============================================================
// IMAGES
// ============================================================
async function compressImage(file) {
  return new Promise(resolve => {
    const r = new FileReader();
    r.onload = e => {
      const img = new Image();
      img.onload = () => {
        const max = 800;
        let w = img.width, h = img.height;
        if (w > max || h > max) {
          if (w > h) { h = h * max / w; w = max; }
          else { w = w * max / h; h = max; }
        }
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL('image/jpeg', 0.75));
      };
      img.src = e.target.result;
    };
    r.readAsDataURL(file);
  });
}

function openPhotoLightbox(src) {
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.92);z-index:300;display:flex;align-items:center;justify-content:center;cursor:pointer;';
  ov.onclick = () => ov.remove();
  const img = document.createElement('img');
  img.src = src;
  img.style.cssText = 'max-width:100%;max-height:100%;object-fit:contain;border-radius:4px;';
  ov.appendChild(img);
  document.body.appendChild(ov);
}

// ============================================================
// UTILS
// ============================================================
function escape(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function setHeader(html) { document.getElementById('header').innerHTML = html; }
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 1800);
}

// ============================================================
// EVENTS
// ============================================================
document.querySelectorAll('.tab').forEach(t => {
  t.addEventListener('click', () => go(t.dataset.route));
});
document.getElementById('addBtn').addEventListener('click', () => {
  const r = getRoute();
  if (r.startsWith('plant/')) openLogSheet(r.split('/')[1]);
  else openPlantSheet();
});

/* PWA service worker */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(()=>{}));
}

/* boot */
go(getRoute());
render();
