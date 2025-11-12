// ICS Maker logic – mirrors Turner_13.py behavior (UTC times, VEVENT + optional VALARM)
(function(){
  const form = document.getElementById('icsForm');
  if (!form) return;

  function pad(n){ return String(n).padStart(2,'0'); }

  function toUtcString(dt){
    const y = dt.getUTCFullYear();
    const m = pad(dt.getUTCMonth()+1);
    const d = pad(dt.getUTCDate());
    const hh = pad(dt.getUTCHours());
    const mm = pad(dt.getUTCMinutes());
    const ss = pad(dt.getUTCSeconds());
    return `${y}${m}${d}T${hh}${mm}${ss}Z`;
  }

  function escapeText(s){
    return String(s)
      .replace(/\\/g, "\\\\")
      .replace(/;/g, "\\;")
      .replace(/,/g, "\\,")
      .replace(/\r\n|\n/g, "\\n");
  }

  function foldLine(line, limit=75){
    const parts=[];
    while(line.length>limit){
      parts.push(line.slice(0,limit));
      line = ' ' + line.slice(limit);
    }
    parts.push(line);
    return parts;
  }

  function linesToIcs(lines){
    const out=[];
    lines.forEach(ln=> out.push(...foldLine(ln)) );
    return out.join('\r\n') + '\r\n';
  }

  function buildEvent({title, start, end, durationMin, description, location, reminderMin}){
    const uid = `${crypto.randomUUID?.()||Math.random().toString(36).slice(2)}@turner`;
    const dtstamp = toUtcString(new Date());

    if (!end && durationMin){
      end = new Date(start.getTime() + durationMin*60*1000);
    }
    if (!end){
      throw new Error('Provide end time or duration');
    }

    const lines = [];
    lines.push('BEGIN:VEVENT');
    lines.push('UID:' + uid);
    lines.push('DTSTAMP:' + dtstamp);
    lines.push('DTSTART:' + toUtcString(start));
    lines.push('DTEND:' + toUtcString(end));
    if (title) lines.push('SUMMARY:' + escapeText(title));
    if (description) lines.push('DESCRIPTION:' + escapeText(description));
    if (location) lines.push('LOCATION:' + escapeText(location));

    const r = Number(reminderMin);
    if (!Number.isNaN(r) && r>0){
      lines.push('BEGIN:VALARM');
      lines.push('ACTION:DISPLAY');
      lines.push('TRIGGER:-PT' + Math.round(r) + 'M');
      lines.push('DESCRIPTION:' + escapeText(title||'Reminder'));
      lines.push('END:VALARM');
    }

    lines.push('END:VEVENT');
    return lines;
  }

  function buildCalendar(eventLines){
    const lines = [];
    lines.push('BEGIN:VCALENDAR');
    lines.push('PRODID:-//Turner//ICS Maker//EN');
    lines.push('VERSION:2.0');
    lines.push('CALSCALE:GREGORIAN');
    lines.push('METHOD:PUBLISH');
    lines.push(...eventLines);
    lines.push('END:VCALENDAR');
    return linesToIcs(lines);
  }

  function parseLocalDateTime(dateStr, timeStr){
    // Interpret as local time then convert to UTC string later
    const [y,m,d] = dateStr.split('-').map(Number);
    const [hh,mm] = (timeStr||'00:00').split(':').map(Number);
    return new Date(y, (m||1)-1, d||1, hh||0, mm||0, 0, 0);
  }

  function sanitizeFilename(s){
    return s.replace(/[^a-z0-9-_]+/gi,'_').replace(/_+/g,'_').replace(/^_|_$/g,'');
  }

  function download(filename, text){
    const blob = new Blob([text], {type: 'text/calendar;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(()=>{ URL.revokeObjectURL(url); a.remove(); }, 0);
  }

  form.addEventListener('submit', function(ev){
    ev.preventDefault();

    const fd = new FormData(form);
    const title = (fd.get('title')||'').toString().trim();
    const startDate = fd.get('startDate');
    const startTime = fd.get('startTime');
    const endDate = fd.get('endDate');
    const endTime = fd.get('endTime');
    const duration = parseInt((fd.get('duration')||'').toString(), 10);
    const reminder = parseInt((fd.get('reminder')||'').toString(), 10);
    const location = (fd.get('location')||'').toString();
    const desc = (fd.get('desc')||'').toString();

    if (!title) return alert('Please enter a Title.');
    if (!startDate || !startTime) return alert('Please enter a Start date and time.');

    const start = parseLocalDateTime(startDate.toString(), startTime.toString());
    let end = null;

    if ((endDate && endDate.toString()) || (endTime && endTime.toString())){
      if (!endDate || !endTime) return alert('Please provide both End date and End time, or use Duration.');
      end = parseLocalDateTime(endDate.toString(), endTime.toString());
      if (end <= start) return alert('End must be after Start.');
    }

    const durationMin = !Number.isNaN(duration) && duration>0 ? duration : null;

    try {
      const evLines = buildEvent({
        title,
        start,
        end,
        durationMin,
        description: desc,
        location,
        reminderMin: !Number.isNaN(reminder) && reminder>0 ? reminder : null,
      });
      const ics = buildCalendar(evLines);

      const datePart = `${start.getFullYear()}-${pad(start.getMonth()+1)}-${pad(start.getDate())}`;
      const base = sanitizeFilename(title) || 'event';
      const filename = `${base}_${datePart}.ics`;

      download(filename, ics);
    } catch(e){
      console.error(e);
      alert('Could not generate event: ' + (e?.message||e));
    }
  });
})();
