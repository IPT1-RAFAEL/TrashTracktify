const socket = io("https://trashtracktify.onrender.com");

// === TOAST NOTIFICATION SYSTEM ===
function showToast(message, type = 'success', duration = 2000) {
  // Remove any existing toast
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;

  // Style it
  Object.assign(toast.style, {
    position: 'fixed',
    bottom: '20px',
    right: '20px',
    minWidth: '200px',
    padding: '12px 20px',
    borderRadius: '8px',
    color: 'white',
    fontWeight: '600',
    fontSize: '0.95rem',
    boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
    transform: 'translateY(100px)',
    opacity: '0',
    transition: 'all 0.3s ease',
    zIndex: '10000',
    pointerEvents: 'none'
  });

  // Color by type
  const colors = {
    success: '#4caf50',
    error: '#f44336',
    info: '#2196f3',
    warning: '#ff9800'
  };
  toast.style.backgroundColor = colors[type] || colors.info;

  document.body.appendChild(toast);

  // Trigger animation
  requestAnimationFrame(() => {
    toast.style.transform = 'translateY(0)';
    toast.style.opacity = '1';
  });

  // Auto-remove
  setTimeout(() => {
    toast.style.transform = 'translateY(100px)';
    toast.style.opacity = '0';
    toast.addEventListener('transitionend', () => toast.remove());
  }, duration);
}

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

// Status widgets
const capacityArc = document.querySelector('.truck-status-card .progress-ring .fg');
const capacityPercent = document.getElementById('tsPercent');
const roundCountEl = document.getElementById('roundCount');

// Residents table
const residentTableBody = document.querySelector('#residentTable tbody');



// In-memory data
let SCHEDULE_LOOKUP = {};
let CALENDAR_EVENTS = {}; // *** NEW: Stores fetched events { 'YYYY-MM-DD': { type, description }, ... }

const BARANGAYS = ['Tugatog','Acacia','Tinajeros'];
const DAYS = ['MON','TUE','WED','THU','FRI','SAT','SUN'];

// --- Utility Functions ---
function setCapacity(percent) {
    const p = Math.max(0, Math.min(100, Math.round(percent)));
    const dashOffset = 100 - p;
    if (capacityArc) capacityArc.style.strokeDashoffset = dashOffset;
    if (capacityPercent) capacityPercent.textContent = `${p}%`;
}
function setRoundTrips(n) {
    if (roundCountEl) roundCountEl.textContent = n;
}





// --- Data Loading ---
async function loadSchedule() {
    try {
        const res = await fetch('/schedule');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const schedules = await res.json();
        SCHEDULE_LOOKUP = {};
        schedules.forEach(s => {
            if (!SCHEDULE_LOOKUP[s.barangay]) SCHEDULE_LOOKUP[s.barangay] = {};
            SCHEDULE_LOOKUP[s.barangay][s.day] = s;
        });
        renderBarangays();
    } catch (err) {
        console.error('loadSchedule error:', err);
    }
}

// *** NEW ***
async function loadCalendarEvents() {
    try {
        const res = await fetch('/calendar/events');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const events = await res.json();
        CALENDAR_EVENTS = {};
        events.forEach(event => {
            CALENDAR_EVENTS[event.event_date] = {
                type: event.event_type,
                description: event.description
            };
        });
        console.log("Calendar events loaded:", CALENDAR_EVENTS);
    } catch (err) {
        console.error("Failed to load calendar events:", err);
        CALENDAR_EVENTS = {};
    }
}

async function loadAndRenderUsers() {
    if (!residentTableBody) return;
    try {
        const res = await fetch('/users');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const users = await res.json();
        residentTableBody.innerHTML = '';
        if (!users || users.length === 0) {
            residentTableBody.innerHTML = '<tr><td colspan="5">No residents found.</td></tr>'; return;
        }
        users.forEach((r) => {
            const tr = document.createElement('tr');
            tr.innerHTML = `<td>${r.id}</td><td>${r.name ?? 'N/A'}</td><td>${r.phone || ''}</td><td>${r.barangay || ''}</td><td>${r.street || ''}</td>`;
            residentTableBody.appendChild(tr);
        });
    } catch (err) {
        console.error("Failed to load users table:", err);
        residentTableBody.innerHTML = `<tr><td colspan="5">Error loading residents.</td></tr>`;
    }
}

// --- Render Barangay Cards ---
function renderBarangays() {
  if (!barangayListEl) return;
  barangayListEl.innerHTML = '';

  const today = new Date();
  const formattedDate = today.toLocaleDateString('en-US', {
    day: '2-digit',
    month: 'long',
    year: 'numeric'
  });

  BARANGAYS.forEach(b => {
    const wrapper = document.createElement('div');
    wrapper.className = 'barangay-card';

    const barangayName = document.createElement('h3');
    barangayName.className = 'barangay-name';
    barangayName.textContent = b;
    wrapper.appendChild(barangayName);

    const dateEl = document.createElement('div');
    dateEl.className = 'barangay-date';
    dateEl.textContent = formattedDate;
    wrapper.appendChild(dateEl);

    const infoRow = document.createElement('div');
    infoRow.className = 'barangay-info';

    // Barangay label
    const barangayLabel = document.createElement('span');
    barangayLabel.innerHTML = `Barangay <b>${b}</b>`;

    // Day label
    const currentDay = today.toLocaleDateString('en-US', { weekday: 'long' });
    const dayKey = today.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
    const dayLabel = document.createElement('span');
    dayLabel.innerHTML = `Day <b>${currentDay}</b>`;

    // Time section
    const timeWrapper = document.createElement('span');
    const rec = SCHEDULE_LOOKUP[b]?.[dayKey];
    const currentTime = rec?.start_time ? rec.start_time.slice(0, 5) : '';

    const timeInput = document.createElement('input');
    timeInput.type = 'time';
    timeInput.className = 'barangay-time-input';
    timeInput.value = currentTime || '';
    timeInput.title = 'Click to set time';

    // Save button
    const saveBtn = document.createElement('button');
    saveBtn.textContent = 'Save';
    saveBtn.className = 'btn save-btn';
    saveBtn.style.padding = '4px 8px';
    saveBtn.style.fontSize = '0.8rem';
    saveBtn.style.marginLeft = '8px';
    saveBtn.type = 'button';
    
    // Save button logic
    saveBtn.addEventListener('click', async () => {

      const start_time = timeInput.value + ':00';
      
      // Provide user feedback
      const originalText = saveBtn.textContent;
      saveBtn.textContent = '...';
      saveBtn.disabled = true;

      try {
        const res = await fetch('/schedule', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            barangay: b,
            day: dayKey,
            start_time,
            updated_by: 'admin'
          })
        });
        if (!res.ok) throw new Error('Failed to save');
        
        saveBtn.textContent = 'OK!';
        showToast('Time Set Successfully', 'success');

        // Update in-memory data
        if (!SCHEDULE_LOOKUP[b]) SCHEDULE_LOOKUP[b] = {};
        if (!SCHEDULE_LOOKUP[b][dayKey]) SCHEDULE_LOOKUP[b][dayKey] = {};
        SCHEDULE_LOOKUP[b][dayKey].start_time = start_time;

      } catch (err) {
        console.error(err);
        showToast('Failed to save time', 'error');
        saveBtn.textContent = 'Fail';
      } finally {
        setTimeout(() => {
          saveBtn.textContent = originalText;
          saveBtn.disabled = false;
        }, 1500);
      }
    });

    timeWrapper.innerHTML = 'Time ';
    timeWrapper.appendChild(timeInput);
    timeWrapper.appendChild(saveBtn);

    infoRow.append(barangayLabel, dayLabel, timeWrapper);
    wrapper.appendChild(infoRow);

    barangayListEl.appendChild(wrapper);
  });
}



// -Generate Calendar ---
function generateCalendar() {
    if (!calendarBody || !monthLabel) return;
    calendarBody.innerHTML = '';
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const firstDay = new Date(year, month, 1);
    const startDow = firstDay.getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    monthLabel.textContent = `${firstDay.toLocaleString('en-US',{month:'long'})} ${year}`;

    // Add leading cells
    for (let i = 0; i < startDow; i++) { 
        calendarBody.appendChild(document.createElement('div')).className = 'cell disabled'; 
    }

    // Create day cells
    for (let d = 1; d <= daysInMonth; d++) {
        const cell = document.createElement('div'); cell.className = 'cell'; cell.className = 'cell';
        cell.textContent = d;

        if (d === now.getDate() && month === now.getMonth() && year === now.getFullYear()) {
            cell.classList.add('today');
        }

        cell.style.cursor = 'default';
        calendarBody.appendChild(cell);
    }

    const totalCells = calendarBody.children.length; const remainder = (7 - (totalCells % 7)) % 7;
    for (let i = 0; i < remainder; i++) { 
        calendarBody.appendChild(document.createElement('div')).className = 'cell disabled'; 
    }
}
// --- END MODIFIED ---

// --- Popups ---
function openEditPopup(barangay, day, currentTime) {
    if (!editPopup || !editBarangayEl || !editDayEl || !editTimeInput) return;
    editBarangayEl.textContent = barangay;
    editDayEl.textContent = day;
    editTimeInput.value = currentTime ? currentTime.slice(0, 5) : '08:00'; // HH:MM for input
    editMsg.textContent = '';
    editPopup.classList.add('show');
}
function closeEditPopup() { editPopup?.classList.remove('show'); }
cancelEditBtn?.addEventListener('click', closeEditPopup);
editForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!editBarangayEl || !editDayEl || !editTimeInput) return;
    const barangay = editBarangayEl.textContent;
    const day = editDayEl.textContent;
    const timeValue = editTimeInput.value;
    if (!timeValue) { editMsg.textContent = 'Please pick a time'; return; }
    const start_time = timeValue + ':00';
    editMsg.textContent = 'Saving...';
    try {
        const res = await fetch('/schedule', {
            method: 'POST',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ barangay, day, start_time, updated_by: 'admin' })
        });
        const result = await res.json();
        if (!res.ok) throw new Error(result.error || 'Save failed');
        editMsg.textContent = 'Saved';
        showToast('Schedule Updated Successfully', 'success');
        setTimeout(closeEditPopup, 600);
    } catch (err) {
        console.error('save schedule error:', err);
        editMsg.textContent = err.message || 'Save failed';
        showToast('Failed to update schedule', 'error');
    }
});



async function loadInitial() {
    try {
        await loadSchedule();
        await loadCalendarEvents();
        generateCalendar();
        await loadAndRenderUsers();
        try {
            const capRes = await fetch('/stats/current-capacity'); if (capRes.ok) setCapacity((await capRes.json()).percentFull ?? 0);
            const tripRes = await fetch('/stats/round-trips'); if (tripRes.ok) setRoundTrips((await tripRes.json()).count ?? 0);
        } catch(e){ console.warn("Could not load stats", e.message); setCapacity(0); setRoundTrips(0); }
    } catch (err) { console.warn('initial load failed', err); }
}

// --- Socket Listeners ---
socket.on('truck-status', (data) => { if (data?.percentFull !== undefined) setCapacity(data.percentFull); });
socket.on('round-trip', (data) => { if (data?.count !== undefined) setRoundTrips(data.count); });
socket.on('schedule-update', loadSchedule);
socket.on('registered-stats-update', loadAndRenderUsers);
// socket.on('trip-update', (count) => setRoundTrips(count)); // This seems redundant with 'round-trip'

// *** NEW ***
socket.on('calendar-update', async () => {
    console.log("Calendar update received, reloading events and calendar...");
    await loadCalendarEvents();
    generateCalendar();
});

// Start initial load
loadInitial();