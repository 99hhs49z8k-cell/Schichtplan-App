// app.js — Schichtplan PWA (Browser-Version deines Scriptable-Codes)

(function(){
  // -------- Helpers --------
  function pad(n){ return String(n).padStart(2,"0"); }
  function ymd(d){ return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
  function ym(d){ return `${d.getFullYear()}-${pad(d.getMonth()+1)}`; }
  function firstOfMonth(d){ return new Date(d.getFullYear(), d.getMonth(), 1); }
  function lastOfMonth(d){ return new Date(d.getFullYear(), d.getMonth()+1, 0); }
  function sameDay(a,b){ return a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate(); }
  function weekdayMon1(jsDay){ return ((jsDay + 6) % 7) + 1; } // Mo=1 … So=7

  // -------- Store laden/speichern --------
  let STORE = {};
  try { STORE = JSON.parse(localStorage.getItem('schichtplan-store')||'{}'); } catch(_) { STORE = {}; }
  if (!STORE.profiles) STORE.profiles = {};

  let current = new Date();
  current = new Date(current.getFullYear(), current.getMonth(), 1);
  let MONTH_KEY = ym(current);
  if (!STORE[MONTH_KEY]) STORE[MONTH_KEY] = {};

  let DATA = STORE[MONTH_KEY];
  let PROFILES = STORE.profiles;

  function persistAll(){
    try { localStorage.setItem('schichtplan-store', JSON.stringify(STORE)); } catch(_){}
  }

  function bootFromTempIfAny(key){
    // Kompatibel zu deiner früheren Temp-Logik (optional)
    try{
      const pr = localStorage.getItem('profiles-temp');
      if(pr){
        const q=JSON.parse(pr);
        if(q && typeof q==='object'){ STORE.profiles=q; PROFILES=STORE.profiles; }
      }
      const dt = localStorage.getItem('data-temp-'+key);
      if(dt){
        const p=JSON.parse(dt);
        if(p && typeof p==='object'){ STORE[key]=p; DATA=STORE[key]; }
      }
    }catch(_){}
  }

  function persistTemp(){
    try{ localStorage.setItem('profiles-temp', JSON.stringify(PROFILES)); }catch(_){}
    try{ localStorage.setItem('data-temp-'+MONTH_KEY, JSON.stringify(DATA)); }catch(_){}
    persistAll();
    updateSummary();
  }

  // -------- DOM refs & Log --------
  const $ = (id)=>document.getElementById(id);
  const grid = $('grid');
  const logEl = $('log');
  const WD_LABEL = {1:"Mo",2:"Di",3:"Mi",4:"Do",5:"Fr",6:"Sa",7:"So"};

  function log(m){
    try{
      logEl.textContent += "\n" + (new Date().toISOString().slice(11,19)) + " " + m;
      logEl.scrollTop = logEl.scrollHeight;
    }catch(_){}
  }

  // -------- Zeitfunktionen --------
  function toMin(v){ if(!v) return NaN; const p=v.split(':'); return parseInt(p[0],10)*60+parseInt(p[1],10); }
  function fmtHM(totalMin){ const m=Math.abs(totalMin); return (totalMin<0?"-":"")+Math.floor(m/60)+":"+String(m%60).padStart(2,"0"); }
  function shiftDurMin(s,e){ const sm=toMin(s), em=toMin(e); if(!isFinite(sm)||!isFinite(em)||em<=sm) return 0; return em-sm; }

  function sumMinutesAll(){
    let total=0;
    (tage||[]).forEach(t => (DATA[t.key]||[]).forEach(sh => total+=shiftDurMin(sh.s,sh.e)));
    return total;
  }
  function sumByEmployee(){
    const map={};
    (tage||[]).forEach(t => (DATA[t.key]||[]).forEach(sh => {
      const emp=(sh.emp||"").trim(); if(!emp) return;
      const m=shiftDurMin(sh.s,sh.e);
      map[emp]=(map[emp]||0)+m;
    }));
    return map;
  }

  // -------- Monatsaufbau --------
  let tage = [];
  function rebuildDays(){
    tage = [];
    const first=firstOfMonth(current), last=lastOfMonth(current), today=new Date();
    for (let d=new Date(first); d<=last; d.setDate(d.getDate()+1)) {
      const wd = weekdayMon1(d.getDay());
      if (wd!==7) tage.push({ key: ymd(d), num: d.getDate(), wd: wd, istHeute: sameDay(d,today) && sameDay(current, new Date(today.getFullYear(), today.getMonth(),1)) });
    }
  }

  // -------- UI: Summary --------
  function updateSummary(){
    $('sum-value').textContent = fmtHM(sumMinutesAll())+' h';
    const m=sumByEmployee();
    const keys=Object.keys(m).sort((a,b)=>a.localeCompare(b,'de'));
    const html = keys.length? keys.map(k=>{
      const h=m[k]; const prof=PROFILES[k]||{}; const min=(prof.minHours||0)*60;
      const warn = h < min ? ' warn' : '';
      const bounds = (prof.minHours||0) || (prof.maxHours||0) ? ' ('+(prof.minHours||0)+'/'+(prof.maxHours||0)+' h)' : '';
      return '<span class="'+(warn?'warn':'')+'">'+k+': '+fmtHM(h)+' h'+bounds+'</span>';
    }).join(', ') : '–';
    $('sum-emps').innerHTML = html;
  }

  // -------- Daten-Manipulation --------
  function upsertShiftForDay(dayKey, sStr, eStr, emp){
    if(!DATA[dayKey]) DATA[dayKey]=[];
    const arr=DATA[dayKey];
    const idx=arr.findIndex(x=>x.s===sStr && x.e===eStr);
    if(idx>=0) arr[idx].emp=emp; else arr.push({s:sStr,e:eStr,emp:emp});
  }
  function mergeOrReplaceShiftForEdit(dayKey, editIndex, sStr, eStr, emp){
    if(!DATA[dayKey]) DATA[dayKey]=[];
    const arr=DATA[dayKey];
    const existingIdx = arr.findIndex((x,i)=> i!==editIndex && x.s===sStr && x.e===eStr);
    if(existingIdx>=0){ arr[existingIdx].emp=emp; arr.splice(editIndex,1); }
    else { arr[editIndex]={s:sStr,e:eStr,emp:emp}; }
  }
  function applyToSameWeekday(wd, sStr, eStr, emp){
    tage.filter(x=>x.wd===wd).forEach(x=> upsertShiftForDay(x.key, sStr, eStr, emp));
  }

  // -------- UI: Monatsgrid + Editor --------
  function renderDays(){
    $('title').textContent = new Intl.DateTimeFormat('de-DE',{month:'long',year:'numeric'}).format(current);
    grid.innerHTML='';
    const f = firstOfMonth(current);
    const firstWd = weekdayMon1(f.getDay());
    const offset = (firstWd === 7) ? 0 : (firstWd - 1);
    for (let i=0;i<offset;i++){ const sp=document.createElement('div'); sp.className='spacer'; grid.appendChild(sp); }

    tage.forEach(t=>{
      const shifts=(DATA[t.key]||[]).slice().sort((a,b)=> toMin(a.s)-toMin(b.s));
      const card=document.createElement('div'); card.className='card'+(t.istHeute?' heute':''); card.setAttribute('data-key',t.key);
      const header=document.createElement('div'); header.className='card-header';
      header.innerHTML='<div class="daynum">'+t.num+'</div><button class="add-btn" type="button">+</button>';
      const add=header.querySelector('button');
      add.addEventListener('click', e=>{
        e.preventDefault(); e.stopPropagation();
        const ed=card.querySelector('.editor'); ed.style.display='flex'; ed.dataset.edit=''; ed.dataset.key=t.key; ed.dataset.wd=t.wd;
        ed.querySelector('.apply .wdlabel').textContent=WD_LABEL[t.wd]; ed.querySelector('.apply').style.display='flex';
      });
      card.appendChild(header);

      const body=document.createElement('div'); body.className='card-body';
      body.addEventListener('click', ()=> card.classList.toggle('expanded'));
      const list=document.createElement('div'); list.className='shift-list';

      if(shifts.length){
        shifts.forEach((sh,idx)=>{
          const row=document.createElement('div'); row.className='shift-row'+(!((sh.emp||"").trim())?' unfilled':'');
          const empTxt=(sh.emp||"").trim(); const who=empTxt?(' – '+empTxt):'';
          row.innerHTML=
            '<div style="flex:1 1 auto;">'+
              '<div class="shift-label">Schicht '+(idx+1)+ who +'</div>'+
              '<div class="shift-detail">'+sh.s+' — '+sh.e+(empTxt?(' · '+empTxt):'')+'</div>'+
            '</div>'+
            '<div class="row-right">'+
              '<button class="icon-btn" type="button">✎</button>'+
              '<button class="icon-btn icon-del" type="button">✕</button>'+
            '</div>';
          const btns=row.querySelectorAll('button');
          btns[0].addEventListener('click', e=>{
            e.preventDefault(); e.stopPropagation();
            const ed=card.querySelector('.editor'); const it=sh||{s:'',e:'',emp:''};
            ed.style.display='flex'; ed.dataset.edit=String(idx); ed.dataset.key=t.key; ed.dataset.wd=t.wd;
            ed.querySelector('.start').value=(it.s||''); ed.querySelector('.end').value=(it.e||''); ed.querySelector('.emp').value=(it.emp||'');
            ed.querySelector('.apply').style.display='none';
          });
          btns[1].addEventListener('click', e=>{
            e.preventDefault(); e.stopPropagation();
            const arr=DATA[t.key]||[]; arr.splice(idx,1); if(arr.length) DATA[t.key]=arr; else delete DATA[t.key];
            persistTemp(); renderDays();
          });
          list.appendChild(row);
        });
      } else {
        const empty=document.createElement('div'); empty.className='empty'; empty.textContent='Keine Schichten';
        list.appendChild(empty);
      }

      body.appendChild(list);
      card.appendChild(body);

      const ed=document.createElement('div'); ed.className='editor'; ed.dataset.key=t.key; ed.dataset.wd=t.wd; ed.dataset.edit='';
      ed.innerHTML=
        '<div class="line"><input class="start" type="time" step="900"><span>–</span><input class="end" type="time" step="900"></div>'+
        '<div class="line"><input class="emp" type="text" placeholder="Mitarbeiter (optional)"></div>'+
        '<div class="error"></div>'+
        '<label class="apply"><input class="applyAll" type="checkbox"> <span>alle <span class="wdlabel">'+WD_LABEL[t.wd]+'</span></span></label>'+
        '<div class="line"><button class="save" type="button">Speichern</button><button class="cancel" type="button">Abbrechen</button></div>';
      const btnSave = ed.querySelector('.save');
      const btnCancel = ed.querySelector('.cancel');
      btnCancel.addEventListener('click', e=>{ e.preventDefault(); e.stopPropagation(); ed.style.display='none'; });
      btnSave.addEventListener('click', e=>{
        e.preventDefault(); e.stopPropagation();
        const key=ed.dataset.key; const wd=parseInt(ed.dataset.wd,10);
        const editIdxStr=ed.dataset.edit; const isEdit=(editIdxStr!==''); const editIdx=isEdit?parseInt(editIdxStr,10):null;
        const sRaw=ed.querySelector('.start').value; const eRaw=ed.querySelector('.end').value; const emp=(ed.querySelector('.emp').value||"").trim();
        const s=sRaw?(parseInt(sRaw.slice(0,2),10)*60+parseInt(sRaw.slice(3,5),10)):NaN;
        const en=eRaw?(parseInt(eRaw.slice(0,2),10)*60+parseInt(eRaw.slice(3,5),10)):NaN;
        const apply=ed.querySelector('.applyAll').checked; const err=ed.querySelector('.error'); err.textContent='';
        if(!isFinite(s)||!isFinite(en)){ err.textContent='Zeiten nötig'; return; }
        if(en<=s){ err.textContent='Ende > Start'; return; }
        if(emp){
          const arrNow=DATA[key]||[];
          for(let i=0;i<arrNow.length;i++){
            if(i===editIdx) continue;
            if((arrNow[i].emp||"").trim()===emp){ err.textContent='Mitarbeiter bereits an diesem Tag eingeteilt'; return; }
          }
        }
        const sStr=sRaw.slice(0,5), eStr=eRaw.slice(0,5);
        if(isEdit){ mergeOrReplaceShiftForEdit(key, editIdx, sStr, eStr, emp); }
        else { upsertShiftForDay(key, sStr, eStr, emp); if(apply){ applyToSameWeekday(wd, sStr, eStr, emp); } }
        ed.style.display='none';
        persistTemp(); renderDays();
      });

      card.appendChild(ed);
      grid.appendChild(card);
    });

    updateSummary();
  }

  // -------- Profiles / Availability --------
  function ensureProfile(name){
    if(!PROFILES[name]) PROFILES[name]={minHours:0,maxHours:160,priority:false,availability:{}};
    if(typeof PROFILES[name].minHours!=='number') PROFILES[name].minHours=0;
    if(typeof PROFILES[name].maxHours!=='number') PROFILES[name].maxHours=160;
    if(typeof PROFILES[name].priority!=='boolean') PROFILES[name].priority=false;
    if(typeof PROFILES[name].availability!=='object' || !PROFILES[name].availability) PROFILES[name].availability={};
    const mk = ym(current);
    if(typeof PROFILES[name].availability[mk]!=='object') PROFILES[name].availability[mk]={};
  }
  function getAvail(name, dayKey){ ensureProfile(name); const mk=ym(current); const v=PROFILES[name].availability[mk][dayKey]; return (typeof v==='number')?v:0; }
  function setAvail(name, dayKey, val){ ensureProfile(name); const mk=ym(current); PROFILES[name].availability[mk][dayKey]=val; }

  function maskForAll(n){ return n>0 ? ((1<<n)-1) : 0; }
  function buildOptions(n){
    const opts=[{v:0,l:'kein'}]; if(n<=0) return opts;
    opts.push({v:maskForAll(n), l:'alle'});
    const count=(1<<n);
    for(let m=1;m<count;m++){
      if(m===maskForAll(n)) continue;
      const parts=[]; for(let i=0;i<n;i++){ if(m&(1<<i)) parts.push(String(i+1)); }
      opts.push({v:m, l:parts.join('+')});
    }
    return opts;
  }
  function fillSelectWithOptions(sel, n, current){
    sel.innerHTML='';
    const opts=buildOptions(n);
    opts.forEach(o=>{
      const op=document.createElement('option'); op.value=String(o.v); op.textContent=o.l; sel.appendChild(op);
    });
    const clip=current & maskForAll(n);
    sel.value=String(clip);
  }

  function detectKeyword(spec){
    const t=(spec||'').toLowerCase();
    if(/nicht\s*verf(u|ü)gbar|nicht verfuegbar|nicht möglich|nicht moeglich/.test(t)) return 'none';
    if(/nur\s*(fr(ü|ue)h)/.test(t)) return 'early';
    if(/nur\s*(sp(ä|ae)t)/.test(t)) return 'late';
    if(/frei\s*verf(u|ü)gbar|verf(u|ü)gbar|beide|alle/.test(t)) return 'all';
    return null;
  }
  function maskFromSpecKeyword(kind, n){
    if(kind==='none') return 0;
    if(kind==='all') return maskForAll(n);
    if(kind==='early') return n>=1 ? (1<<0) : 0;
    if(kind==='late') return n>=1 ? (1<<(n-1)) : 0;
    return 0;
  }
  function parseFreeFormLine(line){
    let s=line.trim(); if(!s) return null;
    const m = s.match(/(?:^|\s)(\d{1,2})\.(\d{1,2})\.?/);
    if(!m) return null;
    const day=parseInt(m[1],10), mon=parseInt(m[2],10);
    if(!(day>=1&&day<=31)) return null;
    if(mon!== (current.getMonth()+1)) return null;
    const kind = detectKeyword(s) || 'all';
    return {type:'date', day:day, kind:kind};
  }
  function parseAvailTextLine(line){
    let s=line.trim(); if(!s) return null;
    s=s.replace(/,/g,' ').replace(/;/g,' ');
    const mDayNum = s.match(/^(\d{1,2})(?:\.|\/(\d{1,2}))?\s*[:\-]?\s*(.+)$/i);
    if(mDayNum){
      const day=parseInt(mDayNum[1],10);
      if(!(day>=1&&day<=31)) return null;
      const rest=(mDayNum[3]||'').trim().toLowerCase();
      return {type:'date', day:day, spec:rest};
    }
    const mWd = s.match(/^(mo|di|mi|do|fr|sa|so)\s*[:\-]?\s*(.+)$/i);
    if(mWd){
      const wdStr=mWd[1].toLowerCase();
      const map={mo:1,di:2,mi:3,do:4,fr:5,sa:6,so:7};
      const wd=map[wdStr];
      const rest=(mWd[2]||'').trim().toLowerCase();
      return {type:'weekday', wd:wd, spec:rest};
    }
    return null;
  }
  function specToMask(spec, dayKey){
    const n=(DATA[dayKey]||[]).length;
    const kw = detectKeyword(spec||'') || 'none';
    return maskFromSpecKeyword(kw, n);
  }

  function applyAvailFromText(name, text){
    ensureProfile(name);
    const lines=(text||'').split(/\n+/);
    lines.forEach(line=>{
      const ff = parseFreeFormLine(line);
      if(ff){
        const d=new Date(current.getFullYear(), current.getMonth(), ff.day);
        if(d.getMonth()!==current.getMonth()) return;
        const key=ymd(d);
        const n=(DATA[key]||[]).length;
        const m = maskFromSpecKeyword(ff.kind, n);
        setAvail(name, key, m);
        return;
      }
      const parsed = parseAvailTextLine(line);
      if(!parsed) return;
      if(parsed.type==='weekday'){
        if(parsed.wd===7) return;
        tage.filter(x=>x.wd===parsed.wd).forEach(x=>{
          const m = specToMask(parsed.spec, x.key);
          setAvail(name, x.key, m);
        });
      } else if(parsed.type==='date'){
        const d=new Date(current.getFullYear(), current.getMonth(), parsed.day);
        if(d.getMonth()!==current.getMonth()) return;
        const key=ymd(d);
        const m = specToMask(parsed.spec, key);
        setAvail(name, key, m);
      }
    });
  }

  function renderProfiles(){
    const list=$('list-profiles'); list.innerHTML='';
    Object.keys(PROFILES).forEach(name=>{
      ensureProfile(name);
      const p=PROFILES[name];

      const card=document.createElement('div'); card.className='card-profile'; card.dataset.oldname=name;

      const head=document.createElement('div'); head.className='row';
      head.innerHTML=
        '<input class="name" type="text" value="'+name+'" placeholder="Name">'+
        '<label>Min Stunden</label><input class="small minh" type="number" min="0" step="1" value="'+(p.minHours||0)+'">'+
        '<label>Max Stunden</label><input class="small maxh" type="number" min="0" step="1" value="'+(p.maxHours||0)+'">'+
        '<label>Priorität</label><input class="prio" type="checkbox" '+(p.priority?'checked':'')+'>'+
        '<button class="tb" type="button">Entfernen</button>';
      head.querySelector('button').addEventListener('click', ()=>{ delete PROFILES[name]; card.remove(); persistTemp(); });
      card.appendChild(head);

      const hr=document.createElement('div'); hr.className='hr'; card.appendChild(hr);

      const hint=document.createElement('div'); hint.style.fontSize='12px'; hint.style.color='#8a8a8a'; hint.textContent='Verfügbarkeit kompakt (Mo–Sa):';
      card.appendChild(hint);

      [1,2,3,4,5,6].forEach(wd=>{
        const row=document.createElement('div'); row.className='avail-week';
        const lbl=document.createElement('div'); lbl.className='daylbl'; lbl.textContent=WD_LABEL[wd];
        const sel=document.createElement('select');

        let maxN = 0;
        tage.filter(x=>x.wd===wd).forEach(x=>{ const n=(DATA[x.key]||[]).length; if(n>maxN) maxN=n; });

        const keys=tage.filter(x=>x.wd===wd).map(x=>x.key);
        const vals=keys.map(k=>getAvail(name,k));
        const uniq=[...new Set(vals)];
        const initVal = uniq.length===1 ? (uniq[0]||0) : 0;

        fillSelectWithOptions(sel, maxN, initVal);
        sel.addEventListener('change', ()=>{
          const raw=parseInt(sel.value,10);
          tage.filter(x=>x.wd===wd).forEach(x=>{
            const n=(DATA[x.key]||[]).length;
            const clipped = raw & maskForAll(n);
            setAvail(name, x.key, clipped);
          });
          persistTemp();
        });

        const btn=document.createElement('button'); btn.textContent='→ alle '+WD_LABEL[wd];
        btn.addEventListener('click', e=>{
          e.preventDefault();
          const raw=parseInt(sel.value,10);
          tage.filter(x=>x.wd===wd).forEach(x=>{
            const nx=(DATA[x.key]||[]).length;
            const clipped = raw & maskForAll(nx);
            setAvail(name, x.key, clipped);
          });
          persistTemp();
        });

        row.appendChild(lbl); row.appendChild(sel); row.appendChild(btn);
        card.appendChild(row);
      });

      const toggle=document.createElement('button'); toggle.className='toggle'; toggle.textContent='Tage ▾';
      const detail=document.createElement('div'); detail.className='avail-detail';
      toggle.addEventListener('click', ()=>{
        const open = detail.style.display==='flex';
        detail.style.display = open ? 'none' : 'flex';
        toggle.textContent = open ? 'Tage ▾' : 'Tage ▴';
      });
      card.appendChild(toggle);

      tage.forEach(t=>{
        const row=document.createElement('div'); row.className='avail-week';
        const lbl=document.createElement('div'); lbl.className='daylbl'; lbl.textContent=WD_LABEL[t.wd]+' '+t.num;
        const sel=document.createElement('select');
        const n=(DATA[t.key]||[]).length;
        fillSelectWithOptions(sel, n, getAvail(name, t.key));
        sel.addEventListener('change', ()=>{
          const raw=parseInt(sel.value,10);
          const clipped = raw & maskForAll(n);
          setAvail(name, t.key, clipped);
          persistTemp();
        });
        const btn=document.createElement('button'); btn.textContent='→ alle '+WD_LABEL[t.wd];
        btn.addEventListener('click', e=>{
          e.preventDefault();
          const raw=parseInt(sel.value,10);
          tage.filter(x=>x.wd===t.wd).forEach(x=>{
            const nx=(DATA[x.key]||[]).length;
            const clipped = raw & maskForAll(nx);
            setAvail(name, x.key, clipped);
          });
          persistTemp();
        });
        row.appendChild(lbl); row.appendChild(sel); row.appendChild(btn);
        detail.appendChild(row);
      });
      card.appendChild(detail);

      const hr2=document.createElement('div'); hr2.className='hr'; card.appendChild(hr2);

      const ta=document.createElement('textarea'); ta.className='ta'; ta.placeholder='Text einfügen (z. B. "Mittwoch, den 01.10. nur Spätschicht")';
      const rowTA=document.createElement('div'); rowTA.className='row';
      const btnTA=document.createElement('button'); btnTA.className='tb'; btnTA.textContent='Übernehmen';
      btnTA.addEventListener('click', ()=>{ applyAvailFromText(name, ta.value||''); persistTemp(); renderProfiles(); });
      rowTA.appendChild(ta); rowTA.appendChild(btnTA);
      card.appendChild(rowTA);

      list.appendChild(card);
    });

    const addBtn=document.createElement('button'); addBtn.className='tb'; addBtn.textContent='+ Mitarbeiter';
    addBtn.addEventListener('click', ()=>{
      let base='Mitarbeiter', i=1, nm=base+i; while(PROFILES[nm]){ i++; nm=base+i; }
      PROFILES[nm]={minHours:0,maxHours:160,priority:false,availability:{}};
      PROFILES[nm].availability[ym(current)]={};
      persistTemp(); renderProfiles();
    });
    list.appendChild(addBtn);

    const saveBtn=document.createElement('button'); saveBtn.className='tb'; saveBtn.style.marginTop='8px'; saveBtn.textContent='Speichern';
    saveBtn.addEventListener('click', ()=>{
      const cards=[].slice.call(document.querySelectorAll('.card-profile'));
      const np={}; const renameMap={};
      cards.forEach(c=>{
        const old=c.dataset.oldname||'';
        const name=c.querySelector('.name').value.trim();
        const maxh=parseInt(c.querySelector('.maxh').value,10);
        const minh=parseInt(c.querySelector('.minh').value,10);
        const pr=c.querySelector('.prio').checked;
        if(name){
          const avail = (PROFILES[old] && PROFILES[old].availability) ? PROFILES[old].availability : {};
          np[name]={minHours:(isFinite(minh)?minh:0), maxHours:(isFinite(maxh)?maxh:0), priority:pr, availability:avail};
          if(old && old!==name) renameMap[old]=name;
        }
      });
      if(Object.keys(renameMap).length){
        Object.keys(DATA).forEach(dayKey=>{
          (DATA[dayKey]||[]).forEach(sh=>{
            const old=(sh.emp||"").trim(); if(old && renameMap[old]) sh.emp=renameMap[old];
          });
        });
      }
      STORE.profiles=np; PROFILES=STORE.profiles;
      persistTemp(); showMain();
    });
    list.appendChild(saveBtn);
  }

  // -------- Auto-Assignment --------
  function autoAssign(){
    const empHours = sumByEmployee(); Object.keys(PROFILES).forEach(n=>{ if(!empHours[n]) empHours[n]=0; });
    tage.forEach(t=>{
      const used = new Set();
      const arr = (DATA[t.key]||[]).slice().sort((a,b)=> toMin(a.s)-toMin(b.s));
      for (let i=0;i<arr.length;i++){
        const sh = arr[i];
        const already = (sh.emp||"").trim();
        if (already){ used.add(already); continue; }
        const dur = shiftDurMin(sh.s, sh.e);
        const schIdx = i+1;
        const cands = Object.keys(PROFILES).filter(name=>{
          if(used.has(name)) return false;
          const prof = PROFILES[name]||{};
          const availMask = getAvail(name, t.key);
          const allow = (availMask & (1<<(schIdx-1))) !== 0;
          const maxMin = (prof.maxHours||0)*60;
          const remOK = (!maxMin || (empHours[name]+dur) <= maxMin);
          return allow && remOK;
        });
        cands.sort((a,b)=>{
          const pa = !!(PROFILES[a]&&PROFILES[a].priority);
          const pb = !!(PROFILES[b]&&PROFILES[b].priority);
          if (pa!==pb) return pa? -1 : 1;
          const ha = empHours[a]||0, hb = empHours[b]||0;
          if (ha!==hb) return ha-hb;
          return a.localeCompare(b,'de');
        });
        if (cands.length){
          const pick = cands[0];
          sh.emp = pick;
          used.add(pick);
          empHours[pick] = (empHours[pick]||0) + dur;
        }
      }
      if (arr.length) DATA[t.key]=arr;
    });
    persistTemp(); renderDays(); log('auto-assigned');
  }

  // -------- Views / Buttons --------
  function showMain(){ $('view-profiles').classList.remove('active'); $('view-main').classList.add('active'); $('btn-left').textContent='Kontrolle'; }
  function showProf(){ $('view-main').classList.remove('active'); $('view-profiles').classList.add('active'); $('btn-left').textContent='Zurück'; renderProfiles(); }

  function toggleLog(){
    const collapsed = logEl.classList.toggle('collapsed');
    $('btn-right').textContent = collapsed ? 'Log ▸' : 'Log ▾';
    $('btn-log-toggle').textContent = collapsed ? '▸' : '▾';
  }

  function setMonth(delta){
    const y = current.getFullYear(), m = current.getMonth()+delta;
    current = new Date(y, m, 1);
    MONTH_KEY = ym(current);
    if(!STORE[MONTH_KEY]) STORE[MONTH_KEY] = {};
    bootFromTempIfAny(MONTH_KEY);
    DATA = STORE[MONTH_KEY];
    rebuildDays(); renderDays(); updateSummary(); log('month=' + MONTH_KEY);
  }

  function daysByWeekday(baseDate){
    const map = {1:[],2:[],3:[],4:[],5:[],6:[]}; // Mo–Sa
    const f = firstOfMonth(baseDate), l = lastOfMonth(baseDate);
    for (let d=new Date(f); d<=l; d.setDate(d.getDate()+1)){
      const wd = weekdayMon1(d.getDay());
      if (wd>=1 && wd<=6) map[wd].push(new Date(d));
    }
    return map;
  }

  function copyFromPrevMonth(){
    const prev = new Date(current.getFullYear(), current.getMonth()-1, 1);
    const prevKey = ym(prev);
    bootFromTempIfAny(prevKey);
    const src = STORE[prevKey] || {};
    const dst = STORE[MONTH_KEY] || {};

    const prevMap = daysByWeekday(prev);
    const currMap = daysByWeekday(current);

    for (let wd=1; wd<=6; wd++){
      const pArr = prevMap[wd];
      const cArr = currMap[wd];
      const len = Math.min(pArr.length, cArr.length);
      for (let i=0; i<len; i++){
        const pDate = pArr[i];
        const cDate = cArr[i];
        const sk = ymd(pDate);
        const dk = ymd(cDate);
        const srcArr = (src[sk]||[]).map(sh=> ({s:sh.s, e:sh.e, emp:""})); // Mitarbeiter leeren
        if (srcArr.length) dst[dk] = srcArr; else delete dst[dk];
      }
      for (let j=len; j<cArr.length; j++){
        const dk2 = ymd(cArr[j]);
        delete dst[dk2];
      }
    }

    STORE[MONTH_KEY] = dst;
    DATA = dst;
    persistTemp(); renderDays();
    log('copied from '+prevKey+' (weekday-aligned)');
  }

  function bindButton(id, fn){ const el=$(id); if(el) el.addEventListener('click', e=>{ e.preventDefault(); e.stopPropagation(); fn(e); }); }

  // Bindings
  bindButton('btn-left', ()=>{ if($('view-main').classList.contains('active')){ showProf(); log('open profiles'); } else { showMain(); log('back'); } });
  bindButton('btn-mid',  ()=>{ logEl.textContent='-- Debug Log --\n'; log('cleared'); });
  bindButton('btn-right',()=>{ toggleLog(); });
  bindButton('btn-log-toggle',()=>{ toggleLog(); });
  bindButton('btn-calc', ()=>{ autoAssign(); });

  bindButton('btn-prev', ()=>{ setMonth(-1); });
  bindButton('btn-next', ()=>{ setMonth(+1); });
  bindButton('btn-copy-prev', ()=>{ copyFromPrevMonth(); });

  bindButton('btn-prev-2', ()=>{ setMonth(-1); });
  bindButton('btn-next-2', ()=>{ setMonth(+1); });
  bindButton('btn-copy-prev-2', ()=>{ copyFromPrevMonth(); });

  // Start
  bootFromTempIfAny(MONTH_KEY);
  rebuildDays(); renderDays(); updateSummary(); log('ready '+MONTH_KEY);
})();
