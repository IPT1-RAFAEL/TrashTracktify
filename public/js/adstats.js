const socket = io("https://trashtracktify.onrender.com");
// const socket = io("http://localhost:3000");

// Elements
const barangayListEl = document.getElementById('barangayList');
const editPopup = document.getElementById('editSchedulePopup');
const editBarangayEl = document.getElementById('editBarangay');
const editDayEl = document.getElementById('editDay');
const editTimeInput = document.getElementById('editTime');
const editMsg = document.getElementById('editMsg');
const editForm = document.getElementById('editScheduleForm');
const cancelEditBtn = document.getElementById('cancelEditBtn');

const calendarBody = document.getElementById('calendarBody');
const monthLabel = document.getElementById('monthLabel');

// status widgets
const capacityArc = document.querySelector('.truck-status-card .progress-ring .fg');
const capacityPercent = document.getElementById('tsPercent'); 
const roundCountEl = document.getElementById('roundCount');

// --- FIX: Renamed element to be clear ---
const residentTableBody = document.querySelector('#residentTable tbody');

// in-memory schedule lookup
let SCHEDULE_LOOKUP = {}; // { barangay: { MON: {start_time, holiday, ...}, ... }, ... }

const BARANGAYS = ['Tugatog','Acacia','Tinajeros'];
const DAYS = ['MON','TUE','WED','THU','FRI','SAT','SUN'];

// --- Utility ---
function setCapacity(percent) {
  const p = Math.max(0, Math.min(100, Math.round(percent)));
  const dashOffset = 100 - p;
  if (capacityArc) {
    capacityArc.style.strokeDashoffset = dashOffset;
  }
  if (capacityPercent) {
    capacityPercent.textContent = `${p}%`;
  }
}
function setRoundTrips(n) {
  if (roundCountEl) roundCountEl.textContent = n;
}

// --- Load schedule from server and render barangay pills ---
async function loadSchedule() {
  try {
    const res = await fetch('/schedule');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const schedules = await res.json();
    // Build lookup
    SCHEDULE_LOOKUP = {};
    schedules.forEach(s => {
      if (!SCHEDULE_LOOKUP[s.barangay]) SCHEDULE_LOOKUP[s.barangay] = {};
      SCHEDULE_LOOKUP[s.barangay][s.day] = s;
    });
    renderBarangays();
  } catch (err) {
    console.error('loadSchedule', err);
  }
}

/* -------------------------
   renderBarangays()
   (This function is correct, no changes)
   ------------------------- */
function renderBarangays() {
  barangayListEl.innerHTML = '';
  BARANGAYS.forEach(b => {
    const card = document.createElement('div');
    card.className = 'barangay';
    const h = document.createElement('h2');
    h.textContent = b;
    card.appendChild(h);
    const daysWrap = document.createElement('div');
    daysWrap.className = 'days';
    DAYS.forEach(d => {
      const rec = (SCHEDULE_LOOKUP[b] && SCHEDULE_LOOKUP[b][d]) ? SCHEDULE_LOOKUP[b][d] : null;
      const timeText = rec && rec.start_time ? rec.start_time.slice(0,5) : '—';
      const span = document.createElement('div');
      span.className = 'day-span' + (timeText === '—' ? ' empty' : '');
      span.dataset.barangay = b;
      span.dataset.day = d;
      const lbl = document.createElement('div');
      lbl.className = 'day-label';
      lbl.textContent = d;
      const t = document.createElement('div');
      t.className = 'day-time';
      t.textContent = timeText;
      span.appendChild(lbl);
      span.appendChild(t);
      span.addEventListener('click', () => {
        const currentTime = rec && rec.start_time ? rec.start_time : '08:00';
        openEditPopup(b, d, currentTime);
      });
      daysWrap.appendChild(span);
    });
    card.appendChild(daysWrap);
    barangayListEl.appendChild(card);
  });
}

// --- Edit popup handlers ---
function openEditPopup(barangay, day, currentTime) {
  editBarangayEl.textContent = barangay;
  editDayEl.textContent = day;
  editTimeInput.value = currentTime ? currentTime.slice(0,5) : '08:00';
  editMsg.textContent = '';
  editPopup.classList.add('show');
  editPopup.setAttribute('aria-hidden','false');
}
function closeEditPopup() {
  editPopup.classList.remove('show');
  editPopup.setAttribute('aria-hidden','true');
}
cancelEditBtn.addEventListener('click', closeEditPopup);

// submit updated time
editForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const barangay = editBarangayEl.textContent;
  const day = editDayEl.textContent;
  const start_time = editTimeInput.value + ':00'; // Append seconds
  if (!editTimeInput.value) { editMsg.textContent = 'Please pick a time'; return; }
  editMsg.textContent = 'Saving...';

  try {
    // Corrected URL
    const res = await fetch('/schedule', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ barangay, day, start_time, updated_by: 'admin' })
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Save failed');

    if (!SCHEDULE_LOOKUP[barangay]) SCHEDULE_LOOKUP[barangay] = {};
    SCHEDULE_LOOKUP[barangay][day] = { barangay, day, start_time };
    renderBarangays();

    editMsg.textContent = 'Saved';
    setTimeout(()=> closeEditPopup(), 600);
  } catch (err) {
    console.error('save schedule', err);
    editMsg.textContent = err.message || 'Save failed';
  }
});

// --- Calendar generation (month view) ---
function generateCalendar() {
  calendarBody.innerHTML = '';
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const firstDay = new Date(year, month, 1);
  const startDow = firstDay.getDay(); // 0..6
  const daysInMonth = new Date(year, month+1, 0).getDate();
  monthLabel.textContent = `${firstDay.toLocaleDateString('en-US',{month:'long'})} ${year}`;

  for (let i=0;i<startDow;i++){
    const empty = document.createElement('div'); empty.className = 'cell disabled'; calendarBody.appendChild(empty);
  }
  for (let d=1; d<=daysInMonth; d++){
    const cell = document.createElement('div'); cell.className='cell';
    cell.dataset.date = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const num = document.createElement('div'); num.className='date-num'; num.textContent = d; cell.appendChild(num);
    if (d === now.getDate()) cell.classList.add('today');
    cell.addEventListener('click', () => {
      const dateStr = cell.dataset.date;
      window.open(`/admin/pickups?date=${encodeURIComponent(dateStr)}`, '_blank');
    });
    calendarBody.appendChild(cell);
  }
  const total = calendarBody.children.length;
  const remainder = (7 - (total % 7)) % 7;
  for (let i=0;i<remainder;i++){ const empty = document.createElement('div'); empty.className='cell disabled'; calendarBody.appendChild(empty); }
}


// --- FIX #1: This function now fetches from /users and populates the table ---
async function loadAndRenderUsers() {
  if (!residentTableBody) return; // Don't run if the table isn't on the page

  try {
    // Fetch from the correct /users endpoint
    const res = await fetch('/users'); 
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const users = await res.json();
    
    residentTableBody.innerHTML = ''; // Clear the table
    if (!users || users.length === 0) {
         residentTableBody.innerHTML = '<tr><td colspan="5">No residents found.</td></tr>';
         return;
    }
    
    users.forEach((r) => {
        const tr = document.createElement('tr');
        // Use the data from the /users endpoint
        tr.innerHTML = `<td>${r.id}</td>
                        <td>${r.name ?? 'N/A'}</td>
                        <td>${r.phone || ''}</td>
                        <td>${r.barangay || ''}</td>
                        <td>${r.street || ''}</td>`; // <-- Street is included here
        residentTableBody.appendChild(tr);
    });
  } catch (err) {
      console.error("Failed to load users table:", err);
      residentTableBody.innerHTML = `<tr><td colspan="5">Error loading residents.</td></tr>`;
  }
}

// --- FIX #2: All chart functions are removed ---


// --- Initial loads: schedule + residents table ---
async function loadInitial() {
  try {
    await loadSchedule();
    generateCalendar();

    // --- FIX #3: Call the function to load the table ---
    await loadAndRenderUsers();

    // fetch current trip count and capacity (this is fine)
    // You might not have these endpoints, so we'll wrap in try/catch
    try {
        const capRes = await fetch('/stats/current-capacity');
        if (capRes.ok) {
          const cap = await capRes.json();
          setCapacity(cap.percentFull ?? 0);
        }
        const tripRes = await fetch('/stats/round-trips');
        if (tripRes.ok) {
          const t = await tripRes.json();
          setRoundTrips(t.count ?? 0);
        }
    } catch (e) {
        console.warn("Could not load optional stats (capacity/trips)", e.message);
        // Set defaults if they fail
        setCapacity(0);
        setRoundTrips(0);
    }

  } catch (err) {
    console.warn('initial load failed', err);
  }
}

// --- Socket listeners ---
socket.on('truck-status', (data) => {
  if (!data) return;
  if (typeof data.percentFull === 'number') {
    setCapacity(data.percentFull);
  }
});

socket.on('round-trip', (data) => {
  if (data && typeof data.count === 'number') setRoundTrips(data.count);
});

socket.on('schedule-update', () => {
  console.log('Schedule update received from server, reloading...');
  loadSchedule();
});

// --- FIX #4: Listen for the correct event to refresh the table ---
// This event is fired by your server when a new user registers.
socket.on('registered-stats-update', () => {
  console.log('New registration detected, refreshing user table...');
  loadAndRenderUsers(); // Refresh the user table
});

// trip count sync (server may broadcast)
socket.on('trip-update', (count) => {
  setRoundTrips(count);
});

// initial load
loadInitial();