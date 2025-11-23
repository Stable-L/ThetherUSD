/* app.js - TronLink / TronWeb integration for TRC20 token (decimals=6)
   Features:
   - Connect TronLink
   - Read active address
   - Read TRC20 balance (decimals = 6)
   - Send transfer via wallet popup (transfer)
   - UI loading / error handling
*/
const CONTRACT_ADDRESS = 'TS19aXnBLtsS7a243wT3NHevPhVLrEK3Cu';
const DECIMALS = 6;

const statusEl = document.getElementById('status');
const balanceEl = document.getElementById('balance');
const connectBtn = document.getElementById('connect-btn');
const connectCta = document.getElementById('connect-cta');
const refreshBtn = document.getElementById('refresh-balance');
const sendForm = document.getElementById('send-form');

let tronWeb;
let userAddress = null;
let contractInstance = null;

function setStatus(text, isError=false){
  statusEl.innerText = text;
  statusEl.style.color = isError ? '#ff8b8b' : '';
}

function setBalanceText(text){
  balanceEl.innerText = text;
}

// Initialize - detect TronLink
async function init() {
  // TronLink injects window.tronWeb
  if (window.tronWeb && window.tronWeb.ready) {
    tronWeb = window.tronWeb;
    userAddress = tronWeb.defaultAddress.base58;
    setStatus('Connected: ' + shortAddr(userAddress));
    await setContract();
    await readBalance();
  } else {
    setStatus('TronLink not found — please install and unlock TronLink.', true);
  }
}

// Short address helper
function shortAddr(a){
  if(!a) return '';
  return a.slice(0,8) + '...' + a.slice(-6);
}

// Ask user to connect (TronLink will prompt)
// Modern TronLink exposes window.tronLink and window.tronWeb; below we attempt to enable by requesting accounts via tronLink
async function connectWallet(){
  try {
    setStatus('Requesting connection...');
    // Some TronLink versions require calling window.tronLink.request or tronWeb.request({method:'tron_requestAccounts'})
    if (window.tronLink && window.tronLink.request) {
      await window.tronLink.request({ method: 'tron_requestAccounts' });
    } else if (window.tronWeb && window.tronWeb.request) {
      await window.tronWeb.request({ method: 'tron_requestAccounts' });
    } else if (window.tronWeb && window.tronWeb.defaultAddress && window.tronWeb.defaultAddress.base58) {
      // already available
    } else {
      throw new Error('No compatible TronLink provider found');
    }

    // small delay for provider to populate
    await new Promise(res=>setTimeout(res, 500));
    if (window.tronWeb && window.tronWeb.ready) {
      tronWeb = window.tronWeb;
      userAddress = tronWeb.defaultAddress.base58;
      setStatus('Connected: ' + shortAddr(userAddress));
      await setContract();
      await readBalance();
    } else {
      throw new Error('Failed to connect to TronLink');
    }
  } catch (err) {
    console.error(err);
    setStatus('Connection rejected or failed: ' + (err.message||err), true);
  }
}

// Set contract instance
async function setContract(){
  try {
    setStatus('Loading contract...');
    contractInstance = await tronWeb.contract().at(CONTRACT_ADDRESS);
    setStatus('Contract loaded — ' + shortAddr(CONTRACT_ADDRESS));
  } catch (err) {
    console.error(err);
    setStatus('Failed to load contract: ' + (err.message||err), true);
  }
}

// Read TRC20 balanceOf
async function readBalance(){
  try {
    if(!contractInstance) {
      await setContract();
      if(!contractInstance) throw new Error('Contract not set');
    }
    setStatus('Reading balance...');
    const raw = await contractInstance.balanceOf(userAddress).call();
    // raw may be BigNumber or hex string depending on provider - normalize:
    let rawStr = raw.toString();
    // convert to human amount
    const amount = Number(rawStr) / (10 ** DECIMALS);
    setBalanceText(amount.toLocaleString('en-US', {minimumFractionDigits: 0, maximumFractionDigits: DECIMALS}));
    setStatus('Ready — ' + shortAddr(userAddress));
  } catch (err) {
    console.error(err);
    setStatus('Failed to read balance: ' + (err.message||err), true);
    setBalanceText('—');
  }
}

// Send transfer using contract.transfer(to, amount)
async function sendTransfer(to, humanAmount){
  try {
    if(!tronWeb || !tronWeb.ready) throw new Error('Wallet not connected');
    if(!contractInstance) await setContract();
    setStatus('Preparing transfer...');
    // validate recipient
    if(!tronWeb.isAddress(to)) throw new Error('Invalid recipient address');

    // convert human amount to integer with decimals
    const integerAmount = BigInt(Math.round(Number(humanAmount) * (10 ** DECIMALS)));
    if(integerAmount <= 0n) throw new Error('Amount must be greater than 0');

    // call transfer (this opens the TronLink popup)
    setStatus('Requesting transaction signature...');
    // Use .send() which triggers the wallet popup
    const tx = await contractInstance.transfer(to, integerAmount.toString()).send({
      feeLimit: 100_000_000 // 100 TRX feeLimit to be safe (adjust as needed)
    });

    // tx may be a transaction object or result; provide feedback
    console.log('transfer tx:', tx);
    setStatus('Transaction submitted — waiting for confirmation...');
    setBalanceText('Loading...');

    // Simple poll for confirmation (fetchTransactionInfo)
    const txid = tx; // tronLink often returns tx id (hex) or object with txID
    let txidStr = typeof tx === 'object' && tx.txID ? tx.txID : String(tx);
    // Poll for 10 seconds
    const start = Date.now();
    let confirmed = false;
    while(Date.now() - start < 15000){
      try{
        const info = await tronWeb.trx.getTransactionInfo(txidStr);
        if(info && (info.receipt || info.ret) ){
          confirmed = true;
          break;
        }
      }catch(e){
        // ignore while pending
      }
      await new Promise(r=>setTimeout(r, 1500));
    }

    if(confirmed){
      setStatus('Transaction confirmed!');
    } else {
      setStatus('Transaction submitted (confirmation pending).');
    }
    await readBalance();
  } catch (err) {
    console.error(err);
    setStatus('Transfer failed: ' + (err.message||err), true);
  }
}

// Event listeners
connectBtn && connectBtn.addEventListener('click', connectWallet);
connectCta && connectCta.addEventListener('click', connectWallet);
refreshBtn && refreshBtn.addEventListener('click', async ()=>{ await readBalance(); });

sendForm && sendForm.addEventListener('submit', async (e)=>{
  e.preventDefault();
  const to = document.getElementById('to').value.trim();
  const amount = document.getElementById('amount').value.trim();
  if(!to || !amount){
    setStatus('Recipient and amount are required', true);
    return;
  }
  // disable submit while working
  const btn = sendForm.querySelector('button[type=submit]');
  btn.disabled = true;
  const prevText = btn.innerText;
  btn.innerText = 'Sending...';
  try{
    await sendTransfer(to, amount);
  }finally{
    btn.disabled = false;
    btn.innerText = prevText;
  }
});

// Auto init when page loads
window.addEventListener('load', async () => {
  document.getElementById('year') && (document.getElementById('year').innerText = new Date().getFullYear());
  // Wait a bit for provider injection
  setTimeout(init, 800);
});
