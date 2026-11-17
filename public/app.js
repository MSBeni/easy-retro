import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, signInAnonymously } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getDatabase, ref, onValue, get, set, update, push, remove, serverTimestamp, onDisconnect,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js';

const PHASES = [
  { id: 'write', label: 'Write', hint: 'Add your cards. Nobody else can see them until the facilitator reveals them.' },
  { id: 'reveal', label: 'Reveal', hint: 'Everyone can see all cards now, with no names on them. If a card is yours, feel free to talk about it.' },
  { id: 'vote', label: 'Vote', hint: 'Spend your votes on the cards you most want to discuss. Totals stay hidden until discussion.' },
  { id: 'discuss', label: 'Discuss', hint: 'Cards are sorted by votes. Capture action items as you go.' },
  { id: 'done', label: 'Wrap up', hint: 'Review the action items and export the summary.' },
];

const TEMPLATES = {
  wwt: { label: "Went well / Didn't go well / Try next", columns: ['What went well', "What didn't go well", 'What should we try'] },
  ssc: { label: 'Start / Stop / Continue', columns: ['Start', 'Stop', 'Continue'] },
  fourl: { label: 'Liked / Learned / Lacked / Longed for', columns: ['Liked', 'Learned', 'Lacked', 'Longed for'] },
  msg: { label: 'Mad / Sad / Glad', columns: ['Mad', 'Sad', 'Glad'] },
};

const appEl = document.getElementById('app');
const topRight = document.getElementById('topbar-right');

function el(tag, props = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return e;
}

let toastTimer = null;
function toast(msg) {
  let t = document.querySelector('.toast');
  if (!t) { t = el('div', { class: 'toast', role: 'status' }); document.body.append(t); }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2500);
}

async function copyText(text, done = 'Copied') {
  try { await navigator.clipboard.writeText(text); toast(done); } catch { toast('Copy failed. Select and copy it manually.'); }
}

function fatal(title, detail) {
  appEl.replaceChildren(el('div', { class: 'panel home' }, el('h1', { text: title }), el('p', { class: 'muted', text: detail })));
}

const NAME_KEY = 'easy-retro:name';
function savedName() { try { return localStorage.getItem(NAME_KEY) || ''; } catch { return ''; } }
function saveName(n) { try { localStorage.setItem(NAME_KEY, n); } catch { /* private mode */ } }

const AVATAR_COLORS = ['#2f9e66', '#d1495b', '#4f6bed', '#d08c1d', '#8b5cf6', '#1f9aa1', '#e0663a', '#c2418a'];
function initials(name) {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  return ((parts[0] || '?')[0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

// Stable pseudo-random order so card order does not reveal who wrote what or when.
function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

const cfg = window.RETRO_FIREBASE_CONFIG;
if (!cfg || !cfg.apiKey || !cfg.databaseURL) {
  fatal('Setup needed', 'This deployment has no Firebase config yet. See the README for the setup steps.');
  throw new Error('Missing Firebase config');
}

const fb = initializeApp(cfg);
const auth = getAuth(fb);
const db = getDatabase(fb);
let serverOffset = 0;
onValue(ref(db, '.info/serverTimeOffset'), (s) => { serverOffset = s.val() || 0; });
const now = () => Date.now() + serverOffset;

let uid;
try {
  await signInAnonymously(auth);
  uid = auth.currentUser.uid;
} catch (e) {
  fatal('Could not sign in', 'Anonymous sign-in failed. If you run this deployment, check that Anonymous sign-in is enabled in Firebase Authentication.');
  throw e;
}

const roomParam = new URLSearchParams(location.search).get('room');
if (roomParam && /^[A-Za-z0-9_-]{6,40}$/.test(roomParam)) Room(roomParam);
else Home();

// ---------------------------------------------------------------- Home

async function Home() {
  topRight.replaceChildren();
  let isAdmin = false;
  try { isAdmin = (await get(ref(db, `admins/${uid}`))).val() === true; } catch { isAdmin = false; }

  const joinInput = el('input', { type: 'text', placeholder: 'Paste a retro link or code' });
  const join = () => {
    const v = joinInput.value.trim();
    const m = v.match(/[?&]room=([A-Za-z0-9_-]+)/);
    const id = m ? m[1] : v;
    if (/^[A-Za-z0-9_-]{6,40}$/.test(id)) location.search = `?room=${id}`;
    else toast('That does not look like a retro link');
  };
  joinInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); });
  const joinPanel = el('section', { class: 'panel' },
    el('h2', { text: 'Join a retro', style: 'margin-top:0;font-size:18px' }),
    el('div', { class: 'row' }, joinInput, el('button', { class: 'btn', text: 'Join', onclick: join })));

  let createPanel;
  if (isAdmin) {
    const title = el('input', { type: 'text', maxlength: '120', placeholder: 'e.g. Project X retro' });
    const tmpl = el('select', {}, Object.entries(TEMPLATES).map(([k, t]) => el('option', { value: k, text: t.label })));
    const votes = el('select', {}, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => el('option', { value: String(n), text: `${n} vote${n > 1 ? 's' : ''} per person`, selected: n === 3 })));
    const create = el('button', { class: 'btn primary', text: 'Create retro' });
    create.addEventListener('click', async () => {
      const t = title.value.trim();
      if (!t) { title.focus(); return; }
      create.disabled = true;
      const id = push(ref(db, 'rooms')).key;
      try {
        await update(ref(db), {
          [`rooms/${id}/meta`]: {
            title: t, facilitator: uid, createdAt: serverTimestamp(),
            columns: TEMPLATES[tmpl.value].columns, votesPerPerson: Number(votes.value),
          },
          [`rooms/${id}/state`]: { phase: 'write' },
        });
        location.search = `?room=${id}`;
      } catch (e) {
        create.disabled = false;
        toast(`Could not create the retro: ${e.message}`);
      }
    });
    createPanel = el('section', { class: 'panel' },
      el('h2', { text: 'Start a retro', style: 'margin-top:0;font-size:18px' }),
      el('div', { class: 'field' }, el('label', { text: 'Title' }), title),
      el('div', { class: 'field' }, el('label', { text: 'Format' }), tmpl),
      el('div', { class: 'field' }, el('label', { text: 'Votes' }), votes),
      el('div', { class: 'row', style: 'margin-top:8px' }, create));
  } else {
    createPanel = el('section', { class: 'panel' },
      el('h2', { text: 'Start a retro', style: 'margin-top:0;font-size:18px' }),
      el('p', { class: 'muted', text: 'Only facilitators can start retros. To make this browser a facilitator, the person who runs this deployment adds the id below under "admins" in the database (see the README).' }),
      el('div', { class: 'row' }, el('span', { class: 'code', text: uid }), el('button', { class: 'btn small', text: 'Copy id', onclick: () => copyText(uid) })));
  }

  appEl.replaceChildren(el('div', { class: 'home' },
    el('div', {}, el('h1', { text: 'Retrospectives', style: 'margin:0 0 6px' }),
      el('p', { class: 'muted', style: 'margin:0', text: 'Write privately, reveal together, vote, discuss and leave with owned action items. Cards never show who wrote them.' })),
    createPanel, joinPanel));
}

// ---------------------------------------------------------------- Room

function Room(id) {
  const base = `rooms/${id}`;
  const S = {
    meta: null, state: null, cards: {}, votes: {}, myVotes: {}, actions: {}, presence: {},
    ready: false, editing: null, built: false, lastFocus: null, deleteArmed: false,
    name: savedName(), pid: null, vid: null, started: false,
  };
  const subs = {};

  const mineKey = `easy-retro:${id}:mine`;
  let mine = {};
  try { mine = JSON.parse(localStorage.getItem(mineKey)) || {}; } catch { mine = {}; }
  const saveMine = () => { try { localStorage.setItem(mineKey, JSON.stringify(mine)); } catch { /* private mode */ } };

  const isF = () => S.meta && S.meta.facilitator === uid;

  appEl.replaceChildren(el('p', { class: 'muted', text: 'Joining…' }));

  onValue(ref(db, `${base}/meta`), (s) => {
    if (!s.exists()) { notFound(); return; }
    S.meta = s.val();
    if (S.started) { render(); return; }
    if (S.name) start();
    else nameGate();
  }, () => notFound());

  // Names are shown in the participant list only. Presence and votes are keyed by
  // random per-room ids, so nothing on the page can link a name to a card or a vote.
  function nameGate() {
    const input = el('input', { type: 'text', maxlength: '40', placeholder: 'Your name', value: S.name, 'aria-label': 'Your name' });
    const go = () => {
      const n = input.value.trim();
      if (!n) { input.focus(); return; }
      S.name = n;
      saveName(n);
      if (S.started) { updatePresence(); render(); } else start();
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    appEl.replaceChildren(el('div', { class: 'panel namegate' },
      el('h1', { text: S.meta.title }),
      el('p', { class: 'muted', text: 'Add your name so the group can see who has joined. Your cards and votes stay anonymous: nothing links them to your name.' }),
      el('div', { class: 'field' }, input),
      el('button', { class: 'btn primary', text: 'Join the retro', onclick: go })));
    input.focus();
  }

  async function start() {
    if (S.started) return;
    S.started = true;
    build();
    try {
      S.pid = (await get(ref(db, `${base}/seats/${uid}`))).val();
      if (!S.pid) {
        S.pid = push(ref(db, `${base}/presence`)).key;
        await update(ref(db, base), { [`seats/${uid}`]: S.pid, [`presence/${S.pid}`]: { name: S.name, ready: false } });
      }
      S.vid = (await get(ref(db, `${base}/ballots/${uid}`))).val();
    } catch (e) {
      toast(`Could not join: ${e.message}`);
    }
    if (S.vid) watchMyVotes();
    onValue(ref(db, '.info/connected'), (c) => {
      if (c.val() !== true || !S.pid) return;
      onDisconnect(ref(db, `${base}/presence/${S.pid}`)).remove();
      updatePresence();
    });
    onValue(ref(db, `${base}/state`), (st) => { S.state = st.val() || { phase: 'write' }; syncSubscriptions(); render(); });
    onValue(ref(db, `${base}/presence`), (p) => { S.presence = p.val() || {}; render(); });
    onValue(ref(db, `${base}/actions`), (a) => { S.actions = a.val() || {}; render(); }, () => {});
  }

  function updatePresence() {
    if (!S.pid) return Promise.resolve();
    return set(ref(db, `${base}/presence/${S.pid}`), { name: S.name, ready: S.ready }).catch(() => {});
  }

  function watchMyVotes() {
    if (subs.myVotes || !S.vid) return;
    subs.myVotes = onValue(ref(db, `${base}/votes/${S.vid}`), (v) => { S.myVotes = v.val() || {}; render(); }, () => { subs.myVotes = null; });
  }

  function notFound() {
    appEl.replaceChildren(el('div', { class: 'panel home' },
      el('h1', { text: 'Retro not found' }),
      el('p', { class: 'muted', text: 'The link may be wrong, or the facilitator deleted this retro.' }),
      el('p', {}, el('a', { href: './', text: 'Go to the start page' }))));
  }

  function subscribe(key, path, onData) {
    if (subs[key]) return;
    subs[key] = onValue(ref(db, path), (s) => onData(s.val() || {}), () => {
      // Permission can lag a phase change by a moment. Drop and retry shortly.
      subs[key] = null;
      setTimeout(syncSubscriptions, 800);
    });
  }
  function unsubscribe(key, clear) {
    if (subs[key]) { subs[key](); subs[key] = null; }
    clear();
  }

  function syncSubscriptions() {
    if (!S.state) return;
    const p = S.state.phase;
    if (p !== 'write') subscribe('cards', `${base}/cards`, (v) => { S.cards = v; render(); });
    else unsubscribe('cards', () => { S.cards = {}; });
    if (p === 'discuss' || p === 'done') subscribe('votes', `${base}/votes`, (v) => { S.votes = v; render(); });
    else unsubscribe('votes', () => { S.votes = {}; });
    if (p !== 'write' && S.editing) clearEditing();
  }

  // --------------------------------------------------------- layout
  const dom = {};
  function build() {
    if (S.built) return;
    S.built = true;
    document.title = `${S.meta.title} · Easy Retro`;
    dom.title = el('h1');
    dom.steps = el('ol', { class: 'steps', 'aria-label': 'Retro phases' });
    dom.sub = el('div', { class: 'people', id: 'participants' });
    dom.timer = el('div', { class: 'timer', 'aria-label': 'Timer' });
    dom.facil = el('div', { class: 'facil', id: 'facilitator-controls' });
    dom.hint = el('div', { class: 'hint', id: 'phase-hint' });
    dom.board = el('div', { class: 'board', id: 'board' });
    dom.cols = S.meta.columns.map((name, i) => {
      const list = el('div', { class: 'cards' });
      const ta = el('textarea', { maxlength: '500', placeholder: 'Add a card…', 'aria-label': `Add a card to ${name}` });
      const save = el('button', { class: 'btn primary small', text: 'Add' });
      const cancel = el('button', { class: 'btn small', text: 'Cancel', hidden: true });
      ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save.click(); });
      save.addEventListener('click', () => submitCard(i));
      cancel.addEventListener('click', clearEditing);
      const composer = el('div', { class: 'composer' }, ta,
        el('div', { class: 'row' }, save, cancel, el('span', { class: 'muted small', text: 'Ctrl or ⌘ + Enter adds it' })));
      const count = el('span', { class: 'col-count' });
      dom.board.append(el('section', { class: 'col', style: colVars(i) }, el('div', { class: 'col-head' }, el('h2', { text: name }), count), list, composer));
      return { list, ta, save, cancel, composer, count };
    });

    dom.ranked = el('div', { class: 'cards ranked', id: 'ranked-cards' });
    dom.actText = el('input', { type: 'text', maxlength: '300', placeholder: 'Action item', 'aria-label': 'Action item' });
    dom.actOwner = el('input', { type: 'text', maxlength: '80', placeholder: 'Owner', 'aria-label': 'Owner', style: 'flex:1' });
    dom.actDue = el('input', { type: 'text', maxlength: '40', placeholder: 'Due (e.g. Nov 28)', 'aria-label': 'Due date', style: 'flex:1' });
    dom.actAdd = el('button', { class: 'btn primary', text: 'Add action', onclick: addAction });
    dom.actText.addEventListener('keydown', (e) => { if (e.key === 'Enter') addAction(); });
    dom.actList = el('ul', { class: 'actions-list' });
    dom.actPanel = el('section', { class: 'panel', id: 'action-items' },
      el('h2', { text: 'Action items', style: 'font-size:16px;margin:0' }), dom.actList,
      el('div', { class: 'field' }, dom.actText),
      el('div', { class: 'row', style: 'margin-top:6px' }, dom.actOwner, dom.actDue),
      el('div', { class: 'row', style: 'margin-top:8px' }, dom.actAdd));
    dom.discuss = el('div', { class: 'discuss', id: 'discussion' }, el('div', {}, dom.ranked), dom.actPanel);
    dom.done = el('section', { class: 'panel', id: 'summary', style: 'margin-bottom:16px' });

    appEl.replaceChildren(
      el('section', { class: 'panel hero' }, el('div', {}, dom.title, dom.steps, dom.sub), dom.timer),
      dom.facil, dom.hint, dom.done, dom.board, dom.discuss);
    setInterval(tick, 500);
  }

  // --------------------------------------------------------- render
  function render() {
    if (!S.built || !S.state) return;
    const phase = S.state.phase;
    const pi = Math.max(0, PHASES.findIndex((p) => p.id === phase));
    dom.title.textContent = S.meta.title;
    dom.steps.replaceChildren(...PHASES.map((p, i) => el('li', { class: i === pi ? 'on' : i < pi ? 'past' : '', text: p.label })));
    renderPeople(phase);

    topRight.replaceChildren(
      isF() ? el('span', { class: 'muted', text: 'You are facilitating' }) : null,
      el('button', { class: 'btn small', text: `${S.name} · change name`, onclick: () => { const n = (prompt('Your name', S.name) || '').trim().slice(0, 40); if (n) { S.name = n; saveName(n); updatePresence(); render(); } } }),
      el('button', { class: 'btn small', text: 'Copy invite link', onclick: () => copyText(`${location.origin}${location.pathname}?room=${id}`, 'Invite link copied') }));

    renderFacil(phase, pi);
    renderHint(phase, pi);

    const onBoard = phase === 'write' || phase === 'reveal' || phase === 'vote';
    dom.board.hidden = !onBoard;
    dom.discuss.hidden = onBoard;
    dom.done.hidden = phase !== 'done';
    if (onBoard) renderBoard(phase);
    else { renderRanked(); renderActions(); }
    if (phase === 'done') renderDone();
    tick();
  }

  function renderFacil(phase, pi) {
    dom.facil.hidden = !isF();
    if (!isF()) return;
    const next = PHASES[pi + 1];
    const prev = PHASES[pi - 1];
    dom.facil.replaceChildren(
      el('strong', { text: 'Facilitator' }),
      el('button', { class: 'btn small', text: prev ? `← ${prev.label}` : '← Back', disabled: !prev, onclick: () => setPhase(prev.id) }),
      el('button', { class: 'btn primary small', text: next ? `Next: ${next.label} →` : 'Finished', disabled: !next, onclick: () => setPhase(next.id) }),
      el('span', { class: 'muted small', style: 'margin-left:8px', text: 'Timer' }),
      ...[1, 3, 5, 10].map((m) => el('button', { class: 'btn small', text: `${m} min`, onclick: () => setState({ timerEnd: now() + m * 60000 }) })),
      el('button', { class: 'btn small', text: '+1 min', onclick: () => setState({ timerEnd: Math.max(now(), S.state.timerEnd || 0) + 60000 }) }),
      el('button', { class: 'btn small', text: 'Stop', onclick: () => setState({ timerEnd: null }) }));
  }

  function renderHint(phase, pi) {
    const parts = [el('strong', { text: `${PHASES[pi].label}: ` }), PHASES[pi].hint];
    if (phase === 'write') {
      parts.push(' ', el('button', {
        class: 'btn small', text: S.ready ? 'I am still writing' : 'I am done',
        onclick: () => { S.ready = !S.ready; updatePresence(); render(); },
      }));
    }
    if (phase === 'vote') parts.push(el('strong', { text: ` Votes left: ${votesLeft()} of ${S.meta.votesPerPerson}.` }));
    dom.hint.replaceChildren(...parts);
  }

  function renderPeople(phase) {
    const people = Object.entries(S.presence || {}).filter(([, p]) => p && p.name)
      .sort((a, b) => a[1].name.localeCompare(b[1].name));
    const ready = people.filter(([, p]) => p.ready).length;
    dom.sub.replaceChildren(
      el('span', { class: 'count', text: `${people.length} ${people.length === 1 ? 'person' : 'people'} here${phase === 'write' ? ` · ${ready} done writing` : ''}` }),
      el('div', { class: 'avatars' }, people.map(([pid, p]) => el('span', { class: `person${pid === S.pid ? ' me' : ''}`, title: p.name },
        el('span', { class: 'avatar', style: `background:${AVATAR_COLORS[hash(p.name) % AVATAR_COLORS.length]}`, text: initials(p.name) }),
        p.name + (pid === S.pid ? ' (you)' : '')))));
  }

  function colVars(i) {
    const k = Number(i) % 6;
    return `--accent-col: var(--c${k}); --tint: var(--t${k})`;
  }

  function renderBoard(phase) {
    const source = phase === 'write' ? mine : S.cards;
    const entries = Object.entries(source).sort((a, b) => hash(a[0]) - hash(b[0]));
    dom.cols.forEach((c, i) => {
      c.composer.hidden = phase !== 'write';
      const items = entries.filter(([, v]) => v && v.col === i).map(([cid, v]) => cardEl(cid, v, phase));
      c.count.textContent = String(items.length);
      c.list.replaceChildren(...(items.length ? items : [el('div', {
        class: 'empty',
        text: phase === 'write' ? 'Your cards show here. Everyone else\'s stay hidden until the reveal.' : 'No cards',
      })]));
    });
  }

  function cardEl(cid, v, phase) {
    const meta = el('div', { class: 'meta' });
    if (phase === 'write') {
      meta.append(el('span', { text: 'Only you can see this' }), el('span', { class: 'row' },
        el('button', { class: 'btn small', text: 'Edit', onclick: () => startEditing(cid) }),
        el('button', { class: 'btn small', text: 'Delete', onclick: () => deleteOwnCard(cid) })));
    } else if (phase === 'vote') {
      const n = myVotesOn(cid);
      meta.append(
        el('span', { class: 'votes', 'aria-label': `${n} of your votes` }, ...Array.from({ length: n }, () => el('span', { class: 'dot' }))),
        el('span', { class: 'row' },
          n ? el('button', { class: 'btn small', text: '− Vote', onclick: () => unvote(cid) }) : null,
          el('button', { class: 'btn small', text: '+ Vote', disabled: votesLeft() === 0, onclick: () => vote(cid) })));
    } else if (isF()) {
      meta.append(el('span'), removeCardButton(cid));
    }
    return el('div', { class: `card${phase === 'write' ? ' mine' : ''}`, 'data-id': cid, style: colVars(v.col) }, v.text, meta.childNodes.length ? meta : null);
  }

  function removeCardButton(cid) {
    const b = el('button', { class: 'btn small danger', text: 'Remove' });
    b.addEventListener('click', () => {
      if (b.dataset.armed) { remove(ref(db, `${base}/cards/${cid}`)).catch((e) => toast(e.message)); return; }
      b.dataset.armed = '1';
      b.textContent = 'Click to confirm';
      setTimeout(() => { delete b.dataset.armed; b.textContent = 'Remove'; }, 3000);
    });
    return b;
  }

  function tally() {
    const counts = {};
    for (const slots of Object.values(S.votes || {})) {
      for (const cid of Object.values(slots || {})) counts[cid] = (counts[cid] || 0) + 1;
    }
    return counts;
  }

  function ranked() {
    const counts = tally();
    return Object.entries(S.cards).sort((a, b) => (counts[b[0]] || 0) - (counts[a[0]] || 0) || hash(a[0]) - hash(b[0])).map(([cid, v]) => ({ cid, ...v, votes: counts[cid] || 0 }));
  }

  function renderRanked() {
    const list = ranked();
    const focus = S.state.focus || null;
    if (!list.length) { dom.ranked.replaceChildren(el('div', { class: 'empty', text: 'No cards to discuss.' })); return; }
    dom.ranked.replaceChildren(...list.map((c) => el('div', { class: `card${focus === c.cid ? ' focus' : ''}`, 'data-id': c.cid, style: colVars(c.col) },
      el('div', { class: `tally${c.votes ? '' : ' zero'}`, title: 'Votes', text: String(c.votes) }),
      el('div', {},
        el('span', { class: 'tag', text: S.meta.columns[c.col] || '' }),
        el('div', { text: c.text }),
        isF() ? el('div', { class: 'meta' }, el('span', { text: focus === c.cid ? 'Discussing now' : '' }), el('span', { class: 'row' },
          el('button', { class: 'btn small', text: focus === c.cid ? 'Stop discussing' : 'Discuss this', onclick: () => setState({ focus: focus === c.cid ? null : c.cid }) }),
          removeCardButton(c.cid))) : null))));
    if (focus && focus !== S.lastFocus) {
      const target = dom.ranked.querySelector(`[data-id="${CSS.escape(focus)}"]`);
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    S.lastFocus = focus;
  }

  function renderActions() {
    const list = Object.entries(S.actions || {}).sort((a, b) => (a[1].createdAt || 0) - (b[1].createdAt || 0));
    const canAdd = S.state.phase !== 'write';
    dom.actAdd.disabled = !canAdd;
    dom.actList.replaceChildren(...(list.length ? list.map(([aid, a]) => el('li', {},
      el('div', { text: a.text }),
      el('div', { class: 'row muted small', style: 'justify-content:space-between;margin-top:4px' },
        el('span', { text: [a.owner && `Owner: ${a.owner}`, a.due && `Due: ${a.due}`].filter(Boolean).join(' · ') || 'No owner yet' }),
        isF() ? el('button', { class: 'btn small', text: 'Remove', onclick: () => remove(ref(db, `${base}/actions/${aid}`)).catch((e) => toast(e.message)) }) : null)))
      : [el('li', { class: 'empty', text: 'No action items yet.' })]));
  }

  function markdown() {
    const date = S.meta.createdAt ? new Date(S.meta.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '';
    const lines = [`# ${S.meta.title}`, '', date ? `Date: ${date}` : '', ''];
    const cards = ranked();
    S.meta.columns.forEach((name, i) => {
      lines.push(`## ${name}`);
      const inCol = cards.filter((c) => c.col === i);
      if (!inCol.length) lines.push('- (none)');
      inCol.forEach((c) => lines.push(`- ${c.votes ? `(${c.votes} vote${c.votes > 1 ? 's' : ''}) ` : ''}${c.text.replace(/\n+/g, ' ')}`));
      lines.push('');
    });
    lines.push('## Action items');
    const acts = Object.values(S.actions || {}).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    if (!acts.length) lines.push('- (none)');
    acts.forEach((a) => {
      const extra = [a.owner && `Owner: ${a.owner}`, a.due && `Due: ${a.due}`].filter(Boolean).join(', ');
      lines.push(`- [ ] ${a.text}${extra ? ` (${extra})` : ''}`);
    });
    return lines.filter((l, i, arr) => !(l === '' && arr[i - 1] === '')).join('\n');
  }

  function renderDone() {
    const md = markdown();
    const del = el('button', { class: 'btn danger', text: 'Delete this retro' });
    del.addEventListener('click', async () => {
      if (!S.deleteArmed) {
        S.deleteArmed = true;
        del.textContent = 'Click again to delete all cards, votes and actions';
        setTimeout(() => { S.deleteArmed = false; render(); }, 4000);
        return;
      }
      try { await remove(ref(db, base)); } catch (e) { toast(e.message); }
    });
    if (S.deleteArmed) del.textContent = 'Click again to delete all cards, votes and actions';
    dom.done.replaceChildren(
      el('h2', { text: 'Summary', style: 'font-size:16px;margin:0 0 8px' }),
      el('div', { class: 'row', style: 'margin-bottom:10px' },
        el('button', { class: 'btn', text: 'Copy as Markdown', onclick: () => copyText(md, 'Summary copied') }),
        el('button', { class: 'btn', text: 'Download .md', onclick: () => download(md) }),
        isF() ? del : null),
      el('pre', { class: 'export', text: md }));
  }

  function download(md) {
    const a = el('a', { href: URL.createObjectURL(new Blob([md], { type: 'text/markdown' })), download: `${S.meta.title.replace(/[^\w-]+/g, '-').toLowerCase() || 'retro'}.md` });
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  function tick() {
    if (!S.state || !dom.timer) return;
    const end = S.state.timerEnd;
    if (!end) { dom.timer.textContent = ''; dom.timer.classList.remove('up', 'low'); return; }
    const ms = end - now();
    if (ms <= 0) { dom.timer.textContent = "Time's up"; dom.timer.classList.remove('low'); dom.timer.classList.add('up'); return; }
    const s = Math.ceil(ms / 1000);
    dom.timer.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    dom.timer.classList.remove('up');
    dom.timer.classList.toggle('low', s <= 30);
  }

  // --------------------------------------------------------- actions
  function setState(patch) {
    return update(ref(db, `${base}/state`), patch).catch((e) => toast(`Could not update: ${e.message}`));
  }
  function setPhase(p) { return setState({ phase: p, timerEnd: null, focus: null }); }

  async function submitCard(col) {
    const c = dom.cols[col];
    const text = c.ta.value.trim();
    if (!text) { c.ta.focus(); return; }
    if (S.state.phase !== 'write') { toast('Writing is closed'); return; }
    c.save.disabled = true;
    try {
      if (S.editing && S.editing.col === col) {
        await update(ref(db, `${base}/cards/${S.editing.id}`), { text });
        mine[S.editing.id] = { col, text };
      } else {
        const cid = push(ref(db, `${base}/cards`)).key;
        await update(ref(db, base), {
          [`cards/${cid}`]: { col, text, createdAt: serverTimestamp() },
          [`owners/${cid}`]: uid,
        });
        mine[cid] = { col, text };
      }
      saveMine();
      c.ta.value = '';
      clearEditing();
      c.ta.focus();
    } catch (e) {
      toast(`Could not save: ${e.message}`);
    } finally {
      c.save.disabled = false;
    }
  }

  function startEditing(cid) {
    const card = mine[cid];
    if (!card) return;
    clearEditing();
    const c = dom.cols[card.col];
    S.editing = { id: cid, col: card.col };
    c.ta.value = card.text;
    c.save.textContent = 'Save';
    c.cancel.hidden = false;
    c.ta.focus();
  }

  function clearEditing() {
    if (S.editing) {
      const c = dom.cols[S.editing.col];
      if (c) { c.ta.value = ''; c.save.textContent = 'Add'; c.cancel.hidden = true; }
    }
    S.editing = null;
    render();
  }

  async function deleteOwnCard(cid) {
    try {
      await update(ref(db, base), { [`cards/${cid}`]: null, [`owners/${cid}`]: null });
      delete mine[cid];
      saveMine();
      if (S.editing && S.editing.id === cid) clearEditing();
      render();
    } catch (e) { toast(`Could not delete: ${e.message}`); }
  }

  function myVotesOn(cid) { return Object.values(S.myVotes || {}).filter((x) => x === cid).length; }
  function votesLeft() { return Math.max(0, S.meta.votesPerPerson - Object.keys(S.myVotes || {}).length); }

  async function vote(cid) {
    try {
      if (!S.vid) {
        const vid = push(ref(db, `${base}/votes`)).key;
        await update(ref(db, base), { [`ballots/${uid}`]: vid, [`votes/${vid}/v0`]: cid });
        S.vid = vid;
        S.myVotes = { v0: cid };
        watchMyVotes();
        render();
        return;
      }
      for (let i = 0; i < S.meta.votesPerPerson; i++) {
        const k = `v${i}`;
        if (!S.myVotes[k]) { await set(ref(db, `${base}/votes/${S.vid}/${k}`), cid); return; }
      }
      toast('No votes left');
    } catch (e) {
      toast(`Vote not saved: ${e.message}`);
    }
  }

  async function unvote(cid) {
    const k = Object.keys(S.myVotes || {}).find((key) => S.myVotes[key] === cid);
    if (!k || !S.vid) return;
    try { await remove(ref(db, `${base}/votes/${S.vid}/${k}`)); } catch (e) { toast(e.message); }
  }

  async function addAction() {
    const text = dom.actText.value.trim();
    if (!text) { dom.actText.focus(); return; }
    const item = { text, createdAt: serverTimestamp() };
    const owner = dom.actOwner.value.trim();
    const due = dom.actDue.value.trim();
    if (owner) item.owner = owner;
    if (due) item.due = due;
    dom.actAdd.disabled = true;
    try {
      await set(push(ref(db, `${base}/actions`)), item);
      dom.actText.value = '';
      dom.actOwner.value = '';
      dom.actDue.value = '';
      dom.actText.focus();
    } catch (e) {
      toast(`Could not add: ${e.message}`);
    } finally {
      dom.actAdd.disabled = false;
    }
  }
}
