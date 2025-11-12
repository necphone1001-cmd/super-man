/* Turner Planner - lightweight PWA for iPhone (iOS 16+)
   Features: tasks/appointments, reminders (web notifications), ICS export, maps deep links,
   photo attachments (stored locally), JSON import/export, offline via service worker.
*/
(function(){
  'use strict';

  // ------- Utilities -------
  const $ = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));

  const today = () => new Date();
  const fmtDateKey = d => d.toISOString().slice(0,10); // YYYY-MM-DD
  const pad = n => (n<10? '0'+n : ''+n);
  const fmtTime = d => pad(d.getHours())+":"+pad(d.getMinutes());

  function toUTC(dt){ // return YYYYMMDDTHHMMSSZ
    const z = new Date(dt.getTime());
    return z.toISOString().replace(/[-:]/g,'').split('.')[0]+'Z';
  }
  function escapeText(s){
    return (s||'').replace(/\\/g,'\\\\').replace(/;/g,'\\;').replace(/,/g,'\\,').replace(/\r?\n/g,'\\n');
  }
  function buildICS(ev){
    const lines = [];
    const uid = ev.id + '@turnerplanner';
    const now = toUTC(new Date());
    const start = toUTC(new Date(ev.start));
    const end = toUTC(new Date(ev.end || (new Date(new Date(ev.start).getTime()+60*60*1000))));
    lines.push('BEGIN:VCALENDAR');
    lines.push('PRODID:-//Turner//Planner//EN');
    lines.push('VERSION:2.0');
    lines.push('CALSCALE:GREGORIAN');
    lines.push('METHOD:PUBLISH');
    lines.push('BEGIN:VEVENT');
    lines.push('UID:'+uid);
    lines.push('DTSTAMP:'+now);
    lines.push('DTSTART:'+start);
    lines.push('DTEND:'+end);
    if (ev.title) lines.push('SUMMARY:'+escapeText(ev.title));
    if (ev.location) lines.push('LOCATION:'+escapeText(ev.location));
    if (ev.notes) lines.push('DESCRIPTION:'+escapeText(ev.notes));
    if (ev.repeat === 'daily') lines.push('RRULE:FREQ=DAILY');
    if (ev.repeat === 'weekly') lines.push('RRULE:FREQ=WEEKLY');
    if (ev.reminderMin && ev.reminderMin>0){
      lines.push('BEGIN:VALARM');
      lines.push('ACTION:DISPLAY');
      lines.push('TRIGGER:-PT'+Math.floor(ev.reminderMin)+'M');
      lines.push('DESCRIPTION:'+escapeText(ev.title||'Reminder'));
      lines.push('END:VALARM');
    }
    lines.push('END:VEVENT');
    lines.push('END:VCALENDAR');
    return lines.join('\r\n')+'\r\n';
  }
  function download(filename, text){
    const blob = new Blob([text], {type:'text/calendar;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click();
    setTimeout(()=>{ URL.revokeObjectURL(url); a.remove(); }, 500);
  }

  function appleMapsUrl(q){
    return 'https://maps.apple.com/?q='+encodeURIComponent(q);
  }
  function googleMapsUrl(q){
    // Try deep link first; if app not installed iOS will ask to open in web
    return 'comgooglemaps://?q='+encodeURIComponent(q);
  }
  function gcalEventUrl(ev){
    // Google Calendar event creation URL
    const base = 'https://calendar.google.com/calendar/render?action=TEMPLATE';
    const text = '&text=' + encodeURIComponent(ev.title || 'Event');
    const details = '&details=' + encodeURIComponent(ev.notes || '');
    const location = ev.location ? ('&location=' + encodeURIComponent(ev.location)) : '';
    const start = new Date(ev.start);
    const end = new Date(ev.end || (start.getTime()+60*60*1000));
    const fmt = d => d.toISOString().replace(/[-:]/g,'').split('.')[0] + 'Z';
    const dates = '&dates=' + fmt(start) + '/' + fmt(end);
    let recur = '';
    if (ev.repeat === 'daily') recur = '&recur=RRULE:FREQ%3DDAILY';
    if (ev.repeat === 'weekly') recur = '&recur=RRULE:FREQ%3DWEEKLY';
    return base + text + details + location + dates + recur;
  }
  function gcalOpenDayUrl(dateKey){
    // Open Google Calendar in day view for the given date
    const [y,m,d] = dateKey.split('-');
    return `https://calendar.google.com/calendar/u/0/r/day/${y}/${parseInt(m,10)}/${parseInt(d,10)}`;
  }
  function buildICSForItems(items){
    const lines = [];
    lines.push('BEGIN:VCALENDAR');
    lines.push('PRODID:-//Turner//Planner//EN');
    lines.push('VERSION:2.0');
    lines.push('CALSCALE:GREGORIAN');
    lines.push('METHOD:PUBLISH');
    for(const ev of items){
      const ics = buildICS(ev).split('\r\n');
      // extract VEVENT block and append
      let begin = ics.indexOf('BEGIN:VEVENT');
      let end = ics.indexOf('END:VEVENT');
      if (begin !== -1 && end !== -1){
        lines.push(...ics.slice(begin, end+1));
      }
    }
    lines.push('END:VCALENDAR');
    return lines.join('\r\n')+'\r\n';
  }

  // ------- Storage (localStorage MVP) -------
  const KEY = 'turner_planner_v1';
  function loadAll(){
    try{ return JSON.parse(localStorage.getItem(KEY)||'[]'); }catch{ return []; }
  }
  function saveAll(items){
    localStorage.setItem(KEY, JSON.stringify(items));
  }

  // ------- State -------
  let state = {
    date: fmtDateKey(today()), // YYYY-MM-DD
    filter: 'all',
    items: loadAll(), // array of {id,type,title,start,end,reminderMin,location,notes,photoData}
  };

  // ------- UI Elements -------
  const dateLabel = $('#dateLabel');
  const prevDay = $('#prevDay');
  const nextDay = $('#nextDay');
  const titleInput = $('#titleInput');
  const timeInput = $('#timeInput');
  const reminderInput = $('#reminderInput');
  const repeatSelect = $('#repeatSelect');
  const locationInput = $('#locationInput');
  const addBtn = $('#addBtn');
  const itemList = $('#itemList');
  const notifyBtn = $('#notifyBtn');
  const exportBtn = $('#exportBtn');
  const exportDayIcsBtn = $('#exportDayIcsBtn');
  const openDayGCalBtn = $('#openDayGCalBtn');
  const importBtn = $('#importBtn');
  const importFile = $('#importFile');
  const installBtn = $('#installBtn');

  // ------- Install (A2HS) -------
  let deferredPrompt;
  window.addEventListener('beforeinstallprompt', (e)=>{
    e.preventDefault();
    deferredPrompt = e;
    installBtn.hidden = false;
  });
  installBtn?.addEventListener('click', async ()=>{
    installBtn.hidden = true;
    if (deferredPrompt){
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt = null;
    }
  });

  // ------- Service worker -------
  if ('serviceWorker' in navigator){
    navigator.serviceWorker.register('service-worker.js');
  }

  // ------- Notifications -------
  notifyBtn.addEventListener('click', async ()=>{
    if (!('Notification' in window)){
      alert('Notifications not supported on this device.');
      return;
    }
    let perm = Notification.permission;
    if (perm === 'default') perm = await Notification.requestPermission();
    if (perm !== 'granted'){
      alert('Reminders disabled (permission not granted). You can still add Calendar alarms.');
    } else {
      alert('Reminders enabled for active sessions. For background reminders, add to Home Screen and keep the app open in the background.');
    }
  });

  function scheduleReminder(item){
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    if (!item.reminderMin || item.reminderMin <= 0) return;
    const start = new Date(item.start).getTime();
    const fireAt = start - item.reminderMin*60000;
    const delta = fireAt - Date.now();
    if (delta <= 0) return;
    setTimeout(()=>{
      new Notification(item.title || 'Reminder', { body: item.location? ('At '+item.location) : '' });
    }, Math.min(delta, 2**31-1));
  }

  // ------- Rendering -------
  function setDate(d){
    state.date = fmtDateKey(d);
    render();
  }
  function render(){
    const d = new Date(state.date+'T00:00:00');
    const todayKey = fmtDateKey(today());
    dateLabel.textContent = state.date === todayKey ? 'Today' : d.toLocaleDateString();
    $$('.chip').forEach(ch=>ch.classList.toggle('active',
      (ch.id==='showAll' && state.filter==='all')||
      (ch.id==='showTasks' && state.filter==='task')||
      (ch.id==='showAppts' && state.filter==='appt')
    ));

    const items = state.items
      .filter(it => it.date === state.date)
      .filter(it => state.filter==='all' || (state.filter==='task' ? it.type==='task' : it.type==='appt'))
      .sort((a,b)=> new Date(a.start) - new Date(b.start));

    itemList.innerHTML='';
    for(const it of items){
      const node = renderItem(it);
      itemList.appendChild(node);
      scheduleReminder(it);
    }
  }

  function renderItem(it){
    const tpl = $('#itemTemplate');
    const li = tpl.content.firstElementChild.cloneNode(true);
    li.dataset.id = it.id;
    li.querySelector('.time').textContent = fmtTime(new Date(it.start));
    li.querySelector('.title').textContent = it.title;
    li.querySelector('.location').textContent = it.location || '';

    // Actions
    li.querySelector('.delete').addEventListener('click', ()=>{
      state.items = state.items.filter(x=>x.id!==it.id); saveAll(state.items); render();
    });
    li.querySelector('.calendar').addEventListener('click', ()=>{
      const ics = buildICS(it);
      download((it.title||'event')+'.ics', ics);
    });
    const gcalBtn = li.querySelector('.gcal');
    if (gcalBtn){
      gcalBtn.addEventListener('click', ()=>{
        const url = gcalEventUrl(it);
        window.open(url, '_blank');
      });
    }
    li.querySelector('.nav').addEventListener('click', ()=>{
      const q = it.location || it.title;
      if (!q) return;
      // Prefer Google Maps (user request), fallback to Apple Maps
      const g = googleMapsUrl(q);
      const a = appleMapsUrl(q);
      // Try to open Google Maps deep link first; if it fails, Apple Maps will still be available via share or back nav
      const iframe = document.createElement('iframe');
      iframe.style.display='none';
      iframe.src = g;
      document.body.appendChild(iframe);
      setTimeout(()=>{ window.location.href = a; iframe.remove(); }, 400);
    });
    const photoBtn = li.querySelector('.photo');
    const photoInput = li.querySelector('.photo-input');
    photoBtn.addEventListener('click', ()=> photoInput.click());
    photoInput.addEventListener('change', async ()=>{
      const file = photoInput.files[0];
      if (!file) return;
      const data = await fileToDataURL(file);
      it.photoData = data; saveAll(state.items); render();
    });
    if (it.photoData){
      const img = new Image();
      img.src = it.photoData; img.className='photo-thumb';
      li.querySelector('.right').insertBefore(img, photoBtn.nextSibling);
    }
    return li;
  }

  function fileToDataURL(file){
    return new Promise((resolve,reject)=>{
      const r = new FileReader();
      r.onload = ()=> resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }

  // ------- Events -------
  prevDay.addEventListener('click', ()=>{
    const d = new Date(state.date+'T00:00:00'); d.setDate(d.getDate()-1); setDate(d);
  });
  nextDay.addEventListener('click', ()=>{
    const d = new Date(state.date+'T00:00:00'); d.setDate(d.getDate()+1); setDate(d);
  });
  $('#showAll').addEventListener('click', ()=>{ state.filter='all'; render(); });
  $('#showTasks').addEventListener('click', ()=>{ state.filter='task'; render(); });
  $('#showAppts').addEventListener('click', ()=>{ state.filter='appt'; render(); });

  addBtn.addEventListener('click', ()=>{
    const title = titleInput.value.trim();
    if (!title) return;
    const t = timeInput.value || '09:00';
    const [hh,mm] = t.split(':').map(Number);
    const d = new Date(state.date+'T00:00:00'); d.setHours(hh,mm,0,0);
    const reminderMin = parseInt(reminderInput.value||'0',10) || 0;
    const loc = locationInput.value.trim();

    const item = {
      id: crypto.randomUUID(),
      type: title.match(/\b(meet|appt|call|doctor|dentist|interview|zoom)\b/i) ? 'appt' : 'task',
      title,
      date: state.date,
      start: d.toISOString(),
      end: new Date(d.getTime()+60*60*1000).toISOString(),
      reminderMin,
      repeat: (repeatSelect?.value || 'none'),
      location: loc || '',
      notes: '',
      photoData: null,
    };
    state.items.push(item); saveAll(state.items); render();
    titleInput.value=''; timeInput.value=''; reminderInput.value=''; locationInput.value='';
  });

  exportBtn.addEventListener('click', ()=>{
    const json = JSON.stringify(state.items, null, 2);
    const blob = new Blob([json], {type:'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href=url; a.download='turner_planner_export.json'; document.body.appendChild(a); a.click();
    setTimeout(()=>{ URL.revokeObjectURL(url); a.remove(); }, 500);
  });

  exportDayIcsBtn.addEventListener('click', ()=>{
    const items = state.items.filter(it=>it.date===state.date);
    if (!items.length){ alert('No items on this day.'); return; }
    const ics = buildICSForItems(items);
    download(state.date + '.ics', ics);
  });
  openDayGCalBtn.addEventListener('click', ()=>{
    const url = gcalOpenDayUrl(state.date);
    window.open(url, '_blank');
  });

  importBtn.addEventListener('click', ()=> importFile.click());
  importFile.addEventListener('change', async ()=>{
    const file = importFile.files[0]; if (!file) return;
    try{
      const text = await file.text();
      const items = JSON.parse(text);
      if (Array.isArray(items)){
        state.items = items; saveAll(state.items); render();
      } else {
        alert('Invalid JSON');
      }
    }catch(err){ alert('Import failed: '+err); }
  });

  // Initialize date and render
  setDate(new Date());
})();
