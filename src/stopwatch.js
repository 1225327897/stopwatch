(function() {
  'use strict';

  // ═══════════════════════════════════════════
  //  MODULE: Utils
  // ═══════════════════════════════════════════
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);

  // Try to call a pywebview API, return null if not available
  async function api(name, ...args) {
    if(!window.pywebview||!window.pywebview.api){
      // pywebview not ready yet — wait for it (max 5s)
      const ok = await new Promise(res => {
        if(window.pywebview&&window.pywebview.api) return res(true);
        let waited = 0;
        const t = setInterval(()=>{
          waited += 100;
          if(window.pywebview&&window.pywebview.api){clearInterval(t);res(true);}
          else if(waited>=5000){clearInterval(t);res(false);}
        },100);
      });
      if(!ok){console.warn('[api] pywebview not ready for',name);return null;}
    }
    try { return await window.pywebview.api[name](...args); }
    catch(e) { console.error('[api]',name,'errored:',e); return null; }
  }

  // HTTP API for presets (bypasses pywebview bridge, 100% reliable)
  async function post(url, data = {}) {
    const r = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data) });
    return r.ok ? r.json() : null;
  }

  function fmtTime(ms) {
    const totalSec = Math.floor(ms / 1000);
    return {
      h: String(Math.floor(totalSec / 3600) % 24).padStart(2, '0'),
      m: String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0'),
      s: String(totalSec % 60).padStart(2, '0'),
    };
  }
  function fmtTimeStr(ms) { const t=fmtTime(ms); return `${t.h}:${t.m}:${t.s}`; }
  function fmtTimeShort(ms) { const t=fmtTime(ms); return t.h==='00' ? `${t.m}:${t.s}` : `${t.h}:${t.m}:${t.s}`; }

  function fmtTimeParts(t) {
    return { h1:t.h[0],h2:t.h[1],m1:t.m[0],m2:t.m[1],s1:t.s[0],s2:t.s[1] };
  }

  function escapeHtml(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function showToast(msg) {
    const toast = $('#toast');
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => toast.classList.remove('show'), 2000);
  }

  let audioCtxMemo = null;
  function getAudioCtx() {
    if (!audioCtxMemo) audioCtxMemo = new (window.AudioContext || window.webkitAudioContext)();
    return audioCtxMemo;
  }

  // ═══════════════════════════════════════════
  //  MODULE: Sound Effects
  // ═══════════════════════════════════════════
  const SFX = {
    beep(freq, dur, type='sine', vol=0.08) {
      try { const c=getAudioCtx(); const o=c.createOscillator(); const g=c.createGain(); o.type=type; o.frequency.setValueAtTime(freq,c.currentTime); g.gain.setValueAtTime(vol,c.currentTime); g.gain.exponentialRampToValueAtTime(0.001,c.currentTime+dur); o.connect(g);g.connect(c.destination); o.start();o.stop(c.currentTime+dur); } catch(e) {}
    },
    lap() { this.beep(880,0.1); setTimeout(()=>this.beep(1100,0.08),80); },
    start() { this.beep(600,0.12,'triangle'); },
    stop() { this.beep(300,0.15,'triangle'); },
    reset() { this.beep(200,0.2,'sawtooth'); },
    finish() { this.beep(1000,0.15);setTimeout(()=>this.beep(1200,0.15),150);setTimeout(()=>this.beep(1400,0.25),300); },
  };

  // ═══════════════════════════════════════════
  //  MODULE: Timer
  // ═══════════════════════════════════════════
  const Timer = {
    mode:'stopwatch', previousMode:'stopwatch', running:false, startTime:0,
    elapsedBefore:0, countdownTotal:0, pomodoroName:'', laps:[], animFrameId:null, lastDigitValues:{},

    getElapsed() {
      if (!this.running) return this.elapsedBefore;
      if (this.mode==='countdown'||this.mode==='pomodoro') return Math.max(0,this.elapsedBefore-(Date.now()-this.startTime));
      return this.elapsedBefore+(Date.now()-this.startTime);
    },

    start() {
      if (this.running) return;
      if ((this.mode==='countdown'||this.mode==='pomodoro') && this.elapsedBefore<=0) { showToast('请先设置倒计时时间'); return; }
      this.running=true; this.startTime=Date.now();
      UI.timerPanel.classList.add((this.mode==='countdown'||this.mode==='pomodoro')?'countdown-active':'running');
      UI.timerPanel.classList.remove('finished'); UI.btnStart.textContent='⏸ 停止'; UI.btnStart.classList.add('running'); UI.btnLap.disabled=false;
      SFX.start(); this._render();
    },

    stop() {
      if (!this.running) return;
      this.elapsedBefore=this.getElapsed(); this.running=false;
      if ((this.mode==='countdown'||this.mode==='pomodoro')&&this.elapsedBefore<=0) this.elapsedBefore=0;
      cancelAnimationFrame(this.animFrameId);
      UI.timerPanel.classList.remove('running','countdown-active'); UI.btnStart.textContent='▶ 开始'; UI.btnStart.classList.remove('running'); UI.btnLap.disabled=true;
      SFX.stop(); UI.updateDisplay(this.elapsedBefore);
      const b=document.getElementById('breathe-overlay'); if(b){b.classList.remove('pulse','flash');b.style.opacity='0';}
    },

    reset() {
      const wasRunning=this.running, elapsedBeforeReset=wasRunning?this.getElapsed():0;
      if(this.running){this.running=false;cancelAnimationFrame(this.animFrameId);}
      this.elapsedBefore=(this.mode==='countdown'||this.mode==='pomodoro')?this.countdownTotal:0;
      if(this.mode==='pomodoro'&&wasRunning&&this.pomodoroName){post('/api/record_pomodoro', {name:this.pomodoroName, minutes:Math.round((this.countdownTotal-elapsedBeforeReset)/60000), completed:false});}
      this.pomodoroName='';
      // Clear breathing overlay
      const b=document.getElementById('breathe-overlay'); if(b){b.classList.remove('pulse','flash');b.style.opacity='0';}
      UI.timerPanel.classList.remove('running','countdown-active','finished'); UI.btnStart.textContent='▶ 开始'; UI.btnStart.classList.remove('running'); UI.btnLap.disabled=true;
      UI.updateDisplay(this.elapsedBefore); if(wasRunning) SFX.reset();
    },

    lap() {
      if(!this.running) return;
      const remaining=this.getElapsed();
      const ms=(this.mode==='countdown'||this.mode==='pomodoro')?(this.countdownTotal-remaining):remaining;
      const t=fmtTime(ms), timeStr=`${t.h}:${t.m}:${t.s}`; let diffStr='';
      if(this.laps.length>0){const diff=ms-this.laps[0].ms,dt=fmtTime(Math.abs(diff));diffStr=(diff>=0?'+':'-')+`${dt.m}:${dt.s}`;}
      this.laps.unshift({ms,timeStr,diffStr}); SFX.lap(); Sidebar.render(); showToast(`计次 ${this.laps.length}: ${timeStr}`);
    },

    setCountdown() {
      const h=parseInt($('#cd-h').value)||0,m=parseInt($('#cd-m').value)||0,s=parseInt($('#cd-s').value)||0;
      this.countdownTotal=(h*3600+m*60+s)*1000;
      this.elapsedBefore=this.countdownTotal;
    },

    switchMode(newMode) {
      if(this.running) this.stop();
      this.previousMode=this.mode; this.mode=newMode;
      UI.modeTabs.forEach(t=>t.classList.remove('active'));
      const at=document.querySelector(`[data-mode="${this.mode}"]`); if(at)at.classList.add('active');
      const cd=$('#countdown-setup');
      if(this.mode==='countdown'){cd.classList.add('visible');UI.timerPanel.classList.add('countdown-mode');return;}
      else if(this.mode==='pomodoro'){Pomodoro.open();this.mode=this.previousMode;UI.modeTabs.forEach(t=>t.classList.remove('active'));const sw=document.querySelector('[data-mode="stopwatch"]');if(sw)sw.classList.add('active');return;}
      else{cd.classList.remove('visible');UI.timerPanel.classList.remove('countdown-mode');this.elapsedBefore=0;this.countdownTotal=0;}
      UI.timerPanel.classList.remove('running','countdown-active','finished');UI.btnStart.textContent='▶ 开始';UI.btnStart.classList.remove('running');UI.btnLap.disabled=true;
      UI.updateDisplay(this.elapsedBefore);
    },

    _render() {
      const ms=this.getElapsed(); UI.updateDisplay(ms);
      if(this.running&&(this.mode==='countdown'||this.mode==='pomodoro')&&ms>0){
        const b=document.getElementById('breathe-overlay'), fiveMin=5*60*1000;
        if(ms<=fiveMin&&b){const p=1-(ms/fiveMin);b.style.setProperty('--pulse-speed',(3-p*2.6)+'s');b.classList.add('pulse');b.style.opacity=0.06+p*0.16;}
        else if(b){b.classList.remove('pulse');b.style.opacity='0';}
      }
      if(this.running){
        if((this.mode==='countdown'||this.mode==='pomodoro')&&ms<=0){
          this.stop(); UI.timerPanel.classList.add('finished'); SFX.finish();
          const b=document.getElementById('breathe-overlay'); if(b){b.classList.remove('pulse');b.classList.add('flash');setTimeout(()=>{b.classList.remove('flash');b.style.opacity='0';},1000);}
          const fo=$('#finish-overlay'), fi=$('#finish-icon'), fm=$('#finish-msg');
          if(this.mode==='pomodoro'){
            post('/api/record_pomodoro', {name:this.pomodoroName, minutes:Math.round(this.countdownTotal/60000), completed:true});
            const isWork=this.countdownTotal>5*60*1000, workMs=isWork?this.countdownTotal:25*60*1000;
            this.countdownTotal=isWork?5*60*1000:workMs; this.elapsedBefore=this.countdownTotal; UI.updateDisplay(this.countdownTotal);
            fi.textContent=isWork?'☕':'🍅'; fm.textContent=isWork?'休息时间到！':'专注时间到！';
            showToast(isWork?'☕ 休息5分钟':`🍅 继续${Math.round(workMs/60000)}分钟专注`);
          }else{fi.textContent='⏰';fm.textContent='倒计时结束！';showToast('⏰ 倒计时结束！');}
          fo.classList.add('show');
          api('restore_window'); api('alert_sound');
          setTimeout(()=>UI.timerPanel.classList.remove('finished'),3000);
          return;
        }
        this.animFrameId=requestAnimationFrame(()=>this._render());
      }
    },
  };

  // ═══════════════════════════════════════════
  //  MODULE: UI
  // ═══════════════════════════════════════════
  const UI = {
    timerPanel:$('#timer-panel'), btnStart:$('#btn-start'), btnLap:$('#btn-lap'), btnReset:$('#btn-reset'),
    modeTabs:$$('.mode-tab'),
    digits:{h1:$('#h1'),h2:$('#h2'),m1:$('#m1'),m2:$('#m2'),s1:$('#s1'),s2:$('#s2')},
    updateDisplay(ms){
      const t=fmtTime(ms), p=fmtTimeParts(t);
      for(const[id,val] of Object.entries(p)){
        if(Timer.lastDigitValues[id]!==val){const box=this.digits[id].parentElement;box.classList.add('flip');setTimeout(()=>box.classList.remove('flip'),250);this.digits[id].textContent=val;Timer.lastDigitValues[id]=val;}
      }
    },
  };

  // ═══════════════════════════════════════════
  //  MODULE: Sidebar
  // ═══════════════════════════════════════════
  const Sidebar = {
    el:$('#sidebar'),btnToggle:$('#btn-sidebar-toggle'),main:$('#main'),list:$('#lap-list'),empty:$('#lap-empty'),
    toggle(){const o=this.el.classList.toggle('open');this.main.classList.toggle('sidebar-open',o);this.btnToggle.classList.toggle('active',o);},
    close(){this.el.classList.remove('open');this.main.classList.remove('sidebar-open');this.btnToggle.classList.remove('active');},
    render(){
      const laps=Timer.laps;
      if(!laps.length){this.list.innerHTML='';this.list.appendChild(this.empty);this.empty.style.display='';return;}
      this.empty.style.display='none'; const msVals=laps.map(l=>l.ms), best=Timer.mode==='stopwatch'?Math.min(...msVals):Math.max(...msVals), worst=Timer.mode==='stopwatch'?Math.max(...msVals):Math.min(...msVals);
      this.list.innerHTML=laps.map((l,i)=>{let cls='';if(laps.length>1&&l.ms===best)cls='best';if(laps.length>1&&l.ms===worst&&best!==worst)cls='worst';return`<div class="lap-item ${cls}"><span class="lap-index">#${laps.length-i}</span><span class="lap-time">${l.timeStr}</span><span class="lap-diff">${l.diffStr}</span></div>`;}).join('');
    },
  };

  // ═══════════════════════════════════════════
  //  MODULE: Countdown Banner
  // ═══════════════════════════════════════════
  const Banner = {
    wrap:$('#banner-wrap'), labelEl:$('#banner-label'), daysEl:$('#banner-days'),
    modal:$('#countdown-modal-overlay'), presetList:$('#countdown-preset-list'),
    dateWrap:$('#cdown-date-wrap'), dateDisplay:$('#cdown-date-display'),
    labelInput:$('#cdown-label'),
    calendar:$('#cdown-calendar'), calMonth:$('#cdown-month-year'), calDays:$('#cdown-cal-days'),
    calYear: new Date().getFullYear(), calMonthIdx: new Date().getMonth(), calSelected: null,
    data: {label:'新年', date:'2027-01-01'},

    // Holiday presets with auto-advancing logic
    presets: [
      {label:'元旦', calc:()=>{const n=new Date();return new Date(n.getFullYear()+1,0,1);}},
      // Lunar holidays: use approximate dates
      {label:'除夕', calc:()=>{const n=new Date(),y=n.getFullYear();const lunar={2026:[1,17],2027:[1,6],2028:[0,26]};const d=lunar[y]||lunar[2026];let t=new Date(y,d[0],d[1]);if(t<n)t=new Date(y+1,(lunar[y+1]||lunar[2026])[0],(lunar[y+1]||lunar[2026])[1]);return t;}},
      {label:'春节', calc:()=>{const d=Banner.presets[1].calc();d.setDate(d.getDate()+1);return d;}},
      {label:'元宵节', calc:()=>{const d=Banner.presets[1].calc();d.setDate(d.getDate()+15);return d;}},
      {label:'清明节', calc:()=>{const n=new Date();let d=new Date(n.getFullYear(),3,5);if(d<n)d=new Date(n.getFullYear()+1,3,5);return d;}},
      {label:'劳动节', calc:()=>{const n=new Date();let d=new Date(n.getFullYear(),4,1);if(d<n)d=new Date(n.getFullYear()+1,4,1);return d;}},
      {label:'端午节', calc:()=>{const n=new Date();let y=n.getFullYear();let d=new Date(y,5,1);d.setDate(d.getDate()+(5-d.getDay()+7)%7+25);if(d<n){y++;d=new Date(y,5,1);d.setDate(d.getDate()+(5-d.getDay()+7)%7+25);}return d;}},
      {label:'中秋节', calc:()=>{const n=new Date();let d=new Date(n.getFullYear(),8,15);if(d<n)d=new Date(n.getFullYear()+1,8,15);return d;}},
      {label:'国庆节', calc:()=>{const n=new Date();let d=new Date(n.getFullYear(),9,1);if(d<n)d=new Date(n.getFullYear()+1,9,1);return d;}},
      {label:'圣诞节', calc:()=>{const n=new Date();let d=new Date(n.getFullYear(),11,25);if(d<n)d=new Date(n.getFullYear()+1,11,25);return d;}},
      {label:'情人节', calc:()=>{const n=new Date();let d=new Date(n.getFullYear(),1,14);if(d<n)d=new Date(n.getFullYear()+1,1,14);return d;}},
      {label:'七夕', calc:()=>{const n=new Date();let y=n.getFullYear();let d=new Date(y,7,1);d.setDate(d.getDate()+(5-d.getDay()+7)%7);if(d<n){y++;d=new Date(y,7,1);d.setDate(d.getDate()+(5-d.getDay()+7)%7);}return d;}},
    ],

    async init() {
      // Load from SQLite
      const saved = await post('/api/get_countdown');
      if (saved && saved.label) this.data = saved;
      this._updateDisplay();
      setInterval(() => this._updateDisplay(), 60000);
      // Build preset list
      this._renderPresets();
      // Events
      this.wrap.addEventListener('click', () => this.open());
      $('#countdown-modal-close').addEventListener('click', () => this.close());
      this.modal.addEventListener('click', e => { /* only X closes */ });
      $('#cdown-save').addEventListener('click', () => this.save());
      // Date wrapper click → toggle calendar
      this.dateWrap.addEventListener('click', e => { e.stopPropagation(); this._toggleCalendar(); });
      // Calendar navigation
      $('#cdown-prev-month').addEventListener('click', e => { e.stopPropagation(); this.calMonthIdx--; if(this.calMonthIdx<0){this.calMonthIdx=11;this.calYear--;} this._renderCalendar(); });
      $('#cdown-next-month').addEventListener('click', e => { e.stopPropagation(); this.calMonthIdx++; if(this.calMonthIdx>11){this.calMonthIdx=0;this.calYear++;} this._renderCalendar(); });
      // Close calendar on outside click
      document.addEventListener('click', e => { if(!this.calendar.contains(e.target)&&e.target!==this.dateWrap&&!this.dateWrap.contains(e.target)) this.calendar.classList.remove('show'); });
    },

    _renderPresets() {
      this.presetList.innerHTML = this.presets.map(p => `<div class="cdown-preset-item">${p.label}</div>`).join('');
      this.presetList.querySelectorAll('.cdown-preset-item').forEach(el => {
        el.addEventListener('click', () => {
          const p = this.presets.find(x => x.label === el.textContent);
          if (!p) return;
          const d = p.calc();
          this.data = {label: p.label, date: d.toISOString().slice(0,10)};
          this.labelInput.value = p.label;
          this.dateDisplay.textContent = this.data.date;
          this.calSelected = this.data.date;
          this.save();
          this.close();
        });
      });
    },

    open() {
      this.modal.classList.add('show');
      this.labelInput.value = this.data.label;
      this.dateDisplay.textContent = this.data.date;
      this.calSelected = this.data.date;
      const d = new Date(this.data.date + 'T00:00:00');
      if (!isNaN(d.getTime())) { this.calYear = d.getFullYear(); this.calMonthIdx = d.getMonth(); }
    },
    close() { this.modal.classList.remove('show'); this.calendar.classList.remove('show'); },

    _toggleCalendar() {
      const show = !this.calendar.classList.contains('show');
      this.calendar.classList.toggle('show', show);
      if (show) this._renderCalendar();
    },

    _renderCalendar() {
      this.calMonth.textContent = `${this.calYear}年 ${this.calMonthIdx + 1}月`;
      const firstDay = new Date(this.calYear, this.calMonthIdx, 1).getDay();
      const daysInMonth = new Date(this.calYear, this.calMonthIdx + 1, 0).getDate();
      const prevDays = new Date(this.calYear, this.calMonthIdx, 0).getDate();
      const today = new Date(); today.setHours(0,0,0,0);
      let html = '';

      // Previous month days
      for (let i = firstDay - 1; i >= 0; i--) {
        html += `<div class="cdown-cal-day other-month" data-date="${this.calYear}-${String(this.calMonthIdx).padStart(2,'0')}-${String(prevDays - i).padStart(2,'0')}">${prevDays - i}</div>`;
      }
      // Current month days
      for (let d = 1; d <= daysInMonth; d++) {
        const ds = `${this.calYear}-${String(this.calMonthIdx+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        let cls = '';
        const cd = new Date(this.calYear, this.calMonthIdx, d);
        if (cd.getTime() === today.getTime()) cls += ' today';
        if (ds === this.calSelected) cls += ' selected';
        html += `<div class="cdown-cal-day${cls}" data-date="${ds}">${d}</div>`;
      }
      // Next month days
      const remaining = 42 - firstDay - daysInMonth;
      for (let d = 1; d <= remaining; d++) {
        html += `<div class="cdown-cal-day other-month">${d}</div>`;
      }

      this.calDays.innerHTML = html;
      this.calDays.querySelectorAll('.cdown-cal-day:not(.other-month)').forEach(el => {
        el.addEventListener('click', e => {
          e.stopPropagation();
          this.calSelected = el.dataset.date;
          this.data.date = this.calSelected;
          this.dateDisplay.textContent = this.calSelected;
          this._renderCalendar();
          this.calendar.classList.remove('show');
        });
      });
    },

    async save() {
      const label = this.labelInput.value.trim() || this.data.label || '事件';
      const date = this.calSelected || this.data.date;
      if (!date) { showToast('请选择日期'); return; }
      this.data = {label, date};
      this._updateDisplay();
      await post('/api/save_countdown', {label, date});
      this.close();
      showToast('✅ 倒数日已保存');
    },

    _updateDisplay() {
      if (!this.data.date) { this.daysEl.textContent = '--'; return; }
      const now = new Date(); now.setHours(0,0,0,0);
      let target = new Date(this.data.date + 'T00:00:00');
      if (isNaN(target.getTime())) { this.daysEl.textContent = '--'; return; }
      // Auto-advance for yearly presets
      const preset = this.presets.find(p => p.label === this.data.label);
      if (target < now) {
        if (preset) {
          // Yearly holiday: advance to next year
          target = preset.calc();
        } else {
          // Check if label looks like a weekday
          const weekdays = ['周一','周二','周三','周四','周五','周六','周日','星期一','星期二','星期三','星期四','星期五','星期六','星期日','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
          if (weekdays.includes(this.data.label)) {
            // Weekly: advance by 7 days
            target = new Date(target.getTime() + 7 * 86400000);
          } else {
            // Custom: advance by same interval
            const oldTarget = new Date(this.data.date + 'T00:00:00');
            const interval = Math.max(1, Math.round((now - oldTarget) / 86400000));
            target = new Date(target.getTime() + interval * 86400000);
          }
        }
        this.data.date = target.toISOString().slice(0,10);
        post('/api/save_countdown', {label: this.data.label, date: this.data.date});
        showToast(`📅 ${this.data.label} 已自动更新`);
      }
      const diff = Math.ceil((target - now) / 86400000);
      this.daysEl.textContent = Math.max(0, diff);
      this.labelEl.textContent = this.data.label;
    },
  };

  // ═══════════════════════════════════════════
  //  MODULE: Theme
  // ═══════════════════════════════════════════
  const Theme = {
    btn:$('#btn-theme'),btnBg:$('#btn-bg'),bgUpload:$('#bg-upload'),bgMedia:$('#bg-media'),bgLayer:$('#bg-layer'),bgDimmer:$('#bg-dimmer'),
    init(){
      const s=localStorage.getItem('stopwatch-theme')||'dark';document.body.setAttribute('data-theme',s);this.btn.textContent=s==='dark'?'☀️':'🌙';
      this.btn.addEventListener('click',()=>this.toggle()); this.btnBg.addEventListener('click',()=>this.bgUpload.click());
      this.bgUpload.addEventListener('change',e=>{if(e.target.files[0])this.setBg(e.target.files[0]);this.bgUpload.value='';});
    },
    toggle(){const n=document.body.getAttribute('data-theme')==='dark'?'light':'dark';document.body.setAttribute('data-theme',n);this.btn.textContent=n==='dark'?'☀️':'🌙';localStorage.setItem('stopwatch-theme',n);},
    setBg(file){
      const url=URL.createObjectURL(file);
      if(file.type.startsWith('video/')){this.bgMedia.src=url;this.bgMedia.style.display='';this.bgMedia.classList.add('active');this.bgMedia.play().catch(()=>{});const img=document.getElementById('bg-image');if(img)img.style.display='none';this.bgLayer.style.backgroundImage='';}
      else{this.bgMedia.pause();this.bgMedia.style.display='none';this.bgMedia.classList.remove('active');let img=document.getElementById('bg-image');if(!img){img=document.createElement('img');img.id='bg-image';img.style.cssText='position:fixed;inset:0;z-index:-1;object-fit:cover;width:100%;height:100%;pointer-events:none;';document.body.insertBefore(img,this.bgMedia);}img.src=url;img.style.display='';this.bgLayer.style.backgroundImage='';}
      this.bgLayer.style.backgroundColor='transparent';this.bgDimmer.classList.add('active');showToast('✅ 背景已更新');
    },
  };

  // ═══════════════════════════════════════════
  //  MODULE: Player
  // ═══════════════════════════════════════════
  const Player = {
    playlist:[],currentTrack:-1,isPlaying:false,currentUrl:null,_pendingPlay:false,_db:null,_switching:false,
    audio:$('#audio-player'),btnPlay:$('#btn-play'),btnPrev:$('#btn-prev'),btnNext:$('#btn-next'),btnImport:$('#btn-import'),
    songTitle:$('#song-title'),songArtist:$('#song-artist'),timeCur:$('#time-current'),timeTotal:$('#time-total'),
    progressBar:$('#progress-bar'),progressFill:$('#progress-fill'),
    volSlider:$('#volume-slider'),volIcon:$('#vol-icon'),volPopup:$('#vol-popup'),volNum:$('#vol-num'),
    plBtn:$('#btn-playlist'),plDropdown:$('#playlist-dropdown'),plList:$('#playlist-list'),plCount:$('#pl-count'),btnRefresh:$('#pl-refresh'),

    init(){
      this.audio.volume=0.7;
      this.btnPlay.addEventListener('click',()=>this.playPause()); this.btnNext.addEventListener('click',()=>this.next()); this.btnPrev.addEventListener('click',()=>this.prev());
      this.btnImport.addEventListener('click',()=>this._importFromPython());
      $('#music-upload').addEventListener('change',e=>{if(e.target.files.length)this.importFiles(e.target.files);e.target.value='';});
      this.plBtn.addEventListener('click',e=>{e.stopPropagation();this.plDropdown.classList.toggle('open');});
      $('#pl-close').addEventListener('click',()=>this.plDropdown.classList.remove('open'));
      this.btnRefresh.addEventListener('click',()=>this._refreshPlaylist());
      this.progressBar.addEventListener('click',e=>{if(!this.audio.duration)return;const r=this.progressBar.getBoundingClientRect();this.audio.currentTime=((e.clientX-r.left)/r.width)*this.audio.duration;});
      this.volSlider.addEventListener('input',()=>this._setVol(this.volSlider.value/100));
      this.volIcon.addEventListener('click',e=>{e.stopPropagation();this.volPopup.classList.toggle('show');});
      this.audio.addEventListener('loadedmetadata',()=>{this.timeTotal.textContent=fmtTimeShort(this.audio.duration||0);});
      this.audio.addEventListener('timeupdate',()=>{this.progressFill.style.width=this.audio.duration?(this.audio.currentTime/this.audio.duration*100)+'%':'0%';this.timeCur.textContent=fmtTimeShort(this.audio.currentTime);});
      this.audio.addEventListener('play',()=>{this.isPlaying=true;this.btnPlay.textContent='⏸';});
      this.audio.addEventListener('pause',()=>{this.isPlaying=false;this.btnPlay.textContent='▶';});
      this.audio.addEventListener('ended',()=>this.next());
      // 修复: 出错时移除坏轨道,不调用 next()(旧代码 next 会改 currentTrack 导致 splice 乱序)
      this.audio.addEventListener('error',()=>{if(this._switching)return;showToast('⚠️ 无法播放该文件');const b=this.currentTrack;if(b<0)return;if(this.currentUrl){URL.revokeObjectURL(this.currentUrl);this.currentUrl=null;}const trk=this.playlist[b];this.playlist.splice(b,1);if(trk&&trk.id){if(trk.source==='disk'){api('delete_music',trk.id).catch(()=>{});}else{this._getDb().then(db=>{const tx=db.transaction('songs','readwrite');tx.objectStore('songs').delete(trk.id);}).catch(()=>{});}}if(!this.playlist.length){this.currentTrack=-1;this.songTitle.textContent='未加载歌曲';this.songArtist.textContent='';this._render();return;}this._pendingPlay=this.isPlaying;this._loadTrack(b>=this.playlist.length?0:b);this._render();});
      // 事件委托: 一个监听器代替 N×2 个,500 首歌不再创建 1000 个 listener
      this.plList.addEventListener('click',e=>{const del=e.target.closest('.pl-del');if(del){e.stopPropagation();this._deleteTrack(parseInt(del.dataset.idx));return;}const item=e.target.closest('.pl-item');if(item){const i=parseInt(item.dataset.idx);this._pendingPlay=this.isPlaying;this._loadTrack(i);}});
      setTimeout(()=>this._loadSaved(),100);
    },

    // DB 连接缓存 + v2→v3 迁移 (keyPath name→id autoIncrement)
    _getDb(){return new Promise((resolve,reject)=>{if(this._db){resolve(this._db);return;}const req=indexedDB.open('stopwatch-audio',3);req.onupgradeneeded=e=>{const db=req.result;if(!db.objectStoreNames.contains('songs')){db.createObjectStore('songs',{keyPath:'id',autoIncrement:true});}else if(e.oldVersion<3){const oldStore=e.target.transaction.objectStore('songs');const allReq=oldStore.getAll();allReq.onsuccess=()=>{const old=allReq.result||[];db.deleteObjectStore('songs');const ns=db.createObjectStore('songs',{keyPath:'id',autoIncrement:true});old.forEach(item=>{if(item.blob)ns.put({name:item.name||'unknown',blob:item.blob});});};}};req.onsuccess=()=>{this._db=req.result;resolve(req.result);};req.onerror=()=>reject(req.error);req.onblocked=()=>console.warn('IDB blocked: close other tabs');});},
    // 按需加载单首歌曲的 blob
    _getBlob(id){return this._getDb().then(db=>new Promise((resolve,reject)=>{const tx=db.transaction('songs','readonly');const req=tx.objectStore('songs').get(id);req.onsuccess=()=>resolve(req.result?req.result.blob:null);req.onerror=()=>reject(req.error);}));},

    playPause(){if(!this.playlist.length){showToast('请先导入歌曲');return;}if(this.currentTrack<0){this._pendingPlay=true;this._loadTrack(0);return;}if(this.isPlaying)this.audio.pause();else this.audio.play().catch(()=>showToast('⚠️ 播放失败'));},
    next(){if(this.playlist.length){this._pendingPlay=this.isPlaying;this._loadTrack((this.currentTrack+1)%this.playlist.length);}},
    prev(){if(this.playlist.length){this._pendingPlay=this.isPlaying;this._loadTrack((this.currentTrack-1+this.playlist.length)%this.playlist.length);}},

    // 纯磁盘存储: HTTP 上传到 Python 后端, 不经过 pywebview bridge / IDB, 避免内存暴涨
    async importFiles(files){
      if(!files||!files.length){showToast('未选择文件');return;}
      const filtered=[];
      for(const f of files){
        const isAudio=f.type.startsWith('audio/')||/\.(mp3|wav|flac|ogg|m4a|aac|wma)$/i.test(f.name);
        if(!isAudio){showToast(`⏭️ ${f.name} 不是音频文件`);continue;}
        const name=f.name.replace(/\.[^.]+$/,'');
        const ext=(f.name.match(/\.[^.]+$/)||['.mp3'])[0];
        let ok=false;
        // 1) 优先 HTTP 上传 (无 base64 开销, 不经过 pywebview bridge)
        try{
          const resp=await fetch(`/api/upload_music?name=${encodeURIComponent(name)}&ext=${encodeURIComponent(ext)}`,{
            method:'POST', body:f
          });
          if(resp.ok){
            const s=await resp.json();
            if(s&&s.id){filtered.push({id:s.id,name:s.name,source:'disk'});ok=true;}
            else{showToast(`⚠️ ${name}: 服务器返回异常`);}
          }else{
            const txt=await resp.text().catch(()=>'');
            showToast(`⚠️ ${name}: HTTP ${resp.status} ${txt.slice(0,80)}`);
          }
        }catch(e){
          showToast(`⚠️ ${name}: 上传失败 ${e.message||e}`);
          console.error('upload_music',e);
        }
        // 2) 兜底: base64 经 pywebview bridge (小文件可用)
        if(!ok&&window.pywebview&&window.pywebview.api){
          try{
            const b64=await new Promise((res,rej)=>{
              const r=new FileReader();
              r.onload=()=>res(r.result.split(',')[1]);
              r.onerror=rej;
              r.readAsDataURL(f);
            });
            const s=await api('import_music_base64',name,b64,ext);
            if(s&&s.id){filtered.push({id:s.id,name:s.name,source:'disk'});ok=true;}
          }catch(e){console.error('import_music_base64 fallback',e);}
        }
        if(!ok) showToast(`❌ ${name} 导入失败`);
      }
      if(!filtered.length){showToast('未找到音频文件');return;}
      for(const af of filtered){this.playlist.push({id:af.id,name:af.name,source:'disk'});}
      if(this.playlist.length&&this.currentTrack<0)this._loadTrack(0);
      this._render();
      showToast(`✅ 已导入 ${filtered.length} 首歌曲`);
    },

    // 通过 Python 文件对话框导入, 文件直接复制到磁盘, 不经过 JS/IDB 内存
    async _importFromPython(){
      let res;
      try{res=await api('import_music');}
      catch(e){console.error('import_music 异常:',e);showToast('❌ 打开文件对话框失败');return;}
      if(res===null||res===undefined){showToast('❌ 打开文件对话框失败');return;}
      if(!res.length){showToast('未选择音频文件');return;}
      for(const s of res){this.playlist.push({id:s.id,name:s.name,source:s.source||'disk'});}
      if(this.playlist.length&&this.currentTrack<0)this._loadTrack(0);
      this._render();
      showToast(`✅ 已导入 ${res.length} 首歌曲`);
    },

    async _loadTrack(idx){
      if(idx<0||idx>=this.playlist.length)return;
      this.currentTrack=idx;
      const t=this.playlist[idx];
      this.songTitle.textContent=t.name;this.songArtist.textContent='';this._render();
      this._switching=true;
      // 切歌时暂停避免中途触发 ended, 清空 src 释放旧资源
      this.audio.pause();
      if(this.currentUrl){URL.revokeObjectURL(this.currentUrl);this.currentUrl=null;}
      this.audio.removeAttribute('src');
      const shouldPlay=this._pendingPlay;this._pendingPlay=false;
      // 磁盘歌曲: 通过 Python HTTP 端点流式播放, 不加载完整 blob 到 JS 内存
      if(t.source==='disk'){
        this.audio.src='/api/stream_music?id='+t.id;this.audio.load();this._switching=false;
        if(shouldPlay)this.audio.play().catch(()=>{});return;
      }
      // 有 file 引用(刚导入未持久化) → 同步设置 src, 无需读 IDB
      if(t.file){this.currentUrl=URL.createObjectURL(t.file);this.audio.src=this.currentUrl;this.audio.load();this._switching=false;if(shouldPlay)this.audio.play().catch(()=>{});return;}
      // IDB 歌曲
      try{
        const blob=await this._getBlob(t.id);
        if(this.currentTrack!==idx){this._switching=false;return;}
        if(!blob){this._switching=false;showToast('⚠️ 无法加载歌曲');return;}
        this.currentUrl=URL.createObjectURL(blob);
        this.audio.src=this.currentUrl;this.audio.load();
        this._switching=false;
        if(shouldPlay)this.audio.play().catch(()=>{});
      }catch(e){this._switching=false;showToast('⚠️ 加载失败');}
    },
    _setVol(v){this.audio.volume=v;this.volSlider.value=Math.round(v*100);this.volNum.textContent=Math.round(v*100);this.volIcon.textContent=v===0?'🔇':v<0.5?'🔉':'🔊';},

    // 修复: 事件委托在 init 中注册,_render 只管 DOM。escapeHtml 防 XSS
    _render(){
      this.plCount.textContent=this.playlist.length;
      if(!this.playlist.length){this.plList.innerHTML='<div id="pl-empty">暂无歌曲，点击 📁 导入</div>';return;}
      this.plList.innerHTML=this.playlist.map((t,i)=>`<div class="pl-item${i===this.currentTrack?' active':''}" data-idx="${i}"><span class="pl-idx">${String(i+1).padStart(2,'0')}</span><span class="pl-name">${escapeHtml(t.name)}</span><span class="pl-del" data-idx="${i}">✕</span></div>`).join('');
    },

    // 修复: 删除单条 IDB 记录,不再 clear()+重存全部
    async _deleteTrack(i){
      if(i<0||i>=this.playlist.length)return;
      const track=this.playlist[i];
      if(i===this.currentTrack){this.audio.pause();this.audio.src='';this.currentTrack=-1;if(this.currentUrl){URL.revokeObjectURL(this.currentUrl);this.currentUrl=null;}}
      if(i<this.currentTrack)this.currentTrack--;
      this.playlist.splice(i,1);
      if(!this.playlist.length){this.currentTrack=-1;this.songTitle.textContent='未加载歌曲';this.songArtist.textContent='';}
      if(track&&track.id){
        if(track.source==='disk'){try{await api('delete_music',track.id);}catch(e){}}
        else{try{const db=await this._getDb();const tx=db.transaction('songs','readwrite');tx.objectStore('songs').delete(track.id);}catch(e){}}
      }
      this._render();
    },

    // 修复: 优先加载磁盘歌曲(流式,不占内存); IDB 作为浏览器/旧数据回退
    // 启动时先 rescan 把孤儿文件重新注册, 再读取列表
    async _loadSaved(){
      this.playlist=[];
      // 1) 先 rescan 孤儿文件 (旧版本升级/表丢失的兜底)
      try{
        const disk=await api('rescan_music');
        if(disk&&disk.length){this.playlist.push(...disk.map(s=>({id:s.id,name:s.name,source:'disk'})));}
      }catch(e){console.error('Player rescan_music:',e);}
      // 2) IDB 旧歌曲
      try{
        const db=await this._getDb();
        const tx=db.transaction('songs','readonly');
        const req=tx.objectStore('songs').openCursor();
        const items=[];
        req.onsuccess=()=>{
          const cursor=req.result;
          if(cursor){items.push({id:cursor.primaryKey,name:cursor.value.name,source:'idb'});cursor.continue();}
          else{
            if(items.length){this.playlist.push(...items);}
            if(this.playlist.length){this._render();this._loadTrack(0);showToast(`🎵 已恢复 ${this.playlist.length} 首歌曲`);}
            else{this._render();}
          }
        };
      }catch(e){console.error('Player loadSaved:',e);if(this.playlist.length){this._render();this._loadTrack(0);}}
    },

    async _refreshPlaylist(){
      this.playlist=[];
      this.currentTrack=-1;
      this.audio.pause();this.audio.src='';
      if(this.currentUrl){URL.revokeObjectURL(this.currentUrl);this.currentUrl=null;}
      this.songTitle.textContent='未加载歌曲';this.songArtist.textContent='';
      try{
        const disk=await api('rescan_music');
        if(disk&&disk.length){this.playlist.push(...disk.map(s=>({id:s.id,name:s.name,source:'disk'})));}
      }catch(e){console.error('Player refresh:',e);}
      this._render();
      if(this.playlist.length){this._loadTrack(0);showToast(`🎵 已刷新 ${this.playlist.length} 首歌曲`);}
      else{showToast('🎵 歌单已清空');}
    },
  };

  // ═══════════════════════════════════════════
  //  MODULE: Pomodoro
  // ═══════════════════════════════════════════
  const Pomodoro = {
    overlay:$('#pomodoro-overlay'),presetList:$('#preset-list'),historyEl:$('#history-list'),
    defaults:[{id:0,name:'🍅 专注工作',icon:'🍅',minutes:25},{id:0,name:'☕ 放松时刻',icon:'☕',minutes:15},{id:0,name:'💻 代码模式',icon:'💻',minutes:45},{id:0,name:'📖 阅读时间',icon:'📖',minutes:30},{id:0,name:'🧘 冥想',icon:'🧘',minutes:10},{id:0,name:'🏃 运动',icon:'🏃',minutes:20}],

    async open(){this.overlay.classList.add('show');await this._loadPresets();const tab=document.querySelector('.pomodoro-tab[data-tab="presets"]');if(tab)tab.click();},

    async _loadPresets() {
      const presets = [...this.defaults];
      // Load from SQLite
      try {
        const dbRaw = await post('/api/get_presets');
        if (dbRaw) {
          const db = typeof dbRaw === 'string' ? JSON.parse(dbRaw) : dbRaw;
          if (Array.isArray(db) && db.length > 0) {
            const dbMap = {};
            db.forEach(p => { dbMap[p.name] = p; });
            for (let i = 0; i < presets.length; i++) {
              if (dbMap[presets[i].name]) { presets[i] = dbMap[presets[i].name]; delete dbMap[presets[i].name]; }
            }
            Object.values(dbMap).forEach(p => presets.push(p));
          }
        }
      } catch(e) {}

      // Render
      this.presetList.innerHTML = presets.map(p => `
        <div class="preset-card" data-minutes="${p.minutes}" data-name="${escapeHtml(p.name||'')}">
          <span class="preset-icon">${p.icon||'⏰'}</span>
          <span class="preset-name">${(p.name||'').replace(/^[^ ]+ /,'')}</span>
          <span class="preset-time">${p.minutes||25} 分钟</span>
          ${p.id && p.id !== 0 ? `<span class="preset-del" data-id="${p.id}">✕</span>` : ''}
        </div>
      `).join('');

      // Bind events
      this.presetList.querySelectorAll('.preset-card').forEach(card => {
        card.addEventListener('click', e => {
          if (e.target.classList.contains('preset-del')) return;
          this._start(parseInt(card.dataset.minutes) || 25, card.dataset.name || '');
        });
      });
      this.presetList.querySelectorAll('.preset-del').forEach(del => {
        del.addEventListener('click', async e => {
          e.stopPropagation();
          await post('/api/delete_preset', {id: parseInt(del.dataset.id)});
          this._loadPresets();
        });
      });
    },

    _start(minutes,name){
      this.overlay.classList.remove('show'); Timer.mode='pomodoro'; Timer.pomodoroName=name;
      UI.modeTabs.forEach(t=>t.classList.remove('active')); const t=document.querySelector('[data-mode="pomodoro"]'); if(t)t.classList.add('active');
      Timer.countdownTotal=minutes*60*1000; Timer.elapsedBefore=Timer.countdownTotal;
      UI.timerPanel.classList.add('countdown-mode'); UI.updateDisplay(Timer.countdownTotal);
      UI.timerPanel.classList.remove('running','countdown-active','finished'); UI.btnStart.textContent='▶ 开始'; UI.btnStart.classList.remove('running'); UI.btnLap.disabled=true;
      showToast(`${name} · ${minutes} 分钟`); post('/api/record_pomodoro', {name:name, minutes:minutes, completed:false});
      Timer.start();
    },

    async _loadHistory(){
      let rows=await post('/api/get_history', {limit:50});
      if(!rows||!rows.length){this.historyEl.innerHTML='<div style="text-align:center;padding:1rem;color:var(--text-muted);">暂无历史记录</div>';return;}
      this.historyEl.innerHTML=rows.map(r=>{const dt=new Date(r.started_at+'Z');return`<div class="history-item"><span class="h-icon">${r.completed?'✅':'⏹'}</span><span class="h-name">${r.preset_name}</span><span class="h-time">${r.minutes}分</span><span>${dt.toLocaleString('zh-CN',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}</span><span class="${r.completed?'h-done':'h-undone'}">${r.completed?'完成':'未完成'}</span></div>`;}).join('');
    },

    async _loadStats(){
      const canvas=$('#stats-canvas'),ctx=canvas.getContext('2d'),summary=$('#stats-summary');
      let data=await post('/api/get_stats', {days:14}); if(!data) data=[];
      if(!data.length){summary.innerHTML='暂无专注记录';ctx.clearRect(0,0,canvas.width,canvas.height);ctx.fillStyle=getComputedStyle(document.body).getPropertyValue('--text-muted');ctx.font='14px Inter,sans-serif';ctx.textAlign='center';ctx.fillText('暂无数据',canvas.width/2,canvas.height/2);return;}
      const max=Math.max(...data.map(d=>d.minutes),1),total=data.reduce((s,d)=>s+d.minutes,0),isDark=document.body.getAttribute('data-theme')==='dark',barW=(canvas.width-80)/data.length-4;
      ctx.clearRect(0,0,canvas.width,canvas.height);
      for(let i=0;i<=4;i++){const y=40+(canvas.height-60)*(i/4);ctx.beginPath();ctx.strokeStyle=isDark?'rgba(255,255,255,0.08)':'rgba(0,0,0,0.08)';ctx.moveTo(50,y);ctx.lineTo(canvas.width-20,y);ctx.stroke();ctx.fillStyle=isDark?'#f0f0f5':'#1a1a2e';ctx.font='10px JetBrains Mono';ctx.textAlign='right';ctx.fillText(Math.round(max*(1-i/4))+'分',46,y+4);}
      data.forEach((d,i)=>{const x=60+i*((canvas.width-80)/data.length),h=((canvas.height-60)*d.minutes)/max,y=canvas.height-20-h;const g=ctx.createLinearGradient(x,y,x,canvas.height-20);g.addColorStop(0,'#7c6ff7');g.addColorStop(1,'#7c6ff744');ctx.fillStyle=g;ctx.beginPath();ctx.roundRect(x,y,barW,h,[4,4,0,0]);ctx.fill();if(d.minutes>0){ctx.fillStyle=isDark?'#f0f0f5':'#1a1a2e';ctx.font='bold 9px JetBrains Mono';ctx.textAlign='center';ctx.fillText(d.minutes+'′',x+barW/2,y-4);}ctx.fillStyle=(isDark?'#f0f0f5':'#1a1a2e')+'88';ctx.font='9px Inter';ctx.textAlign='center';ctx.fillText(d.day.slice(5),x+barW/2,canvas.height-4);});
      summary.innerHTML=`近 14 天累计专注 <strong>${total} 分钟</strong>（${Math.round(total/60)} 小时）`;
    },
  };

  // ═══════════════════════════════════════════
  //  MODULE: Settings
  // ═══════════════════════════════════════════
  const Settings = {
    overlay:$('#settings-overlay'), sidebar:$('#settings-sidebar'), panels:$('#settings-panels'),
    fonts: [
      {name:'系统默认', family:'Inter, "Microsoft YaHei", sans-serif', preview:'ABCabc 你好世界 — The quick brown fox'},
      {name:'微软雅黑', family:'"Microsoft YaHei", sans-serif', preview:'ABCabc 你好世界 — 微软雅黑'},
      {name:'幼圆', family:'YouYuan, "Yuanti SC", sans-serif', preview:'ABCabc 你好世界 — 幼圆字体'},
      {name:'楷体', family:'KaiTi, STKaiti, serif', preview:'ABCabc 你好世界 — 楷体字体'},
      {name:'Comic Sans', family:'"Comic Sans MS", cursive', preview:'ABCabc Hello — Comic Sans MS'},
      {name:'Consolas', family:'Consolas, "Courier New", monospace', preview:'ABCabc 123 — Consolas Mono'},
    ],

    init() {
      $('#btn-settings').addEventListener('click', () => this.open());
      $('#settings-close').addEventListener('click', () => { this._discard(); this.close(); });
      $('#settings-confirm').addEventListener('click', () => { this._apply(); this.close(); });
      // Sidebar navigation
      this.sidebar.querySelectorAll('.settings-nav').forEach(nav => {
        nav.addEventListener('click', () => {
          this.sidebar.querySelectorAll('.settings-nav').forEach(n => n.classList.remove('active'));
          nav.classList.add('active');
          this.panels.querySelectorAll('.settings-panel').forEach(p => p.classList.remove('active'));
          const panel = document.getElementById('panel-' + nav.dataset.panel);
          if (panel) panel.classList.add('active');
        });
      });
      // Load saved font
      const saved = localStorage.getItem('stopwatch-font');
      if (saved) {
        document.body.style.fontFamily = saved;
        document.documentElement.style.setProperty('--font-mono', saved);
        document.documentElement.style.setProperty('--font-body', saved);
      }
      this._renderFonts();
      this._renderAbout();
      this._renderClockStyles();
    },
    _renderClockStyles() {
      // Animation styles — click updates UI only, 确定 commits
      const styleOpts = $$('#clock-style-opts .clock-style-opt');
      this._updateClockStyleUI = (style) => {
        styleOpts.forEach(o => o.classList.toggle('active', o.dataset.style === style));
      };
      styleOpts.forEach(o => {
        o.addEventListener('click', () => {
          this._pendingStyle = o.dataset.style;
          this._updateClockStyleUI(this._pendingStyle);
        });
      });
      // Date formats — click updates UI only, 确定 commits
      const dateOpts = $$('#clock-datefmts .clock-style-opt');
      this._updateDateFmtUI = (fmt) => {
        dateOpts.forEach(o => o.classList.toggle('active', o.dataset.fmt === fmt));
      };
      dateOpts.forEach(o => {
        o.addEventListener('click', () => {
          this._pendingDate = o.dataset.fmt;
          this._updateDateFmtUI(this._pendingDate);
        });
      });
    },

    _renderAbout() {
      const aboutContent = $('#about-content');
      // Default (offline fallback)
      let version = '3.0';
      let changelog = [
        {v:'3.0', text:'全新注册登录系统：支持多账户记忆、密码修改、首次引导与聚光式功能教学'},
        {v:'2.3', text:'正式更名「须臾」——取佛经"极短时间单位"之意，愿君惜取片刻光阴'},
        {v:'2.2', text:'关于页面支持动态更新，应用有了专属图标，弹窗不会再误触关闭'},
        {v:'2.1', text:'可以在设置里切换字体了，倒数日支持节日预设和自定义日历，日期过了自动跳到下一次'},
        {v:'2.0', text:'番茄钟可以自定义预设了，还能看每日专注统计。新增禅模式白噪音和倒计时呼吸灯提醒'},
        {v:'1.0', text:'首个桌面版本，支持计时、倒计时、音乐播放、自定义壁纸和深浅色主题'},
        {v:'0.1', text:'最初的样子，一个简单的网页秒表'},
      ];
      // Try to fetch live version from Python API
      post('/api/version').then(data => {
        if (data && data.version) {
          version = data.version;
          changelog = data.changelog;
        }
        aboutContent.innerHTML = `
          <div class="about-logo">⏱</div>
          <div class="about-name">须臾</div>
          <div class="about-version">Version ${version}</div>
          <div class="about-desc">一款集正计时、倒计时、番茄钟、白噪音、音乐播放、壁纸切换于一体的多功能桌面计时应用。</div>
          <div class="about-meta">
            <div class="about-meta-item"><div class="label">架构</div><div class="value">pywebview + SQLite</div></div>
            <div class="about-meta-item"><div class="label">引擎</div><div class="value">Edge WebView2</div></div>
            <div class="about-meta-item"><div class="label">Python</div><div class="value">3.11</div></div>
            <div class="about-meta-item"><div class="label">打包</div><div class="value">PyInstaller</div></div>
          </div>
          <div class="about-changelog">
            ${changelog.map(c => `<strong>V${c.v}</strong> — ${c.text}<br>`).join('')}
          </div>
          <div class="about-author">
            <div class="about-author-title">🧑‍💻 关于作者</div>
            <a class="about-bili" href="https://space.bilibili.com/8523024" target="_blank">
              <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M17.8 4.5c-1.4-.4-2.8-.4-4.2-.2-1.1.1-2.1.4-3 .8-.7.3-1.4.7-2 1.2-.5.4-.9.9-1.2 1.5-.3.6-.5 1.2-.5 1.9 0 .6.2 1.2.5 1.7.3.5.7.9 1.2 1.3.5.3 1 .6 1.6.8.6.2 1.2.3 1.9.3.7 0 1.3-.1 1.9-.3.6-.2 1.2-.5 1.6-.8.5-.3.9-.8 1.2-1.3.3-.5.5-1.1.5-1.7 0-.7-.2-1.3-.5-1.9-.3-.6-.7-1.1-1.2-1.5-.4-.4-1-.7-1.5-1-.6-.2-1.3-.4-2-.5zM9.8 11.5c-.4 0-.7.3-.7.7v3.6c0 .4.3.7.7.7s.7-.3.7-.7v-3.6c0-.4-.3-.7-.7-.7zm2.2 0c-.4 0-.7.3-.7.7v3.6c0 .4.3.7.7.7s.7-.3.7-.7v-3.6c0-.4-.3-.7-.7-.7zm2.2 0c-.4 0-.7.3-.7.7v3.6c0 .4.3.7.7.7s.7-.3.7-.7v-3.6c0-.4-.3-.7-.7-.7z"/></svg>
              哔哩哔哩主页
            </a>
          </div>
          <div class="about-donate">
            <button class="about-donate-btn" id="donate-btn">💰 投喂作者</button>
          </div>
          <div id="donate-modal" style="display:none;position:fixed;inset:0;z-index:500;background:rgba(0,0,0,0.6);align-items:center;justify-content:center;" onclick="this.style.display='none'">
            <img src="投喂作者.jpg" alt="支付宝扫码" style="max-width:320px;max-height:80vh;border-radius:12px;cursor:pointer;box-shadow:0 8px 40px rgba(0,0,0,0.4);" onclick="event.stopPropagation();window.open('https://qr.alipay.com/','_blank')">
          </div>
        `;
        // Bind donate button
        const dbtn = document.getElementById('donate-btn');
        if (dbtn) dbtn.addEventListener('click', () => {
          document.getElementById('donate-modal').style.display = 'flex';
        });
      });
    },

    _renderFonts() {
      const currentFont = document.body.style.fontFamily || getComputedStyle(document.body).fontFamily || '';
      const list = $('#font-list');
      this._rebuildFontList = (selectedFamily) => {
        const selKey = (selectedFamily || '').split(',')[0].replace(/"/g,'').trim().toLowerCase();
        list.innerHTML = this.fonts.map(f => {
          const fKey = f.family.split(',')[0].replace(/"/g,'').trim().toLowerCase();
          const sel = selKey === fKey;
          return `<div class="font-option${sel?' selected':''}" data-family="${f.family.replace(/"/g,'&quot;')}" style="font-family:${f.family}">
            <strong>${f.name}</strong>
            <span class="font-preview" style="font-family:${f.family}">${f.preview}</span>
          </div>`;
        }).join('');
        list.querySelectorAll('.font-option').forEach(opt => {
          opt.addEventListener('click', () => {
            this._pendingFont = opt.dataset.family.replace(/&quot;/g,'"');
            this._rebuildFontList(this._pendingFont);
          });
        });
      };
      // Initial render
      this._rebuildFontList(currentFont);
    },

    open() {
      // Snapshot current settings into pending state
      this._savedStyle = Clock.style || localStorage.getItem('clock-style') || 'flip';
      this._savedDate = localStorage.getItem('clock-datefmt') || 'chinese';
      const savedFont = localStorage.getItem('stopwatch-font') || '';
      const currentFont = document.body.style.fontFamily || getComputedStyle(document.body).fontFamily || '';
      this._savedFont = savedFont || currentFont;
      this._pendingStyle = this._savedStyle;
      this._pendingDate = this._savedDate;
      this._pendingFont = this._savedFont;
      // Update UI to reflect saved state
      if (this._updateClockStyleUI) this._updateClockStyleUI(this._savedStyle);
      if (this._updateDateFmtUI) this._updateDateFmtUI(this._savedDate);
      if (this._rebuildFontList) this._rebuildFontList(this._savedFont);
      this.overlay.classList.add('show');
    },

    _apply() {
      // Commit pending changes to localStorage and live state
      if (this._pendingStyle !== this._savedStyle) {
        Clock.style = this._pendingStyle;
        localStorage.setItem('clock-style', this._pendingStyle);
      }
      if (this._pendingDate !== this._savedDate) {
        localStorage.setItem('clock-datefmt', this._pendingDate);
      }
      if (this._pendingFont !== this._savedFont) {
        try {
          document.body.style.fontFamily = this._pendingFont;
          document.documentElement.style.setProperty('--font-mono', this._pendingFont);
          document.documentElement.style.setProperty('--font-body', this._pendingFont);
          localStorage.setItem('stopwatch-font', this._pendingFont);
        } catch(e) {}
      }
    },

    _discard() {
      // Revert UI to saved state
      if (this._updateClockStyleUI) this._updateClockStyleUI(this._savedStyle);
      if (this._updateDateFmtUI) this._updateDateFmtUI(this._savedDate);
      if (this._rebuildFontList) this._rebuildFontList(this._savedFont);
    },

    close() { this.overlay.classList.remove('show'); },
  };

  // ── Account section ───────────────────────
  const Account = {
    init() {
      $('#acct-save-btn').addEventListener('click', async () => {
        const oldPw = $('#acct-old-pw').value;
        const newPw = $('#acct-new-pw').value;
        const newPw2 = $('#acct-new-pw2').value;
        const err = $('#acct-error');
        err.textContent = ''; err.style.color = '#ff6b6b';
        if (!oldPw || !newPw || !newPw2) { err.textContent = '请填写所有字段'; return; }
        if (newPw.length < 7) { err.textContent = '新密码需 >6 位'; return; }
        if (newPw !== newPw2) { err.textContent = '两次密码不一致'; return; }
        const token = localStorage.getItem('auth_token');
        const r = await fetch('/api/change_password', {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
          body: JSON.stringify({ oldPassword: oldPw, newPassword: newPw })
        }).then(r => r.json());
        if (r.ok) {
          err.style.color = '#4caf50'; err.textContent = '✅ 密码已修改，即将返回登录页...';
          setTimeout(() => {
            localStorage.removeItem('auth_token');
            window.location.href = 'login.html';
          }, 1000);
        } else {
          err.textContent = r.error || '修改失败';
        }
      });
    }
  };

  // ═══════════════════════════════════════════
  //  MODULE: Clock
  // ═══════════════════════════════════════════
  const Clock = {
    init() {
      $('#btn-clock').addEventListener('click', ()=>window.location.href='clock.html');
    }
  };

  // ═══════════════════════════════════════════
  //  MODULE: Zen
  // ═══════════════════════════════════════════
  const Zen = {
    enabled:false,selectedSound:null,selectedMinutes:25,currentSound:null,audioCtx:null,gainNode:null,sourceNodes:[],
    overlay:$('#zen-overlay'),step1:$('#zen-step1'),step2:$('#zen-step2'),grid:$('#zen-sound-grid'),timerPresets:$('#zen-timer-presets'),
    presets:[{id:'rain',icon:'🌧️',name:'雨声'},{id:'ocean',icon:'🌊',name:'海浪'},{id:'stream',icon:'🏞️',name:'溪流'},{id:'fire',icon:'🔥',name:'篝火'},{id:'wind',icon:'🍃',name:'风声'},{id:'brown',icon:'🌑',name:'棕噪音'},{id:'pink',icon:'🌫️',name:'粉噪音'},{id:'bowl',icon:'🪷',name:'梵音钵'}],
    _ctx(){if(!this.audioCtx){this.audioCtx=new(window.AudioContext||window.webkitAudioContext)();this.gainNode=this.audioCtx.createGain();this.gainNode.gain.value=0;this.gainNode.connect(this.audioCtx.destination);}if(this.audioCtx.state==='suspended')this.audioCtx.resume();return this.audioCtx;},
    _stopAll(){this.sourceNodes.forEach(n=>{try{n.stop();}catch(e){}});this.sourceNodes=[];},
    _noiseBuf(d=2){const c=this._ctx(),b=c.createBuffer(1,c.sampleRate*d,c.sampleRate),data=b.getChannelData(0);for(let i=0;i<data.length;i++)data[i]=Math.random()*2-1;return b;},
    _fadeTo(t){if(!this.gainNode)return;this.gainNode.gain.cancelScheduledValues(this._ctx().currentTime);this.gainNode.gain.setTargetAtTime(t,this._ctx().currentTime,0.5);},
    _start(id){this.currentSound=id;this._ctx().resume();if(this._players[id])this._players[id]();this._fadeTo(0.25);this.enabled=true;$('#btn-zen').classList.add('active');},
    _stop(){this._fadeTo(0);setTimeout(()=>{if(this.gainNode&&this.gainNode.gain.value<0.005)this._stopAll();},800);this.enabled=false;$('#btn-zen').classList.remove('active');},
    _players:{
      rain(){const z=Zen;z._stopAll();const c=z._ctx(),b=z._noiseBuf(4),s=c.createBufferSource();s.buffer=b;s.loop=true;const h=c.createBiquadFilter();h.type='highpass';h.frequency.value=2000;const l=c.createBiquadFilter();l.type='lowpass';l.frequency.value=8000;const m=c.createGain();m.gain.value=0.5;const o=c.createOscillator();o.frequency.value=0.3;const og=c.createGain();og.gain.value=0.3;o.connect(og).connect(m.gain);o.start();s.connect(h).connect(l).connect(m).connect(z.gainNode);s.start();z.sourceNodes.push(s,o);},
      ocean(){const z=Zen;z._stopAll();const c=z._ctx(),b=z._noiseBuf(8),s=c.createBufferSource();s.buffer=b;s.loop=true;const l=c.createBiquadFilter();l.type='lowpass';l.frequency.value=500;const w=c.createOscillator();w.frequency.value=0.12;const wg=c.createGain();wg.gain.value=0.8;const mg=c.createGain();mg.gain.value=0;w.connect(wg);wg.connect(mg.gain);s.connect(l).connect(mg).connect(z.gainNode);w.start();s.start();z.sourceNodes.push(s,w);},
      stream(){const z=Zen;z._stopAll();const c=z._ctx(),b=z._noiseBuf(3),s=c.createBufferSource();s.buffer=b;s.loop=true;const h=c.createBiquadFilter();h.type='highpass';h.frequency.value=1000;const l=c.createBiquadFilter();l.type='lowpass';l.frequency.value=6000;s.connect(h).connect(l).connect(z.gainNode);s.start();z.sourceNodes.push(s);},
      fire(){const z=Zen;z._stopAll();const c=z._ctx(),b=z._noiseBuf(2),s=c.createBufferSource();s.buffer=b;s.loop=true;const bp=c.createBiquadFilter();bp.type='bandpass';bp.frequency.value=400;bp.Q.value=0.5;const cg=c.createGain();cg.gain.value=0.15;const cl=c.createOscillator();cl.type='sawtooth';cl.frequency.value=15;const cm=c.createGain();cm.gain.value=0.5;cl.connect(cm).connect(cg.gain);cl.start();s.connect(bp).connect(cg).connect(z.gainNode);s.start();z.sourceNodes.push(s,cl);},
      wind(){const z=Zen;z._stopAll();const c=z._ctx(),b=z._noiseBuf(6),s=c.createBufferSource();s.buffer=b;s.loop=true;const l=c.createBiquadFilter();l.type='lowpass';l.frequency.value=400;const g=c.createOscillator();g.frequency.value=0.08;const gg=c.createGain();gg.gain.value=0.7;g.connect(gg);s.connect(l).connect(gg).connect(z.gainNode);g.start();s.start();z.sourceNodes.push(s,g);},
      brown(){const z=Zen;z._stopAll();const c=z._ctx(),b=z._noiseBuf(4),s=c.createBufferSource();s.buffer=b;s.loop=true;const l1=c.createBiquadFilter();l1.type='lowpass';l1.frequency.value=200;l1.Q.value=0.7;const l2=c.createBiquadFilter();l2.type='lowpass';l2.frequency.value=200;l2.Q.value=0.7;s.connect(l1).connect(l2).connect(z.gainNode);s.start();z.sourceNodes.push(s);},
      pink(){const z=Zen;z._stopAll();const c=z._ctx(),b=z._noiseBuf(4),s=c.createBufferSource();s.buffer=b;s.loop=true;const l=c.createBiquadFilter();l.type='lowpass';l.frequency.value=3000;const sh=c.createBiquadFilter();sh.type='lowshelf';sh.frequency.value=500;sh.gain.value=3;s.connect(l).connect(sh).connect(z.gainNode);s.start();z.sourceNodes.push(s);},
      bowl(){const z=Zen;z._stopAll();const c=z._ctx();[130.8,261.6,392,523.3,196,329.6].forEach(f=>{const o=c.createOscillator();o.type='sine';o.frequency.value=f;const g=c.createGain();g.gain.value=0.015;const sh=c.createOscillator();sh.frequency.value=0.5+Math.random()*0.3;const sg=c.createGain();sg.gain.value=2;sh.connect(sg).connect(o.frequency);sh.start();o.connect(g).connect(z.gainNode);o.start();z.sourceNodes.push(o,sh);});},
    },
    open(){if(this.enabled){this._stop();return;}this.selectedSound=null;this.selectedMinutes=25;this.overlay.classList.add('show');this.step1.style.display='';this.step2.style.display='none';this._renderStep1();this._renderStep2();$('#zen-custom-min').value=25;},
    _renderStep1(){this.grid.innerHTML=this.presets.map(p=>`<div class="zen-sound-card${this.selectedSound===p.id?' selected':''}" data-id="${p.id}"><span class="zs-icon">${p.icon}</span><span class="zs-name">${p.name}</span></div>`).join('');this.grid.querySelectorAll('.zen-sound-card').forEach(c=>c.addEventListener('click',()=>{this.selectedSound=c.dataset.id;this._renderStep1();this._start(this.selectedSound);this.step1.style.display='none';this.step2.style.display='';}));},
    _renderStep2(){this.timerPresets.innerHTML=[5,10,15,25,30,45,60].map(m=>`<span class="zen-time-preset${this.selectedMinutes===m?' selected':''}" data-min="${m}">${m} 分钟</span>`).join('');this.timerPresets.querySelectorAll('.zen-time-preset').forEach(el=>el.addEventListener('click',()=>{this.selectedMinutes=parseInt(el.dataset.min);this._renderStep2();$('#zen-custom-min').value=this.selectedMinutes;}));},
  };

  // ═══════════════════════════════════════════
  //  MODULE: Quotes
  // ═══════════════════════════════════════════
  const Quotes = {
    el:$('#quote-text'),refresh:$('#quote-refresh'),
    data:["千里之行，始于足下。— 老子《道德经》","天行健，君子以自强不息。— 《周易》","不积跬步，无以至千里。— 荀子《劝学》","业精于勤，荒于嬉。— 韩愈","宝剑锋从磨砺出，梅花香自苦寒来。","学而不思则罔，思而不学则殆。— 孔子","天生我材必有用。— 李白《将进酒》","路漫漫其修远兮，吾将上下而求索。— 屈原","莫等闲，白了少年头，空悲切。— 岳飞","少壮不努力，老大徒伤悲。","一寸光阴一寸金。","读万卷书，行万里路。","海纳百川，有容乃大。— 林则徐","天下兴亡，匹夫有责。","其实地上本没有路，走的人多了，也便成了路。— 鲁迅","时间就像海绵里的水。— 鲁迅","成功=艰苦劳动+正确方法+少说空话。— 爱因斯坦","失败是成功之母。","世界以痛吻我，要我报之以歌。— 泰戈尔","生如夏花之绚烂，死如秋叶之静美。— 泰戈尔","一个人可以被毁灭，但不能被打败。— 海明威","优于别人，并不高贵，真正的高贵应该是优于过去的自己。— 海明威","只有用心灵才能看得清事物本质。— 《小王子》","人生如逆旅，我亦是行人。— 苏轼","回首向来萧瑟处，归去，也无风雨也无晴。— 苏轼","此心安处是吾乡。— 苏轼","人间有味是清欢。— 苏轼","采菊东篱下，悠然见南山。— 陶渊明","人生自古谁无死，留取丹心照汗青。— 文天祥","海内存知己，天涯若比邻。— 王勃","欲穷千里目，更上一层楼。— 王之涣","山重水复疑无路，柳暗花明又一村。— 陆游","会当凌绝顶，一览众山小。— 杜甫","盛年不重来，一日难再晨。— 陶渊明","非淡泊无以明志，非宁静无以致远。— 诸葛亮","锲而不舍，金石可镂。— 荀子","老骥伏枥，志在千里。— 曹操","己所不欲，勿施于人。— 孔子","三人行，必有我师焉。— 孔子","书籍是人类进步的阶梯。— 高尔基"],
    init(){this.refresh.addEventListener('click',()=>this.show());this.show();},
    show(){this.el.classList.add('fade');setTimeout(()=>{this.el.textContent='💬 '+this.data[Math.floor(Math.random()*this.data.length)];this.el.classList.remove('fade');},200);},
  };

  // ═══════════════════════════════════════════
  //  MODULE: Particles
  // ═══════════════════════════════════════════
  const Particles = {
    init(){this.canvas=$('#particles');this.ctx=this.canvas.getContext('2d');this._resize();window.addEventListener('resize',()=>this._resize());this.particles=Array.from({length:60},()=>new this._Particle());this._animate();},
    _resize(){this.canvas.width=window.innerWidth;this.canvas.height=window.innerHeight;},
    _animate(){this.ctx.clearRect(0,0,this.canvas.width,this.canvas.height);const isDark=document.body.getAttribute('data-theme')==='dark';this.particles.forEach(p=>{p.update(this.canvas.width,this.canvas.height);p.draw(this.ctx,isDark);});requestAnimationFrame(()=>this._animate());},
    _Particle:class{constructor(){this.reset(true);}reset(init){if(!init){this.x=Math.random()*1200;this.y=Math.random()*800;}this.size=Math.random()*1.8+0.3;this.speedX=(Math.random()-0.5)*0.4;this.speedY=(Math.random()-0.5)*0.4;this.opacity=Math.random()*0.5+0.1;}update(w,h){this.x+=this.speedX;this.y+=this.speedY;if(this.x<0||this.x>w||this.y<0||this.y>h)this.reset(false);}draw(ctx,isDark){ctx.beginPath();ctx.arc(this.x,this.y,this.size,0,Math.PI*2);ctx.fillStyle=isDark?`rgba(255,255,255,${this.opacity})`:`rgba(100,100,150,${this.opacity*0.7})`;ctx.fill();}},
  };

  // ═══════════════════════════════════════════
  // APP: Init
  // ═══════════════════════════════════════════
  // Test pywebview bridge
  (async () => {
    const pong = await fetch('/api/ping',{method:'POST'}).then(r=>r.json());
    console.log('[bridge] ping:', pong);
    if (pong === 'pong') showToast('🔗 Python 桥接正常');
  })();
  // ── Onboarding (first login) ──────────────
  if (localStorage.getItem('first_login') === '1') {
    // Step 0: Welcome + theme
    const wOverlay = $('#onboarding-overlay');
    wOverlay.classList.add('show');
    const wSteps = [$$('.onboard-step')[0], $$('.onboard-step')[1]];
    const wDots = $$('.ob-dot');
    let wStep = 0;
    function showWStep(n) {
      wSteps.forEach((s,i) => { s.classList.toggle('active', i===n); });
      wDots.forEach((d,i) => { d.classList.toggle('active', i===n); });
      wStep = n;
    }
    wOverlay.addEventListener('click', e => {
      if (wStep === 0 && !e.target.closest('.ob-start-btn') && !e.target.closest('.ob-theme-btn')) showWStep(1);
    });
    // Start button also advances
    document.querySelector('.ob-start-btn')?.addEventListener('click', e => {
      e.stopPropagation();
      showWStep(1);
    });
    $$('.ob-theme-btn').forEach(btn => btn.addEventListener('click', e => {
      e.stopPropagation();
      document.body.setAttribute('data-theme', btn.dataset.theme);
      localStorage.setItem('stopwatch-theme', btn.dataset.theme);
      // After theme select, start guided tour
      wOverlay.classList.remove('show');
      startTour();
    }));
    $('#ob-skip').addEventListener('click', () => {
      wOverlay.classList.remove('show');
      localStorage.removeItem('first_login');
    });

    function startTour() {
      const steps = [
        { el:'#timer-display', title:'⏱ 计时核心', desc:'这里是计时器主面板。正计时、倒计时、番茄钟都在这里显示。按下空格键即可开始计时。' },
        { el:'#mode-tabs', title:'📋 模式切换', desc:'点击切换三种模式：正计时（秒表）、倒计时、番茄钟。每种模式有独立的功能和设置。' },
        { el:'#top-bar', title:'🔧 顶部工具栏', desc:'这里集成了全屏、白噪音禅模式、计时记录、设置等快捷入口。' },
        { el:'#banner-wrap', title:'📅 倒数日', desc:'点击这里可以设置倒数日，支持节日预设和自定义日期，日期过了会自动更新。' },
        { el:'#hint-bar', title:'⌨️ 快捷键', desc:'底部栏显示所有键盘快捷键：空格开始/暂停，L计次，R重置，S侧栏，P番茄钟。' },
      ];
      const overlay = $('#tour-overlay');
      const spotlight = $('#tour-spotlight');
      const tooltip = $('#tour-tooltip');
      const counter = $('#tour-step-counter');
      const titleEl = $('#tour-title');
      const descEl = $('#tour-desc');
      const nextBtn = $('#tour-next');
      const dotsEl = $('#tour-dots');

      // Build dots
      steps.forEach(() => {
        const d = document.createElement('span'); d.className = 'tour-dot'; dotsEl.appendChild(d);
      });
      const dots = dotsEl.querySelectorAll('.tour-dot');

      let current = 0;
      overlay.classList.add('show');

      function showTour(n) {
        current = n;
        const step = steps[n];
        const el = document.querySelector(step.el);
        if (!el) return;
        const rect = el.getBoundingClientRect();
        // Position spotlight
        spotlight.style.left = (rect.left - 8) + 'px';
        spotlight.style.top = (rect.top - 8) + 'px';
        spotlight.style.width = (rect.width + 16) + 'px';
        spotlight.style.height = (rect.height + 16) + 'px';
        // Position tooltip below or above
        let tooltipTop = rect.bottom + 16;
        if (tooltipTop + 120 > window.innerHeight) tooltipTop = rect.top - 140;
        tooltip.style.left = Math.max(16, rect.left) + 'px';
        tooltip.style.top = tooltipTop + 'px';
        tooltip.style.maxWidth = Math.min(360, window.innerWidth - 32) + 'px';
        // Content
        counter.textContent = (n+1) + '/' + steps.length;
        titleEl.textContent = step.title;
        descEl.textContent = step.desc;
        nextBtn.textContent = n < steps.length - 1 ? '下一步' : '完成';
        // Dots
        dots.forEach((d,i) => d.classList.toggle('active', i===n));
      }

      showTour(0);
      nextBtn.addEventListener('click', () => {
        if (current < steps.length - 1) showTour(current + 1);
        else { overlay.classList.remove('show'); localStorage.removeItem('first_login'); }
      });
      $('#tour-skip').addEventListener('click', () => {
        overlay.classList.remove('show');
        localStorage.removeItem('first_login');
      });
    }
  }

  Theme.init(); Account.init(); Clock.init(); Banner.init(); Settings.init(); Player.init(); Quotes.init(); Particles.init();

  UI.btnStart.addEventListener('click',()=>Timer.running?Timer.stop():Timer.start());
  UI.btnReset.addEventListener('click',()=>Timer.reset());
  UI.btnLap.addEventListener('click',()=>Timer.lap());
  $('#btn-sidebar-toggle').addEventListener('click',()=>Sidebar.toggle());
  $('#sidebar-close').addEventListener('click',()=>Sidebar.close());
  $('#clear-laps').addEventListener('click',()=>{Timer.laps=[];Sidebar.render();showToast('记录已清空');});

  // Countdown modal
  const cdSetup=$('#countdown-setup');
  $('#cd-h').addEventListener('change',()=>{if(!Timer.running)Timer.setCountdown();});
  $('#cd-m').addEventListener('change',()=>{if(!Timer.running)Timer.setCountdown();});
  $('#cd-s').addEventListener('change',()=>{if(!Timer.running)Timer.setCountdown();});
  $('#countdown-confirm').addEventListener('click',()=>{Timer.setCountdown();if(Timer.countdownTotal<=0){showToast('⏳ 请设置倒计时时间');return;}cdSetup.classList.remove('visible');UI.timerPanel.classList.add('countdown-mode');UI.updateDisplay(Timer.elapsedBefore);UI.timerPanel.classList.remove('running','countdown-active','finished');UI.btnStart.textContent='▶ 开始';UI.btnStart.classList.remove('running');UI.btnLap.disabled=true;showToast(`⏳ 倒计时 ${$('#cd-h').value||0}:${String($('#cd-m').value||0).padStart(2,'0')}:${String($('#cd-s').value||0).padStart(2,'0')}`);Timer.start();});
  $('#countdown-cancel').addEventListener('click',()=>{cdSetup.classList.remove('visible');UI.timerPanel.classList.remove('countdown-mode');Timer.mode='stopwatch';Timer.elapsedBefore=0;Timer.countdownTotal=0;UI.modeTabs.forEach(t=>t.classList.remove('active'));const sw=document.querySelector('[data-mode="stopwatch"]');if(sw)sw.classList.add('active');UI.updateDisplay(0);});
  cdSetup.addEventListener('click',e=>{if(e.target===cdSetup)$('#countdown-cancel').click();});

  // Mode tabs
  UI.modeTabs.forEach(tab=>tab.addEventListener('click',()=>Timer.switchMode(tab.dataset.mode)));

  // Pomodoro modal
  $('#pomodoro-close').addEventListener('click',()=>Pomodoro.overlay.classList.remove('show'));
  Pomodoro.overlay.addEventListener('click',e=>{ /* only X closes */ });
  $('#add-preset-btn').addEventListener('click',async()=>{
    const icon=$('#preset-icon-input').value.trim()||'⏰',name=$('#preset-name-input').value.trim(),mins=parseInt($('#preset-minutes-input').value);
    if(!name){showToast('请输入预设名称');return;}if(!mins||mins<1){showToast('请输入有效分钟数');return;}
    try {
      const result = await post('/api/save_preset', {name:icon+' '+name, icon, minutes:mins});
      if (result && result.id) showToast('✅ 预设已保存');
      else showToast('❌ 保存失败');
    } catch(e) { showToast('❌ 请求失败'); }
    $('#preset-icon-input').value='';$('#preset-name-input').value='';$('#preset-minutes-input').value='25';
    await Pomodoro._loadPresets();
  });
  document.querySelectorAll('.pomodoro-tab').forEach(tab=>tab.addEventListener('click',async()=>{document.querySelectorAll('.pomodoro-tab').forEach(t=>t.classList.remove('active'));tab.classList.add('active');const sc=$('#stats-container');Pomodoro.presetList.style.display='none';Pomodoro.historyEl.classList.remove('show');sc.style.display='none';if(tab.dataset.tab==='history'){Pomodoro.historyEl.classList.add('show');await Pomodoro._loadHistory();}else if(tab.dataset.tab==='stats'){sc.style.display='';await Pomodoro._loadStats();}else Pomodoro.presetList.style.display='';}));

  // Export CSV
  $('#export-laps').addEventListener('click',()=>{if(!Timer.laps.length){showToast('暂无记录');return;}const csv='序号,时间,差值\n'+Timer.laps.map((l,i)=>`${Timer.laps.length-i},${l.timeStr},${l.diffStr}`).join('\n');const blob=new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8;'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`laps_${new Date().toISOString().slice(0,10)}.csv`;a.click();URL.revokeObjectURL(a.href);showToast('✅ 已导出 CSV');});

  // Fullscreen
  let isFullscreen=false;
  $('#btn-fullscreen').addEventListener('click',async()=>{try{await api('toggle_fullscreen');isFullscreen=!isFullscreen;$('#btn-fullscreen').textContent=isFullscreen?'✖':'⛶';document.body.classList.toggle('fullscreen',isFullscreen);}catch(e){if(!document.fullscreenElement){document.documentElement.requestFullscreen().catch(()=>showToast('全屏不可用'));}else{document.exitFullscreen();}}});
  document.addEventListener('fullscreenchange',()=>{const fs=!!document.fullscreenElement;$('#btn-fullscreen').textContent=fs?'✖':'⛶';document.body.classList.toggle('fullscreen',fs);});

  // Zen
  $('#btn-zen').addEventListener('click',()=>Zen.open());
  $('#zen-close').addEventListener('click',()=>Zen.overlay.classList.remove('show'));
  Zen.overlay.addEventListener('click',e=>{ /* only X closes */ });
  $('#zen-back').addEventListener('click',()=>{Zen.step2.style.display='none';Zen.step1.style.display='';Zen._stopAll();});
  $('#zen-start').addEventListener('click',()=>{const mins=parseInt($('#zen-custom-min').value)||Zen.selectedMinutes;Zen.overlay.classList.remove('show');Timer.mode='countdown';Timer.countdownTotal=mins*60*1000;Timer.elapsedBefore=Timer.countdownTotal;UI.timerPanel.classList.add('countdown-mode');UI.updateDisplay(Timer.countdownTotal);UI.timerPanel.classList.remove('running','countdown-active','finished');UI.modeTabs.forEach(t=>t.classList.remove('active'));const cd=document.querySelector('[data-mode="countdown"]');if(cd)cd.classList.add('active');UI.btnStart.textContent='▶ 开始';UI.btnStart.classList.remove('running');UI.btnLap.disabled=true;Timer.start();showToast(`🧘 ${Zen.presets.find(p=>p.id===Zen.selectedSound)?.name||''} · ${mins} 分钟`);post('/api/record_pomodoro', {name:'🧘 '+(Zen.presets.find(p=>p.id===Zen.selectedSound)?.name||''), minutes:mins, completed:false});});
  $('#zen-ambient').addEventListener('click',()=>{Zen.overlay.classList.remove('show');showToast(`🎧 ${Zen.presets.find(p=>p.id===Zen.selectedSound)?.name||''} 环境音播放中`);});
  $('#zen-custom-min').addEventListener('input',()=>{Zen.selectedMinutes=parseInt($('#zen-custom-min').value)||25;Zen._renderStep2();});

  // Finish overlay dismiss
  $('#finish-dismiss').addEventListener('click',()=>$('#finish-overlay').classList.remove('show'));
  $('#finish-overlay').addEventListener('click',e=>{if(e.target===$('#finish-overlay'))$('#finish-overlay').classList.remove('show');});

  // Keyboard
  document.addEventListener('keydown',e=>{if(e.target.tagName==='INPUT')return;switch(e.key.toLowerCase()){case' ':e.preventDefault();Timer.running?Timer.stop():Timer.start();break;case'l':if(Timer.running)Timer.lap();break;case'r':Timer.reset();break;case's':Sidebar.toggle();break;case'p':e.preventDefault();Player.plDropdown.classList.toggle('open');break;case'arrowleft':e.preventDefault();Player.prev();break;case'arrowright':e.preventDefault();Player.next();break;}});

  // Hint bar
  document.querySelectorAll('.hint-action').forEach(el=>el.addEventListener('click',()=>{const a=el.dataset.action;if(a==='toggle')Timer.running?Timer.stop():Timer.start();else if(a==='lap'&&Timer.running)Timer.lap();else if(a==='reset')Timer.reset();else if(a==='sidebar')Sidebar.toggle();else if(a==='playlist')Player.plDropdown.classList.toggle('open');else if(a==='prev')Player.prev();else if(a==='next')Player.next();}));

  // Drag & drop
  document.addEventListener('dragover',e=>{e.preventDefault();});
  document.addEventListener('drop',e=>{e.preventDefault();const f=e.dataTransfer.files[0];if(f&&f.type.startsWith('audio/'))Player.importFiles(e.dataTransfer.files);else if(f&&(f.type.startsWith('image/')||f.type.startsWith('video/')))Theme.setBg(f);});

  // Global error
  window.addEventListener('error',e=>{showToast('⚠️ 出错了: '+(e.message||'未知错误'));});

  // Zen hooks
  const _origStart=Timer.start.bind(Timer);Timer.start=function(){_origStart();if(Zen.enabled&&(this.mode==='countdown'||this.mode==='pomodoro'))Zen._fadeTo(0.25);};
  const _origStop=Timer.stop.bind(Timer);Timer.stop=function(){_origStop();if(Zen.enabled)Zen._fadeTo(0);};
  const _origReset=Timer.reset.bind(Timer);Timer.reset=function(){_origReset();if(Zen.enabled)Zen._stop();};
  const _origSwitch=Timer.switchMode.bind(Timer);Timer.switchMode=function(nm){if(nm==='stopwatch'&&Zen.enabled)Zen._stop();_origSwitch(nm);};

  console.log('%c⏱ Stopwatch Pro Ready','color:#7c6ff7;font-size:1.2em;');
})();
