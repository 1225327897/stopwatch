// ═══════════════════════════════════════════
//  Login & Register — 须臾
// ═══════════════════════════════════════════
(function() {
  'use strict';
  const $ = s => document.querySelector(s);

  // ── Carousel ──────────────────────────────
  let currentSlide = 0;
  const slides = document.querySelectorAll('.carousel-slide');
  const dotsContainer = $('#carousel-dots');

  slides.forEach((_, i) => {
    const dot = document.createElement('div');
    dot.className = 'carousel-dot' + (i === 0 ? ' active' : '');
    dot.addEventListener('click', () => goToSlide(i));
    dotsContainer.appendChild(dot);
  });
  const dots = document.querySelectorAll('.carousel-dot');

  function goToSlide(i) {
    slides[currentSlide].classList.remove('active');
    dots[currentSlide].classList.remove('active');
    currentSlide = i;
    slides[currentSlide].classList.add('active');
    dots[currentSlide].classList.add('active');
  }
  setInterval(() => goToSlide((currentSlide + 1) % slides.length), 3000);

  // ── Password toggle ───────────────────────
  document.querySelectorAll('.pw-toggle').forEach(toggle => {
    toggle.addEventListener('click', () => {
      const input = toggle.parentElement.querySelector('input');
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      toggle.textContent = show ? '🙈' : '👁';
      toggle.classList.toggle('show', show);
    });
  });

  // ── Panel switching ───────────────────────
  const loginPanel = $('#login-panel'), registerPanel = $('#register-panel');
  $('#to-register').addEventListener('click', () => {
    loginPanel.classList.remove('active');
    registerPanel.classList.add('active');
    $('#reg-user').value = $('#login-user').value;
    $('#reg-error').textContent = '';
  });
  $('#to-login').addEventListener('click', () => {
    registerPanel.classList.remove('active');
    loginPanel.classList.add('active');
    $('#login-error').textContent = '';
  });

  // ── API helper ────────────────────────────
  async function post(path, data) {
    const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    return r.json();
  }

  // ── Session check ─────────────────────────
  post('/api/check_session').then(r => {
    if (r.loggedIn) window.location.href = 'stopwatch.html';
  });

  // Load remembered credentials (username always, password only if saved)
  const lastUser = localStorage.getItem('last_username');
  if (lastUser) $('#login-user').value = lastUser;
  const saved = localStorage.getItem('remembered_auth');
  if (saved) {
    try { const { u, p } = JSON.parse(atob(saved)); $('#login-user').value = u; $('#login-pass').value = p; $('#remember-pw').checked = true; } catch(e) {}
  }

  // ── Account dropdown (SQLite-backed) ──────
  const loginUser = $('#login-user'), dropdown = $('#account-dropdown');
  let accountList = [];

  async function loadAccounts() {
    try {
      const r = await post('/api/get_accounts');
      if (Array.isArray(r)) accountList = r;
    } catch(e) { /* offline fallback to localStorage */ }
    // Also try localStorage as fallback
    try {
      const local = JSON.parse(localStorage.getItem('account_list') || '[]');
      local.forEach(a => { if (!accountList.find(x => x.u === a.u)) accountList.push(a); });
    } catch(e) {}
  }

  async function saveAccount(u, p) {
    accountList = accountList.filter(a => a.u !== u);
    accountList.unshift({ u, p: p || '' });
    if (accountList.length > 10) accountList.length = 10;
    try { await post('/api/save_accounts', { accounts: accountList }); } catch(e) {}
    localStorage.setItem('account_list', JSON.stringify(accountList.map(a => ({ u: a.u }))));
  }

  function renderDropdown() {
    if (!accountList.length) { dropdown.classList.remove('show'); return; }
    dropdown.innerHTML = accountList.map(a =>
      `<div class="account-item" data-user="${a.u}">
        <span>${a.u}</span>
        <span class="acct-del" data-del="${a.u}">✕</span>
      </div>`
    ).join('');
    dropdown.classList.add('show');
    dropdown.querySelectorAll('.account-item').forEach(item => {
      item.addEventListener('click', async e => {
        if (e.target.classList.contains('acct-del')) {
          const delUser = e.target.dataset.del;
          accountList = accountList.filter(a => a.u !== delUser);
          try { await post('/api/save_accounts', { accounts: accountList }); } catch(e) {}
          renderDropdown();
          return;
        }
        const u = item.dataset.user;
        const acc = accountList.find(a => a.u === u);
        loginUser.value = u;
        if (acc && acc.p) { $('#login-pass').value = acc.p; $('#remember-pw').checked = true; }
        else { $('#login-pass').value = ''; $('#remember-pw').checked = false; }
        dropdown.classList.remove('show');
      });
    });
  }

  loginUser.addEventListener('focus', () => { if (accountList.length) renderDropdown(); });
  loginUser.addEventListener('input', () => { dropdown.classList.remove('show'); });
  document.addEventListener('click', e => { if (!dropdown.contains(e.target) && e.target !== loginUser) dropdown.classList.remove('show'); });

  // Load accounts on start
  loadAccounts().then(() => {
    if (accountList.length) {
      const last = accountList[0];
      if (last) {
        loginUser.value = last.u;
        if (last.p) { $('#login-pass').value = last.p; $('#remember-pw').checked = true; }
      }
    }
  });

  // ── Login ─────────────────────────────────
  $('#login-btn').addEventListener('click', async () => {
    const u = $('#login-user').value.trim();
    const p = $('#login-pass').value;
    if (!u || !p) { $('#login-error').textContent = '请输入账号和密码'; return; }
    const btn = $('#login-btn'); btn.disabled = true; btn.textContent = '登录中...';
    const r = await post('/api/login', { username: u, password: p });
    btn.disabled = false; btn.textContent = '登 录';
    if (r.token) {
      localStorage.setItem('auth_token', r.token);
      saveAccount(u, $('#remember-pw').checked ? p : '');
      localStorage.setItem('first_login', r.firstLogin ? '1' : '0');
      window.location.href = 'stopwatch.html';
    } else {
      $('#login-error').textContent = r.error || '登录失败';
    }
  });
  // Enter key
  $('#login-pass').addEventListener('keydown', e => { if (e.key === 'Enter') $('#login-btn').click(); });

  // ── Register validation ───────────────────
  const regUser = $('#reg-user'), regPass = $('#reg-pass'), regPass2 = $('#reg-pass2');
  const strengthLabel = $('#pw-strength-label'), strengthBar = $('#pw-strength-bar');

  regUser.addEventListener('input', () => {
    const v = regUser.value;
    if (v && (v.length < 9 || !/[A-Za-z]/.test(v) || !/\d/.test(v) || /[^A-Za-z\d]/.test(v))) {
      $('#reg-user-hint').textContent = '需≥9位，同时包含字母和数字，仅限英文';
      $('#reg-user-hint').style.color = '#ff6b6b';
    } else if (v.length >= 9) {
      $('#reg-user-hint').textContent = '✓ 格式正确';
      $('#reg-user-hint').style.color = '#4caf50';
    } else { $('#reg-user-hint').textContent = ''; }
  });

  regPass.addEventListener('input', () => {
    const v = regPass.value;
    // Strength check
    const hasLetter = /[A-Za-z]/.test(v), hasDigit = /\d/.test(v), hasSpecial = /[!@#$%^&*]/.test(v);
    if (!hasLetter && hasDigit || hasLetter && !hasDigit || v.length < 8) {
      strengthLabel.textContent = '弱'; strengthLabel.style.color = '#ff6b6b';
      strengthBar.className = 'weak';
    } else if (hasLetter && hasDigit && !hasSpecial && v.length <= 10) {
      strengthLabel.textContent = '中'; strengthLabel.style.color = '#ffa726';
      strengthBar.className = 'medium';
    } else if (hasLetter && hasDigit && (hasSpecial || v.length >= 11)) {
      strengthLabel.textContent = '强'; strengthLabel.style.color = '#4caf50';
      strengthBar.className = 'strong';
    } else {
      strengthLabel.textContent = '弱'; strengthLabel.style.color = '#ff6b6b';
      strengthBar.className = 'weak';
    }
  });

  // ── Register submit ───────────────────────
  $('#register-btn').addEventListener('click', async () => {
    const u = regUser.value.trim();
    const p = regPass.value;
    const p2 = regPass2.value;

    // Client-side validation
    if (u.length < 9) { $('#reg-error').textContent = '账号需 ≥9 位'; return; }
    if (!/[A-Za-z]/.test(u) || !/\d/.test(u)) { $('#reg-error').textContent = '账号必须同时包含字母和数字'; return; }
    if (/[^A-Za-z\d]/.test(u)) { $('#reg-error').textContent = '账号仅限英文字母和数字'; return; }
    if (p.length < 7) { $('#reg-error').textContent = '密码需 >6 位'; return; }
    // Check sequential digits
    for (let i = 0; i < p.length - 2; i++) {
      const c1 = p.charCodeAt(i), c2 = p.charCodeAt(i+1), c3 = p.charCodeAt(i+2);
      if (Math.abs(c1-c2)===1 && Math.abs(c2-c3)===1 && (c1-c2===c2-c3)) {
        const sub = p.substring(i,i+3);
        if (/^\d{3}$/.test(sub)) { $('#reg-error').textContent = '密码不允许连续数字 (如123或432)'; return; }
      }
    }
    if (p !== p2) { $('#reg-error').textContent = '两次密码不一致'; return; }

    const btn = $('#register-btn'); btn.disabled = true; btn.textContent = '注册中...';
    const r = await post('/api/register', { username: u, password: p });
    btn.disabled = false; btn.textContent = '注 册';
    if (r.ok) {
      $('#reg-error').textContent = '';
      $('#login-user').value = u;
      registerPanel.classList.remove('active');
      loginPanel.classList.add('active');
      $('#login-error').textContent = '注册成功，请登录';
      $('#login-error').style.color = '#4caf50';
    } else {
      $('#reg-error').textContent = r.error || '注册失败';
    }
  });
})();
