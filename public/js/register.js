const socket = io("https://trashtracktify.onrender.com");

/**
 * @param {string} timeString
 * @returns {string} )
 */
function formatTime12Hour(timeString) {
  if (!timeString || typeof timeString !== 'string') {
    return '—'; // Return '—' for invalid input
  }

  const [hours, minutes] = timeString.split(':');
  
  if (hours === undefined || minutes === undefined) {
     return '—'; // Handle incomplete string
  }

  let h = parseInt(hours, 10);
  const m = parseInt(minutes, 10);

  if (isNaN(h) || isNaN(m)) {
    return '—'; // Handle non-numeric parts
  }

  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) {
    h = 12;
  }

  const formattedMinutes = m < 10 ? `0${m}` : m;

  return `${h}:${formattedMinutes} ${ampm}`;
}


const msgBox = document.getElementById('popupMsg');
const form = document.getElementById('popupForm');
const barangaySelect = document.querySelector('#popupForm select[name="barangay"]');
const streetSelect = document.getElementById('streetSelect');

// Data holders
const daysOfWeek = ['MON','TUE','WED','THU','FRI','SAT','SUN'];
let allStreetsData = {};
let CALENDAR_EVENTS = {}; 

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

// --- Schedule Loading Logic ---
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
    console.error('loadSchedule error', err);
  }
}

async function loadCalendarEvents() {
    try {
        const res = await fetch('/calendar/events');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const events = await res.json();
        CALENDAR_EVENTS = {};

        events.forEach(event => {
            CALENDAR_EVENTS[event.event_date] = {
                type: event.type,
                description: event.description
            };
        });
        // --- END FIX ---

        console.log("User calendar events (All) loaded:", CALENDAR_EVENTS);
    } catch (err) {
        console.error("Failed to load calendar events:", err);
        CALENDAR_EVENTS = {}; 
    }
}

socket.on('schedule-update', async () => { 
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

socket.on('calendar-update', async () => {
    console.log('[Register] Calendar updated, reloading events...');
    await loadCalendarEvents();
    
    if (typeof updateTopTimeAndDay === 'function') {
        updateTopTimeAndDay();
    }
    if (typeof generateCalendar === 'function') {
        generateCalendar();
    }
});


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

      if (data.barangay) {
        localStorage.setItem('userBarangay', data.barangay);
        if (typeof displayBarangay === 'function') displayBarangay();
        if (typeof updateTopTimeAndDay === 'function') updateTopTimeAndDay();
        if (typeof generateCalendar === 'function') generateCalendar();
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
loadStreetData();


// --- CALENDAR / TOP INFO functions ---
async function initTopInfo(){
  updateTopDate();
  displayBarangay();
  
  await loadSchedule();
  await loadCalendarEvents();
  
  updateTopTimeAndDay();
  setInterval(updateTopDate, 60000);
}
window.initTopInfo = initTopInfo;

/** Update Date string at top */
function updateTopDate(){
  const now = new Date();
  const month = now.toLocaleDateString('en-US',{month:'long'});
  const dateText = `${now.getDate()}, ${month}, ${now.getFullYear()}`;
  const dayText = now.toLocaleDateString('en-US',{weekday:'long'});
  
  const topDateEl = document.getElementById('topDate');
  const topDayEl = document.getElementById('topDay');
  if (topDateEl) topDateEl.textContent = dateText;
  if (topDayEl) topDayEl.textContent = dayText;
}
window.updateTopDate = updateTopDate;

/** Display saved barangay */
function displayBarangay(){
  const saved = localStorage.getItem('userBarangay');
  const savedEl = document.getElementById('savedBarangay');
  const topEl = document.getElementById('topBarangay');
  
  if (savedEl) savedEl.textContent = saved ? saved : 'Not registered';
  if (topEl) topEl.textContent = saved ? saved : 'Not registered';
}
window.displayBarangay = displayBarangay;

/** Update top time/day from schedule lookup */
function updateTopTimeAndDay(){
  const saved = localStorage.getItem('userBarangay');
  const topTimeEl = document.getElementById('topTime');
  const topDayEl = document.getElementById('topDay'); 
  if (!topTimeEl) return;
  if (!saved || !window.__SCHEDULE_LOOKUP) { 
    topTimeEl.textContent = '—'; 
    return; 
  }

  const today = new Date(); 
  const wkShort = today.toLocaleDateString('en-US',{weekday:'short'}).toUpperCase();
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


function generateCalendar(){
  const calendarBody = document.getElementById('calendarBody');
  if (!calendarBody) return; 

  calendarBody.innerHTML = '';
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const firstDay = new Date(year, month, 1);
  const startDow = firstDay.getDay(); 
  const daysInMonth = new Date(year, month+1, 0).getDate();

  // show month label
  const monthLabel = document.getElementById('monthLabel');
  if (monthLabel) {
    monthLabel.textContent = `${firstDay.toLocaleString('en-US',{month:'long'})} ${year}`;
  }

  // fill leading blanks
  for (let i=0;i<startDow;i++){
    const empty = document.createElement('div');
    empty.className = 'cell disabled';
    calendarBody.appendChild(empty);
  }

  // date cells
  for (let d=1; d<=daysInMonth; d++){
    const cell = document.createElement('div');
    cell.className = 'cell';
    cell.textContent = d;

    // if current day -> mark
    if (d === now.getDate() && month === now.getMonth()) {
      cell.classList.add('today');
    }

    cell.style.cursor = 'default';
    calendarBody.appendChild(cell);
  }
  // --- END OF CORRECTED LOOP ---

  // fill trailing blanks
  const totalCells = calendarBody.children.length;
  const remainder = (7 - (totalCells % 7)) % 7;
  for (let i=0;i<remainder;i++){
    const empty = document.createElement('div');
    empty.className = 'cell disabled';
    calendarBody.appendChild(empty);
  }
}
window.generateCalendar = generateCalendar;

window._rt = { generateCalendar, updateTopTimeAndDay };
