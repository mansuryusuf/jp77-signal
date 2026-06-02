/* ═══════════════════════════════════════
   JP77 Signal Dashboard — app.js
   Traders Family Method
   ─────────────────────────────────────
   Features:
   • Live forex prices via Finnhub WebSocket
   • Historical candles via Finnhub REST API
   • Support & Resistance calculation (pivot method)
   • Ranging / Breakout signal detection (JP77 method)
   • TP / SL calculator with customizable R:R
   • Lot size / Money management calculator
   • AI morning briefing via Anthropic API
   • Morning checklist
   • Simulation mode (no API key needed)
═══════════════════════════════════════ */

'use strict';

/* ────────────────────────────────────
   PAIR CONFIG
──────────────────────────────────── */
const PAIRS = {
  EURUSD: { finnhub: 'OANDA:EUR_USD', digits: 4, pipSize: 0.0001, pipVal: 10,   slDefault: 50, session: 'London/NY'    },
  GBPUSD: { finnhub: 'OANDA:GBP_USD', digits: 4, pipSize: 0.0001, pipVal: 10,   slDefault: 60, session: 'London/NY'    },
  XAUUSD: { finnhub: 'OANDA:XAU_USD', digits: 1, pipSize: 0.1,    pipVal: 10,   slDefault: 150,session: 'All Sessions' },
  USDJPY: { finnhub: 'OANDA:USD_JPY', digits: 2, pipSize: 0.01,   pipVal: 9.1,  slDefault: 50, session: 'Tokyo/NY'     },
  GBPJPY: { finnhub: 'OANDA:GBP_JPY', digits: 2, pipSize: 0.01,   pipVal: 9.1,  slDefault: 70, session: 'London/Tokyo' },
  AUDUSD: { finnhub: 'OANDA:AUD_USD', digits: 4, pipSize: 0.0001, pipVal: 10,   slDefault: 45, session: 'Sydney/Tokyo' },
};

const BASE_SIM = {
  EURUSD:1.0842, GBPUSD:1.2715, XAUUSD:2345.5,
  USDJPY:154.32, GBPJPY:196.44, AUDUSD:0.6521,
};

const CHECKLIST_ITEMS = [
  'Cek economic calendar — news high impact hari ini',
  'Gambar Support & Resistance di H4 / Daily',
  'Tentukan metode: Ranging atau Breakout?',
  'Konfirmasi bias sesuai trend Weekly/Daily',
  'Hitung lot size (maks 2% risk dari balance)',
  'Pasang TP & SL sebelum entry (min RR 1:2)',
  'Tidak trading saat news besar (avoid slippage)',
];

/* ────────────────────────────────────
   STATE
──────────────────────────────────── */
const State = {
  pair:       'EURUSD',
  tf:         'M5',
  candles:    [],        // { time, open, high, low, close }
  currentPrice: null,
  priceOpen:   null,
  sr:          {},       // { r2, r1, s1, s2 }
  signal:      null,     // { type, bias, confidence }
  tpsl:        null,     // { entry, tp, sl, slPips, tpPips }
  rr:          2,
  balance:     1000,
  riskPct:     2,
  checklist:   {},
  demoMode:    true,
  finnhubWs:   null,
  demoInterval:null,
  chart:       null,
  chartDatasets: null,
};

/* ────────────────────────────────────
   SETTINGS
──────────────────────────────────── */
function openSettings() {
  document.getElementById('settingsModal').classList.remove('hidden');
  document.getElementById('finnhubKeyInput').value = localStorage.getItem('finnhubKey') || '';
  document.getElementById('anthropicKeyInput').value = localStorage.getItem('anthropicKey') || '';
}
function closeSettings() {
  document.getElementById('settingsModal').classList.add('hidden');
}
function saveSettings() {
  const fk = document.getElementById('finnhubKeyInput').value.trim();
  const ak = document.getElementById('anthropicKeyInput').value.trim();
  if (fk) localStorage.setItem('finnhubKey', fk);
  if (ak) localStorage.setItem('anthropicKey', ak);
  closeSettings();
  App.init();
}
function useDemo() {
  localStorage.removeItem('finnhubKey');
  closeSettings();
  App.init();
}

/* ────────────────────────────────────
   INDICATORS
──────────────────────────────────── */
const Indicators = {

  /**
   * Calculate pivot-based Support & Resistance levels
   * Uses a lookback window to find swing highs/lows, then clusters them
   */
  calcSR(candles) {
    const lookback = 3;
    const pivotH = [], pivotL = [];

    for (let i = lookback; i < candles.length - lookback; i++) {
      const c = candles[i];
      let isH = true, isL = true;
      for (let j = i - lookback; j <= i + lookback; j++) {
        if (j === i) continue;
        if (candles[j].high  >= c.high) isH = false;
        if (candles[j].low   <= c.low)  isL = false;
      }
      if (isH) pivotH.push(c.high);
      if (isL) pivotL.push(c.low);
    }

    const cluster = (arr, tolerance) => {
      if (!arr.length) return [];
      const sorted = [...arr].sort((a, b) => a - b);
      const groups = [[sorted[0]]];
      for (let i = 1; i < sorted.length; i++) {
        const g = groups[groups.length - 1];
        const avg = g.reduce((s, v) => s + v, 0) / g.length;
        if (Math.abs(sorted[i] - avg) / avg < tolerance) g.push(sorted[i]);
        else groups.push([sorted[i]]);
      }
      return groups.map(g => g.reduce((s, v) => s + v, 0) / g.length);
    };

    const price  = candles[candles.length - 1]?.close || 1;
    const tol    = 0.0015;
    const res    = cluster(pivotH, tol).filter(v => v > price).sort((a,b) => a - b);
    const sup    = cluster(pivotL, tol).filter(v => v < price).sort((a,b) => b - a);

    return {
      r2: res[1] ?? (price * 1.003),
      r1: res[0] ?? (price * 1.0015),
      s1: sup[0] ?? (price * 0.9985),
      s2: sup[1] ?? (price * 0.997),
    };
  },

  /**
   * Detect Ranging or Breakout signal — core JP77 method
   */
  detectSignal(candles, sr) {
    if (!candles.length) return { type:'WAIT', bias:'NEUTRAL', confidence:0 };

    const price  = candles[candles.length - 1].close;
    const { r1, s1 } = sr;
    const range  = r1 - s1;
    if (range <= 0) return { type:'WAIT', bias:'NEUTRAL', confidence:0 };

    const pos = (price - s1) / range;

    // Momentum: % change over last 8 candles
    const lookback = Math.min(8, candles.length);
    const prev = candles[candles.length - lookback].open;
    const momentum = (price - prev) / prev * 100;

    // ATR proxy (avg of last 10 candle ranges)
    const atrWindow = candles.slice(-10);
    const atr = atrWindow.reduce((s, c) => s + (c.high - c.low), 0) / atrWindow.length;
    const breakoutBuffer = atr * 0.3;

    // BREAKOUT: price has exited S/R zone with momentum
    if (price > r1 + breakoutBuffer && momentum > 0.02) {
      const conf = Math.round(Math.min(88, 62 + Math.abs(momentum) * 8));
      return { type:'BREAKOUT', bias:'BUY', confidence:conf };
    }
    if (price < s1 - breakoutBuffer && momentum < -0.02) {
      const conf = Math.round(Math.min(88, 62 + Math.abs(momentum) * 8));
      return { type:'BREAKOUT', bias:'SELL', confidence:conf };
    }

    // RANGING: price near SR boundaries
    if (pos >= 0.78) {
      const conf = Math.round(Math.min(82, 52 + pos * 35));
      return { type:'RANGING', bias:'SELL', confidence:conf };
    }
    if (pos <= 0.22) {
      const conf = Math.round(Math.min(82, 52 + (1-pos) * 35));
      return { type:'RANGING', bias:'BUY', confidence:conf };
    }

    return { type:'WAIT', bias:'NEUTRAL', confidence:0 };
  },

  /**
   * Calculate Entry, TP, SL based on signal and R:R
   */
  calcTPSL(pair, signal, sr, rr) {
    const cfg = PAIRS[pair];
    const price = sr.currentPrice || State.currentPrice;
    if (!price || signal.bias === 'NEUTRAL') return null;

    const dir = signal.bias === 'BUY' ? 1 : -1;
    const slPips = cfg.slDefault;
    const tpPips = Math.round(slPips * rr);
    const pip = cfg.pipSize;

    const d = cfg.digits;
    return {
      entry:  +price.toFixed(d),
      tp:     +(price + dir * pip * tpPips).toFixed(d),
      sl:     +(price - dir * pip * slPips).toFixed(d),
      slPips, tpPips,
    };
  },

  /**
   * Lot size calculator
   */
  calcLots(balance, riskPct, slPips, pair) {
    const risk = balance * (riskPct / 100);
    const pipVal = PAIRS[pair].pipVal;
    const lots = risk / (slPips * pipVal);
    return Math.max(0.01, +lots.toFixed(2));
  },
};

/* ────────────────────────────────────
   SIMULATION ENGINE (no API key)
──────────────────────────────────── */
const SimEngine = {

  /**
   * @param {string} pair
   * @param {number|null} basePrice  — gunakan harga real jika tersedia, fallback ke BASE_SIM
   */
  start(pair, basePrice = null) {
    this.stop();
    const cfg  = PAIRS[pair];
    // PENTING: Selalu pakai harga real jika diberikan, bukan hardcoded BASE_SIM
    const base = basePrice && basePrice > 0 ? basePrice : BASE_SIM[pair];
    let   p    = base;

    // Generate historical candles (80 candles) berbasis harga real
    const history = [];
    let hp = base;
    for (let i = 80; i >= 0; i--) {
      const o = hp;
      hp += (Math.random() - 0.495) * cfg.pipSize * 20;
      hp  = +hp.toFixed(cfg.digits);
      const h = +(Math.max(o, hp) + cfg.pipSize * (Math.random() * 3)).toFixed(cfg.digits);
      const l = +(Math.min(o, hp) - cfg.pipSize * (Math.random() * 3)).toFixed(cfg.digits);
      history.push({ time: Date.now() - i * 60000 * 5, open: o, high: h, low: l, close: hp });
    }

    State.candles      = history;
    State.currentPrice = hp;
    State.priceOpen    = history[0].open;

    App.onNewCandle();

    // Tick simulasi — bergerak relatif terhadap harga terakhir
    State.demoInterval = setInterval(() => {
      p += (Math.random() - 0.495) * cfg.pipSize * 6;
      p  = +p.toFixed(cfg.digits);
      App.onTick(p);
    }, 800);
  },

  stop() {
    if (State.demoInterval) {
      clearInterval(State.demoInterval);
      State.demoInterval = null;
    }
  },
};

/* ────────────────────────────────────
   FINNHUB ENGINE (live prices)
──────────────────────────────────── */
const FinnhubEngine = {

  /** Ambil harga terkini via REST — untuk validasi & fallback */
  async fetchQuote(pair) {
    const key = localStorage.getItem('finnhubKey');
    if (!key) return null;
    try {
      const sym = PAIRS[pair].finnhub;
      const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${sym}&token=${key}`);
      const d   = await res.json();
      return (d && d.c > 0) ? d : null;
    } catch { return null; }
  },

  /** Ambil historical candles + validasi cocok dengan harga live */
  async fetchCandles(pair, resolution = 5, currentPrice = null) {
    const key = localStorage.getItem('finnhubKey');
    if (!key) return null;
    const sym  = PAIRS[pair].finnhub;
    const to   = Math.floor(Date.now() / 1000);
    const from = to - 60 * resolution * 120;
    try {
      const res  = await fetch(`https://finnhub.io/api/v1/forex/candle?symbol=${sym}&resolution=${resolution}&from=${from}&to=${to}&token=${key}`);
      const data = await res.json();
      if (data.s !== 'ok' || !data.t?.length) return null;

      const candles = data.t.map((t, i) => ({
        time:  t * 1000,
        open:  data.o[i], high: data.h[i],
        low:   data.l[i], close: data.c[i],
      }));

      // VALIDASI: tolak candles jika harganya menyimpang >5% dari harga live
      if (currentPrice && currentPrice > 0) {
        const lastClose = candles[candles.length - 1].close;
        const dev = Math.abs(lastClose - currentPrice) / currentPrice;
        if (dev > 0.05) {
          console.warn(`[JP77] Candle stale (dev=${(dev*100).toFixed(1)}%) — pakai simulasi berbasis harga live`);
          return null;
        }
      }
      return candles;
    } catch { return null; }
  },

  connectWS(pair) {
    this.disconnect();
    const key = localStorage.getItem('finnhubKey');
    if (!key) return;

    const sym = PAIRS[pair].finnhub;
    const ws  = new WebSocket(`wss://ws.finnhub.io?token=${key}`);

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'subscribe', symbol: sym }));
      UI.setLive(true);
    };

    ws.onmessage = (evt) => {
      const msg = JSON.parse(evt.data);
      if (msg.type === 'trade' && msg.data?.length) {
        const latest = msg.data[msg.data.length - 1];
        if (latest.s === sym) App.onTick(latest.p);
      }
    };

    ws.onerror = () => UI.setLive(false);
    ws.onclose = () => UI.setLive(false);
    State.finnhubWs = ws;
  },

  disconnect() {
    if (State.finnhubWs) {
      State.finnhubWs.close();
      State.finnhubWs = null;
    }
  },
};

/* ────────────────────────────────────
   CHART ENGINE
──────────────────────────────────── */
const ChartEngine = {

  init() {
    const canvas = document.getElementById('priceChart');
    if (State.chart) { State.chart.destroy(); State.chart = null; }

    const labels = [];
    const closes = [];
    const highs  = [];
    const lows   = [];

    State.candles.slice(-60).forEach(c => {
      const d = new Date(c.time);
      labels.push(`${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`);
      closes.push(c.close);
      highs.push(c.high);
      lows.push(c.low);
    });

    const { r1, r2, s1, s2 } = State.sr;
    const priceColor = State.signal?.bias === 'BUY' ? '#00d68f' : State.signal?.bias === 'SELL' ? '#ff4757' : '#3e8ef7';

    State.chart = new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: State.pair,
            data:  closes,
            borderColor: priceColor,
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 3,
            fill: true,
            backgroundColor: (ctx) => {
              const chart = ctx.chart;
              const { ctx: c, chartArea } = chart;
              if (!chartArea) return 'transparent';
              const gradient = c.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
              gradient.addColorStop(0, priceColor + '22');
              gradient.addColorStop(1, 'transparent');
              return gradient;
            },
            tension: 0.3,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 0 },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend:    { display: false },
          tooltip:   {
            backgroundColor: '#0d1520',
            borderColor:     '#1e2d40',
            borderWidth:     1,
            titleColor:      '#7a8fa8',
            bodyColor:       '#e8edf4',
            callbacks: {
              label: (ctx) => ` ${ctx.parsed.y.toFixed(PAIRS[State.pair].digits)}`,
            },
          },
          annotation: this.buildAnnotations(r1, r2, s1, s2),
        },
        scales: {
          x: {
            ticks: { color: '#4a5e74', font: { family: "'JetBrains Mono'", size: 10 }, maxTicksLimit: 8, maxRotation: 0 },
            grid:  { color: '#1e2d4044' },
          },
          y: {
            position: 'right',
            ticks: {
              color: '#4a5e74',
              font:  { family: "'JetBrains Mono'", size: 10 },
              callback: (v) => v.toFixed(PAIRS[State.pair].digits),
            },
            grid: { color: '#1e2d4044' },
          },
        },
      },
    });

    document.getElementById('chartOverlay').classList.add('hidden');
  },

  buildAnnotations(r1, r2, s1, s2) {
    if (!r1) return {};
    const line = (y, color, label) => ({
      type: 'line',
      yMin: y, yMax: y,
      borderColor: color,
      borderWidth: 1.5,
      borderDash: [5, 4],
      label: { content: `${label} ${y}`, enabled: true, position: 'start', color, backgroundColor: 'transparent', font: { size: 10, family: 'JetBrains Mono' } },
    });
    return {
      annotations: {
        r2: line(r2, '#ff475766', 'R2'),
        r1: line(r1, '#ff4757',   'R1'),
        s1: line(s1, '#00d68f',   'S1'),
        s2: line(s2, '#00d68f66', 'S2'),
      },
    };
  },

  appendTick(price) {
    if (!State.chart) return;
    const ds = State.chart.data.datasets[0];
    ds.data.push(price);
    if (ds.data.length > 60) ds.data.shift();

    const now = new Date();
    const lbl = `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`;
    State.chart.data.labels.push(lbl);
    if (State.chart.data.labels.length > 60) State.chart.data.labels.shift();

    State.chart.update('none');
  },
};

/* ────────────────────────────────────
   AI ENGINE
──────────────────────────────────── */
const AIEngine = {
  async analyze() {
    const key = localStorage.getItem('anthropicKey');
    if (!key) {
      UI.setAIContent(`<div class="ai-placeholder"><div class="ai-icon">⚠</div><p>Anthropic API key belum dikonfigurasi.<br>Buka ⚙ pengaturan dan masukkan key Anda.</p></div>`);
      return;
    }

    UI.setAILoading(true);
    const { pair, sr, signal, tpsl, rr, balance, riskPct } = State;
    const cfg = PAIRS[pair];
    const lots = tpsl ? Indicators.calcLots(balance, riskPct, tpsl.slPips, pair) : 0;

    const prompt = `Kamu adalah AI trading signal analyst yang menggunakan metode Johnpaul77 (JP77) dari Traders Family — Pak Tito Hayunanda.

Berikan morning briefing singkat dan profesional untuk sinyal trading berikut:

PAIR: ${pair} | Harga: ${State.currentPrice?.toFixed(cfg.digits)} | TF: ${State.tf}
SR: R2=${sr.r2} | R1=${sr.r1} | S1=${sr.s1} | S2=${sr.s2}
Metode: ${signal?.type || 'WAIT'} | Bias: ${signal?.bias || 'NEUTRAL'} | Confidence: ${signal?.confidence || 0}%
${tpsl ? `Entry: ${tpsl.entry} | TP: ${tpsl.tp} (+${tpsl.tpPips} pips) | SL: ${tpsl.sl} (-${tpsl.slPips} pips) | R:R 1:${rr}` : 'Tidak ada setup valid saat ini.'}
Balance: $${balance} | Risk: ${riskPct}% | Lot Size: ${lots}

Format respons (tanpa Markdown bold):
🔍 Kondisi Market
[2-3 kalimat tentang kondisi price action saat ini]

📍 Setup JP77
[Jelaskan setup yang terbentuk: ranging/breakout, level kunci]

🎯 Rekomendasi Entry
[Buy/Sell/Wait, level entry ideal, TP, SL]

💰 Money Management
[Lot size, catatan risiko]

⚡ Reminder JP77
[Satu prinsip Pak Tito yang relevan hari ini]

Maksimal 180 kata. Langsung ke poin. Gunakan bahasa Indonesia profesional.`;

    try {
      const res  = await fetch('https://api.anthropic.com/v1/messages', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          model:      'claude-sonnet-4-20250514',
          max_tokens: 1000,
          messages:   [{ role: 'user', content: prompt }],
        }),
      });
      const data = await res.json();
      const text = data.content?.map(c => c.text || '').join('') || 'Analisis tidak tersedia.';
      UI.setAIContent(`<div class="ai-result">${text}</div>`);
    } catch (e) {
      UI.setAIContent(`<div class="ai-placeholder"><p>Error: ${e.message}</p></div>`);
    }
    UI.setAILoading(false);
  },
};

/* ────────────────────────────────────
   UI UPDATES
──────────────────────────────────── */
const UI = {
  setLive(isLive) {
    State.demoMode = !isLive;
    const badge = document.getElementById('liveIndicator');
    const text  = document.getElementById('liveText');
    badge.className = 'live-badge ' + (isLive ? 'live' : 'demo');
    text.textContent = isLive ? 'LIVE' : 'DEMO';
  },

  updatePrice(price) {
    const cfg   = PAIRS[State.pair];
    const prev  = State.currentPrice;
    const fmt   = price.toFixed(cfg.digits);
    const chg   = prev ? price - prev : 0;
    const chgPct= prev ? ((price - State.priceOpen) / State.priceOpen * 100).toFixed(2) : 0;

    document.getElementById('priceDisplay').textContent = fmt;
    document.getElementById('nowVal').textContent = fmt;

    const el = document.getElementById('priceChange');
    if (chg > 0) {
      el.className = 'price-change up';
      el.textContent = `▲ +${(Math.abs(chgPct))}%`;
    } else if (chg < 0) {
      el.className = 'price-change down';
      el.textContent = `▼ -${Math.abs(chgPct)}%`;
    }

    const spread = (cfg.pipSize * 2).toFixed(cfg.digits);
    document.getElementById('bidAsk').textContent     = `Bid: ${(price - cfg.pipSize).toFixed(cfg.digits)} | Ask: ${(price + cfg.pipSize).toFixed(cfg.digits)}`;
    document.getElementById('spreadDisplay').textContent = `Spread: ${2} pips`;
    document.getElementById('sessionInfo').textContent  = `Session: ${cfg.session}`;
    document.getElementById('pairLabel').textContent     = State.pair.replace('USD','/'+'USD').replace('JPY','/'+'JPY').replace('GBP/USD', 'GBP/USD');
  },

  updateSR() {
    const { r2, r1, s1, s2 } = State.sr;
    const d = PAIRS[State.pair].digits;
    document.getElementById('r2Val').textContent = r2?.toFixed(d) || '—';
    document.getElementById('r1Val').textContent = r1?.toFixed(d) || '—';
    document.getElementById('s1Val').textContent = s1?.toFixed(d) || '—';
    document.getElementById('s2Val').textContent = s2?.toFixed(d) || '—';
  },

  updateSignal() {
    const { signal, tpsl, rr } = State;
    if (!signal) return;

    const badge = document.getElementById('signalBadge');
    const conf  = signal.confidence;
    const biasMap = {
      BUY:     { icon: '▲', class: 'buy',     color: '#00d68f' },
      SELL:    { icon: '▼', class: 'sell',    color: '#ff4757' },
      NEUTRAL: { icon: '⏸', class: 'neutral', color: '#4a5e74' },
    };
    const bm = biasMap[signal.bias] || biasMap.NEUTRAL;

    document.getElementById('signalIcon').textContent = bm.icon;
    document.getElementById('signalBias').textContent = signal.bias;
    badge.className = `signal-badge ${bm.class}`;
    document.getElementById('methodDisplay').textContent  = signal.type;
    document.getElementById('confDisplay').textContent    = conf > 0 ? conf + '%' : '—';
    document.getElementById('trendDisplay').textContent   = signal.bias === 'BUY' ? 'Bullish' : signal.bias === 'SELL' ? 'Bearish' : 'Ranging';
    document.getElementById('signalTimestamp').textContent = new Date().toLocaleTimeString('id-ID');

    const bar = document.getElementById('confBar');
    bar.style.width = conf + '%';
    bar.style.background = bm.color;

    if (tpsl) {
      const d = PAIRS[State.pair].digits;
      document.getElementById('entryVal').textContent = tpsl.entry?.toFixed(d) || '—';
      document.getElementById('entryNote').textContent = 'Market Price';
      document.getElementById('tpVal').textContent   = tpsl.tp?.toFixed(d) || '—';
      document.getElementById('tpPips').textContent  = `+${tpsl.tpPips} pips`;
      document.getElementById('slVal').textContent   = tpsl.sl?.toFixed(d) || '—';
      document.getElementById('slPips').textContent  = `-${tpsl.slPips} pips`;
    } else {
      ['entryVal','tpVal','slVal'].forEach(id => document.getElementById(id).textContent = '—');
      ['entryNote','tpPips','slPips'].forEach(id => document.getElementById(id).textContent = '—');
    }
  },

  updateMM() {
    const { balance, riskPct, rr, tpsl, pair } = State;
    const riskAmt = balance * (riskPct / 100);
    const profitTarget = riskAmt * rr;
    const lots = tpsl ? Indicators.calcLots(balance, riskPct, tpsl.slPips, pair) : 0;
    const maxDD = 30;

    document.getElementById('riskAmt').textContent      = '$' + riskAmt.toFixed(2);
    document.getElementById('lotSize').textContent       = lots + ' lot';
    document.getElementById('profitTarget').textContent  = '$' + profitTarget.toFixed(2);
    document.getElementById('maxDD').textContent         = maxDD + '%';
    document.getElementById('riskPctLabel').textContent  = riskPct + '%';

    const warning = document.getElementById('riskWarning');
    warning.classList.toggle('hidden', riskPct <= 3);

    // Growth table
    const table = document.getElementById('growthTable');
    let html = '<tr><th style="color:#4a5e74;padding:3px 6px;font-weight:500">Bulan</th><th style="color:#4a5e74;padding:3px 6px;font-weight:500">Profit</th><th style="color:#4a5e74;padding:3px 6px;font-weight:500">Balance</th></tr>';
    let bal = balance;
    for (let i = 1; i <= 6; i++) {
      const profit = bal * 0.18;
      bal += profit;
      html += `<tr><td>${i}</td><td style="color:#00d68f">+$${profit.toFixed(0)}</td><td>$${bal.toFixed(0)}</td></tr>`;
    }
    table.innerHTML = html;
  },

  initChecklist() {
    const saved = JSON.parse(localStorage.getItem('jp77_checklist') || '{}');
    State.checklist = saved;
    const el = document.getElementById('checklist');
    el.innerHTML = CHECKLIST_ITEMS.map((text, i) => `
      <div class="check-item${saved[i] ? ' done' : ''}" onclick="App.toggleCheck(${i})">
        <div class="check-box${saved[i] ? ' checked' : ''}">
          ${saved[i] ? '<svg width="10" height="8" viewBox="0 0 10 8" fill="none"><path d="M1 4L3.5 6.5L9 1" stroke="white" stroke-width="1.5" stroke-linecap="round"/></svg>' : ''}
        </div>
        <span class="check-text">${text}</span>
      </div>
    `).join('');
    this.updateCheckProgress();
  },

  updateCheckProgress() {
    const done  = Object.values(State.checklist).filter(Boolean).length;
    const total = CHECKLIST_ITEMS.length;
    document.getElementById('checkProgress').textContent = `${done}/${total}`;
    document.getElementById('checkBar').style.width = (done / total * 100) + '%';
  },

  updateClock() {
    const now = new Date();
    const hh  = now.getUTCHours().toString().padStart(2,'0');
    const mm  = now.getUTCMinutes().toString().padStart(2,'0');
    const ss  = now.getUTCSeconds().toString().padStart(2,'0');
    document.getElementById('clockDisplay').textContent = `${hh}:${mm}:${ss} UTC`;

    const hour = now.getUTCHours();
    let session = 'Sydney';
    if (hour >= 7  && hour < 16) session = 'London';
    if (hour >= 13 && hour < 22) session = 'New York';
    if (hour >= 0  && hour < 8)  session = 'Tokyo';
    document.getElementById('sessionLabel').textContent = session;
  },

  setAILoading(loading) {
    const btn = document.getElementById('analyzeBtn');
    btn.disabled = loading;
    btn.textContent = loading ? '⏳ Menganalisis...' : 'Analisis ↗';
    if (loading) {
      this.setAIContent(`<div class="ai-loading"><div class="spinner"></div><p>AI sedang menganalisis pasar...</p></div>`);
    }
  },

  setAIContent(html) {
    document.getElementById('aiContent').innerHTML = html;
  },
};

/* ────────────────────────────────────
   MAIN APP CONTROLLER
──────────────────────────────────── */
const App = {

  async init() {
    const key = localStorage.getItem('finnhubKey');
    State.demoMode = !key;

    // Show modal if first time
    if (!localStorage.getItem('jp77_init')) {
      openSettings();
      localStorage.setItem('jp77_init', '1');
    }

    UI.setLive(!State.demoMode);
    UI.initChecklist();
    UI.updateMM();

    setInterval(() => UI.updateClock(), 1000);
    UI.updateClock();

    await this.loadPair(State.pair);
  },

  async loadPair(pair) {
    State.pair        = pair;
    State.candles     = [];
    State.currentPrice = null;
    State.signal      = null;
    State.tpsl        = null;
    this._tickCount   = 0;

    // Update UI tab
    document.querySelectorAll('.pair-tab').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.pair === pair);
    });
    const fmt = { EURUSD:'EUR/USD', GBPUSD:'GBP/USD', XAUUSD:'XAU/USD',
                  USDJPY:'USD/JPY', GBPJPY:'GBP/JPY', AUDUSD:'AUD/USD' };
    document.getElementById('pairLabel').textContent = fmt[pair] || pair;
    document.getElementById('chartOverlay').classList.remove('hidden');

    SimEngine.stop();
    FinnhubEngine.disconnect();

    if (State.demoMode) {
      // Mode demo murni — simulasi dari BASE_SIM
      SimEngine.start(pair, null);
    } else {
      // ── LIVE MODE ──
      // LANGKAH 1: Ambil harga terkini dulu via Quote API
      const quote = await FinnhubEngine.fetchQuote(pair);
      const livePrice = quote?.c || null;

      if (livePrice) {
        State.currentPrice = livePrice;
        State.priceOpen    = quote.o || livePrice;
        UI.updatePrice(livePrice);
      }

      // LANGKAH 2: Coba ambil historical candles, validasi vs harga live
      const candles = await FinnhubEngine.fetchCandles(pair, 5, livePrice);

      if (candles && candles.length > 10) {
        // Candles valid — pakai data real
        State.candles   = candles;
        State.currentPrice = livePrice || candles[candles.length-1].close;
        State.priceOpen    = candles[0].open;
        this.onNewCandle();
      } else {
        // Candles tidak valid / tidak tersedia
        // Simulasi berbasis harga LIVE (bukan hardcoded BASE_SIM)
        console.warn('[JP77] Candles tidak tersedia, simulasi berbasis harga live:', livePrice);
        SimEngine.start(pair, livePrice);
        // Override currentPrice ke harga live jika ada
        if (livePrice) {
          State.currentPrice = livePrice;
          UI.updatePrice(livePrice);
        }
      }

      // LANGKAH 3: Connect WebSocket untuk tick realtime
      FinnhubEngine.connectWS(pair);
    }
  },


  onNewCandle() {
    if (!State.candles.length) return;
    State.sr     = Indicators.calcSR(State.candles);
    State.signal = Indicators.detectSignal(State.candles, State.sr);
    State.tpsl   = Indicators.calcTPSL(State.pair, State.signal, State.sr, State.rr);

    UI.updateSR();
    UI.updateSignal();
    UI.updateMM();
    ChartEngine.init();

    if (State.currentPrice) UI.updatePrice(State.currentPrice);
  },

  onTick(price) {
    // VALIDASI: Tolak tick jika menyimpang >3% dari harga terakhir (filter anomali/stale data)
    if (State.currentPrice && State.currentPrice > 0) {
      const dev = Math.abs(price - State.currentPrice) / State.currentPrice;
      if (dev > 0.03) {
        console.warn(`[JP77] Tick anomali: ${price} vs current ${State.currentPrice} (dev ${(dev*100).toFixed(2)}%) — diabaikan`);
        return;
      }
    }

    State.currentPrice = price;
    UI.updatePrice(price);
    ChartEngine.appendTick(price);

    // Setiap 15 ticks: update candle terakhir + recalc S/R & signal
    if (!this._tickCount) this._tickCount = 0;
    this._tickCount++;
    if (this._tickCount % 15 === 0) {
      const last = State.candles[State.candles.length - 1];
      if (last) {
        last.close = price;
        last.high  = Math.max(last.high,  price);
        last.low   = Math.min(last.low,   price);
      }
      State.sr     = Indicators.calcSR(State.candles);
      State.signal = Indicators.detectSignal(State.candles, State.sr);
      State.tpsl   = Indicators.calcTPSL(State.pair, State.signal, State.sr, State.rr);
      UI.updateSR();
      UI.updateSignal();
      UI.updateMM();
    }
  },


  refreshSignal() {
    if (!State.candles.length) return;
    State.sr     = Indicators.calcSR(State.candles);
    State.signal = Indicators.detectSignal(State.candles, State.sr);
    State.tpsl   = Indicators.calcTPSL(State.pair, State.signal, State.sr, State.rr);
    UI.updateSR();
    UI.updateSignal();
    UI.updateMM();
    ChartEngine.init();
  },

  runAIAnalysis() {
    AIEngine.analyze();
  },

  toggleCheck(idx) {
    State.checklist[idx] = !State.checklist[idx];
    localStorage.setItem('jp77_checklist', JSON.stringify(State.checklist));
    UI.initChecklist();
  },
};

/* ────────────────────────────────────
   EVENT LISTENERS
──────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {

  // Pair tabs
  document.getElementById('pairTabs').addEventListener('click', (e) => {
    const tab = e.target.closest('.pair-tab');
    if (tab?.dataset.pair) App.loadPair(tab.dataset.pair);
  });

  // TF buttons
  document.querySelectorAll('.tf-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      State.tf = btn.dataset.tf;
      const tfMap = { M5:5, M15:15, H1:60, H4:240 };
      if (!State.demoMode) {
        FinnhubEngine.fetchCandles(State.pair, tfMap[State.tf] || 5, State.currentPrice).then(candles => {
          if (candles?.length) {
            State.candles = candles;
            App.onNewCandle();
          } else if (State.currentPrice) {
            SimEngine.start(State.pair, State.currentPrice);
          }
        });
      }
    });
  });

  // R:R slider
  document.getElementById('rrSlider').addEventListener('input', (e) => {
    State.rr = +e.target.value;
    document.getElementById('rrDisplay').textContent = `1 : ${State.rr}`;
    State.tpsl = Indicators.calcTPSL(State.pair, State.signal || {bias:'NEUTRAL'}, State.sr, State.rr);
    UI.updateSignal();
    UI.updateMM();
  });

  // Balance input
  document.getElementById('balanceInput').addEventListener('input', (e) => {
    State.balance = +e.target.value || 1000;
    UI.updateMM();
  });

  // Risk slider
  document.getElementById('riskSlider').addEventListener('input', (e) => {
    State.riskPct = +e.target.value;
    UI.updateMM();
  });

  // Close modal on backdrop click
  document.getElementById('settingsModal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeSettings();
  });

  // Keyboard shortcut: press R to refresh signal
  document.addEventListener('keydown', (e) => {
    if (e.key === 'r' && !e.ctrlKey) App.refreshSignal();
  });

  // Start app
  App.init();
});
