# ◈ JP77 Signal Dashboard — Traders Family Method

> Dashboard sinyal trading berbasis metode **Johnpaul77 (JP77)** oleh Pak Tito Hayunanda, CEO Traders Family.
> Berjalan 100% di browser — bisa di-host gratis di GitHub Pages.

![Dashboard Preview](https://img.shields.io/badge/Status-Live%20%7C%20Demo%20Mode-00d68f?style=flat-square)
![License](https://img.shields.io/badge/License-MIT-3e8ef7?style=flat-square)
![Method](https://img.shields.io/badge/Metode-JP77%20Ranging%20%26%20Breakout-ff4757?style=flat-square)

---

## 🚀 Cara Deploy ke GitHub Pages (5 Menit)

### Langkah 1 — Fork / Clone Repo

```bash
# Clone repo ini
git clone https://github.com/USERNAME/jp77-signal.git
cd jp77-signal
```

Atau klik tombol **Fork** di GitHub untuk copy ke akun Anda.

---

### Langkah 2 — Aktifkan GitHub Pages

1. Buka repo Anda di GitHub
2. Klik **Settings** → **Pages**
3. Di bagian **Source**, pilih **GitHub Actions**
4. Klik **Save**

---

### Langkah 3 — Push / Trigger Deploy

Setiap kali Anda push ke branch `main`, GitHub Actions otomatis deploy ke:

```
https://USERNAME.github.io/jp77-signal/
```

Atau trigger manual: **Actions** → **Deploy JP77 Signal Dashboard** → **Run workflow**

---

## 🔑 Konfigurasi API Keys

Buka website Anda, klik ikon ⚙️ di pojok kanan atas.

### Finnhub API (Live Forex Prices) — GRATIS

1. Daftar di [finnhub.io](https://finnhub.io) — **100% gratis**
2. Salin API Key dari dashboard
3. Masukkan di pengaturan dashboard

**Tanpa key:** Dashboard otomatis berjalan di **Mode Demo** dengan harga simulasi.

### Anthropic API (Analisis AI) — Berbayar

1. Daftar di [console.anthropic.com](https://console.anthropic.com)
2. Buat API Key baru
3. Masukkan di pengaturan dashboard

**Tanpa key:** Tombol "Analisis AI" tidak akan berfungsi. Semua fitur lain tetap aktif.

> **⚠️ Keamanan:** API keys disimpan di `localStorage` browser Anda. Jangan bagikan URL dengan keys sudah diisi ke orang lain. Gunakan di perangkat pribadi.

---

## 📊 Fitur Dashboard

### Signal Panel
- **Deteksi otomatis** metode Ranging vs Breakout (JP77 method)
- **Support & Resistance** dihitung dari pivot high/low + clustering
- **Entry, TP, SL** otomatis dengan Risk:Reward yang bisa diatur
- **Confidence meter** berdasarkan posisi harga di range S/R
- Pair: `EURUSD`, `GBPUSD`, `XAUUSD`, `USDJPY`, `GBPJPY`, `AUDUSD`

### Chart
- Grafik harga realtime dengan garis S/R overlay
- Timeframe: M5, M15, H1, H4
- Historical data dari Finnhub REST API

### Money Management
- Kalkulator lot size otomatis (balance × risk%)
- Warning jika risk > 3% (JP77 rule)
- Proyeksi portofolio 6 bulan (model 18%/bulan)

### AI Morning Briefing
- Analisis bergaya morning briefing Traders Family
- Ditulis oleh Claude AI dengan prompt JP77 method
- Mencakup: kondisi market, setup, entry, money management, reminder JP77

### Trading Plan Checklist
- 7 poin morning checklist ala JP77
- Progress bar & persistent storage (tersimpan di browser)
- Prinsip-prinsip utama JP77

---

## ⚙️ Metode Trading JP77

Dashboard ini mengimplementasikan inti dari metode Pak Tito:

```
1. SUPPORT & RESISTANCE
   Gambar zona S/R dari pivot high/low di H4 & Daily

2. RANGING METHOD
   • Harga berada di dalam range antara S dan R
   • Near Resistance → SELL signal
   • Near Support    → BUY signal

3. BREAKOUT METHOD
   • Harga menembus R dengan momentum → BUY signal
   • Harga menembus S dengan momentum → SELL signal

4. MONEY MANAGEMENT
   • Risk per trade: maks 2–3% dari balance
   • Max drawdown:  30%
   • Min R:R ratio: 1:2
```

---

## 🗂️ Struktur File

```
jp77-signal/
├── index.html          ← Struktur HTML utama
├── style.css           ← Dark trading theme CSS
├── app.js              ← Logic: S/R, signal, chart, AI, MM
├── .github/
│   └── workflows/
│       └── deploy.yml  ← Auto-deploy ke GitHub Pages
└── README.md           ← Panduan ini
```

---

## 🛠️ Menjalankan Secara Lokal

Tidak butuh build tool. Cukup:

```bash
# Gunakan live server sederhana
npx serve .

# Atau dengan Python
python -m http.server 8080

# Atau dengan PHP
php -S localhost:8080
```

Buka `http://localhost:8080` di browser.

**Catatan:** WebSocket Finnhub butuh HTTPS di production. Untuk development lokal, mode demo tetap berfungsi sempurna.

---

## 📦 Dependencies

Semua via CDN — tidak ada `npm install` diperlukan:

| Library | Versi | Fungsi |
|---------|-------|--------|
| [Chart.js](https://www.chartjs.org/) | 4.4.1 | Price chart rendering |
| [Google Fonts](https://fonts.google.com/) | — | JetBrains Mono + Inter |

---

## 🔧 Kustomisasi

### Menambah Pair Baru

Edit `app.js`, tambahkan ke objek `PAIRS`:

```js
const PAIRS = {
  // ...existing pairs...
  EURCAD: {
    finnhub: 'OANDA:EUR_CAD',
    digits:  4,
    pipSize: 0.0001,
    pipVal:  7.4,
    slDefault: 55,
    session: 'London/NY',
  },
};
```

Lalu tambahkan tombol di `index.html`:
```html
<button class="pair-tab" data-pair="EURCAD">EUR/CAD</button>
```

### Mengubah SL Default

Setiap pair punya `slDefault` (dalam pips). Ubah sesuai style trading Anda.

### Mengubah Algoritma Signal

Fungsi `Indicators.detectSignal()` di `app.js` bisa dimodifikasi. Parameter kunci:
- `breakoutBuffer`: seberapa jauh harga harus melewati S/R untuk dianggap breakout
- Threshold `0.78` / `0.22`: posisi dalam range untuk trigger Ranging signal

---

## ⚠️ Disclaimer

> **Penting:** Dashboard ini dibuat untuk tujuan **edukasi dan latihan** berdasarkan metode JP77 yang dipelajari dari konten publik Traders Family. Bukan merupakan rekomendasi investasi atau financial advice.
>
> Trading forex mengandung **risiko tinggi**. Selalu gunakan modal yang Anda siap kehilangan. Konsultasikan dengan mentor atau professional sebelum trading dengan uang nyata.

---

## 📚 Referensi

- [Traders Family](https://tradersfamily.id) — Website resmi
- [YouTube Traders Family](https://youtube.com/@TradersFamilyID) — Channel edukasi
- [MQL5 Interview JP77](https://www.mql5.com/en/articles/1045) — Interview Pak Tito

---

## 📄 License

MIT License — Bebas digunakan, dimodifikasi, dan didistribusikan dengan menyertakan kredit.

---

*Dibuat dengan ❤️ untuk komunitas trader Indonesia.*
*"Consistent profit comes from consistent way of trading." — Pak Tito Hayunanda*
