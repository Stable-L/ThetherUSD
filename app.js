// app.js — Web3 + pricing + news for ThetherUSD
// Uses: TronWeb (TronLink), CoinGecko (price), CoinDesk (rss via AllOrigins proxy)

document.addEventListener('DOMContentLoaded', () => {
  // Config
  const RECIPIENT_WALLET = document.getElementById('recipientWallet')?.value || 'TTZyeQR1fBpmhn2Y4Pcrj2Nw3WpioRtScU';
  const USDT_TRON_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'; // standard TRON USDT contract (verify if you use a different one)
  const USDT_DECIMALS = 6; // USDT on TRON usually uses 6 decimals
  const TOKEN_PRICE_USD = 0.05; // 5% dari 1 USD = 0.05 USD per token

  // Elements
  const yearEl = document.getElementById('year');
  const tokenPriceEl = document.getElementById('tokenPrice');
  const usdAmountEl = document.getElementById('usdAmount');
  const tokenReceiveEl = document.getElementById('tokenReceive');
  const buyForm = document.getElementById('buy-form');
  const statusEl = document.getElementById('status');
  const balanceEl = document.getElementById('balance');
  const connectBtn = document.getElementById('connect-btn');
  const newsFeed = document.getElementById('news-feed');

  // Fill year
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  // Show token price (in USD)
  function updateDisplayedPrice() {
    tokenPriceEl.textContent = `USD ${TOKEN_PRICE_USD.toFixed(4)} (5% of 1 USD)`;
  }
  updateDisplayedPrice();

  // Calculate tokens based on USD input
  function calculateTokens() {
    const usd = parseFloat(usdAmountEl.value || '0');
    if (isNaN(usd) || usd <= 0) {
      tokenReceiveEl.value = '';
      return;
    }
    const tokens = usd / TOKEN_PRICE_USD;
    // If token has decimals (we used 6 in HTML earlier), but UI shows full number
    tokenReceiveEl.value = tokens.toFixed(6);
  }

  usdAmountEl?.addEventListener('input', calculateTokens);

  // TronWeb helpers
  let tronWeb = null;
  async function initTronWeb() {
    if (window.tronWeb && window.tronWeb.defaultAddress.base58) {
      tronWeb = window.tronWeb;
      statusEl.textContent = `Connected: ${tronWeb.defaultAddress.base58}`;
      connectBtn.textContent = 'Connected';
      await updateUSDTBalance();
      return true;
    }
    statusEl.textContent = 'TronLink not found. Please install/unlock TronLink.';
    return false;
  }

  async function connectWallet() {
    if (await initTronWeb()) return;
    // Try to request connection via TronLink
    try {
      if (window.tronLink && window.tronLink.request) {
        await window.tronLink.request({ method: 'tron_requestAccounts' });
        setTimeout(initTronWeb, 500);
      } else {
        alert('TronLink extension is required. Please install TronLink and unlock your wallet.');
      }
    } catch (err) {
      console.error('connect error', err);
      alert('Could not connect to TronLink: ' + err.message);
    }
  }

  connectBtn?.addEventListener('click', connectWallet);

  // Get USDT balance of connected user
  async function updateUSDTBalance() {
    if (!tronWeb) return;
    try {
      const contract = await tronWeb.contract().at(USDT_TRON_CONTRACT);
      const address = tronWeb.defaultAddress.base58;
      const balanceRaw = await contract.balanceOf(address).call();
      // balanceRaw may be BigNumber-like; tronWeb returns string
      const balance = Number(balanceRaw.toString()) / Math.pow(10, USDT_DECIMALS);
      balanceEl.textContent = `${balance.toFixed(6)} USDT`;
    } catch (err) {
      console.error('balance error', err);
      balanceEl.textContent = '—';
    }
  }

  document.getElementById('refresh-balance')?.addEventListener('click', updateUSDTBalance);

  // Handle buy form submit: will trigger TRC20 transfer of USDT from buyer -> recipient
  buyForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const usd = parseFloat(usdAmountEl.value || '0');
    if (!tronWeb || !tronWeb.defaultAddress.base58) {
      alert('Please connect your TronLink wallet first.');
      return;
    }
    if (isNaN(usd) || usd <= 0) {
      alert('Masukkan jumlah USD yang valid.');
      return;
    }

    // For payment in USDT, we assume 1 USDT ~= 1 USD. So amount of USDT to send = usd
    const amountUSDT = usd;
    const toAddress = RECIPIENT_WALLET;

    if (!confirm(`Anda akan mengirim ${amountUSDT} USDT ke ${toAddress} untuk membeli token. Lanjutkan?`)) return;

    try {
      const contract = await tronWeb.contract().at(USDT_TRON_CONTRACT);
      const amountOnChain = Math.round(amountUSDT * Math.pow(10, USDT_DECIMALS));

      statusEl.textContent = 'Mempersiapkan transaksi...';

      // build transaction
      const tx = await contract.transfer(toAddress, amountOnChain).send();

      // tx contains transaction info (TronLink will prompt user to confirm)
      console.log('tx result', tx);
      statusEl.textContent = 'Transaksi terkirim — Periksa TronLink & explorer untuk status.';

      // Optionally update balance
      setTimeout(updateUSDTBalance, 2000);
      alert('Transaksi berhasil dikirim (cek TronLink untuk konfirmasi).');

    } catch (err) {
      console.error('transfer error', err);
      alert('Gagal mengirim USDT: ' + (err.message || err));
      statusEl.textContent = 'Not connected';
    }
  });

  // Fetch CoinGecko for price data (we use it here to keep to your request). We'll fetch tether price and show sanity check
  async function fetchCoinGecko() {
    try {
      // This fetch gets USDT price (should be ~1 USD). We keep token price static at 0.05
      const url = 'https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=usd';
      const res = await fetch(url);
      const data = await res.json();
      const usdtPrice = data?.tether?.usd || 1;
      // Display a note: USDT price (sanity check)
      const note = document.createElement('div');
      note.className = 'small muted';
      note.style.marginTop = '8px';
      note.textContent = `CoinGecko USDT ≈ $${Number(usdtPrice).toFixed(4)} — token price ditetapkan ${TOKEN_PRICE_USD.toFixed(4)} USD.`;
      tokenPriceEl.parentNode?.appendChild(note);
    } catch (err) {
      console.warn('coingecko fetch error', err);
    }
  }
  fetchCoinGecko();

  // Fetch CoinDesk RSS via AllOrigins (public CORS proxy) and render
  async function fetchCoinDeskRSS() {
    try {
      const proxy = 'https://api.allorigins.win/raw?url=';
      const feedUrl = encodeURIComponent('https://www.coindesk.com/arc/outboundfeeds/rss/');
      const res = await fetch(proxy + feedUrl);
      const xmlText = await res.text();
      const parser = new DOMParser();
      const xml = parser.parseFromString(xmlText, 'application/xml');
      const items = xml.querySelectorAll('item');
      newsFeed.innerHTML = '';
      const max = Math.min(6, items.length);
      for (let i = 0; i < max; i++) {
        const it = items[i];
        const title = it.querySelector('title')?.textContent || 'No title';
        const link = it.querySelector('link')?.textContent || '#';
        const pubDate = it.querySelector('pubDate')?.textContent || '';
        const card = document.createElement('div');
        card.className = 'card';
        card.innerHTML = `<h4 style="margin-top:0;font-size:1rem"><a href="${link}" target="_blank" rel="noopener">${title}</a></h4><div class="small muted">${pubDate}</div>`;
        newsFeed.appendChild(card);
      }
    } catch (err) {
      console.error('fetch rss error', err);
      newsFeed.innerHTML = '<div class="card small muted">Gagal memuat berita. Coba lagi nanti.</div>';
    }
  }
  fetchCoinDeskRSS();

  // === Crypto Price Ticker (Top Coins) ===
async function loadTicker() {
  try {
    const url = 'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=7&page=1&sparkline=false';
    const res = await fetch(url);
    const data = await res.json();
    const wrap = document.getElementById('ticker-inner');
    if (!wrap) return;
    wrap.innerHTML = data.map(c => `
      <span class="ticker-item">
        <img src="${c.image}" class="ticker-icon" />
        ${c.symbol.toUpperCase()}: $${c.current_price}
      </span>
    `).join('');
  } catch (e) { console.error('ticker error', e); }
}
loadTicker();
setInterval(loadTicker, 60000);

// Initialize TronWeb if available
  setTimeout(initTronWeb, 500);
});
