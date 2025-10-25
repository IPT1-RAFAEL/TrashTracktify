const socket = io("https://trashtracktify.onrender.com");
// const socket = io("http://localhost:3000");

const daysOfWeek = ['MON','TUE','WED','THU','FRI','SAT','SUN'];

async function loadSchedule() {
  try {
    const res = await fetch('/schedule');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const schedules = await res.json();
    const byBarangay = {};
    schedules.forEach(s => {
      if (!byBarangay[s.barangay]) byBarangay[s.barangay] = {};
      byBarangay[s.barangay][s.day] = s.start_time;
    });

    ['Tugatog','Acacia','Tinajeros'].forEach(b => {
      const el = document.getElementById(`${b}-days`);
      if (!el) return;
      el.innerHTML = '';
      daysOfWeek.forEach(d => {
        const t = byBarangay[b]?.[d] || 'N/A';
        const sp = document.createElement('span');
        sp.textContent = `${d}: ${t === 'N/A' ? t : t.slice(0,5)}`;
        el.appendChild(sp);
      });
    });
  } catch (e) {
    console.error('loadSchedule error', e);
  }
}

socket.on('schedule-update', loadSchedule);
loadSchedule();
