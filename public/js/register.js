const socket = io("https://trashtracktify.onrender.com");
// const socket = io("http://localhost:3000");

const msgBox = document.getElementById('popupMsg');
const form = document.getElementById('popupForm');
const barangaySelect = document.querySelector('#popupForm select[name="barangay"]');
const streetSelect = document.getElementById('streetSelect'); // ID added to the street select in HTML

// Data holders
const daysOfWeek = ['MON','TUE','WED','THU','FRI','SAT','SUN'];
let allStreetsData = {}; // To store the fetched street data { barangay: [{name, coords}, ...] }

// --- Street Data Loading and Dynamic Dropdown Logic ---
async function loadStreetData() {
    try {
        const response = await fetch('/data/streets.json'); // Fetches the JSON file
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        allStreetsData = await response.json();
        console.log('[Register] Street data loaded successfully.');
        if (barangaySelect) {
             barangaySelect.disabled = false;
             updateStreetOptions();
        }
    } catch (error) {
        console.error("Failed to load street data:", error);
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
    streetSelect.innerHTML = ''; // Clear existing options
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

// --- Schedule Loading Logic (kept from your original) ---
async function loadSchedule() {
  try {
    const response = await fetch('/schedule');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const schedules = await response.json();

    // restructure schedule for quick lookup
    const scheduleByBarangay = {};
    schedules.forEach(s => {
      if (!scheduleByBarangay[s.barangay]) scheduleByBarangay[s.barangay] = {};
      // store full record (may include holiday flag)
      scheduleByBarangay[s.barangay][s.day] = s;
    });

    // Save into global so calendar/show-detail can access it
    window.__SCHEDULE_LOOKUP = scheduleByBarangay;

    // Populate any existing legacy days container if present (non-calendar UI)
    ['Tugatog', 'Acacia', 'Tinajeros'].forEach(barangay => {
      const daysContainer = document.getElementById(`${barangay}-days`);
      if (!daysContainer) return;
      daysContainer.innerHTML = '';
      daysOfWeek.forEach(day => {
        const rec = scheduleByBarangay[barangay]?.[day];
        const timeText = rec ? (rec.start_time ? rec.start_time.slice(0,5) : 'N/A') : 'N/A';
        const span = document.createElement('span');
        span.textContent = `${day}: ${timeText}`;
        daysContainer.appendChild(span);
      });
    });
  } catch (err) {
    console.error('loadSchedule error', err);
  }
}

socket.on('schedule-update', () => {
  console.log('[Register] Schedule updated via socket, reloading display...');
  loadSchedule();
});

// --- Registration Form Submission Logic (kept) ---
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
    if (!/^09\d{9}$/.test(data.phone)) { msgBox.textContent = 'Phone number must be 11 digits starting with 09'; msgBox.style.color='red'; return; }
    if (!data.barangay) { msgBox.textContent = 'Please select a Barangay.'; msgBox.style.color='red'; return; }
    if (!data.street) { msgBox.textContent = 'Please select a Street.'; msgBox.style.color='red'; return; }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(()=> controller.abort(), 15000);
      const res = await fetch('/register', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify(data),
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || `Server error ${res.status}`);

      msgBox.textContent = result.message || '✅ Registration successful!';
      msgBox.style.color = 'green';
      e.target.reset();
      updateStreetOptions();

      // persist chosen barangay locally for this device
      if (data.barangay) {
        localStorage.setItem('userBarangay', data.barangay);
        // update UI top/meta
        if (typeof displayBarangay === 'function') displayBarangay();
        if (typeof updateTopTimeAndDay === 'function') updateTopTimeAndDay();
      }

      setTimeout(()=> {
          const registerPopup = document.getElementById('registerPopup');
          if (registerPopup) registerPopup.classList.remove('show');
      }, 900);

    } catch (err) {
      console.error('[Register] Registration error:', err);
      msgBox.textContent = err.name === 'AbortError'
        ? 'Request timed out. Please try again.'
        : (err.message || 'Registration failed');
      msgBox.style.color = 'red';
    }
  });
}

// --- Initial Setup on Page Load ---
loadSchedule();
loadStreetData();

// --- CALENDAR / TOP INFO functions (added) ---

/**
 * Initialization for top info (date, barangay, day, time).
 * Exposed as global initTopInfo()
 */
function initTopInfo(){
  updateTopDate();
  displayBarangay();
  updateTopTimeAndDay();
  // refresh top date every minute in case day changes
  setInterval(updateTopDate, 60000);
}
window.initTopInfo = initTopInfo;

/** Update Date string at top */
function updateTopDate(){
  const now = new Date();
  const month = now.toLocaleDateString('en-US',{month:'long'});
  const dateText = `${now.getDate()}, ${month}, ${now.getFullYear()}`;
  const dayText = now.toLocaleDateString('en-US',{weekday:'long'});
  document.getElementById('topDate').textContent = dateText;
  document.getElementById('topDay').textContent = dayText;
}
window.updateTopDate = updateTopDate;

/** Display saved barangay */
function displayBarangay(){
  const saved = localStorage.getItem('userBarangay');
  document.getElementById('savedBarangay').textContent = saved ? saved : 'Not registered';
  document.getElementById('topBarangay').textContent = saved ? saved : 'Not registered';
}
window.displayBarangay = displayBarangay;

/** Update top time/day from schedule lookup */
function updateTopTimeAndDay(){
  const saved = localStorage.getItem('userBarangay');
  const topTimeEl = document.getElementById('topTime');
  const topDayEl = document.getElementById('topDay');
  if (!saved || !window.__SCHEDULE_LOOKUP) { topTimeEl.textContent = '—'; return; }

  // current weekday short (MON...SUN)
  const wkShort = new Date().toLocaleDateString('en-US',{weekday:'short'}).toUpperCase();
  // schedule lookup uses MON..SUN – convert SUN->SUN etc. But schedule object uses MON..SUN keys
  // We'll try to find schedule record
  const lookup = window.__SCHEDULE_LOOKUP[saved];
  if (lookup && lookup[wkShort]) {
    const rec = lookup[wkShort];
    if (rec.holiday) {
      topTimeEl.textContent = 'HOLIDAY';
      topTimeEl.style.color = 'red';
    } else {
      topTimeEl.style.color = '';
      topTimeEl.textContent = rec.start_time || '—';
    }
  } else {
    topTimeEl.textContent = '—';
  }
}
window.updateTopTimeAndDay = updateTopTimeAndDay;

/** Generate static calendar for current month and attach click handlers */
function generateCalendar(){
  const calendarBody = document.getElementById('calendarBody');
  calendarBody.innerHTML = '';
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-indexed
  const firstDay = new Date(year, month, 1);
  const startDow = firstDay.getDay(); // 0 (Sun) .. 6 (Sat)
  const daysInMonth = new Date(year, month+1, 0).getDate();

  // show month label
  const monthLabel = document.getElementById('monthLabel');
  monthLabel.textContent = `${firstDay.toLocaleDateString('en-US',{month:'long'})} ${year}`;

  // fill leading blanks
  for (let i=0;i<startDow;i++){
    const empty = document.createElement('div');
    empty.className = 'cell disabled';
    calendarBody.appendChild(empty);
  }

  // create day cells
  for (let d=1; d<=daysInMonth; d++){
    const cell = document.createElement('div');
    cell.className = 'cell';
    cell.dataset.date = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const num = document.createElement('div');
    num.className = 'date-num';
    num.textContent = d;
    cell.appendChild(num);

    // if current day -> mark
    if (d === now.getDate()) cell.classList.add('today');

    // add click handler
    cell.addEventListener('click', async (e) => {
      // do nothing when clicking on disabled (shouldn't happen)
      if (cell.classList.contains('disabled')) return;
      const dateStr = cell.dataset.date;
      if (typeof showDateDetails === 'function') {
        showDateDetails(dateStr);
      } else {
        // fallback: simple alert
        alert('Clicked date: ' + dateStr);
      }
    });

    calendarBody.appendChild(cell);
  }

  // fill trailing blanks to finish the grid (optional)
  const totalCells = calendarBody.children.length;
  const remainder = (7 - (totalCells % 7)) % 7;
  for (let i=0;i<remainder;i++){
    const empty = document.createElement('div');
    empty.className = 'cell disabled';
    calendarBody.appendChild(empty);
  }
}
window.generateCalendar = generateCalendar;

/** Show date details popup; attempts to fetch pickup record, falls back to schedule lookup */
async function showDateDetails(dateStr){
  const datePopup = document.getElementById('datePopup');
  const title = document.getElementById('datePopupTitle');
  const body = document.getElementById('datePopupBody');
  title.textContent = dateStr;
  body.textContent = 'Loading...';
  datePopup.classList.add('show');

  const barangay = localStorage.getItem('userBarangay');
  if (!barangay) {
    body.textContent = 'No barangay registered on this device.';
    return;
  }

  // attempt to fetch a pickup record for this date (server-side endpoint)
  // Expected server API (optional): /pickup?date=YYYY-MM-DD&barangay=Name
  try {
    const res = await fetch(`/pickup?date=${encodeURIComponent(dateStr)}&barangay=${encodeURIComponent(barangay)}`);
    if (res.ok) {
      const rec = await res.json();
      // assume server returns { time: "08:15", note: "...", recordedBy: "..."}
      if (rec && (rec.time || rec.recorded)) {
        body.innerHTML = `<div><strong>Recorded:</strong> ${rec.time || rec.recorded}</div>${rec.note? `<div style="margin-top:6px">${rec.note}</div>`:''}`;
        return;
      }
      // if server returned no record content, fall through to schedule fallback
    }
  } catch (err) {
    // ignore fetch errors and fallback
    console.warn('pickup fetch failed', err);
  }

  // fallback: attempt to derive from schedule (weekday)
  try {
    const dt = new Date(dateStr + 'T00:00:00');
    const dayShort = dt.toLocaleDateString('en-US',{weekday:'short'}).toUpperCase(); // MON..SUN
    const lookup = window.__SCHEDULE_LOOKUP || {};
    const rec = (lookup[barangay] && lookup[barangay][dayShort]) ? lookup[barangay][dayShort] : null;
    if (rec) {
      if (rec.holiday) {
        body.innerHTML = `<div style="color:red;font-weight:800">HOLIDAY — No Pickup</div>`;
      } else {
        body.innerHTML = `<div><strong>Scheduled Start:</strong> ${rec.start_time || '—'}</div><div style="margin-top:6px;color:#666">${rec.note || ''}</div>`;
      }
    } else {
      body.textContent = 'No record or scheduled pickup for this date.';
    }
  } catch (err) {
    body.textContent = 'No record available.';
  }
}
window.showDateDetails = showDateDetails;

/* init on load - careful: schedule must be loaded before top time can show correctly.
   We already called loadSchedule() above. To be safe, we run a small timed update after schedule load.
*/
setTimeout(()=>{
  if (typeof initTopInfo === 'function') initTopInfo();
}, 700);

// expose utility for debugging
window._rt = { generateCalendar, showDateDetails, updateTopTimeAndDay };

// end of register.js
