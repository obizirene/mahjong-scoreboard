/**
 * 🀅 雀神殿堂 - 麻將戰績記分板、月度 MVP 與聽牌大師
 * 支援 Firebase Realtime Database (global_lounge) 實時全人群組同步
 */

// ==========================================
// 1. STATE & CONSTANTS
// ==========================================
const STORAGE_KEY = 'mahjong_hall_data_v2';
const RTDB_NODE = 'global_lounge';

const TILE_MAP = {
  m1: '1萬', m2: '2萬', m3: '3萬', m4: '4萬', m5: '5萬', m6: '6萬', m7: '7萬', m8: '8萬', m9: '9萬',
  p1: '1筒', p2: '2筒', p3: '3筒', p4: '4筒', p5: '5筒', p6: '6筒', p7: '7筒', p8: '8筒', p9: '9筒',
  s1: '1條', s2: '2條', s3: '3條', s4: '4條', s5: '5條', s6: '6條', s7: '7條', s8: '8條', s9: '9條',
  z1: '東', z2: '南', z3: '西', z4: '北', z5: '中', z6: '發', z7: '白'
};

const ALL_TILES = Object.keys(TILE_MAP);

const AppState = {
  players: [],
  rounds: [],
  selectedMonth: '',
  selectedYear: '',
  mvpMode: 'month', // 'month' or 'year'
  calc: {
    base: 30,
    tai: 10,
    taiCount: 5,
    selectedTags: []
  },
  aiHand: [],
  activeTab: 'tab-mvp',
  cropper: {
    image: null,
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    isDragging: false,
    startX: 0,
    startY: 0
  },
  tempCroppedAvatar: '',
  firebaseReady: false,
  rtdbRef: null
};

// ==========================================
// 2. FIREBASE REALTIME DATABASE SYNC ENGINE
// ==========================================
function applyCloudData(data) {
  if (!data) return;
  if (Array.isArray(data.players)) {
    AppState.players = data.players.map(p => ({
      ...p,
      title: p.titleTag || p.title || ''
    }));
  } else if (typeof data.players === 'object') {
    AppState.players = Object.values(data.players).map(p => ({
      ...p,
      title: p.titleTag || p.title || ''
    }));
  } else {
    AppState.players = [];
  }

  if (Array.isArray(data.rounds)) {
    AppState.rounds = data.rounds;
  } else if (typeof data.rounds === 'object') {
    AppState.rounds = Object.values(data.rounds);
  } else {
    AppState.rounds = [];
  }

  // Auto-detect any player IDs in rounds that are missing from players list
  const knownPids = new Set(AppState.players.map(p => p.id));
  AppState.rounds.forEach(r => {
    Object.keys(r.scores || {}).forEach(pid => {
      if (!knownPids.has(pid)) {
        AppState.players.push({
          id: pid,
          name: '牌友 (' + pid.substring(Math.max(0, pid.length - 4)) + ')',
          color: '#10b981',
          title: '常客牌友',
          titleTag: '常客牌友',
          avatarUrl: ''
        });
        knownPids.add(pid);
      }
    });
  });

  // Auto-select latest month that actually has game rounds
  const months = getAvailableMonths();
  const monthWithRounds = months.find(m => AppState.rounds.some(r => r.date && r.date.startsWith(m)));
  const currentMonthRoundCount = AppState.rounds.filter(r => r.date && r.date.startsWith(AppState.selectedMonth)).length;
  if (!AppState.selectedMonth || currentMonthRoundCount === 0) {
    if (monthWithRounds) {
      AppState.selectedMonth = monthWithRounds;
    }
  }

  const countBadge = document.getElementById('player-count-badge');
  if (countBadge) countBadge.textContent = AppState.players.length;

  saveLocalBackup();
  refreshAllViews();
}

async function fetchCloudDataRest() {
  const dbUrl = window.FIREBASE_CONFIG && window.FIREBASE_CONFIG.databaseURL;
  if (!dbUrl) return false;
  try {
    const res = await fetch(`${dbUrl}/${RTDB_NODE}.json?t=${Date.now()}`);
    if (res.ok) {
      const data = await res.json();
      if (data) {
        applyCloudData(data);
        const syncDot = document.getElementById('sync-dot');
        const syncLabel = document.querySelector('.room-code-label');
        if (syncDot) {
          syncDot.className = 'sync-dot live';
          syncDot.style.background = '#10b981';
        }
        if (syncLabel) syncLabel.textContent = '雲端已即時同步';
        return true;
      }
    }
  } catch (e) {
    console.warn('REST cloud fetch warning:', e);
  }
  return false;
}

function initFirebase() {
  const syncDot = document.getElementById('sync-dot');
  const syncLabel = document.querySelector('.room-code-label');

  if (!window.FIREBASE_CONFIG || !window.FIREBASE_CONFIG.databaseURL) {
    console.log('Firebase Realtime Database URL not provided. Running in Local Mode.');
    if (syncDot) {
      syncDot.className = 'sync-dot';
      syncDot.style.background = '#f59e0b';
    }
    if (syncLabel) syncLabel.textContent = '本機模式';
    return;
  }

  try {
    if (typeof firebase !== 'undefined' && firebase.apps) {
      if (!firebase.apps.length) {
        firebase.initializeApp(window.FIREBASE_CONFIG);
      }
      const db = firebase.database();
      AppState.rtdbRef = db.ref(RTDB_NODE);
      AppState.firebaseReady = true;

      if (syncDot) {
        syncDot.className = 'sync-dot live';
        syncDot.style.background = '#10b981';
      }
      if (syncLabel) syncLabel.textContent = '雲端已即時同步';

      // Listen for realtime updates from global_lounge node
      AppState.rtdbRef.on('value', (snapshot) => {
        const data = snapshot.val();
        if (data) {
          applyCloudData(data);
        }
      }, (error) => {
        console.error('Firebase realtime sync error:', error);
      });
    }
  } catch (e) {
    console.warn('Firebase SDK init warning (using REST fallback):', e);
  }
}

// Push latest state to Firebase Realtime Database
async function syncPushToCloud() {
  const cleanPlayers = AppState.players.map(p => ({
    id: p.id,
    name: p.name,
    color: p.color || '#10b981',
    titleTag: p.title || p.titleTag || '',
    avatarUrl: p.avatarUrl || ''
  }));

  const payload = {
    players: cleanPlayers,
    rounds: AppState.rounds,
    updatedAt: new Date().toISOString()
  };

  // 1. WebSocket SDK push
  if (AppState.firebaseReady && AppState.rtdbRef) {
    try {
      await AppState.rtdbRef.set(payload);
    } catch (e) {
      console.warn('Firebase SDK push error:', e);
    }
  }

  // 2. Direct REST API push
  const dbUrl = window.FIREBASE_CONFIG && window.FIREBASE_CONFIG.databaseURL;
  if (dbUrl) {
    try {
      await fetch(`${dbUrl}/${RTDB_NODE}.json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } catch (e) {
      console.warn('REST push error:', e);
    }
  }

  saveLocalBackup();
  refreshAllViews();
}

async function syncSavePlayer(player) {
  const pData = {
    ...player,
    title: player.title || player.titleTag || '',
    titleTag: player.title || player.titleTag || ''
  };
  const idx = AppState.players.findIndex(p => p.id === player.id);
  if (idx >= 0) {
    AppState.players[idx] = pData;
  } else {
    AppState.players.push(pData);
  }
  await syncPushToCloud();
  refreshAllViews();
}

async function syncDeletePlayer(playerId) {
  AppState.players = AppState.players.filter(p => p.id !== playerId);
  await syncPushToCloud();
  refreshAllViews();
}

async function syncSaveRound(round) {
  AppState.rounds.push(round);
  await syncPushToCloud();
  refreshAllViews();
}

async function syncDeleteRound(roundId) {
  AppState.rounds = AppState.rounds.filter(r => r.id !== roundId);
  await syncPushToCloud();
  refreshAllViews();
}

// ==========================================
// 3. LOCAL CACHE (NO DEFAULT DUMMY DATA)
// ==========================================
function loadLocalState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      AppState.players = (parsed.players || []).map(p => ({
        ...p,
        title: p.titleTag || p.title || ''
      }));
      AppState.rounds = parsed.rounds || [];
    } else {
      AppState.players = [];
      AppState.rounds = [];
    }
  } catch (e) {
    console.error('Failed to load local state:', e);
    AppState.players = [];
    AppState.rounds = [];
  }
}

function saveLocalBackup() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      players: AppState.players,
      rounds: AppState.rounds
    }));
  } catch (e) {
    console.error('Failed to save local state:', e);
  }
}

function refreshAllViews() {
  renderMVPView();
  renderPlayersView();
  renderHistoryView();
}

// ==========================================
// 4. TOAST NOTIFICATIONS
// ==========================================
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  
  let icon = 'ℹ️';
  if (type === 'success') icon = '✅';
  if (type === 'error') icon = '⚠️';
  if (type === 'gold') icon = '👑';

  toast.innerHTML = `<span class="toast-icon">${icon}</span> <span class="toast-msg">${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('toast-fadeout');
    setTimeout(() => toast.remove(), 400);
  }, 2600);
}

// ==========================================
// 5. TAB NAVIGATION
// ==========================================
function initNavigation() {
  const allTabBtns = document.querySelectorAll('[data-tab]');
  allTabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const tabId = btn.getAttribute('data-tab');
      switchTab(tabId);
    });
  });
}

function switchTab(tabId) {
  AppState.activeTab = tabId;

  document.querySelectorAll('[data-tab]').forEach(btn => {
    if (btn.getAttribute('data-tab') === tabId) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  document.querySelectorAll('.tab-page').forEach(page => {
    if (page.id === tabId) {
      page.classList.add('active');
    } else {
      page.classList.remove('active');
    }
  });

  if (tabId === 'tab-mvp') renderMVPView();
  if (tabId === 'tab-players') renderPlayersView();
  if (tabId === 'tab-history') renderHistoryView();
  if (tabId === 'tab-calculator') renderCalculatorView();
  if (tabId === 'tab-ai-scanner') renderAIScannerView();
}

// ==========================================
// 6. TAB 1: 月度與年度 MVP 榮譽殿堂
// ==========================================
function getAvailableMonths() {
  const months = new Set();
  const now = new Date();
  const currentMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  months.add(currentMonthStr);

  AppState.rounds.forEach(r => {
    if (r.date && r.date.length >= 7) {
      months.add(r.date.substring(0, 7));
    }
  });

  return Array.from(months).sort().reverse();
}

function getAvailableYears() {
  const years = new Set();
  const now = new Date();
  years.add(String(now.getFullYear()));

  AppState.rounds.forEach(r => {
    if (r.date && r.date.length >= 4) {
      years.add(r.date.substring(0, 4));
    }
  });

  return Array.from(years).sort().reverse();
}

function initMVPSelectors() {
  const selectMonth = document.getElementById('select-month');
  const selectYear = document.getElementById('select-year');
  const label = document.getElementById('select-month-label');
  const btnMonth = document.getElementById('btn-mvp-month');
  const btnYear = document.getElementById('btn-mvp-year');

  if (btnMonth && btnYear) {
    btnMonth.onclick = () => {
      if (AppState.mvpMode !== 'month') {
        AppState.mvpMode = 'month';
        btnMonth.classList.add('active');
        btnYear.classList.remove('active');
        renderMVPView();
      }
    };

    btnYear.onclick = () => {
      if (AppState.mvpMode !== 'year') {
        AppState.mvpMode = 'year';
        btnYear.classList.add('active');
        btnMonth.classList.remove('active');
        renderMVPView();
      }
    };
  }

  const isYear = AppState.mvpMode === 'year';

  if (isYear) {
    if (selectMonth) selectMonth.classList.add('hidden');
    if (selectYear) selectYear.classList.remove('hidden');
    if (label) label.textContent = '🎆 選擇年份：';

    if (selectYear) {
      const years = getAvailableYears();
      if (!AppState.selectedYear || !years.includes(AppState.selectedYear)) {
        AppState.selectedYear = years[0];
      }
      selectYear.innerHTML = years.map(y => {
        return `<option value="${y}" ${y === AppState.selectedYear ? 'selected' : ''}>${y} 全年度</option>`;
      }).join('');

      selectYear.onchange = (e) => {
        AppState.selectedYear = e.target.value;
        renderMVPView();
      };
    }
  } else {
    if (selectYear) selectYear.classList.add('hidden');
    if (selectMonth) selectMonth.classList.remove('hidden');
    if (label) label.textContent = '📅 選擇月份：';

    if (selectMonth) {
      const months = getAvailableMonths();
      const monthWithRounds = months.find(m => AppState.rounds.some(r => r.date && r.date.startsWith(m)));
      const currentMonthRoundCount = AppState.rounds.filter(r => r.date && r.date.startsWith(AppState.selectedMonth)).length;
      if (!AppState.selectedMonth || !months.includes(AppState.selectedMonth) || (currentMonthRoundCount === 0 && monthWithRounds)) {
        AppState.selectedMonth = monthWithRounds || months[0];
      }
      selectMonth.innerHTML = months.map(m => {
        const [y, mm] = m.split('-');
        const count = AppState.rounds.filter(r => r.date && r.date.startsWith(m)).length;
        const countLabel = count > 0 ? ` (${count} 將)` : ' (新月份)';
        return `<option value="${m}" ${m === AppState.selectedMonth ? 'selected' : ''}>${y} 年 ${parseInt(mm, 10)} 月份${countLabel}</option>`;
      }).join('');

      selectMonth.onchange = (e) => {
        AppState.selectedMonth = e.target.value;
        renderMVPView();
      };
    }
  }
}

function calculateMonthlyStats(month) {
  const monthRounds = AppState.rounds.filter(r => r.date && r.date.startsWith(month));
  const playerStats = {};

  AppState.players.forEach(p => {
    playerStats[p.id] = {
      player: p,
      profit: 0,
      roundsCount: 0,
      wins: 0,
      losses: 0,
      maxWin: 0,
      maxLoss: 0
    };
  });

  monthRounds.forEach(round => {
    Object.entries(round.scores || {}).forEach(([pid, score]) => {
      if (!playerStats[pid]) {
        playerStats[pid] = {
          player: { id: pid, name: '牌友', color: '#10b981', title: '' },
          profit: 0,
          roundsCount: 0,
          wins: 0,
          losses: 0,
          maxWin: 0,
          maxLoss: 0
        };
      }
      const val = Number(score) || 0;
      playerStats[pid].profit += val;
      playerStats[pid].roundsCount += 1;
      if (val > 0) {
        playerStats[pid].wins += 1;
        if (val > playerStats[pid].maxWin) playerStats[pid].maxWin = val;
      } else if (val < 0) {
        playerStats[pid].losses += 1;
        if (val < playerStats[pid].maxLoss) playerStats[pid].maxLoss = val;
      }
    });
  });

  const activeStats = Object.values(playerStats)
    .filter(s => s.roundsCount > 0)
    .map(s => {
      const winRate = s.roundsCount > 0 ? ((s.wins / s.roundsCount) * 100) : 0;
      const avg = s.roundsCount > 0 ? Math.round(s.profit / s.roundsCount) : 0;
      return {
        ...s,
        winRate,
        avg
      };
    })
    .sort((a, b) => b.profit - a.profit);

  return {
    rounds: monthRounds,
    activeStats
  };
}

function calculateYearlyStats(year) {
  const yearRounds = AppState.rounds.filter(r => r.date && r.date.startsWith(year));
  const playerStats = {};

  AppState.players.forEach(p => {
    playerStats[p.id] = {
      player: p,
      profit: 0,
      roundsCount: 0,
      wins: 0,
      losses: 0,
      maxWin: 0,
      maxLoss: 0
    };
  });

  yearRounds.forEach(round => {
    Object.entries(round.scores || {}).forEach(([pid, score]) => {
      if (!playerStats[pid]) {
        playerStats[pid] = {
          player: { id: pid, name: '牌友', color: '#10b981', title: '' },
          profit: 0,
          roundsCount: 0,
          wins: 0,
          losses: 0,
          maxWin: 0,
          maxLoss: 0
        };
      }
      const val = Number(score) || 0;
      playerStats[pid].profit += val;
      playerStats[pid].roundsCount += 1;
      if (val > 0) {
        playerStats[pid].wins += 1;
        if (val > playerStats[pid].maxWin) playerStats[pid].maxWin = val;
      } else if (val < 0) {
        playerStats[pid].losses += 1;
        if (val < playerStats[pid].maxLoss) playerStats[pid].maxLoss = val;
      }
    });
  });

  const activeStats = Object.values(playerStats)
    .filter(s => s.roundsCount > 0)
    .map(s => {
      const winRate = s.roundsCount > 0 ? ((s.wins / s.roundsCount) * 100) : 0;
      const avg = s.roundsCount > 0 ? Math.round(s.profit / s.roundsCount) : 0;
      return {
        ...s,
        winRate,
        avg
      };
    })
    .sort((a, b) => b.profit - a.profit);

  return {
    rounds: yearRounds,
    activeStats
  };
}

function renderMVPView() {
  initMVPSelectors();
  const isYear = AppState.mvpMode === 'year';

  const { rounds, activeStats } = isYear 
    ? calculateYearlyStats(AppState.selectedYear)
    : calculateMonthlyStats(AppState.selectedMonth);

  const h2 = document.getElementById('mvp-title-h2');
  const pDesc = document.getElementById('mvp-title-p');
  const tableTitle = document.getElementById('table-header-title');

  if (h2) h2.textContent = isYear ? `🏆 雀界傳說 ‧ ${AppState.selectedYear} 年度總決算` : '🏆 雀聖降臨 ‧ 近期風雲榜';
  if (pDesc) pDesc.textContent = isYear ? '路遙知馬力，日久見牌技！三百六十五天的血流成河，見證年度最強雀聖的榮耀加冕。' : '牌品好人品自然好！實況轉播這個月誰得牌神眷顧，誰又是被針對的放槍王。';
  if (tableTitle) tableTitle.textContent = isYear ? `📊 ${AppState.selectedYear} 年度瘋狗排行榜` : '📊 每月蕭郎排行榜';

  const podiumContainer = document.getElementById('podium-container');
  const awardsContainer = document.getElementById('special-awards-grid');
  const tbody = document.getElementById('tbody-monthly-leaderboard');
  const summaryText = document.getElementById('monthly-summary-text');

  if (summaryText) {
    const totalFlow = rounds.reduce((acc, r) => {
      const roundPositive = Object.values(r.scores || {}).reduce((s, v) => v > 0 ? s + v : s, 0);
      return acc + roundPositive;
    }, 0);
    const periodLabel = isYear ? '全年度共' : '共';
    summaryText.innerHTML = `${periodLabel} <strong>${rounds.length}</strong> 將對局 ‧ 累計流動資金 <strong>$ ${totalFlow.toLocaleString()}</strong>`;
  }

  // Render Podium (Top 3)
  if (podiumContainer) {
    if (activeStats.length === 0) {
      const months = getAvailableMonths();
      const monthWithRounds = months.find(m => AppState.rounds.some(r => r.date && r.date.startsWith(m)));
      const countWithRounds = monthWithRounds ? AppState.rounds.filter(r => r.date && r.date.startsWith(monthWithRounds)).length : 0;

      podiumContainer.innerHTML = `
        <div class="empty-state card glass-card text-center p-8 w-full">
          <span style="font-size: 3rem;">🀄</span>
          <h4 class="mt-2 text-gold font-bold">${isYear ? '本年度' : '本月份'}尚無戰績紀錄</h4>
          <p class="text-subtle mt-1">目前選擇的是全新月份。您可以點擊上方「選擇月份」查看歷史月份！</p>
          ${!isYear && monthWithRounds && monthWithRounds !== AppState.selectedMonth ? `
            <button class="btn btn-primary btn-sm mt-3 glow-effect" onclick="AppState.selectedMonth='${monthWithRounds}'; renderMVPView();">
              👉 切換至 ${monthWithRounds} 查看歷史戰績 (${countWithRounds} 將)
            </button>
          ` : ''}
        </div>
      `;
    } else {
      const first = activeStats[0];
      const second = activeStats[1];
      const third = activeStats[2];

      const renderPodiumCard = (rank, stat) => {
        if (!stat) {
          return `<div class="podium-card rank-${rank}"><div class="podium-name">從缺</div></div>`;
        }
        const p = stat.player;
        const avatarInner = p.avatarUrl 
          ? `<img src="${p.avatarUrl}" alt="${p.name}">` 
          : p.name.charAt(0);

        const crownHtml = rank === 1 ? '<div class="crown-badge">👑</div>' : '';
        const profitSign = stat.profit >= 0 ? '+' : '';
        const profitColor = stat.profit >= 0 ? 'text-gold' : 'text-red';
        const rankTitleDefault = isYear ? (rank === 1 ? '年度王者' : '年度高手') : (rank === 1 ? '當月雀神' : '牌友');

        return `
          <div class="podium-card rank-${rank}">
            ${crownHtml}
            <div class="avatar-wrapper" style="background:${p.color || '#10b981'}">
              ${avatarInner}
              <span class="rank-badge">${rank}</span>
            </div>
            <div class="podium-name">${p.name}</div>
            <div class="podium-title">${p.title || rankTitleDefault}</div>
            <div class="podium-profit ${profitColor}">${profitSign}$ ${stat.profit.toLocaleString()}</div>
            <div class="podium-stats-row">
              <span>勝率 ${stat.winRate.toFixed(1)}%</span>
              <span>${stat.roundsCount} 將</span>
            </div>
          </div>
        `;
      };

      podiumContainer.innerHTML = `
        ${renderPodiumCard(2, second)}
        ${renderPodiumCard(1, first)}
        ${renderPodiumCard(3, third)}
      `;
    }
  }

  // Render Special Category Awards
  if (awardsContainer) {
    if (activeStats.length === 0) {
      awardsContainer.innerHTML = '';
    } else {
      const mvp = activeStats[0];
      const eligibleForWinRate = activeStats.filter(s => s.roundsCount >= 2);
      const winRateKing = (eligibleForWinRate.length > 0 ? eligibleForWinRate : activeStats)
        .slice().sort((a, b) => b.winRate - a.winRate)[0];

      const bigWinner = activeStats.slice().sort((a, b) => b.maxWin - a.maxWin)[0];
      const philanthropist = activeStats.slice().sort((a, b) => a.profit - b.profit)[0];
      const workhorse = activeStats.slice().sort((a, b) => b.roundsCount - a.roundsCount)[0];

      const renderAwardCard = (icon, title, stat, desc, highlight) => {
        if (!stat) return '';
        const p = stat.player;
        return `
          <div class="award-card">
            <div class="award-icon-box">${icon}</div>
            <div class="award-info">
              <div class="award-title">${title}</div>
              <div class="award-winner">${p.name} <span class="text-gold font-bold text-sm">(${highlight})</span></div>
              <div class="award-sub">${desc}</div>
            </div>
          </div>
        `;
      };

      const mvpTitle = isYear ? '年度雀神 (年度瘋狗)' : '當月雀神 (每月蕭郎)';
      const mvpDesc = isYear ? `${AppState.selectedYear} 全年度戰績淨利冠軍` : '當月戰績淨利冠軍';
      const winRateTitle = isYear ? '年度勝率王' : '勝率之王';
      const winRateDesc = isYear ? '全年度勝將率最高牌友' : '勝將率最高牌友';
      const bigWinTitle = isYear ? '年度單將暴發戶' : '單將暴發戶';
      const bigWinDesc = isYear ? '全年度單場最高獨贏收益' : '單場最高獨贏收益';
      const philTitle = isYear ? '年度大方慈善家' : '大方慈善家';
      const philDesc = isYear ? '全年度默默奉獻籌碼之大功臣' : '默默奉獻籌碼之功臣';
      const workTitle = isYear ? '年度雀界勞模' : '雀界勞模';
      const workDesc = isYear ? '全年度參戰將數最狂熱' : '出賽將數最狂熱';

      awardsContainer.innerHTML = `
        ${renderAwardCard('👑', mvpTitle, mvp, mvpDesc, `+ $ ${mvp.profit.toLocaleString()}`)}
        ${renderAwardCard('🎯', winRateTitle, winRateKing, winRateDesc, `${winRateKing.winRate.toFixed(1)}%`)}
        ${renderAwardCard('🚀', bigWinTitle, bigWinner, bigWinDesc, `+ $ ${bigWinner.maxWin.toLocaleString()}`)}
        ${renderAwardCard('💸', philTitle, philanthropist, philDesc, `$ ${philanthropist.profit.toLocaleString()}`)}
        ${renderAwardCard('🀄', workTitle, workhorse, workDesc, `${workhorse.roundsCount} 將`)}
      `;
    }
  }

  // Render Full Leaderboard Table
  if (tbody) {
    if (activeStats.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" class="text-center p-6 text-subtle">
            ${isYear ? '本年度' : '本月'}尚無紀錄，點擊右上角「記新的一將」開始記錄！
          </td>
        </tr>
      `;
    } else {
      tbody.innerHTML = activeStats.map((stat, idx) => {
        const p = stat.player;
        const rank = idx + 1;
        let rankBadge = rank;
        if (rank === 1) rankBadge = '🥇 1';
        if (rank === 2) rankBadge = '🥈 2';
        if (rank === 3) rankBadge = '🥉 3';

        const profitClass = stat.profit > 0 ? 'text-gold font-bold' : (stat.profit < 0 ? 'text-red font-bold' : '');
        const profitSign = stat.profit > 0 ? '+' : '';

        return `
          <tr>
            <td><strong>${rankBadge}</strong></td>
            <td>
              <div class="player-cell" style="display:flex; align-items:center; gap:0.5rem;">
                <span class="player-dot" style="background:${p.color || '#10b981'}; width:10px; height:10px; border-radius:50%; display:inline-block;"></span>
                <div>
                  <strong>${p.name}</strong>
                  <div class="text-xs text-subtle">${p.title || ''}</div>
                </div>
              </div>
            </td>
            <td><strong>${stat.roundsCount}</strong></td>
            <td class="${profitClass}">${profitSign}$ ${stat.profit.toLocaleString()}</td>
            <td>${stat.winRate.toFixed(1)}%</td>
            <td class="${stat.avg >= 0 ? 'text-emerald' : 'text-red'}">${stat.avg >= 0 ? '+' : ''}$ ${stat.avg.toLocaleString()}</td>
            <td class="text-gold">+$ ${stat.maxWin.toLocaleString()}</td>
          </tr>
        `;
      }).join('');
    }
  }
}

// ==========================================
// 7. TAB 2: 牌友玩家池 & 個人檔案
// ==========================================
function calculatePlayerLifetimeStats(playerId) {
  let profit = 0;
  let roundsCount = 0;
  let wins = 0;
  let losses = 0;
  let maxWin = 0;
  let maxLoss = 0;
  const opponents = {};

  AppState.rounds.forEach(r => {
    if (r.scores && playerId in r.scores) {
      roundsCount += 1;
      const myScore = Number(r.scores[playerId]) || 0;
      profit += myScore;
      if (myScore > 0) {
        wins += 1;
        if (myScore > maxWin) maxWin = myScore;
      } else if (myScore < 0) {
        losses += 1;
        if (myScore < maxLoss) maxLoss = myScore;
      }

      Object.entries(r.scores).forEach(([oppId, oppScore]) => {
        if (oppId === playerId) return;
        if (!opponents[oppId]) {
          const oppPlayer = AppState.players.find(p => p.id === oppId);
          opponents[oppId] = {
            id: oppId,
            name: oppPlayer ? oppPlayer.name : '未知',
            sharedRounds: 0,
            relativeAdvantage: 0
          };
        }
        opponents[oppId].sharedRounds += 1;
        opponents[oppId].relativeAdvantage += (myScore - (Number(oppScore) || 0));
      });
    }
  });

  const winRate = roundsCount > 0 ? ((wins / roundsCount) * 100) : 0;
  const oppList = Object.values(opponents).sort((a, b) => b.relativeAdvantage - a.relativeAdvantage);
  const bestATM = oppList.length > 0 && oppList[0].relativeAdvantage > 0 ? oppList[0] : null;
  const worstNemesis = oppList.length > 0 && oppList[oppList.length - 1].relativeAdvantage < 0 ? oppList[oppList.length - 1] : null;

  return {
    profit,
    roundsCount,
    wins,
    losses,
    winRate,
    maxWin,
    maxLoss,
    bestATM,
    worstNemesis
  };
}

function renderPlayersView() {
  const grid = document.getElementById('player-grid');
  const countBadge = document.getElementById('player-count-badge');
  if (countBadge) countBadge.textContent = AppState.players.length;

  if (!grid) return;

  if (AppState.players.length === 0) {
    grid.innerHTML = `
      <div class="card glass-card text-center p-8 w-full" style="grid-column: 1 / -1;">
        <h3>👥 牌友池尚未建立玩家</h3>
        <p class="text-subtle mt-2">請點擊上方「➕ 新增牌友」建立第一位牌桌好友！</p>
      </div>
    `;
    return;
  }

  grid.innerHTML = AppState.players.map(p => {
    const stats = calculatePlayerLifetimeStats(p.id);
    const avatarInner = p.avatarUrl
      ? `<img src="${p.avatarUrl}" alt="${p.name}">`
      : p.name.charAt(0);

    const profitClass = stats.profit >= 0 ? 'text-gold' : 'text-red';
    const profitSign = stats.profit >= 0 ? '+' : '';

    return `
      <div class="player-card" onclick="openPlayerDetailModal('${p.id}')">
        <div class="player-card-header">
          <div class="player-avatar" style="background:${p.color || '#10b981'}">
            ${avatarInner}
          </div>
          <div class="player-info" style="flex:1;">
            <h3>${p.name}</h3>
            <p class="player-tag">${p.title || '常客牌友'}</p>
          </div>
          <button class="btn btn-secondary btn-xs" style="padding:4px 8px;" title="編輯玩家" onclick="event.stopPropagation(); openEditPlayerModal('${p.id}')">✏️ 編輯</button>
        </div>

        <div class="player-stats-grid">
          <div class="stat-item">
            <div class="stat-label">生涯戰績</div>
            <div class="stat-value ${profitClass}">${profitSign}$ ${stats.profit.toLocaleString()}</div>
          </div>
          <div class="stat-item">
            <div class="stat-label">出戰將數</div>
            <div class="stat-value">${stats.roundsCount} 將</div>
          </div>
          <div class="stat-item">
            <div class="stat-label">生涯勝率</div>
            <div class="stat-value">${stats.winRate.toFixed(1)}%</div>
          </div>
          <div class="stat-item">
            <div class="stat-label">最高獨贏</div>
            <div class="stat-value text-gold">+$ ${stats.maxWin.toLocaleString()}</div>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function openPlayerDetailModal(playerId) {
  const p = AppState.players.find(x => x.id === playerId);
  if (!p) return;

  const modal = document.getElementById('player-detail-modal');
  const title = document.getElementById('player-detail-title');
  const content = document.getElementById('player-detail-content');

  title.textContent = `🀅 牌友詳細檔案 - ${p.name}`;
  const stats = calculatePlayerLifetimeStats(p.id);

  const avatarInner = p.avatarUrl
    ? `<img src="${p.avatarUrl}" style="width:100%; height:100%; object-fit:cover; border-radius:50%;">`
    : `<div style="width:100%; height:100%; display:flex; align-items:center; justify-content:center; font-size:2rem; font-weight:800; color:#fff;">${p.name.charAt(0)}</div>`;

  content.innerHTML = `
    <div class="player-detail-profile-card">
      <div style="display:flex; align-items:center; gap:1.25rem; margin-bottom:1.5rem;">
        <div style="width:80px; height:80px; border-radius:50%; background:${p.color || '#10b981'}; overflow:hidden; flex-shrink:0; box-shadow: 0 4px 12px rgba(0,0,0,0.4);">
          ${avatarInner}
        </div>
        <div>
          <h2 style="font-size:1.6rem; color:#fff; font-weight:800;">${p.name}</h2>
          <p class="text-gold font-bold">${p.title || '無牌桌稱號'}</p>
          <span class="text-subtle text-xs">加入時間: ${new Date(p.createdAt || Date.now()).toLocaleDateString()}</span>
        </div>
      </div>

      <div class="grid-2 mt-4" style="gap:1rem;">
        <div class="card glass-card p-4">
          <span class="text-subtle text-xs">生涯總淨利</span>
          <h3 class="mt-1 ${stats.profit >= 0 ? 'text-gold' : 'text-red'}">
            ${stats.profit >= 0 ? '+' : ''}$ ${stats.profit.toLocaleString()}
          </h3>
        </div>
        <div class="card glass-card p-4">
          <span class="text-subtle text-xs">參戰將數</span>
          <h3 class="mt-1 text-white">${stats.roundsCount} 將</h3>
        </div>
        <div class="card glass-card p-4">
          <span class="text-subtle text-xs">生涯勝將率</span>
          <h3 class="mt-1 text-emerald">${stats.winRate.toFixed(1)}%</h3>
        </div>
        <div class="card glass-card p-4">
          <span class="text-subtle text-xs">最高單將獨贏</span>
          <h3 class="mt-1 text-gold">+$ ${stats.maxWin.toLocaleString()}</h3>
        </div>
      </div>

      <div class="card glass-card p-4 mt-4">
        <h4 class="text-gold font-bold">⚔️ 牌桌相剋關係分析</h4>
        <div class="grid-2 mt-3" style="gap:1rem;">
          <div style="background:rgba(16,185,129,0.12); padding:1rem; border-radius:12px; border:1px solid rgba(16,185,129,0.3);">
            <div style="font-size:1.4rem;">💰</div>
            <strong class="text-emerald">頭號提款機</strong>
            <p class="text-sm mt-1">${stats.bestATM ? `${stats.bestATM.name} (同桌相對淨贏 $${Math.round(stats.bestATM.relativeAdvantage/2)})` : '目前無明顯對手'}</p>
          </div>
          <div style="background:rgba(239,68,68,0.12); padding:1rem; border-radius:12px; border:1px solid rgba(239,68,68,0.3);">
            <div style="font-size:1.4rem;">⚡</div>
            <strong class="text-red">宿命剋星</strong>
            <p class="text-sm mt-1">${stats.worstNemesis ? `${stats.worstNemesis.name} (同桌相對失血 $${Math.abs(Math.round(stats.worstNemesis.relativeAdvantage/2))})` : '目前無剋星'}</p>
          </div>
        </div>
      </div>
    </div>
  `;

  modal.classList.remove('hidden');
}

// Player Modal Form logic
function initPlayerFormModal() {
  const btnAdd = document.getElementById('btn-add-player');
  const modal = document.getElementById('modal-player-form');
  const btnSave = document.getElementById('btn-save-player');
  const btnDelete = document.getElementById('btn-delete-player-form');
  const colorSwatches = document.querySelectorAll('.color-swatch');

  let selectedColor = '#10b981';

  colorSwatches.forEach(swatch => {
    swatch.addEventListener('click', () => {
      colorSwatches.forEach(s => s.classList.remove('active'));
      swatch.classList.add('active');
      selectedColor = swatch.getAttribute('data-color');
    });
  });

  if (btnAdd) {
    btnAdd.addEventListener('click', () => {
      document.getElementById('player-form-id').value = '';
      document.getElementById('player-form-name').value = '';
      document.getElementById('player-form-title-tag').value = '';
      document.getElementById('player-form-title').textContent = '➕ 新增牌友';
      AppState.tempCroppedAvatar = '';
      updateAvatarPreview('');
      if (btnDelete) btnDelete.classList.add('hidden');
      modal.classList.remove('hidden');
    });
  }

  if (btnSave) {
    btnSave.addEventListener('click', async () => {
      const id = document.getElementById('player-form-id').value;
      const name = document.getElementById('player-form-name').value.trim();
      const title = document.getElementById('player-form-title-tag').value.trim();

      if (!name) {
        showToast('請輸入玩家姓名或暱稱！', 'error');
        return;
      }

      if (id) {
        const p = AppState.players.find(x => x.id === id);
        const updated = {
          ...p,
          name,
          title,
          titleTag: title,
          color: selectedColor,
          avatarUrl: AppState.tempCroppedAvatar !== undefined ? AppState.tempCroppedAvatar : (p ? p.avatarUrl : '')
        };
        await syncSavePlayer(updated);
        showToast(`已更新牌友「${name}」！`, 'success');
      } else {
        const newPlayer = {
          id: 'p_' + Date.now(),
          name,
          title,
          titleTag: title,
          color: selectedColor,
          avatarUrl: AppState.tempCroppedAvatar || '',
          createdAt: Date.now()
        };
        await syncSavePlayer(newPlayer);
        showToast(`已成功新增牌友「${name}」！`, 'success');
      }

      modal.classList.add('hidden');
    });
  }

  if (btnDelete) {
    btnDelete.addEventListener('click', async () => {
      const id = document.getElementById('player-form-id').value;
      const p = AppState.players.find(x => x.id === id);
      if (!p) return;

      if (confirm(`確定要刪除玩家「${p.name}」嗎？這將自牌友池移除。`)) {
        await syncDeletePlayer(id);
        modal.classList.add('hidden');
        showToast(`已刪除玩家「${p.name}」`, 'info');
      }
    });
  }

  const btnTriggerAvatar = document.getElementById('btn-trigger-avatar');
  const fileInput = document.getElementById('player-form-avatar-file');
  const btnClearAvatar = document.getElementById('btn-clear-avatar');

  if (btnTriggerAvatar && fileInput) {
    btnTriggerAvatar.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (event) => {
          openCropperModal(event.target.result);
        };
        reader.readAsDataURL(file);
      }
      fileInput.value = '';
    });
  }

  if (btnClearAvatar) {
    btnClearAvatar.addEventListener('click', () => {
      AppState.tempCroppedAvatar = '';
      updateAvatarPreview('');
    });
  }
}

function openEditPlayerModal(playerId) {
  const p = AppState.players.find(x => x.id === playerId);
  if (!p) return;

  const modal = document.getElementById('modal-player-form');
  document.getElementById('player-form-id').value = p.id;
  document.getElementById('player-form-name').value = p.name;
  document.getElementById('player-form-title-tag').value = p.title || p.titleTag || '';
  document.getElementById('player-form-title').textContent = `✏️ 編輯牌友 - ${p.name}`;

  document.querySelectorAll('.color-swatch').forEach(s => {
    if (s.getAttribute('data-color') === p.color) {
      s.classList.add('active');
    } else {
      s.classList.remove('active');
    }
  });

  AppState.tempCroppedAvatar = p.avatarUrl || '';
  updateAvatarPreview(p.avatarUrl || '');

  const btnDelete = document.getElementById('btn-delete-player-form');
  if (btnDelete) btnDelete.classList.remove('hidden');

  modal.classList.remove('hidden');
}

function updateAvatarPreview(url) {
  const previewBox = document.getElementById('avatar-preview-box');
  const btnClear = document.getElementById('btn-clear-avatar');
  if (!previewBox) return;

  if (url) {
    previewBox.innerHTML = `<img src="${url}" style="width:100%; height:100%; object-fit:cover; border-radius:50%;">`;
    if (btnClear) btnClear.classList.remove('hidden');
  } else {
    previewBox.innerHTML = `<span id="avatar-preview-text">無頭像</span>`;
    if (btnClear) btnClear.classList.add('hidden');
  }
}

// ==========================================
// 8. AVATAR CROPPER (CANVAS)
// ==========================================
function initAvatarCropper() {
  const canvas = document.getElementById('cropper-canvas');
  const zoomInput = document.getElementById('cropper-zoom-input');
  const btnApply = document.getElementById('btn-apply-crop');
  const cropperModal = document.getElementById('modal-avatar-cropper');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');

  function draw() {
    if (!AppState.cropper.image) return;
    const cw = canvas.width;
    const ch = canvas.height;
    ctx.clearRect(0, 0, cw, ch);

    const img = AppState.cropper.image;
    const scale = AppState.cropper.scale;
    const iw = img.width * scale;
    const ih = img.height * scale;

    const x = (cw - iw) / 2 + AppState.cropper.offsetX;
    const y = (ch - ih) / 2 + AppState.cropper.offsetY;

    ctx.drawImage(img, x, y, iw, ih);
  }

  canvas.addEventListener('mousedown', (e) => {
    AppState.cropper.isDragging = true;
    AppState.cropper.startX = e.clientX - AppState.cropper.offsetX;
    AppState.cropper.startY = e.clientY - AppState.cropper.offsetY;
  });

  window.addEventListener('mousemove', (e) => {
    if (!AppState.cropper.isDragging) return;
    AppState.cropper.offsetX = e.clientX - AppState.cropper.startX;
    AppState.cropper.offsetY = e.clientY - AppState.cropper.startY;
    draw();
  });

  window.addEventListener('mouseup', () => {
    AppState.cropper.isDragging = false;
  });

  canvas.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) {
      AppState.cropper.isDragging = true;
      AppState.cropper.startX = e.touches[0].clientX - AppState.cropper.offsetX;
      AppState.cropper.startY = e.touches[0].clientY - AppState.cropper.offsetY;
    }
  });

  window.addEventListener('touchmove', (e) => {
    if (!AppState.cropper.isDragging || e.touches.length !== 1) return;
    AppState.cropper.offsetX = e.touches[0].clientX - AppState.cropper.startX;
    AppState.cropper.offsetY = e.touches[0].clientY - AppState.cropper.startY;
    draw();
  });

  window.addEventListener('touchend', () => {
    AppState.cropper.isDragging = false;
  });

  if (zoomInput) {
    zoomInput.addEventListener('input', (e) => {
      AppState.cropper.scale = parseFloat(e.target.value);
      draw();
    });
  }

  if (btnApply) {
    btnApply.addEventListener('click', () => {
      const outputCanvas = document.createElement('canvas');
      outputCanvas.width = 160;
      outputCanvas.height = 160;
      const outCtx = outputCanvas.getContext('2d');

      outCtx.beginPath();
      outCtx.arc(80, 80, 80, 0, Math.PI * 2);
      outCtx.closePath();
      outCtx.clip();

      outCtx.drawImage(canvas, 0, 0, 320, 320, 0, 0, 160, 160);

      const croppedDataUrl = outputCanvas.toDataURL('image/jpeg', 0.88);
      AppState.tempCroppedAvatar = croppedDataUrl;
      updateAvatarPreview(croppedDataUrl);

      cropperModal.classList.add('hidden');
      showToast('頭像已成功裁切！', 'success');
    });
  }
}

function openCropperModal(imageSrc) {
  const cropperModal = document.getElementById('modal-avatar-cropper');
  const canvas = document.getElementById('cropper-canvas');
  const zoomInput = document.getElementById('cropper-zoom-input');
  if (!cropperModal || !canvas) return;

  const img = new Image();
  img.onload = () => {
    AppState.cropper.image = img;
    const initialScale = Math.max(320 / img.width, 320 / img.height);
    AppState.cropper.scale = initialScale;
    AppState.cropper.offsetX = 0;
    AppState.cropper.offsetY = 0;

    if (zoomInput) {
      zoomInput.min = (initialScale * 0.5).toFixed(2);
      zoomInput.max = (initialScale * 3).toFixed(2);
      zoomInput.value = initialScale.toFixed(2);
    }

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 320, 320);
    const iw = img.width * initialScale;
    const ih = img.height * initialScale;
    ctx.drawImage(img, (320 - iw) / 2, (320 - ih) / 2, iw, ih);

    cropperModal.classList.remove('hidden');
  };
  img.src = imageSrc;
}

// ==========================================
// 9. TAB 3: 對局紀錄歷史
// ==========================================
function renderHistoryView() {
  const listContainer = document.getElementById('history-list');
  const searchInput = document.getElementById('input-history-search');
  if (!listContainer) return;

  const query = searchInput ? searchInput.value.trim().toLowerCase() : '';
  const sortedRounds = AppState.rounds.slice().sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

  const filtered = sortedRounds.filter(r => {
    if (!query) return true;
    if (r.title && r.title.toLowerCase().includes(query)) return true;
    if (r.note && r.note.toLowerCase().includes(query)) return true;
    if (r.date && r.date.includes(query)) return true;
    for (const pid of Object.keys(r.scores || {})) {
      const p = AppState.players.find(x => x.id === pid);
      if (p && p.name.toLowerCase().includes(query)) return true;
    }
    return false;
  });

  if (filtered.length === 0) {
    listContainer.innerHTML = `
      <div class="card glass-card text-center p-8 w-full">
        <h3>📜 無符合條件的對局紀錄</h3>
        <p class="text-subtle mt-2">${query ? '請嘗試更換搜尋關鍵字' : '點擊「記新的一將」開始建立戰績！'}</p>
      </div>
    `;
    return;
  }

  listContainer.innerHTML = filtered.map(round => {
    const playerScoresHtml = Object.entries(round.scores || {}).map(([pid, score]) => {
      const p = AppState.players.find(x => x.id === pid);
      const name = p ? p.name : '未知玩家';
      const color = p ? p.color : '#10b981';
      const val = Number(score) || 0;
      const isWinner = val > 0;
      const isLoser = val < 0;

      return `
        <div class="player-chip-pill ${isWinner ? 'winner' : (isLoser ? 'loser' : '')}">
          <span class="player-dot" style="background:${color}; width:8px; height:8px; border-radius:50%; display:inline-block;"></span>
          <span>${name}</span>
          <strong class="${isWinner ? 'text-gold' : (isLoser ? 'text-red' : '')}">
            ${val >= 0 ? '+' : ''}$ ${val.toLocaleString()}
          </strong>
        </div>
      `;
    }).join('');

    return `
      <div class="history-card">
        <div style="flex:1;">
          <div style="display:flex; align-items:center; gap:0.5rem; margin-bottom:0.4rem;">
            <span class="history-date">📅 ${round.date}</span>
            <span class="history-round">${round.title || '一將對局'}</span>
          </div>
          ${round.note ? `<p class="history-note">✏️ ${round.note}</p>` : ''}
          <div class="history-players-chips mt-2">
            ${playerScoresHtml}
          </div>
        </div>

        <button class="btn btn-secondary btn-xs text-red" title="刪除此將紀錄" onclick="handleDeleteRound('${round.id}')">🗑️ 刪除</button>
      </div>
    `;
  }).join('');
}

async function handleDeleteRound(roundId) {
  const r = AppState.rounds.find(x => x.id === roundId);
  if (!r) return;

  if (confirm(`確定要刪除「${r.date} ${r.title}」的戰績紀錄嗎？`)) {
    await syncDeleteRound(roundId);
    showToast('已成功刪除該將戰績！', 'info');
  }
}

// ==========================================
// 10. MODAL 1: 記新的一將 & 零和檢查
// ==========================================
// 10. MODAL 1: 記新的一將 & 零和檢查 (支援中途換手多人紀錄)
// ==========================================
let activeLoggerSlots = []; // [{ pid: 'p1', score: '' }, ...]

function renderLoggerSlotCards() {
  const container = document.getElementById('players-input-grid');
  if (!container) return;

  const windLabels = ['東家 / 1 號位', '南家 / 2 號位', '西家 / 3 號位', '北家 / 4 號位'];

  container.innerHTML = activeLoggerSlots.map((slot, idx) => {
    const isDeletable = activeLoggerSlots.length > 4 && idx >= 4;
    const tagLabel = windLabels[idx] || `換手玩家 / ${idx + 1} 號位`;

    const playerOptions = AppState.players.map((p) => {
      const isSelected = p.id === slot.pid;
      return `<option value="${p.id}" ${isSelected ? 'selected' : ''}>${p.name} (${p.title || '牌友'})</option>`;
    }).join('');

    const deleteBtnHtml = isDeletable 
      ? `<button type="button" class="btn-remove-slot" data-index="${idx}">🗑️ 移除此位</button>` 
      : '';

    return `
      <div class="player-score-card" data-index="${idx}">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div class="card-tag">${tagLabel}</div>
          ${deleteBtnHtml}
        </div>
        <select class="custom-select select-active-player" data-index="${idx}">
          ${playerOptions}
        </select>
        <div class="score-input-wrapper">
          <label>當將淨輸贏 ($)</label>
          <input type="number" class="custom-input input-player-score" data-index="${idx}" value="${slot.score !== undefined ? slot.score : ''}" placeholder="正贏負輸" step="10">
          <div class="touch-modifiers">
            <button type="button" class="mod-btn" data-index="${idx}" data-val="100">+100</button>
            <button type="button" class="mod-btn" data-index="${idx}" data-val="-100">-100</button>
            <button type="button" class="mod-btn" data-index="${idx}" data-val="500">+500</button>
            <button type="button" class="mod-btn" data-index="${idx}" data-val="-500">-500</button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  // Re-bind event listeners
  container.querySelectorAll('.select-active-player').forEach(sel => {
    sel.addEventListener('change', (e) => {
      const i = parseInt(e.target.getAttribute('data-index'), 10);
      if (activeLoggerSlots[i]) activeLoggerSlots[i].pid = e.target.value;
      updateBalanceCheck();
    });
  });

  container.querySelectorAll('.input-player-score').forEach(input => {
    input.addEventListener('input', (e) => {
      const i = parseInt(e.target.getAttribute('data-index'), 10);
      if (activeLoggerSlots[i]) activeLoggerSlots[i].score = e.target.value;
      updateBalanceCheck();
    });
  });

  container.querySelectorAll('.mod-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = parseInt(btn.getAttribute('data-index'), 10);
      const val = parseInt(btn.getAttribute('data-val'), 10) || 0;
      const input = container.querySelector(`.input-player-score[data-index="${i}"]`);
      if (input && activeLoggerSlots[i]) {
        const cur = parseInt(input.value, 10) || 0;
        const nextVal = cur + val;
        input.value = nextVal;
        activeLoggerSlots[i].score = nextVal;
        updateBalanceCheck();
      }
    });
  });

  container.querySelectorAll('.btn-remove-slot').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = parseInt(btn.getAttribute('data-index'), 10);
      if (activeLoggerSlots.length > 4 && i >= 4) {
        const removedPid = activeLoggerSlots[i].pid;
        const p = AppState.players.find(x => x.id === removedPid);
        activeLoggerSlots.splice(i, 1);
        renderLoggerSlotCards();
        showToast(`已移除${p ? '玩家【' + p.name + '】' : ''}欄位！`, 'info');
      }
    });
  });

  updateBalanceCheck();
}

function initScoreLoggerModal() {
  const modal = document.getElementById('modal-score-logger');
  const btnOpenDesktop = document.getElementById('btn-new-round');
  const btnOpenMobile = document.getElementById('fab-new-round');
  const btnInherit = document.getElementById('btn-inherit-last');
  const btnAddSlot = document.getElementById('btn-add-logger-slot');
  const btnSave = document.getElementById('btn-save-round');
  const btnAutoBalance = document.getElementById('btn-auto-balance');

  function openModal() {
    if (AppState.players.length < 4) {
      showToast('牌友池玩家少於 4 人，請先新增至少 4 位牌友！', 'error');
      switchTab('tab-players');
      return;
    }

    const today = new Date().toISOString().substring(0, 10);
    document.getElementById('log-date').value = today;

    const todayRounds = AppState.rounds.filter(r => r.date === today);
    document.getElementById('log-round-title').value = `第 ${todayRounds.length + 1} 將`;
    document.getElementById('log-note').value = '';

    // Initialize 4 default slots with unique players
    activeLoggerSlots = AppState.players.slice(0, 4).map(p => ({
      pid: p.id,
      score: ''
    }));

    renderLoggerSlotCards();
    modal.classList.remove('hidden');
  }

  if (btnOpenDesktop) btnOpenDesktop.addEventListener('click', openModal);
  if (btnOpenMobile) btnOpenMobile.addEventListener('click', openModal);

  if (btnInherit) {
    btnInherit.addEventListener('click', () => {
      if (AppState.rounds.length === 0) {
        showToast('尚無上一將紀錄可帶入！', 'info');
        return;
      }
      const last = AppState.rounds[AppState.rounds.length - 1];
      const pids = Object.keys(last.scores || {});
      if (pids.length >= 4) {
        activeLoggerSlots = pids.map(pid => ({
          pid,
          score: ''
        }));
        renderLoggerSlotCards();
        showToast(`已帶入上一將 ${pids.length} 位名單！`, 'success');
      } else {
        showToast('上一將紀錄不符名單格式！', 'error');
      }
    });
  }

  if (btnAddSlot) {
    btnAddSlot.addEventListener('click', () => {
      const selectedPids = activeLoggerSlots.map(s => s.pid);
      const unselected = AppState.players.find(p => !selectedPids.includes(p.id)) || AppState.players[0];

      activeLoggerSlots.push({
        pid: unselected ? unselected.id : (AppState.players[0] ? AppState.players[0].id : ''),
        score: ''
      });
      renderLoggerSlotCards();
      showToast(`已新增第 ${activeLoggerSlots.length} 位換手/參賽玩家欄位！`, 'success');
    });
  }

  if (btnAutoBalance) {
    btnAutoBalance.addEventListener('click', () => {
      const inputs = document.querySelectorAll('#players-input-grid .input-player-score');
      if (inputs.length === 0) return;

      let sum = 0;
      inputs.forEach((input) => {
        sum += (parseInt(input.value, 10) || 0);
      });

      const diff = -sum;
      if (diff === 0) return;

      // Put diff into last slot
      const lastIdx = activeLoggerSlots.length - 1;
      const lastInput = inputs[lastIdx];
      const cur = parseInt(lastInput.value, 10) || 0;
      const nextVal = cur + diff;
      lastInput.value = nextVal;
      activeLoggerSlots[lastIdx].score = nextVal;
      updateBalanceCheck();
      showToast(`已自動將差額 $${diff.toLocaleString()} 補平！`, 'success');
    });
  }

  if (btnSave) {
    btnSave.addEventListener('click', async () => {
      const date = document.getElementById('log-date').value || new Date().toISOString().substring(0, 10);
      const title = document.getElementById('log-round-title').value.trim() || '一將對局';
      const note = document.getElementById('log-note').value.trim();

      if (activeLoggerSlots.length < 4) {
        showToast('參賽玩家至少需要 4 人！', 'error');
        return;
      }

      const selectedPids = activeLoggerSlots.map(s => s.pid);
      const uniquePids = new Set(selectedPids);
      if (uniquePids.size < selectedPids.length) {
        showToast('參賽玩家選擇不能重複，請確認每位選擇不同牌友！', 'error');
        return;
      }

      let sum = 0;
      const scores = {};
      activeLoggerSlots.forEach((slot, idx) => {
        const input = document.querySelector(`#players-input-grid .input-player-score[data-index="${idx}"]`);
        const val = input ? (parseInt(input.value, 10) || 0) : 0;
        scores[slot.pid] = val;
        sum += val;
      });

      if (sum !== 0) {
        showToast(`金額尚未對平！目前總和差額為 $${sum}，請平帳後再儲存。`, 'error');
        return;
      }

      const newRound = {
        id: 'r_' + Date.now(),
        date,
        title,
        note,
        scores,
        timestamp: Date.now()
      };

      await syncSaveRound(newRound);
      modal.classList.add('hidden');
      showToast(`🎉 成功記錄「${title}」(${activeLoggerSlots.length}人位) 戰績！`, 'success');
    });
  }
}

function updateBalanceCheck() {
  const scoreInputs = document.querySelectorAll('#players-input-grid .input-player-score');
  const sumDisplay = document.getElementById('balance-sum-display');
  const statusContainer = document.getElementById('balance-status');
  const btnAutoBalance = document.getElementById('btn-auto-balance');
  const btnSave = document.getElementById('btn-save-round');

  let sum = 0;
  let hasAnyInput = false;

  scoreInputs.forEach(input => {
    if (input.value !== '') hasAnyInput = true;
    sum += (parseInt(input.value, 10) || 0);
  });

  if (sumDisplay) {
    sumDisplay.textContent = `${sum >= 0 ? '+' : ''}$ ${sum.toLocaleString()}`;
  }

  if (sum === 0 && hasAnyInput) {
    if (statusContainer) {
      statusContainer.className = 'balance-status balance-ok';
      statusContainer.innerHTML = `<span class="status-icon">⚖️</span> <span class="status-text">目前總和：<strong class="text-emerald">$ 0 (完美平帳)</strong></span>`;
    }
    if (btnAutoBalance) btnAutoBalance.disabled = true;
    if (btnSave) btnSave.disabled = false;
  } else {
    if (statusContainer) {
      statusContainer.className = 'balance-status balance-error';
      statusContainer.innerHTML = `<span class="status-icon">⚠️</span> <span class="status-text">目前總和：<strong class="text-red">${sum >= 0 ? '+' : ''}$ ${sum.toLocaleString()} (未平帳)</strong></span>`;
    }
    if (btnAutoBalance) btnAutoBalance.disabled = false;
    if (btnSave) btnSave.disabled = (sum !== 0);
  }
}

// ==========================================
// 11. TAB 4: 底台算分器
// ==========================================
function initCalculator() {
  const baseInput = document.getElementById('calc-base');
  const taiInput = document.getElementById('calc-tai');
  const taiCountInput = document.getElementById('calc-tai-count');
  const btnClearTags = document.getElementById('btn-clear-tai-tags');
  const tagBtns = document.querySelectorAll('.tai-tag-btn');

  if (!baseInput || !taiInput || !taiCountInput) return;

  function calculate() {
    if (!baseInput || !taiInput || !taiCountInput) return;
    const base = Math.max(0, parseInt(baseInput.value, 10) || 0);
    const tai = Math.max(0, parseInt(taiInput.value, 10) || 0);
    const taiCount = Math.max(0, parseInt(taiCountInput.value, 10) || 0);

    const ronPay = base + (taiCount * tai);
    const tsumoPayPerPlayer = base + (taiCount * tai);
    const tsumoTotal = tsumoPayPerPlayer * 3;

    const resultRon = document.getElementById('result-ron');
    const resultRonDesc = document.getElementById('result-ron-desc');
    const resultTsumo = document.getElementById('result-tsumo');
    const resultTsumoTotal = document.getElementById('result-tsumo-total');

    if (resultRon) resultRon.textContent = `$ ${ronPay.toLocaleString()}`;
    if (resultRonDesc) resultRonDesc.textContent = `= 1 底 ($${base}) + ${taiCount} 台 ($${taiCount * tai})`;
    if (resultTsumo) resultTsumo.textContent = `$ ${tsumoPayPerPlayer.toLocaleString()} / 人`;
    if (resultTsumoTotal) resultTsumoTotal.textContent = `$ ${tsumoTotal.toLocaleString()}`;
  }

  if (baseInput) baseInput.addEventListener('input', calculate);
  if (taiInput) taiInput.addEventListener('input', calculate);
  if (taiCountInput) taiCountInput.addEventListener('input', calculate);

  tagBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      btn.classList.toggle('active');
      recalcTags();
    });
  });

  function recalcTags() {
    let totalTai = 0;
    const selected = [];
    document.querySelectorAll('.tai-tag-btn.active').forEach(b => {
      const taiVal = parseInt(b.getAttribute('data-tai'), 10) || 0;
      const name = b.getAttribute('data-name') || '';
      totalTai += taiVal;
      selected.push({ name, tai: taiVal });
    });

    if (taiCountInput) {
      taiCountInput.value = totalTai;
    }

    const selectedTagsBox = document.getElementById('selected-tags-box');
    if (selectedTagsBox) {
      if (selected.length === 0) {
        selectedTagsBox.innerHTML = '<span class="text-subtle">尚未點選快捷鍵，請點選下方常見格式！</span>';
      } else {
        selectedTagsBox.innerHTML = selected.map(s => {
          return `<span class="active-tag-chip" style="background:rgba(212,175,55,0.2); border:1px solid rgba(212,175,55,0.4); color:#ffd700; padding:2px 8px; border-radius:12px; font-size:0.8rem; margin-right:4px;">${s.name} (+${s.tai}台)</span>`;
        }).join(' ');
      }
    }

    calculate();
  }

  if (btnClearTags) {
    btnClearTags.addEventListener('click', () => {
      tagBtns.forEach(b => b.classList.remove('active'));
      if (taiCountInput) taiCountInput.value = 0;
      recalcTags();
    });
  }

  calculate();
}

function renderCalculatorView() {
  initCalculator();
}

// ==========================================
// 12. TAB 5: 聽牌大師 (16/17 張手牌分析)
// ==========================================
function initAIScanner() {
  const pickerBtns = document.querySelectorAll('.picker-tile-btn');
  const btnClearHand = document.getElementById('btn-clear-ai-hand');
  if (pickerBtns.length === 0 && !btnClearHand) return;

  pickerBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const code = btn.getAttribute('data-code');
      addTileToAIHand(code);
    });
  });

  if (btnClearHand) {
    btnClearHand.addEventListener('click', () => {
      AppState.aiHand = [];
      renderAIScannerView();
      showToast('手牌已清空', 'info');
    });
  }
}

function addTileToAIHand(tileCode) {
  if (AppState.aiHand.length >= 17) {
    showToast('手牌已達 17 張上限！', 'info');
    return;
  }

  const currentCount = AppState.aiHand.filter(t => t === tileCode).length;
  if (currentCount >= 4) {
    showToast(`麻將中「${TILE_MAP[tileCode]}」最多僅有 4 張！`, 'error');
    return;
  }

  AppState.aiHand.push(tileCode);
  sortAIHand();
  renderAIScannerView();
}

function removeTileFromAIHand(index) {
  AppState.aiHand.splice(index, 1);
  renderAIScannerView();
}

function sortAIHand() {
  const typeOrder = { m: 1, p: 2, s: 3, z: 4 };
  AppState.aiHand.sort((a, b) => {
    const typeA = a.charAt(0);
    const typeB = b.charAt(0);
    if (typeOrder[typeA] !== typeOrder[typeB]) {
      return typeOrder[typeA] - typeOrder[typeB];
    }
    const numA = parseInt(a.charAt(1), 10);
    const numB = parseInt(b.charAt(1), 10);
    return numA - numB;
  });
}

function isWinningHand17(tiles) {
  if (tiles.length !== 17) return false;

  const counts = {};
  tiles.forEach(t => {
    counts[t] = (counts[t] || 0) + 1;
  });

  for (const pairTile of Object.keys(counts)) {
    if (counts[pairTile] >= 2) {
      const remaining = { ...counts };
      remaining[pairTile] -= 2;
      if (canFormMelds(remaining, 5)) {
        return true;
      }
    }
  }

  return false;
}

function canFormMelds(counts, meldsNeeded) {
  if (meldsNeeded === 0) {
    return Object.values(counts).every(c => c === 0);
  }

  let firstTile = null;
  for (const t of ALL_TILES) {
    if (counts[t] > 0) {
      firstTile = t;
      break;
    }
  }

  if (!firstTile) return meldsNeeded === 0;

  if (counts[firstTile] >= 3) {
    counts[firstTile] -= 3;
    if (canFormMelds(counts, meldsNeeded - 1)) return true;
    counts[firstTile] += 3;
  }

  const suit = firstTile.charAt(0);
  const num = parseInt(firstTile.charAt(1), 10);
  if (suit !== 'z' && num <= 7) {
    const t2 = `${suit}${num + 1}`;
    const t3 = `${suit}${num + 2}`;
    if (counts[t2] > 0 && counts[t3] > 0) {
      counts[firstTile] -= 1;
      counts[t2] -= 1;
      counts[t3] -= 1;
      if (canFormMelds(counts, meldsNeeded - 1)) return true;
      counts[firstTile] += 1;
      counts[t2] += 1;
      counts[t3] += 1;
    }
  }

  return false;
}

function analyzeWaits16(tiles16) {
  if (tiles16.length !== 16) return [];
  const winningWaits = [];

  for (const candidate of ALL_TILES) {
    const candidateHand = [...tiles16, candidate];
    if (isWinningHand17(candidateHand)) {
      winningWaits.push(candidate);
    }
  }
  return winningWaits;
}

function analyzeDiscards17(tiles17) {
  if (tiles17.length !== 17) return [];
  const discards = [];
  const uniqueTiles = Array.from(new Set(tiles17));

  uniqueTiles.forEach(discardTile => {
    const idx = tiles17.indexOf(discardTile);
    const hand16 = [...tiles17.slice(0, idx), ...tiles17.slice(idx + 1)];
    const waits = analyzeWaits16(hand16);
    if (waits.length > 0) {
      discards.push({
        discard: discardTile,
        waits: waits,
        waitsCount: waits.length
      });
    }
  });

  return discards.sort((a, b) => b.waitsCount - a.waitsCount);
}

function renderAIScannerView() {
  const rack = document.getElementById('ai-hand-rack');
  const countSpan = document.getElementById('ai-tile-count');
  const resultPanel = document.getElementById('ai-result-panel');

  if (countSpan) countSpan.textContent = AppState.aiHand.length;

  if (rack) {
    if (AppState.aiHand.length === 0) {
      rack.innerHTML = '<span class="text-subtle">尚未新增手牌，請點選下方牌型加入！</span>';
    } else {
      rack.innerHTML = AppState.aiHand.map((code, idx) => {
        const suit = code.charAt(0);
        let colorClass = '';
        if (suit === 'm') colorClass = 'text-red font-bold';
        if (suit === 'p') colorClass = 'text-gold font-bold';
        if (suit === 's') colorClass = 'text-emerald font-bold';
        if (code === 'z5') colorClass = 'text-red font-bold';
        if (code === 'z6') colorClass = 'text-emerald font-bold';

        return `
          <button class="rack-tile-chip ${colorClass}" title="點擊移除此張牌" onclick="removeTileFromAIHand(${idx})">
            <span>${TILE_MAP[code] || code}</span>
            <span class="rack-tile-delete">&times;</span>
          </button>
        `;
      }).join('');
    }
  }

  if (resultPanel) {
    const n = AppState.aiHand.length;

    if (n === 0) {
      resultPanel.innerHTML = `
        <div class="ai-empty-placeholder">
          <span class="ai-brain-icon" style="font-size:2.5rem; display:block; margin-bottom:0.5rem;">🧠</span>
          <p>請加入手牌（如 16 張或 17 張），系統將自動計算進牌與最佳聽牌方案！</p>
        </div>
      `;
    } else if (n === 16) {
      const waits = analyzeWaits16(AppState.aiHand);
      if (waits.length > 0) {
        resultPanel.innerHTML = `
          <div class="ai-analysis-box ready-to-win" style="padding:1rem;">
            <div style="background:rgba(16,185,129,0.2); border:1px solid rgba(16,185,129,0.5); padding:0.5rem 1rem; border-radius:8px; color:#34d399; font-weight:800;">
              🎉 恭喜！當前 16 張手牌已達成「聽牌」狀態！
            </div>
            <h4 class="mt-3 text-gold">🀄 當前聽牌牌面 (${waits.length} 面聽)：</h4>
            <div class="waits-tiles-row mt-2" style="display:flex; flex-wrap:wrap; gap:0.5rem;">
              ${waits.map(t => `<span style="background:rgba(212,175,55,0.25); border:1px solid #ffd700; color:#ffd700; font-weight:800; font-size:1.1rem; padding:4px 12px; border-radius:8px;">${TILE_MAP[t]}</span>`).join('')}
            </div>
            <p class="text-subtle text-xs mt-3">💡 建議：只要進以上任一張牌即告胡牌！</p>
          </div>
        `;
      } else {
        resultPanel.innerHTML = `
          <div class="ai-analysis-box" style="padding:1rem;">
            <div style="background:rgba(245,158,11,0.2); border:1px solid rgba(245,158,11,0.5); padding:0.5rem 1rem; border-radius:8px; color:#fbbf24; font-weight:800;">
              ⚠️ 16 張手牌分析：尚未進入聽牌面
            </div>
            <p class="mt-2 text-sm text-subtle">手牌搭子組合可能尚欠 1 組順子/刻子或雀頭對子。建議檢視孤張或重組搭子！</p>
          </div>
        `;
      }
    } else if (n === 17) {
      const discardOptions = analyzeDiscards17(AppState.aiHand);
      if (discardOptions.length > 0) {
        const best = discardOptions[0];
        resultPanel.innerHTML = `
          <div class="ai-analysis-box best-discard" style="padding:1rem;">
            <div style="background:rgba(16,185,129,0.2); border:1px solid rgba(16,185,129,0.5); padding:0.5rem 1rem; border-radius:8px; color:#34d399; font-weight:800;">
              🎯 最佳打牌推薦：打出【${TILE_MAP[best.discard]}】
            </div>
            <p class="mt-3">打出 <strong>${TILE_MAP[best.discard]}</strong> 後立即聽 <strong class="text-gold">${best.waitsCount} 面牌</strong>：</p>
            <div class="waits-tiles-row mt-2" style="display:flex; flex-wrap:wrap; gap:0.5rem;">
              ${best.waits.map(t => `<span style="background:rgba(212,175,55,0.25); border:1px solid #ffd700; color:#ffd700; font-weight:800; font-size:1.1rem; padding:4px 12px; border-radius:8px;">${TILE_MAP[t]}</span>`).join('')}
            </div>
            
            ${discardOptions.length > 1 ? `
              <div class="other-discards-list mt-4">
                <span class="text-xs text-subtle">🔄 其他聽牌打法：</span>
                ${discardOptions.slice(1).map(opt => `
                  <div class="discard-sub-row text-xs mt-1">
                    打 <strong>${TILE_MAP[opt.discard]}</strong> ➜ 聽 ${opt.waits.map(w => TILE_MAP[w]).join('、')} (${opt.waitsCount}面)
                  </div>
                `).join('')}
              </div>
            ` : ''}
          </div>
        `;
      } else {
        resultPanel.innerHTML = `
          <div class="ai-analysis-box" style="padding:1rem;">
            <div style="background:rgba(245,158,11,0.2); border:1px solid rgba(245,158,11,0.5); padding:0.5rem 1rem; border-radius:8px; color:#fbbf24; font-weight:800;">
              ⚠️ 17 張手牌分析：打出任何牌皆尚未聽牌
            </div>
            <p class="mt-2 text-sm text-subtle">手牌結構尚處於進張鋪陳階段，建議打出字牌單張或偏張孤張（如1、9）。</p>
          </div>
        `;
      }
    } else {
      resultPanel.innerHTML = `
        <div class="ai-analysis-box" style="padding:1rem;">
          <div style="background:rgba(59,130,246,0.2); border:1px solid rgba(59,130,246,0.5); padding:0.5rem 1rem; border-radius:8px; color:#60a5fa; font-weight:800;">
            ℹ️ 目前手牌共 ${n} 張
          </div>
          <p class="mt-2 text-sm text-subtle">台灣麻將標準手牌為 <strong>16 張</strong>（聽牌）或 <strong>17 張</strong>（摸牌準備打出）。請繼續點選牌型！</p>
        </div>
      `;
    }
  }
}

// ==========================================
// 13. MODAL 4: 資料備份、匯入與示範數據
// ==========================================
function initBackupModal() {
  const btnOpen = document.getElementById('btn-backup-modal');
  const modal = document.getElementById('modal-backup');
  const btnLoadDemo = document.getElementById('btn-load-demo');
  const btnExport = document.getElementById('btn-export-json');
  const btnImportTrigger = document.getElementById('btn-trigger-import');
  const fileImport = document.getElementById('file-import-json');
  const btnResetAll = document.getElementById('btn-reset-all');
  const btnForceSync = document.getElementById('btn-force-sync');

  if (btnOpen) {
    btnOpen.addEventListener('click', () => {
      modal.classList.remove('hidden');
    });
  }

  // Load Demo Data (Optional manual click)
  if (btnLoadDemo) {
    btnLoadDemo.addEventListener('click', async () => {
      const samplePlayers = [
        { id: 'p_demo1', name: '老陳', color: '#10b981', title: '東區雀聖 ‧ 自摸機器', titleTag: '東區雀聖 ‧ 自摸機器', avatarUrl: '', createdAt: Date.now() },
        { id: 'p_demo2', name: '阿銘', color: '#3b82f6', title: '碰碰胡魔人 ‧ 大三元收割機', titleTag: '碰碰胡魔人 ‧ 大三元收割機', avatarUrl: '', createdAt: Date.now() },
        { id: 'p_demo3', name: '小美', color: '#ec4899', title: '門清甜心 ‧ 專剋老陳', titleTag: '門清甜心 ‧ 專剋老陳', avatarUrl: '', createdAt: Date.now() },
        { id: 'p_demo4', name: '志豪', color: '#f59e0b', title: '槓上開花狂魔 ‧ 運氣流玩家', titleTag: '槓上開花狂魔 ‧ 運氣流玩家', avatarUrl: '', createdAt: Date.now() }
      ];
      for (const p of samplePlayers) {
        await syncSavePlayer(p);
      }
      modal.classList.add('hidden');
      showToast('✨ 已載入示範牌友！', 'gold');
    });
  }

  if (btnExport) {
    btnExport.addEventListener('click', () => {
      const dataStr = JSON.stringify({
        version: '2.0',
        exportedAt: new Date().toISOString(),
        players: AppState.players,
        rounds: AppState.rounds
      }, null, 2);

      const blob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const dateStr = new Date().toISOString().substring(0, 10);
      a.href = url;
      a.download = `mahjong_hall_backup_${dateStr}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('📥 備份 JSON 檔案已下載！', 'success');
    });
  }

  if (btnImportTrigger && fileImport) {
    btnImportTrigger.addEventListener('click', () => fileImport.click());
    fileImport.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = async (event) => {
        try {
          const parsed = JSON.parse(event.target.result);
          if (Array.isArray(parsed.players)) {
            AppState.players = parsed.players;
            if (Array.isArray(parsed.rounds)) {
              AppState.rounds = parsed.rounds;
            }
            await syncPushToCloud();
            modal.classList.add('hidden');
            showToast('✅ 備份資料匯入還原成功！', 'success');
          } else {
            showToast('匯入失敗：JSON 格式不相符！', 'error');
          }
        } catch (err) {
          showToast('匯入失敗：檔案非合法的 JSON 格式！', 'error');
        }
      };
      reader.readAsText(file);
      fileImport.value = '';
    });
  }

  if (btnResetAll) {
    btnResetAll.addEventListener('click', async () => {
      if (confirm('⚠️ 警告：確定要清空雲端與本機的玩家與歷史戰績嗎？此動作無法復原！')) {
        AppState.players = [];
        AppState.rounds = [];
        await syncPushToCloud();
        modal.classList.add('hidden');
        showToast('已清空全部戰績與玩家資料', 'info');
        refreshAllViews();
      }
    });
  }

  if (btnForceSync) {
    btnForceSync.addEventListener('click', async () => {
      const dot = document.getElementById('sync-dot');
      if (dot) dot.classList.add('syncing');
      try {
        const ok = await fetchCloudDataRest();
        if (ok) {
          showToast('✅ 雲端戰績資料已重新整理並同步！', 'success');
        } else {
          loadLocalState();
          refreshAllViews();
          showToast('ℹ️ 本機戰績已刷新', 'info');
        }
      } catch (e) {
        loadLocalState();
        refreshAllViews();
      } finally {
        setTimeout(() => {
          if (dot) dot.classList.remove('syncing');
        }, 400);
      }
    });
  }
}

// ==========================================
// 14. GLOBAL MODAL CLOSE HANDLERS
// ==========================================
function initModalCloseHandlers() {
  document.querySelectorAll('.btn-close-modal, .modal-close-icon').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const overlay = btn.closest('.modal-overlay');
      if (overlay) overlay.classList.add('hidden');
    });
  });

  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.classList.add('hidden');
      }
    });
  });
}

// ==========================================
// 15. MAIN INITIALIZATION BOOTSTRAP
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
  try {
    loadLocalState();
    initNavigation();
    initMVPSelectors();
    initScoreLoggerModal();
    initPlayerFormModal();
    initAvatarCropper();
    initCalculator();
    initAIScanner();
    initBackupModal();
    initModalCloseHandlers();

    const searchInput = document.getElementById('input-history-search');
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        renderHistoryView();
      });
    }

    refreshAllViews();
  } catch (err) {
    console.error('Error during initial UI setup:', err);
  }

  // 1. Instant REST cloud sync (guarantees data loads immediately in <200ms)
  try {
    await fetchCloudDataRest();
  } catch (e) {
    console.error('REST cloud sync error:', e);
  }

  // 2. Connect Firebase WebSocket for live push updates
  try {
    initFirebase();
  } catch (e) {
    console.error('Firebase init error:', e);
  }
});
