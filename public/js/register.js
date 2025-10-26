

// Utility function to format time
function formatTime12Hour(timeString) {
  if (!timeString || typeof timeString !== 'string') {
    return '—';
  }
  const [hours, minutes] = timeString.split(':');
  if (hours === undefined || minutes === undefined) {
    return '—';
  }
  let h = parseInt(hours, 10);
  const m = parseInt(minutes, 10);
  if (isNaN(h) || isNaN(m)) {
    return '—';
  }
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) {
    h = 12;
  }
  const formattedMinutes = m < 10 ? `0${m}` : m;
  return `${h}:${formattedMinutes} ${ampm}`;
}

// Define functions at the top level
async function loadSchedule() {
  try {
    const response = await fetch('/schedule');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const schedules = await response.json();
    const scheduleByBarangay = {};
    schedules.forEach(s => {
      if (!scheduleByBarangay[s.barangay]) scheduleByBarangay[s.barangay] = {};
      scheduleByBarangay[s.barangay][s.day] = s;
    });
    window.__SCHEDULE_LOOKUP = scheduleByBarangay;
  } catch (err) {
    console.error('[Register] loadSchedule error', err);
  }
}

async function loadCalendarEvents() {
  try {
    const res = await fetch('/calendar/events');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const events = await res.json();
    window.CALENDAR_EVENTS = {}; // Make it global
    events.forEach(event => {
      window.CALENDAR_EVENTS[event.event_date] = {
        type: event.event_type,
        description: event.description
      };
    });
    console.log("[Register] User calendar events (All) loaded:", window.CALENDAR_EVENTS);
  } catch (err) {
    console.error("[Register] Failed to load calendar events:", err);
    window.CALENDAR_EVENTS = {};
  }
}

const msgBox = document.getElementById('popupMsg');
const form = document.getElementById('popupForm');
const barangaySelect = document.querySelector('#popupForm select[name="barangay"]');
const streetSelect = document.getElementById('streetSelect');

// --- TOAST NOTIFICATION SYSTEM ---
function showToast(message, type = 'success', duration = 2000) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;

  Object.assign(toast.style, {
    position: 'fixed', bottom: '20px', right: '20px',
    minWidth: '200px', padding: '12px 20px',
    borderRadius: '8px', color: 'white', fontWeight: '600',
    fontSize: '0.95rem', boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
    transform: 'translateY(100px)', opacity: '0',
    transition: 'all 0.3s ease', zIndex: '10000', pointerEvents: 'none'
 });
  const colors = { success: '#4caf50', error: '#f44336', info: '#2196f3', warning: '#ff9800' };
  toast.style.backgroundColor = colors[type] || colors.info;

  document.body.appendChild(toast);

  requestAnimationFrame(() => {
    toast.style.transform = 'translateY(0)';
  });

  setTimeout(() => {
    toast.style.transform = 'translateY(100px)';
    toast.style.opacity = '0';
    toast.addEventListener('transitionend', () => toast.remove());
  }, duration);
}

// Data holders (moved to global scope)
const daysOfWeek = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
let allStreetsData = {};
let CALENDAR_EVENTS = {}; // Redundant now, but kept for clarity; use window.CALENDAR_EVENTS

// --- TRIP COUNTER ---
let tripCount = 0;
const tripCounterEl = document.getElementById('savedBarangay');

function updateTripCounter(count) {
  tripCount = count;
  if (tripCounterEl) {
    tripCounterEl.textContent = count;
  }
}

// Listen for real-time trip updates
if (window.socket) {
  window.socket.on('round-trip', (data) => {
    if (data?.count !== undefined) {
      updateTripCounter(data.count);
      showToast(`Trip Counter: ${data.count}`, 'info');
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  // --- Street Data Loading and Dynamic Dropdown Logic ---
  async function loadStreetData() {
    try {
      const response = await fetch('/data/streets.json');
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      allStreetsData = await response.json();
      console.log('[Register] Street data loaded successfully.');
      if (barangaySelect) {
        barangaySelect.disabled = false;
        updateStreetOptions();
      }
    } catch (error) {
      console.error("[Register] Failed to load street data:", error);
      if (barangaySelect) barangaySelect.disabled = true;
      if (streetSelect) {
        streetSelect.disabled = true;
        streetSelect.innerHTML = '<option value="" disabled selected>Error loading streets</option>';
      }
    }
  }

  function updateStreetOptions() {
    if (!barangaySelect || !streetSelect || Object.keys(allStreetsData).length === 0) {
      return;
    }
    const selectedBarangay = barangaySelect.value;
    streetSelect.innerHTML = '';
    streetSelect.disabled = true;
    if (selectedBarangay && allStreetsData[selectedBarangay]) {
      streetSelect.disabled = false;
      streetSelect.innerHTML = '<option value="" disabled selected>Select Street</option>';
      const streetNames = [...new Set(allStreetsData[selectedBarangay].map(item => item.name))];
      streetNames.sort();
      streetNames.forEach(streetName => {
        const option = document.createElement('option');
        option.value = streetName;
        option.textContent = streetName;
        streetSelect.appendChild(option);
      });
    } else {
      streetSelect.innerHTML = '<option value="" disabled selected>Select Barangay First</option>';
    }
  }

  if (barangaySelect && streetSelect) {
    barangaySelect.addEventListener('change', updateStreetOptions);
  }

  // --- Socket Event Handlers ---
  if (window.socket) {
    window.socket.on('schedule-update', async () => {
      console.log('[Register] Schedule updated via socket, reloading display...');
      await loadSchedule();
      if (typeof displayBarangay === 'function') {
        displayBarangay();
      }
      if (typeof updateTopTimeAndDay === 'function') {
        updateTopTimeAndDay();
      }
      if (typeof generateCalendar === 'function') {
        generateCalendar();
      }
    });

    window.socket.on('calendar-update', async () => {
      console.log('[Register] Calendar updated, reloading events...');
      await loadCalendarEvents();
      if (typeof updateTopTimeAndDay === 'function') {
        updateTopTimeAndDay();
      }
      if (typeof generateCalendar === 'function') {
        generateCalendar();
      }
    });
  } else {
    console.warn('[Register] Socket.IO not initialized, some features may not work.');
  }

  // --- Registration Form Submission Logic ---
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      msgBox.textContent = '';
      const formData = new FormData(e.target);
      const data = Object.fromEntries(formData.entries());
      data.name = (data.name || '').trim();
      data.phone = (data.phone || '').trim();
      data.barangay = (data.barangay || '').trim();
      data.street = (data.street || '').trim();
      if (!data.name) { msgBox.textContent = 'Name is required'; msgBox.style.color = 'red'; return; }
      if (!/^09\d{9}$/.test(data.phone)) { msgBox.textContent = 'Phone number must be 11 digits starting with 09'; msgBox.style.color = 'red'; return; }
      if (!data.barangay) { msgBox.textContent = 'Please select a Barangay.'; msgBox.style.color = 'red'; return; }
      if (!data.street) { msgBox.textContent = 'Please select a Street.'; msgBox.style.color = 'red'; return; }
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);
        const res = await fetch('/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
          signal: controller.signal
        });
        clearTimeout(timeoutId);
        const text = await res.text();
        let result;
        try {
          result = JSON.parse(text);
        } catch (e) {
          throw new Error('Server error');
        }
        if (!res.ok) throw new Error(result.error || `Server error ${res.status}`);
        msgBox.textContent = result.message || '✅ Registration successful!';
        msgBox.style.color = 'green';
        showToast('Registration Successful', 'success');
        e.target.reset();
        updateStreetOptions();
        if (data.barangay) {
          localStorage.setItem('userBarangay', data.barangay);
          const isDriverPage = document.body.classList.contains('driver-page') 
            || window.location.pathname.includes('driver');

          if (isDriverPage) {
            localStorage.setItem('driverBarangay', data.barangay);
          } else {
            localStorage.setItem('userBarangay', data.barangay);
          }
          if (typeof displayBarangay === 'function') displayBarangay();
          if (typeof updateTopTimeAndDay === 'function') updateTopTimeAndDay();
          if (typeof generateCalendar === 'function') generateCalendar();
        }
        setTimeout(() => {
          const registerPopup = document.getElementById('registerPopup');
          if (registerPopup) registerPopup.classList.remove('show');
        }, 900);
      } catch (err) {
        console.error('[Register] Registration error:', err);
        msgBox.textContent = err.name === 'AbortError'
        const errorMsg = err.name === 'AbortError'
          ? 'Request timed out. Please try again.'
          : (err.message || 'Registration failed');
        msgBox.style.color = 'red';
        msgBox.textContent = errorMsg;
        showToast('Registration Failed', 'error');
      }
    });
  }

  // --- Initial Setup on Page Load ---
  loadStreetData();
  setTimeout(() => {
    if (typeof displayBarangay === 'function') displayBarangay();
  }, 100);
});

  // Load initial trip count
  fetch('/stats/round-trips')
    .then(res => res.ok ? res.json() : { count: 0 })
    .then(data => updateTripCounter(data.count || 0))
    .catch(() => updateTripCounter(0));

// --- CALENDAR / TOP INFO functions ---
async function initTopInfo() {
  updateTopDate();
  displayBarangay();
  await loadSchedule(); // Now accessible
  await loadCalendarEvents(); // Now accessible
  updateTopTimeAndDay();
  setInterval(updateTopDate, 60000);
}
window.initTopInfo = initTopInfo;

function updateTopDate() {
  const now = new Date();
  const month = now.toLocaleDateString('en-US', { month: 'long' });
  const dateText = `${now.getDate()}, ${month}, ${now.getFullYear()}`;
  const dayText = now.toLocaleDateString('en-US', { weekday: 'long' });
  const topDateEl = document.getElementById('topDate');
  const topDayEl = document.getElementById('topDay');
  if (topDateEl) topDateEl.textContent = dateText;
  if (topDayEl) topDayEl.textContent = dayText;
}
window.updateTopDate = updateTopDate;

function displayBarangay() {
  const isDriverPage = document.body.classList.contains('driver-page') 
                    || window.location.pathname.includes('driver-driverschedule');

  let saved;
  if (isDriverPage) {
    saved = localStorage.getItem('driverBarangay') || 'Not assigned';
  } else {
    saved = localStorage.getItem('userBarangay') || 'Not registered';
  }

  const savedEl = document.getElementById('savedBarangay');
  const topEl = document.getElementById('topBarangay');
  if (savedEl) savedEl.textContent = saved;
  if (topEl) topEl.textContent = saved;
}
window.displayBarangay = displayBarangay;

function updateTopTimeAndDay() {
  const saved = localStorage.getItem('driverBarangay') || localStorage.getItem('userBarangay');
  const topTimeEl = document.getElementById('topTime');
  const topDayEl = document.getElementById('topDay');
  if (!topTimeEl) return;
  if (!saved || !window.__SCHEDULE_LOOKUP) {
    topTimeEl.textContent = '—';
    return;
  }
  const today = new Date();
  const wkShort = today.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
  const lookup = window.__SCHEDULE_LOOKUP[saved];
  if (lookup && lookup[wkShort]) {
    const rec = lookup[wkShort];
    topTimeEl.style.color = '';
    topTimeEl.textContent = formatTime12Hour(rec.start_time) || '—';
  } else {
    topTimeEl.textContent = '—';
  }
}
window.updateTopTimeAndDay = updateTopTimeAndDay;

function generateCalendar() {
  const calendarBody = document.getElementById('calendarBody');
  if (!calendarBody) return;
  calendarBody.innerHTML = '';
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const firstDay = new Date(year, month, 1);
  const startDow = firstDay.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthLabel = document.getElementById('monthLabel');
  if (monthLabel) {
    monthLabel.textContent = `${firstDay.toLocaleString('en-US', { month: 'long' })} ${year}`;
  }
  for (let i = 0; i < startDow; i++) {
    const empty = document.createElement('div');
    empty.className = 'cell disabled';
    calendarBody.appendChild(empty);
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const cell = document.createElement('div');
    cell.className = 'cell';
    cell.textContent = d;
    if (d === now.getDate() && month === now.getMonth()) {
      cell.classList.add('today');
    }
    cell.style.cursor = 'default';
    calendarBody.appendChild(cell);
  }
  const totalCells = calendarBody.children.length;
  const remainder = (7 - (totalCells % 7)) % 7;
  for (let i = 0; i < remainder; i++) {
    const empty = document.createElement('div');
    empty.className = 'cell disabled';
    calendarBody.appendChild(empty);
  }
}
window.generateCalendar = generateCalendar;

window._rt = { generateCalendar, updateTopTimeAndDay, updateTripCounter };