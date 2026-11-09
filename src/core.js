/**
 * ⚽ تمرين السبت — منطق الخادم (Supabase Edge Function)
 * نفس منطق نسخة Google Sheets، لكن البيانات تُحمّل من PostgreSQL في بداية كل طلب
 * وتُحفظ التغييرات في نفس المعاملة (transaction) في نهايته.
 * الجداول في الذاكرة: TX.tables[key] = [{_row, ...columns as strings}]
 */
const TZ = 'Europe/Istanbul';
const OFFSET = '+03:00';            // Türkiye: UTC+3 all year
const MAIN = 14, RES = 4, CAP = MAIN + RES;
const LATE_MS = 24 * 3600 * 1000;
const PER_DEVICE_DEFAULT = 3;       // عدد الأسماء من الجوال الواحد (المنظّم يغيّره)
const POSITIONS = ['GK', 'DEF', 'MID', 'FWD', 'ANY'];
const REASONS = ['withdraw', 'late_withdraw', 'no_show', 'excused', 'mistake'];

const SHEETS = {
  settings: { name: 'Settings', cols: ['key', 'value'] },
  sessions: { name: 'Sessions', cols: ['id', 'date', 'start', 'end', 'lock', 'pitch', 'map', 'fee', 'seed', 'published', 'created_at'] },
  players: { name: 'Players', cols: ['id', 'name', 'pos', 'created_at'] },
  regs: { name: 'Registrations', cols: ['id', 'session_id', 'player_id', 'pos', 'created_at', 'status', 'reason', 'removed_at', 'device', 'by_admin'] },
  bib: { name: 'BibDraws', cols: ['id', 'session_id', 'n', 'team', 'at'] },
  matches: { name: 'Matches', cols: ['session_id', 'sa', 'sb', 'saved_at'] },
  match_players: { name: 'MatchPlayers', cols: ['session_id', 'player_id', 'team', 'goals', 'assists'] },
  votes: { name: 'Votes', cols: ['id', 'session_id', 'device', 'category', 'player_id', 'at'] }
};
const COLORS = {
  red: { name: 'الأحمر', c: '#ff4a3d', fill: '#c9271f' }, blue: { name: 'الأزرق', c: '#3d8bff', fill: '#1f5fd0' },
  white: { name: 'الأبيض', c: '#f2f2f2', fill: '#e8e8e8' }, black: { name: 'الأسود', c: '#a0a0a0', fill: '#1a1a1a' },
  yellow: { name: 'الأصفر', c: '#ffd23f', fill: '#e6b800' }, green: { name: 'الأخضر', c: '#3ddc84', fill: '#16944f' },
  orange: { name: 'البرتقالي', c: '#ff8a3d', fill: '#e8590c' }, purple: { name: 'البنفسجي', c: '#b18cff', fill: '#6a3fd1' },
  sky: { name: 'السماوي', c: '#6cc8ff', fill: '#2b8fd6' }
};
const MONTHS_AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

/* ============ web app ============ */

/* ============ setup (first run creates the PIN and the first session) ============ */

function setup() {
  let pin = setting_('admin_pin');
  if (pin) throw new Error('التطبيق مُعدّ مسبقاً.');
  pin = String(100000 + Math.floor(Math.random() * 900000));
  setSetting_('admin_pin', pin);
  if (!rows_('sessions').length) {
    append_('sessions', {
      id: uid_(), date: nextSaturday_(), start: '21:00', end: '22:00', lock: '20:00',
      pitch: 'SERDİVAN HALI SAHA', map: 'https://maps.app.goo.gl/LXMVQoQtZKKKL2tj9',
      fee: 300, seed: 1, published: 0, created_at: Date.now()
    });
  }
  return 'تم الإعداد ✅  رمز المنظّم (PIN): ' + pin;
}

/* ============ public API (called from the page) ============ */

function getState(req) {
  req = req || {};
  return personalize_(base_(), req.device, isAdmin_(req.pin));
}

// photo of a player: the organizer, or the phone that registered that player
function setPhoto(req) {
  return write_(req, function (admin) {
    const pid = String(req.player_id || '');
    const p = rows_('players').filter(function (x) { return x.id === pid; })[0];
    if (!p) throw new Error('اللاعب غير موجود.');
    if (!admin) {
      const mine = !!req.device && rows_('regs').some(function (r) { return r.player_id === pid && r.device === String(req.device); });
      if (!mine) throw new Error('تقدر تغيّر صورتك أنت بس (من الجوال اللي سجّلت منه)، أو المنظّم.');
    }
    if (req.remove) {
      deleteWhere_('settings', function (x) { return x.key === 'photo_' + pid; });
      TX.photo = { pid: pid, remove: true };
      return 'تم حذف صورة ' + p.name + '.';
    }
    const b64 = String(req.data || '');
    if (!/^\/9j\//.test(b64)) throw new Error('الصورة لازم تكون JPEG.');
    if (b64.length > 400000) throw new Error('الصورة كبيرة، جرّب صورة ثانية.');
    setSetting_('photo_' + pid, String(Date.now()));
    TX.photo = { pid: pid, data: b64 };
    return 'تم حفظ صورة ' + p.name + ' ✅';
  });
}

function checkPin(req) {
  const ok = isAdmin_(req && req.pin, true);
  if (!ok) throw new Error('رمز المنظّم غير صحيح.');
  return { msg: 'تم دخول المنظّم.', state: getState(req) };
}

function register(req) {
  return write_(req, function (admin) {
    const S = current_();
    const now = Date.now();
    if (!admin && now >= at_(S.date, S.lock)) throw new Error('القائمة مقفلة.');
    const pos = POSITIONS.indexOf(req.pos) >= 0 ? req.pos : 'ANY';
    const name = cleanName_(req.name);
    if (!name) throw new Error('اكتب اسمك أولاً.');
    const regs = rows_('regs').filter(function (r) { return r.session_id === S.id && r.status === 'active'; });
    if (regs.length >= CAP) throw new Error('القائمة مكتملة: 14 أساسي و4 احتياط.');
    const perDevice = perDevice_(rows_('settings'));
    if (!admin && req.device && regs.filter(function (r) { return r.device === req.device; }).length >= perDevice)
      throw new Error(perDevice === 1 ? 'تقدر تسجّل اسماً واحداً فقط من نفس الجوال.' : 'وصلت للحد: تقدر تسجّل ' + perDevice + ' أسماء فقط من نفس الجوال.');

    const key = normKey_(name);
    const players = rows_('players');
    let p = players.filter(function (x) { return normKey_(x.name) === key; })[0];
    if (!p) {
      p = { id: uid_(), name: name, pos: pos, created_at: now };
      append_('players', p);
    }
    if (regs.some(function (r) { return r.player_id === p.id; }))
      throw new Error(p.name + ' مسجّل في القائمة مسبقاً.');

    append_('regs', {
      id: uid_(), session_id: S.id, player_id: p.id, pos: pos, created_at: now,
      status: 'active', reason: '', removed_at: '', device: req.device || '', by_admin: admin ? 1 : 0
    });
    const rank = regs.length + 1;
    return rank <= MAIN ? 'تم تسجيل ' + p.name + ' أساسياً (رقم ' + rank + ').'
                        : 'تم تسجيل ' + p.name + ' في الاحتياط (رقم ' + rank + ').';
  }, false);
}

function withdraw(req) {
  return write_(req, function () {
    const S = current_();
    if (Date.now() >= at_(S.date, S.lock)) throw new Error('القائمة مقفلة. تواصل مع المنظّم.');
    const info = findActive_(S, req.reg_id);
    if (!req.device || info.reg.device !== req.device) throw new Error('تقدر تسحب تسجيلك أنت فقط.');
    const late = info.rank <= MAIN && Date.now() >= at_(S.date, S.start) - LATE_MS;
    removeReg_(info.reg, late ? 'late_withdraw' : 'withdraw');
    return late ? 'تم الانسحاب، وانحسب انسحاباً متأخراً.' : 'تم الانسحاب.';
  }, false);
}

function updateRegistration(req) {
  return write_(req, function (admin) {
    const S = current_();
    if (!admin && Date.now() >= at_(S.date, S.lock)) throw new Error('القائمة مقفلة. تواصل مع المنظّم للتعديل.');
    const info = findActive_(S, req.reg_id);
    const reg = info.reg;
    if (!admin && (!req.device || reg.device !== req.device)) throw new Error('تقدر تعدّل تسجيلك أنت فقط.');
    const changed = [];
    let orphan = null;
    if (req.pos && POSITIONS.indexOf(req.pos) >= 0 && req.pos !== reg.pos) {
      // keep the current split when the organizer fixes a position after teams are out
      const before = admin ? base_(true) : null;
      if (before && before.teams && before.teams.some(function (t) { return t.list.some(function (p) { return p.player_id === reg.player_id; }); }))
        setSetting_('ovr_' + S.id, JSON.stringify(frozenOvr_(S.id, before.teams)));
      reg.pos = req.pos; changed.push('المركز');
    }
    if (req.name !== undefined && req.name !== null) {
      const name = cleanName_(req.name);
      if (!name) throw new Error('اكتب الاسم.');
      const players = rows_('players');
      const cur = players.filter(function (p) { return p.id === reg.player_id; })[0];
      if (!cur || cur.name !== name) {
        const key = normKey_(name);
        const other = players.filter(function (p) { return p.id !== reg.player_id && normKey_(p.name) === key; })[0];
        if (other) {
          const taken = rows_('regs').some(function (r) { return r.session_id === S.id && r.status === 'active' && r.player_id === other.id; });
          if (taken) throw new Error(other.name + ' مسجّل في القائمة مسبقاً.');
          orphan = reg.player_id;
          reg.player_id = other.id;
        } else {
          const hasHistory = rows_('regs').some(function (r) { return r.player_id === reg.player_id && r.id !== reg.id; }) ||
            rows_('match_players').some(function (m) { return m.player_id === reg.player_id; });
          if (cur && !hasHistory) { cur.name = name; update_('players', cur); }
          else {
            const np = { id: uid_(), name: name, pos: reg.pos, created_at: Date.now() };
            append_('players', np);
            reg.player_id = np.id;
          }
        }
        changed.push('الاسم');
      }
    }
    if (!changed.length) return 'ما فيه تغيير.';
    update_('regs', reg);
    if (orphan) {
      const used = rows_('regs').some(function (r) { return r.player_id === orphan; }) ||
        rows_('match_players').some(function (m) { return m.player_id === orphan; });
      if (!used) deleteWhere_('players', function (p) { return p.id === orphan; });
    }
    return 'تم تعديل ' + changed.join(' و') + '، ومكانك في القائمة ما تغيّر.';
  }, false);
}

function adminRemove(req) {
  return write_(req, function () {
    const S = current_();
    if (REASONS.indexOf(req.reason) < 0) throw new Error('اختر سبب الحذف.');
    const info = findActive_(S, req.reg_id);
    let reason = req.reason;
    if (reason === 'withdraw' && info.rank <= MAIN && Date.now() >= at_(S.date, S.start) - LATE_MS) reason = 'late_withdraw';
    if ((reason === 'no_show') && info.rank > MAIN) reason = 'excused';
    removeReg_(info.reg, reason);
    const name = playerName_(info.reg.player_id);
    const labels = { withdraw: 'تم حذف ' + name + '.', late_withdraw: 'تم تسجيل انسحاب متأخر لـ ' + name + '.',
      no_show: 'تم تسجيل غياب ' + name + '.', excused: 'تم حذف ' + name + ' بعذر.', mistake: 'تم حذف ' + name + ' (خطأ إدخال).' };
    return labels[reason];
  }, true);
}

function adminSaveSession(req) {
  return write_(req, function () {
    const S = current_();
    const d = req.data || {};
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date || '')) throw new Error('التاريخ غير صحيح.');
    ['start', 'end', 'lock'].forEach(function (k) { if (!/^\d{2}:\d{2}$/.test(d[k] || '')) throw new Error('الأوقات غير صحيحة.'); });
    if (d.lock > d.start) throw new Error('وقت القفل لازم يكون قبل بداية التمرين.');
    if (d.end <= d.start) throw new Error('وقت النهاية لازم يكون بعد البداية.');
    S.date = d.date; S.start = d.start; S.end = d.end; S.lock = d.lock;
    S.pitch = cleanName_(d.pitch, 60) || S.pitch;
    S.map = String(d.map || '').trim().slice(0, 300);
    S.fee = Math.max(0, Math.round(Number(d.fee) || 0));
    update_('sessions', S);
    return 'تم حفظ الموعد.';
  }, true);
}

function adminPublish(req) {
  return write_(req, function () {
    const S = current_(); S.published = 1; update_('sessions', S);
    setSetting_('hide_' + S.id, '');
    return 'التوزيع ظاهر للجميع الآن.';
  }, true);
}

function adminUnpublish(req) {
  return write_(req, function () {
    const S = current_(); S.published = 0; update_('sessions', S);
    setSetting_('hide_' + S.id, '1');
    return 'انخفى التوزيع، ويظهر عند القفل.';
  }, true);
}

function adminSetAutoFull(req) {
  return write_(req, function () {
    setSetting_('auto_full', req.on ? '1' : '0');
    return req.on ? 'التوزيع يظهر تلقائياً أول ما تكتمل 14.' : 'التوزيع التلقائي عند الاكتمال متوقف، ويظهر عند القفل أو بزر المنظّم.';
  }, true);
}

function adminReshuffle(req) {
  return write_(req, function () {
    const S = current_(); S.seed = (Number(S.seed) || 1) + 1; S.published = 1; update_('sessions', S);
    setSetting_('ovr_' + S.id, '');
    return 'تمت إعادة التوزيع التلقائي.';
  }, true);
}

// ---- manual team edits (organizer) ----
function teamOf_(teams, pid) {
  if (!teams) return null;
  if (teams[0].list.some(function (p) { return p.player_id === pid; })) return 'A';
  if (teams[1].list.some(function (p) { return p.player_id === pid; })) return 'B';
  return null;
}
// pin everyone where they stand now, so only players who join later are auto-placed
function frozenOvr_(sid, teams) {
  const ovr = readOvr_(sid);
  if (teams) teams.forEach(function (t, i) { t.list.forEach(function (p) { ovr[p.player_id] = i ? 'B' : 'A'; }); });
  return ovr;
}
function readOvr_(sid) { try { return JSON.parse(setting_('ovr_' + sid) || '{}') || {}; } catch (e) { return {}; } }

function adminMovePlayer(req) {
  return write_(req, function () {
    const S = current_();
    const b = base_(true);
    const from = teamOf_(b.teams, req.player_id);
    if (!from) throw new Error('هذا اللاعب مو ضمن التوزيع.');
    const to = from === 'A' ? 'B' : 'A';
    const ovr = frozenOvr_(S.id, b.teams); ovr[req.player_id] = to;
    setSetting_('ovr_' + S.id, JSON.stringify(ovr));
    const p = b.list.filter(function (x) { return x.player_id === req.player_id; })[0];
    return 'تم نقل ' + (p ? p.name : 'اللاعب') + ' إلى الفريق ' + to + '.';
  }, true);
}

function adminSwapPlayers(req) {
  return write_(req, function () {
    const S = current_();
    const b = base_(true);
    const ta = teamOf_(b.teams, req.a), tb = teamOf_(b.teams, req.b);
    if (!ta || !tb) throw new Error('اختر لاعبين من التوزيع.');
    if (ta === tb) throw new Error('اختر لاعباً من الفريق الثاني للتبديل.');
    const ovr = frozenOvr_(S.id, b.teams); ovr[req.a] = tb; ovr[req.b] = ta;
    setSetting_('ovr_' + S.id, JSON.stringify(ovr));
    const nm = function (id) { const x = b.list.filter(function (q) { return q.player_id === id; })[0]; return x ? x.name : ''; };
    return 'تم تبديل ' + nm(req.a) + ' و' + nm(req.b) + '.';
  }, true);
}

function adminResetTeams(req) {
  return write_(req, function () {
    const S = current_(); setSetting_('ovr_' + S.id, '');
    return 'رجع التوزيع التلقائي.';
  }, true);
}

function adminSetPerDevice(req) {
  return write_(req, function () {
    const n = Math.round(Number(req.n));
    if (!(n >= 1 && n <= 6)) throw new Error('اختر رقماً من 1 إلى 6.');
    setSetting_('per_device', String(n));
    return 'صار كل جوال يقدر يسجّل ' + n + (n === 1 ? ' اسم.' : ' أسماء.');
  }, true);
}

function perDevice_(settingsRows) {
  const r = settingsRows.filter(function (x) { return x.key === 'per_device'; })[0];
  const n = r ? Number(r.value) : 0;
  return n >= 1 && n <= 6 ? n : PER_DEVICE_DEFAULT;
}

function castVote(req) {
  return write_(req, function (admin) {
    const S = current_();
    const b = base_(true);
    if (!b.match) throw new Error('التصويت يفتح بعد تسجيل نتيجة المباراة.');
    if (['mvp', 'def'].indexOf(req.category) < 0) throw new Error('نوع التصويت غير صحيح.');
    const players = b.match.teamA.concat(b.match.teamB);
    if (!players.some(function (p) { return p.player_id === req.player_id; })) throw new Error('اختر لاعباً لعب في المباراة.');
    if (!req.device) throw new Error('ما قدرنا نتعرّف على جوالك. حدّث الصفحة.');
    const played = b.list.slice(0, MAIN).some(function (r) { return r.device === req.device; });
    if (!played && !admin) throw new Error('التصويت للي لعبوا في المباراة فقط.');
    if (b.votingClosed && !admin) throw new Error('المنظّم قفل التصويت.');
    const old = rows_('votes').filter(function (v) { return v.session_id === S.id && v.device === req.device && v.category === req.category; })[0];
    if (old) { old.player_id = req.player_id; old.at = Date.now(); update_('votes', old); }
    else append_('votes', { id: uid_(), session_id: S.id, device: req.device, category: req.category, player_id: req.player_id, at: Date.now() });
    return old ? 'تم تغيير صوتك.' : 'تم تسجيل صوتك.';
  }, false);
}

function adminPickAward(req) {
  return write_(req, function () {
    const S = current_();
    const b = base_(true);
    if (!b.match) throw new Error('الاختيار يكون بعد تسجيل نتيجة المباراة.');
    if (['mvp', 'def'].indexOf(req.category) < 0) throw new Error('نوع الجائزة غير صحيح.');
    const label = req.category === 'mvp' ? 'أفضل لاعب' : 'أفضل مدافع';
    if (!req.player_id) { setSetting_('pick_' + S.id + '_' + req.category, ''); return 'رجع ' + label + ' حسب التصويت.'; }
    const p = b.match.teamA.concat(b.match.teamB).filter(function (x) { return x.player_id === req.player_id; })[0];
    if (!p) throw new Error('اختر لاعباً لعب في المباراة.');
    setSetting_('pick_' + S.id + '_' + req.category, req.player_id);
    return 'تم: ' + label + ' هذا الأسبوع ' + p.name + ' (اختيار المنظّم).';
  }, true);
}

function adminVoting(req) {
  return write_(req, function () {
    const S = current_();
    if (req.clear) {
      deleteWhere_('votes', function (v) { return v.session_id === S.id; });
      return 'تم مسح كل أصوات هذا الأسبوع.';
    }
    setSetting_('vote_closed_' + S.id, req.open ? '' : '1');
    return req.open ? 'تم فتح التصويت.' : 'تم قفل التصويت، والنتيجة الحالية هي المعتمدة.';
  }, true);
}

function adminSetBib(req) {
  return write_(req, function () {
    const S = current_();
    if (!base_(true).teams) throw new Error('السديري يتحدد بعد ظهور التوزيع.');
    if (req.team !== 'A' && req.team !== 'B') throw new Error('اختر الفريق.');
    append_('bib', { id: uid_(), session_id: S.id, n: -1, team: req.team, at: Date.now() });
    return 'الفريق ' + req.team + ' يلبس السديري الفسفوري (اختيار المنظّم).';
  }, true);
}

function adminDeleteResult(req) {
  return write_(req, function () {
    const S = current_();
    const had = rows_('matches').some(function (r) { return r.session_id === S.id; });
    if (!had) throw new Error('ما فيه نتيجة مسجّلة هذا الأسبوع.');
    deleteWhere_('match_players', function (r) { return r.session_id === S.id; });
    deleteWhere_('matches', function (r) { return r.session_id === S.id; });
    deleteWhere_('votes', function (v) { return v.session_id === S.id; });
    ['pick_' + S.id + '_mvp', 'pick_' + S.id + '_def', 'vote_closed_' + S.id].forEach(function (k) { if (setting_(k)) setSetting_(k, ''); });
    return 'تم حذف نتيجة هذا الأسبوع وأصواتها.';
  }, true);
}

function adminSwapOrder(req) {
  return write_(req, function () {
    const S = current_();
    const active = rows_('regs').filter(function (r) { return r.session_id === S.id && r.status === 'active'; })
      .sort(function (a, b) { return Number(a.created_at) - Number(b.created_at) || a._row - b._row; });
    const ia = active.findIndex(function (r) { return r.id === req.a; });
    const ib = active.findIndex(function (r) { return r.id === req.b; });
    if (ia < 0 || ib < 0 || ia === ib) throw new Error('اختر لاعبين من القائمة.');
    const times = active.map(function (r) { return Number(r.created_at) || 0; });
    for (let i = 1; i < times.length; i++) if (times[i] <= times[i - 1]) times[i] = times[i - 1] + 1;
    const order = active.slice();
    order[ia] = active[ib]; order[ib] = active[ia];
    order.forEach(function (r, i) { if (Number(r.created_at) !== times[i]) { r.created_at = times[i]; update_('regs', r); } });
    return 'تم تبديل مكان ' + playerName_(active[ia].player_id) + ' (رقم ' + (ia + 1) + ') مع ' + playerName_(active[ib].player_id) + ' (رقم ' + (ib + 1) + ').';
  }, true);
}

function adminSetCaptain(req) {
  return write_(req, function () {
    const S = current_();
    const b = base_(true);
    if (!b.teams) throw new Error('الكابتن يتحدد بعد ظهور التوزيع.');
    const ti = b.teams[0].list.some(function (p) { return p.player_id === req.player_id; }) ? 0 :
      b.teams[1].list.some(function (p) { return p.player_id === req.player_id; }) ? 1 : -1;
    if (ti < 0) throw new Error('اختر لاعباً من التوزيع.');
    const t = ti ? 'B' : 'A';
    let caps = {};
    try { caps = JSON.parse(setting_('cap_' + S.id) || '{}') || {}; } catch (e) { caps = {}; }
    const name = playerName_(req.player_id);
    if (caps[t] === req.player_id) { delete caps[t]; setSetting_('cap_' + S.id, JSON.stringify(caps)); return 'تم شيل شارة الكابتن عن ' + name + '.'; }
    caps[t] = req.player_id;
    setSetting_('cap_' + S.id, JSON.stringify(caps));
    return name + ' كابتن الفريق ' + t + '.';
  }, true);
}

function adminSetColors(req) {
  return write_(req, function () {
    if (!COLORS[req.a] || !COLORS[req.b]) throw new Error('اختر لوناً من القائمة.');
    if (req.a === req.b) throw new Error('اختر لونين مختلفين للفريقين.');
    setSetting_('color_a', req.a); setSetting_('color_b', req.b);
    return 'الفريق A ' + COLORS[req.a].name + ' والفريق B ' + COLORS[req.b].name + '.';
  }, true);
}

function adminDrawBib(req) {
  return write_(req, function () {
    const S = current_();
    const b = base_(true);
    if (!b.teams) throw new Error('القرعة تكون بعد ظهور التوزيع.');
    const n = fair100_();
    const team = n < 50 ? 'A' : 'B';
    append_('bib', { id: uid_(), session_id: S.id, n: n, team: team, at: Date.now() });
    return 'الرقم ' + pad_(n) + ': الفريق ' + team + ' يلبس السديري الفسفوري.';
  }, true);
}

function adminSaveResult(req) {
  return write_(req, function () {
    const S = current_();
    const b = base_(true);
    if (!b.teams) throw new Error('النتيجة تُسجّل بعد ظهور التوزيع.');
    const blank = function (v) { return v === '' || v === null || v === undefined || String(v).trim() === ''; };
    if (blank(req.sa) || blank(req.sb)) throw new Error('اكتب نتيجة الفريقين.');
    const sa = Number(req.sa), sb = Number(req.sb);
    if (!(sa >= 0 && sa < 100 && sb >= 0 && sb < 100) || sa % 1 || sb % 1) throw new Error('اكتب نتيجة الفريقين.');
    const goals = req.goals || {}, assists = req.assists || {};
    const totA = b.teams[0].list.reduce(function (n, p) { return n + (Number(goals[p.player_id]) || 0); }, 0);
    const totB = b.teams[1].list.reduce(function (n, p) { return n + (Number(goals[p.player_id]) || 0); }, 0);
    if (totA > sa || totB > sb) throw new Error('أهداف اللاعبين أكثر من نتيجة الفريق. راجع الأرقام.');
    // replace this session's rows
    deleteWhere_('match_players', function (r) { return r.session_id === S.id; });
    deleteWhere_('matches', function (r) { return r.session_id === S.id; });
    append_('matches', { session_id: S.id, sa: sa, sb: sb, saved_at: Date.now() });
    b.teams.forEach(function (t, i) {
      t.list.forEach(function (p) {
        const g = Math.max(0, Math.min(30, Math.round(Number(goals[p.player_id]) || 0)));
        const a = Math.max(0, Math.min(30, Math.round(Number(assists[p.player_id]) || 0)));
        append_('match_players', { session_id: S.id, player_id: p.player_id, team: i ? 'B' : 'A', goals: g, assists: a });
      });
    });
    return 'تم حفظ النتيجة، وانفتح التصويت لأفضل لاعب وأفضل مدافع.';
  }, true);
}

function adminNewWeek(req) {
  return write_(req, function () {
    const S = current_();
    // the finished week is final: voting closes and its winners are announced
    if (setting_('vote_closed_' + S.id) !== '1') setSetting_('vote_closed_' + S.id, '1');
    const d = new Date(S.date + 'T12:00:00' + OFFSET);
    d.setTime(d.getTime() + 7 * 86400000);
    append_('sessions', {
      id: uid_(), date: Utilities.formatDate(d, TZ, 'yyyy-MM-dd'), start: S.start, end: S.end, lock: S.lock,
      pitch: S.pitch, map: S.map, fee: S.fee, seed: 1, published: 0, created_at: Date.now()
    });
    return '✅ تم اعتماد نتائج الأسبوع وحفظها، وانفتح تمرين جديد والقائمة فارغة.';
  }, true);
}

/* ============ state ============ */

function base_() { return buildBase_(); }

function buildBase_() {
  const now = Date.now();
  const sessions = rows_('sessions');
  const players = rows_('players');
  const pmap = {};
  players.forEach(function (p) { pmap[p.id] = p; });
  const out = {
    now: now, builtAt: now, appUrl: appUrl_(), session: null, list: [], teams: null, bib: [], match: null,
    stats: { rank: [], commit: [] }, history: [],
    roster: players.map(function (p) { return p.name; }).sort(function (a, b) { return a.localeCompare(b, 'ar'); }),
    photos: {}
  };
  // player photos: {player_id: version}; the picture itself is served by GET ?photo=<id>&v=<version>
  rows_('settings').forEach(function (s) { if (s.key.indexOf('photo_') === 0 && s.value) out.photos[s.key.slice(6)] = s.value; });
  if (!sessions.length) return out;
  const S = latestSession_(sessions);
  const allRegs = rows_('regs');
  const active = allRegs.filter(function (r) { return r.session_id === S.id && r.status === 'active'; })
    .sort(function (a, b) { return Number(a.created_at) - Number(b.created_at) || a._row - b._row; });
  out.session = { id: S.id, date: S.date, start: S.start, end: S.end, lock: S.lock, pitch: S.pitch, map: S.map,
    fee: Number(S.fee) || 0, seed: Number(S.seed) || 1, published: String(S.published) === '1' };
  out.lockAt = at_(S.date, S.lock);
  out.startAt = at_(S.date, S.start);
  out.locked = now >= out.lockAt;
  out.list = active.slice(0, CAP).map(function (r, i) {
    const p = pmap[r.player_id] || { name: '؟' };
    return { id: r.id, player_id: r.player_id, name: p.name, pos: r.pos, rank: i + 1, device: r.device };
  });
  const mains = out.list.slice(0, MAIN);
  const settingsRows = rows_('settings');
  out.perDevice = perDevice_(settingsRows);
  out.manual = false;
  const sget = function (k) { const r = settingsRows.filter(function (x) { return x.key === k; })[0]; return r ? r.value : ''; };
  out.autoFull = sget('auto_full') !== '0';
  out.votingClosed = sget('vote_closed_' + S.id) === '1';
  const hidden = sget('hide_' + S.id) === '1';
  out.teamsReason = out.locked ? 'locked' : out.session.published ? 'published' : (out.autoFull && !hidden && mains.length >= MAIN) ? 'full' : '';
  if (out.teamsReason && mains.length >= 2) {
    const auto = makeTeams_(mains, S.id + '|' + out.session.seed + '|' + mains.map(function (p) { return p.player_id; }).sort().join(','));
    const ovrRow = settingsRows.filter(function (x) { return x.key === 'ovr_' + S.id; })[0];
    let ovr = {};
    try { ovr = ovrRow && ovrRow.value ? JSON.parse(ovrRow.value) : {}; } catch (e) { ovr = {}; }
    const A = [], B = [];
    auto[0].list.forEach(function (p) { (ovr[p.player_id] === 'B' ? B : A).push(p); });
    auto[1].list.forEach(function (p) { (ovr[p.player_id] === 'A' ? A : B).push(p); });
    // keep teams even: players the organizer did not place by hand (e.g. a reserve who just came in) go to the smaller team
    for (let guard = 0; guard < MAIN && Math.abs(A.length - B.length) > 1; guard++) {
      const big = A.length > B.length ? A : B, small = big === A ? B : A;
      let k = -1;
      for (let i = big.length - 1; i >= 0; i--) if (!ovr[big[i].player_id]) { k = i; break; }
      if (k < 0) break;
      small.push(big.splice(k, 1)[0]);
    }
    out.manual = A.length !== auto[0].list.length || A.some(function (p, i) { return auto[0].list.indexOf(p) < 0; });
    // show each team in position order: GK, DEF, MID, FWD, then "any" (stable inside each position)
    const rankPos = function (p) { const i = POSITIONS.indexOf(p.pos); return i < 0 ? POSITIONS.length : i; };
    [A, B].forEach(function (L) {
      const idx = new Map(L.map(function (p, i) { return [p, i]; }));
      L.sort(function (x, y) { return rankPos(x) - rankPos(y) || idx.get(x) - idx.get(y); });
    });
    out.teams = [A, B].map(function (list) {
      const c = {};
      list.forEach(function (p) { c[p.pos] = (c[p.pos] || 0) + 1; });
      return { c: c, list: list.map(function (p) { return { player_id: p.player_id, name: p.name, pos: p.pos }; }) };
    });
    let caps = {};
    try { caps = JSON.parse(sget('cap_' + S.id) || '{}') || {}; } catch (e) { caps = {}; }
    out.captains = { A: null, B: null };
    ['A', 'B'].forEach(function (t, i) {
      const c = out.teams[i].list.filter(function (p) { return p.player_id === caps[t]; })[0];
      if (c) { c.cap = true; out.captains[t] = c.player_id; }
    });
  }
  const bibs = rows_('bib');
  out.bib = bibs.filter(function (b) { return b.session_id === S.id; })
    .sort(function (a, b) { return Number(a.at) - Number(b.at); })
    .map(function (b) { return { n: Number(b.n), team: b.team, at: Number(b.at) }; });

  // results + stats
  const matches = rows_('matches');
  const mps = rows_('match_players');
  const sessById = {};
  sessions.forEach(function (s) { sessById[s.id] = s; });
  const votes = rows_('votes');
  const nameOf = function (pid) { return (pmap[pid] || { name: '؟' }).name; };
  const st = {};
  function g(pid) {
    if (!st[pid]) st[pid] = { player_id: pid, name: nameOf(pid), p: 0, w: 0, d: 0, l: 0, goals: 0, assists: 0, late: 0, ns: 0, mvp: 0, def: 0 };
    return st[pid];
  }
  function tally(sid, cat) {
    const t = {};
    votes.forEach(function (v) { if (v.session_id === sid && v.category === cat) t[v.player_id] = (t[v.player_id] || 0) + 1; });
    return Object.keys(t).map(function (pid) { return { player_id: pid, name: nameOf(pid), n: t[pid] }; })
      .sort(function (a, b) { return b.n - a.n || a.name.localeCompare(b.name, 'ar'); });
  }
  function leaders(list) { return list.length ? list.filter(function (x) { return x.n === list[0].n; }) : []; }
  const months = {};
  function mo(key) {
    if (!months[key]) months[key] = { key: key, label: MONTHS_AR[Number(key.slice(5, 7)) - 1] + ' ' + key.slice(0, 4), matches: 0, pl: {} };
    return months[key];
  }
  function mp(m, pid) { if (!m.pl[pid]) m.pl[pid] = { player_id: pid, name: nameOf(pid), goals: 0, assists: 0, mvp: 0, def: 0, mvpVotes: 0, defVotes: 0, p: 0, w: 0, d: 0, l: 0 }; return m.pl[pid]; }
  matches.forEach(function (m) {
    const sa = Number(m.sa), sb = Number(m.sb);
    const ra = sa > sb ? 'w' : sa < sb ? 'l' : 'd';
    const rb = ra === 'w' ? 'l' : ra === 'l' ? 'w' : 'd';
    const sess = sessById[m.session_id] || {};
    const M = mo((sess.date || '0000-01').slice(0, 7)); M.matches++;
    const rows = mps.filter(function (x) { return x.session_id === m.session_id; });
    rows.forEach(function (x) {
      const res = x.team === 'A' ? ra : rb;
      const s = g(x.player_id); s.p++; s[res]++; s.goals += Number(x.goals) || 0; s.assists += Number(x.assists) || 0;
      const q = mp(M, x.player_id); q.p++; q[res]++; q.goals += Number(x.goals) || 0; q.assists += Number(x.assists) || 0;
    });
    const sb2 = bibs.filter(function (b) { return b.session_id === m.session_id; })
      .sort(function (a, b) { return Number(a.at) - Number(b.at); });
    const pick = function (field) {
      return rows.filter(function (x) { return Number(x[field]) > 0; })
        .sort(function (a, b) { return Number(b[field]) - Number(a[field]); })
        .map(function (x) { return { player_id: x.player_id, name: nameOf(x.player_id), g: Number(x[field]), team: x.team }; });
    };
    const mvpT = tally(m.session_id, 'mvp'), defT = tally(m.session_id, 'def');
    const official = function (cat, T) {
      const pid = sget('pick_' + m.session_id + '_' + cat);
      if (pid && rows.some(function (x) { return x.player_id === pid; })) {
        const v = T.filter(function (x) { return x.player_id === pid; })[0];
        return [{ player_id: pid, name: nameOf(pid), n: v ? v.n : 0, admin: true }];
      }
      if (m.session_id === S.id && !out.votingClosed) return [];   // announced when the organizer closes voting
      return leaders(T);
    };
    const mvpW = official('mvp', mvpT), defW = official('def', defT);
    mvpW.forEach(function (x) { g(x.player_id).mvp++; mp(M, x.player_id).mvp++; });
    defW.forEach(function (x) { g(x.player_id).def++; mp(M, x.player_id).def++; });
    mvpT.forEach(function (x) { mp(M, x.player_id).mvpVotes += x.n; });
    defT.forEach(function (x) { mp(M, x.player_id).defVotes += x.n; });
    const team = function (t) { return rows.filter(function (x) { return x.team === t; }).map(function (x) { return { player_id: x.player_id, name: nameOf(x.player_id) }; }); };
    const h = { sid: m.session_id, date: sess.date || '', pitch: sess.pitch || '', sa: sa, sb: sb, winner: sa > sb ? 'A' : sa < sb ? 'B' : 'draw',
      scorers: pick('goals'), assisters: pick('assists'), teamA: team('A'), teamB: team('B'),
      mvp: mvpW, def: defW, mvpTally: mvpT, defTally: defT,
      votesCount: votes.filter(function (v) { return v.session_id === m.session_id; }).length,
      bib: sb2.length ? sb2[sb2.length - 1].team : null };
    out.history.push(h);
    if (m.session_id === S.id) out.match = h;
  });
  // monthly awards
  const thisMonth = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd').slice(0, 7);
  out.months = Object.keys(months).sort().reverse().map(function (k) {
    const M = months[k], pl = Object.keys(M.pl).map(function (id) { return M.pl[id]; });
    // player of the month = most points that month (same points as the season table)
    const table = pl.map(function (x) {
      return { player_id: x.player_id, name: x.name, pts: points_(x), p: x.p, w: x.w, d: x.d, l: x.l, goals: x.goals, assists: x.assists, mvp: x.mvp, def: x.def };
    }).sort(rankCmp_);
    const t0 = table[0];
    const potm = t0 && t0.pts > 0 ? table.filter(function (x) { return x.pts === t0.pts && x.w === t0.w && x.goals === t0.goals && x.assists === t0.assists; }) : [];
    const best = function (field, tie) {
      const top = pl.filter(function (x) { return x[field] > 0; }).sort(function (a, b) { return b[field] - a[field] || (tie ? b[tie] - a[tie] : 0); });
      if (!top.length) return null;
      const lead = top.filter(function (x) { return x[field] === top[0][field] && (!tie || x[tie] === top[0][tie]); });
      return { names: lead.map(function (x) { return x.name; }), n: top[0][field] };
    };
    return { key: k, label: M.label, matches: M.matches, final: k < thisMonth, table: table, potm: potm,
      goals: best('goals', 'assists'), assists: best('assists', 'goals'), mvp: best('mvp', 'mvpVotes'), def: best('def', 'defVotes'), wins: best('w'),
      scorers: pl.filter(function (x) { return x.goals + x.assists > 0; })
        .sort(function (a, b) { return b.goals - a.goals || b.assists - a.assists || a.name.localeCompare(b.name, 'ar'); })
        .map(function (x) { return { name: x.name, goals: x.goals, assists: x.assists, p: x.p }; }) };
  });
  out.voteDevices = votes.filter(function (v) { return v.session_id === S.id; }).map(function (v) { return { device: v.device, category: v.category, player_id: v.player_id }; });
  const ca = sget('color_a'), cb = sget('color_b');
  out.colors = { a: COLORS[ca] ? ca : 'red', b: COLORS[cb] && cb !== (COLORS[ca] ? ca : 'red') ? cb : 'blue' };
  out.palette = COLORS;
  out.history.sort(function (a, b) { return a.date < b.date ? 1 : -1; });
  allRegs.forEach(function (r) {
    if (r.status !== 'removed') return;
    if (r.reason === 'late_withdraw') g(r.player_id).late++;
    if (r.reason === 'no_show') g(r.player_id).ns++;
  });
  const all = Object.keys(st).map(function (k) { return st[k]; });
  out.stats.rank = all.filter(function (s) { return s.p > 0; })
    .map(function (s) { return Object.assign({ pts: points_(s) }, s); })
    .sort(rankCmp_);
  // player of the month: every finished month's winner (newest first) + who leads the current month
  out.potm = out.months.filter(function (m) { return m.potm.length; }).map(function (m) {
    return { key: m.key, label: m.label, final: m.final, matches: m.matches, winners: m.potm, runnersUp: m.table.filter(function (x) { return m.potm.indexOf(x) < 0; }).slice(0, 2) };
  });
  out.stats.winners = all.filter(function (s) { return s.p > 0; })
    .map(function (s) { return { player_id: s.player_id, name: s.name, p: s.p, w: s.w, d: s.d, l: s.l, rate: Math.round(s.w / s.p * 100) }; })
    .sort(function (a, b) { return b.w - a.w || b.rate - a.rate || a.name.localeCompare(b.name, 'ar'); });
  out.stats.scorers = all.filter(function (s) { return s.goals + s.assists > 0; })
    .sort(function (a, b) { return b.goals - a.goals || b.assists - a.assists || a.name.localeCompare(b.name, 'ar'); });
  out.stats.commit = all.filter(function (s) { return s.p + s.late + s.ns > 0; })
    .map(function (s) { return Object.assign({ rate: Math.round(s.p / (s.p + s.late + s.ns) * 100) }, s); })
    .sort(function (a, b) { return b.rate - a.rate || b.p - a.p || a.name.localeCompare(b.name, 'ar'); });
  return out;
}

// points: win 3, draw 1, goal 1, assist 0.5, weekly best player +3, weekly best defender +2
function points_(s) { return s.w * 3 + (s.d || 0) + (s.goals || 0) + (s.assists || 0) * 0.5 + (s.mvp || 0) * 3 + (s.def || 0) * 2; }
function rankCmp_(a, b) { return b.pts - a.pts || b.w - a.w || b.goals - a.goals || b.assists - a.assists || b.p - a.p || a.name.localeCompare(b.name, 'ar'); }

function personalize_(b, device, admin) {
  const out = JSON.parse(JSON.stringify(b));
  out.now = Date.now();
  out.isAdmin = !!admin;
  out.locked = out.lockAt ? out.now >= out.lockAt : false;
  out.myCount = 0;
  const vd = out.voteDevices || [];
  out.myVotes = {};
  vd.forEach(function (v) { if (device && v.device === device) out.myVotes[v.category] = v.player_id; });
  out.canVote = !!out.match && (!!admin || (!out.votingClosed && !!device && out.list.slice(0, MAIN).some(function (r) { return r.device === device; })));
  delete out.voteDevices;
  if (!admin && !out.votingClosed && out.session) {
    out.history.forEach(function (h) { if (h.sid === out.session.id) { h.mvpTally = []; h.defTally = []; } });
    if (out.match) { out.match.mvpTally = []; out.match.defTally = []; }
  }
  // players this phone has ever registered (they may change their own photo)
  out.myPlayers = device ? Object.keys((TX.tables.regs || []).reduce(function (m, r) { if (r.device === device) m[r.player_id] = 1; return m; }, {})) : [];
  out.list.forEach(function (r) {
    r.mine = !!device && r.device === device;
    if (r.mine) { r.friend = out.myCount > 0; out.myCount++; }
    delete r.device;
  });
  return out;
}

/* ============ teams (deterministic, same result for everyone) ============ */

function makeTeams_(mains, seed) {
  const r = rng_(seed), cap = Math.ceil(mains.length / 2);
  const T = [{ list: [], c: {} }, { list: [], c: {} }];
  let flip = r() < 0.5 ? 0 : 1;
  POSITIONS.forEach(function (g) {
    shuffle_(mains.filter(function (x) { return x.pos === g; }), r).forEach(function (p) {
      const ca = T[0].c[g] || 0, cb = T[1].c[g] || 0;
      let pick;
      if (g !== 'ANY' && ca !== cb) pick = ca < cb ? 0 : 1;
      else if (T[0].list.length !== T[1].list.length) pick = T[0].list.length < T[1].list.length ? 0 : 1;
      else { pick = flip; flip = 1 - flip; }
      if (T[pick].list.length >= cap) pick = 1 - pick;
      T[pick].list.push(p); T[pick].c[g] = (T[pick].c[g] || 0) + 1;
    });
  });
  return T;
}
function hash_(s) {
  let h = 1779033703 ^ s.length;
  for (let i = 0; i < s.length; i++) { h = Math.imul(h ^ s.charCodeAt(i), 3432918353); h = h << 13 | h >>> 19; }
  h = Math.imul(h ^ h >>> 16, 2246822507); h = Math.imul(h ^ h >>> 13, 3266489909);
  return (h ^= h >>> 16) >>> 0;
}
function rng_(seed) {
  let a = hash_(seed);
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function shuffle_(arr, r) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
  return a;
}
// unbiased 0..99 from a random UUID (SecureRandom on Google's side)
function fair100_() {
  for (let i = 0; i < 50; i++) {
    const hex = crypto.randomUUID().replace(/-/g, '');
    for (let k = 0; k + 2 <= 8; k += 2) {
      const b = parseInt(hex.substr(k, 2), 16);
      if (b < 200) return b % 100;
    }
  }
  return Math.floor(Math.random() * 100);
}

/* ============ helpers ============ */

function write_(req, fn, needAdmin) {
  // the caller runs every write inside one transaction holding an advisory lock
  req = req || {};
  const admin = isAdmin_(req.pin);
  if (needAdmin && !admin) throw new Error('هذا الإجراء للمنظّم فقط.');
  TX.writing = true;
  const msg = fn(admin);
  return { msg: msg, state: personalize_(base_(), req.device, admin) };
}

// wrong-PIN counter: 15 failures lock the PIN for 10 minutes
function isAdmin_(pin, countFail) {
  if (!pin) return false;
  const pf = String(setting_('pinfail') || '').split('|');
  const fails = Number(pf[1] || 0) > Date.now() ? Number(pf[0] || 0) : 0;
  if (fails >= 15) return false;
  const ok = String(pin) === String(setting_('admin_pin'));
  if (!ok && countFail) { TX.writing = true; TX.persistOnError = true; setSetting_('pinfail', (fails + 1) + '|' + (Date.now() + 600000)); }
  return ok;
}

function current_() {
  const s = rows_('sessions');
  if (!s.length) throw new Error('لم يتم إعداد التطبيق بعد. شغّل الدالة setup.');
  return latestSession_(s);
}
function latestSession_(s) {
  return s.slice().sort(function (a, b) {
    return (a.date + a.start).localeCompare(b.date + b.start) || Number(a.created_at) - Number(b.created_at);
  })[s.length - 1];
}
function findActive_(S, regId) {
  const active = rows_('regs').filter(function (r) { return r.session_id === S.id && r.status === 'active'; })
    .sort(function (a, b) { return Number(a.created_at) - Number(b.created_at) || a._row - b._row; });
  for (let i = 0; i < active.length; i++) if (active[i].id === regId) return { reg: active[i], rank: i + 1 };
  throw new Error('هذا التسجيل غير موجود، ربما حُذف للتو.');
}
function removeReg_(reg, reason) {
  reg.status = 'removed'; reg.reason = reason; reg.removed_at = Date.now();
  update_('regs', reg);
}
function playerName_(id) {
  const p = rows_('players').filter(function (x) { return x.id === id; })[0];
  return p ? p.name : '';
}
function at_(date, hm) { return new Date(date + 'T' + hm + ':00' + OFFSET).getTime(); }
function pad_(n) { return (n < 10 ? '0' : '') + n; }
function uid_() { return crypto.randomUUID().replace(/-/g, '').slice(0, 12); }
function cleanName_(s, max) { return String(s || '').replace(/\s+/g, ' ').trim().slice(0, max || 30); }
function normKey_(s) {
  return cleanName_(s).replace(/[ً-ْٰـ]/g, '').replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه').replace(/ى/g, 'ي').toLowerCase();
}
function nextSaturday_() {
  const now = new Date();
  const today = Utilities.formatDate(now, TZ, 'yyyy-MM-dd');
  const dow = Number(Utilities.formatDate(now, TZ, 'u')); // 1 = Monday … 7 = Sunday
  let add = (6 - dow + 7) % 7;
  if (add === 0 && now.getTime() >= at_(today, '20:00')) add = 7;
  return Utilities.formatDate(new Date(new Date(today + 'T12:00:00' + OFFSET).getTime() + add * 86400000), TZ, 'yyyy-MM-dd');
}
function appUrl_() { return setting_('app_url') || ''; }

/* ---- date helper (replaces Utilities.formatDate) ---- */
const Utilities = {
  formatDate: function (d, tz, fmt) {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' }).formatToParts(d);
    const g = function (t) { return parts.filter(function (p) { return p.type === t; })[0].value; };
    if (fmt === 'yyyy-MM-dd') return g('year') + '-' + g('month') + '-' + g('day');
    if (fmt === 'u') return String({ Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[g('weekday')]);
    throw new Error('fmt ' + fmt);
  }
};

/* ---- table access (in-memory copy of the database for this request) ---- */
// rows_ returns copies (like reading a sheet); update_ writes a row back by _row.
function tbl_(k) {
  if (!SHEETS[k]) throw new Error('unknown table ' + k);
  if (!TX.tables[k]) TX.tables[k] = [];
  return TX.tables[k];
}
function rows_(k) {
  return tbl_(k).map(function (r) { return Object.assign({}, r); });
}
function clean_(k, o) {
  const out = {};
  SHEETS[k].cols.forEach(function (c) { out[c] = o[c] === undefined || o[c] === null ? '' : String(o[c]); });
  return out;
}
function append_(k, o) {
  const t = tbl_(k);
  TX.seq[k] = Math.max(TX.seq[k] || 0, t.reduce(function (m, r) { return Math.max(m, r._row); }, 0)) + 1;
  const row = Object.assign({ _row: TX.seq[k] }, clean_(k, o));
  t.push(row);
  TX.log.push({ op: 'ins', k: k, row: Object.assign({}, row) });
}
function update_(k, o) {
  const t = tbl_(k);
  const i = t.findIndex(function (r) { return r._row === o._row; });
  if (i < 0) throw new Error('row not found');
  t[i] = Object.assign({ _row: o._row }, clean_(k, o));
  TX.log.push({ op: 'upd', k: k, row: Object.assign({}, t[i]) });
}
function deleteWhere_(k, pred) {
  const t = tbl_(k);
  const gone = rows_(k).filter(pred).map(function (r) { return r._row; });
  if (!gone.length) return;
  TX.tables[k] = t.filter(function (r) { return gone.indexOf(r._row) < 0; });
  gone.forEach(function (n) { TX.log.push({ op: 'del', k: k, row: { _row: n } }); });
}
function setting_(key) {
  const r = tbl_('settings').filter(function (x) { return x.key === key; })[0];
  return r ? r.value : '';
}
function setSetting_(key, value) {
  const r = rows_('settings').filter(function (x) { return x.key === key; })[0];
  if (r) { r.value = value; update_('settings', r); } else append_('settings', { key: key, value: value });
}
