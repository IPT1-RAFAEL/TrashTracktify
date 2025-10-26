const socket = io("https://trashtracktify.onrender.com");

// Elements
const barangayListEl = document.getElementById('barangayList');
const editPopup = document.getElementById('editSchedulePopup');
const editBarangayEl = document.getElementById('editBarangay');
const editDayEl = document.getElementById('editDay');
const editTimeInput = document.getElementById('editTime');
const editMsg = document.getElementById('editMsg');
const editForm = document.getElementById('editScheduleForm');
const cancelEditBtn = document.getElementById('cancelEditBtn');
const resetPasswordPopup = document.getElementById('adminResetPasswordPopup');
const resetPasswordForm = document.getElementById('adminResetPasswordForm');
const submitResetBtn = document.getElementById('submitAdminResetBtn');
const backToLoginFromReset = document.getElementById('backToLoginFromReset');
const resetMsg = document.getElementById('adminResetMsg');

const calendarBody = document.getElementById('calendarBody');
const monthLabel = document.getElementById('monthLabel');

// Status widgets
const capacityArc = document.querySelector('.truck-status-card .progress-ring .fg');
const capacityPercent = document.getElementById('tsPercent');
const roundCountEl = document.getElementById('roundCount');

// Residents table
const residentTableBody = document.querySelector('#residentTable tbody');

// === NEW: Admin Auth Popup Elements ===
const loginPopup = document.getElementById('adminLoginPopup');
const registerPopup = document.getElementById('adminRegisterPopup');
const forgotPasswordPopup = document.getElementById('adminForgotPasswordPopup');

const loginForm = document.getElementById('adminLoginForm');
const registerForm = document.getElementById('adminRegisterForm');
const forgotPasswordForm = document.getElementById('adminForgotPasswordForm');

const loginBtn = document.getElementById('adminLoginBtn');
const registerBtn = document.getElementById('adminRegisterBtn');
const sendResetBtn = document.getElementById('sendAdminResetBtn');

// Buttons to switch popups
const showRegisterBtn = document.getElementById('showAdminRegisterBtn');
const showForgotPasswordBtn = document.getElementById('showAdminForgotBtn');
const backToLoginFromRegister = document.getElementById('backToLoginFromRegister');
const backToLoginFromForgot = document.getElementById('backToLoginFromForgot');

// Header buttons
const adminLoginHeaderBtn = document.getElementById('adminLoginHeaderBtn');
const adminLogoutBtn = document.getElementById('adminLogoutBtn');

// Message areas
const loginMsg = document.getElementById('adminLoginMsg');
const registerMsg = document.getElementById('adminRegisterMsg');
const forgotMsg = document.getElementById('adminForgotMsg');
// === END NEW ===


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


// --- NEW: Popup Switching Logic ---
function showPopup(popupToShow) {
  // Hide all popups first
  [loginPopup, registerPopup, forgotPasswordPopup, resetPasswordPopup].forEach(p => {
    if (p) p.classList.remove('show');
  });
  // Show the requested one
  if (popupToShow) popupToShow.classList.add('show');
  // Lock body scroll
  if (document.body) document.body.classList.add("locked");
}

function hideAllPopups() {
   [loginPopup, registerPopup, forgotPasswordPopup].forEach(p => {
    if (p) p.classList.remove('show');
  });
   if (document.body) document.body.classList.remove('locked');
}

// Wire up the buttons to switch popups
if (showRegisterBtn) showRegisterBtn.addEventListener('click', () => showPopup(registerPopup));
if (showForgotPasswordBtn) showForgotPasswordBtn.addEventListener('click', () => showPopup(forgotPasswordPopup));
if (backToLoginFromRegister) backToLoginFromRegister.addEventListener('click', () => showPopup(loginPopup));
if (backToLoginFromForgot) backToLoginFromForgot.addEventListener('click', () => showPopup(loginPopup));
if (backToLoginFromReset) backToLoginFromReset.addEventListener('click', () => showPopup(loginPopup));
// --- END NEW ---


// --- NEW: Admin Auth Form Handling ---

// Registration
if (registerForm && registerBtn) {
    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        registerMsg.textContent = '';
        registerMsg.style.color = ''; 

        const name = document.getElementById('regAdminName')?.value.trim();
        const phone = document.getElementById('regAdminPhone')?.value.trim();
        const password = document.getElementById('regAdminPassword')?.value.trim();

        if (!name || !phone || !password) {
            registerMsg.textContent = 'Please fill in all fields.';
            registerMsg.style.color = 'orange';
            return;
        }
        if (!/^09\d{9}$/.test(phone)) {
             registerMsg.textContent = 'Invalid phone (must be 09xxxxxxxxx).';
             registerMsg.style.color = 'orange';
             return;
        }
        if (password.length < 6) {
             registerMsg.textContent = 'Password must be at least 6 characters.';
             registerMsg.style.color = 'orange';
             return;
        }

        registerBtn.textContent = 'Registering...';
        registerBtn.disabled = true;

        try {
            // !! IMPORTANT: You will need to create this '/admin-register' endpoint on your server
            const res = await fetch('/admin-register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ regName: name, regPhone: phone, regPassword: password })
            });
            const result = await res.json();
            if (!res.ok) throw new Error(result.error || `Registration failed: ${res.status}`);

            registerMsg.textContent = result.message || 'Registration successful! Redirecting to login...';
            registerMsg.style.color = 'var(--accent)';
            registerForm.reset();
            setTimeout(() => showPopup(loginPopup), 1500);

        } catch (err) {
            console.error('Admin registration error:', err);
            registerMsg.textContent = `Registration Error: ${err.message}`;
            registerMsg.style.color = 'red';
        } finally {
            registerBtn.textContent = 'Register';
            registerBtn.disabled = false;
        }
    });
}

// Login
if (loginForm && loginBtn) {
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        loginMsg.textContent = '';
        loginMsg.style.color = '';

        const name = document.getElementById('adminName')?.value.trim();
        const password = document.getElementById('adminPassword')?.value.trim();

        if (!name || !password) {
            loginMsg.textContent = 'Please enter admin name and password.';
            loginMsg.style.color = 'orange';
             return;
        }

        loginBtn.textContent = 'Logging in...';
        loginBtn.disabled = true;

        try {
            // !! IMPORTANT: You will need to create this '/admin-login' endpoint on your server
            const res = await fetch('/admin-login', { 
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ adminName: name, adminPassword: password })
            });
            const result = await res.json();
            if (!res.ok) throw new Error(result.error || `Login failed: ${res.status}`);

            loginMsg.textContent = result.message || 'Login successful!';
            loginMsg.style.color = 'var(--accent)';

            // Simulate session by storing a token/flag
            localStorage.setItem('adminAuthenticated', 'true'); 

            setTimeout(() => {
                hideAllPopups();
                adminLoginHeaderBtn.style.display = 'none';
                adminLogoutBtn.style.display = 'block';
            }, 800);

        } catch (err) {
            console.error('Admin login error:', err);
            loginMsg.textContent = `Login Error: ${err.message}`;
            loginMsg.style.color = 'red';
        } finally {
            loginBtn.textContent = 'Login';
            loginBtn.disabled = false;
        }
    });
}

// Forgot Password
if (forgotPasswordForm && sendResetBtn) {
    forgotPasswordForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        forgotMsg.textContent = '';
        forgotMsg.style.color = '';

        const phone = document.getElementById('forgotAdminPhone')?.value.trim();
        if (!phone || !/^09\d{9}$/.test(phone)) {
            forgotMsg.textContent = 'Please enter a valid phone number (09xxxxxxxxx).';
            forgotMsg.style.color = 'orange';
            return;
        }

        sendResetBtn.textContent = 'Sending...';
        sendResetBtn.disabled = true;

        try {
            const res = await fetch('/admin-forgot-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ resetPhone: phone })
            });
            const result = await res.json();
            if (!res.ok) throw new Error(result.error || 'Failed to send reset code');

            forgotMsg.textContent = result.message || 'Reset code sent! Please check your phone.';
            forgotMsg.style.color = 'var(--accent)';
            forgotPasswordForm.reset();
            setTimeout(() => showPopup(resetPasswordPopup), 1500); // Switch to reset popup
        } catch (err) {
            console.error('Forgot password error:', err);
            forgotMsg.textContent = `Error: ${err.message}`;
            forgotMsg.style.color = 'red';
        } finally {
            sendResetBtn.textContent = 'Send Reset Link';
            sendResetBtn.disabled = false;
        }
    });
}

// Reset Password
if (resetPasswordForm && submitResetBtn) {
    resetPasswordForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        resetMsg.textContent = '';
        resetMsg.style.color = '';

        const phone = document.getElementById('resetAdminPhone')?.value.trim();
        const token = document.getElementById('resetCode')?.value.trim();
        const newPassword = document.getElementById('resetNewPassword')?.value.trim();
        const confirmPassword = document.getElementById('resetConfirmPassword')?.value.trim();

        if (!phone || !token || !newPassword || !confirmPassword) {
            resetMsg.textContent = 'Please fill in all fields.';
            resetMsg.style.color = 'orange';
            return;
        }
        if (!/^09\d{9}$/.test(phone)) {
            resetMsg.textContent = 'Invalid phone number (must be 09xxxxxxxxx).';
            resetMsg.style.color = 'orange';
            return;
        }
        if (!/^\d{6}$/.test(token)) {
            resetMsg.textContent = 'Code must be 6 digits.';
            resetMsg.style.color = 'orange';
            return;
        }
        if (newPassword !== confirmPassword) {
            resetMsg.textContent = 'Passwords do not match.';
            resetMsg.style.color = 'orange';
            return;
        }
        if (newPassword.length < 6) {
            resetMsg.textContent = 'Password must be at least 6 characters.';
            resetMsg.style.color = 'orange';
            return;
        }

        submitResetBtn.textContent = 'Resetting...';
        submitResetBtn.disabled = true;

        try {
            const res = await fetch('/admin-reset-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone, token, newPassword, confirmPassword })
            });
            const result = await res.json();
            if (!res.ok) throw new Error(result.error || 'Failed to reset password');

            resetMsg.textContent = result.message || 'Password reset successful! Redirecting to login...';
            resetMsg.style.color = 'var(--accent)';
            resetPasswordForm.reset();
            setTimeout(() => showPopup(loginPopup), 1500);
        } catch (err) {
            console.error('Reset password error:', err);
            resetMsg.textContent = `Error: ${err.message}`;
            resetMsg.style.color = 'red';
        } finally {
            submitResetBtn.textContent = 'Reset Password';
            submitResetBtn.disabled = false;
        }
    });
}

// Header button listeners
if (adminLoginHeaderBtn) {
    adminLoginHeaderBtn.addEventListener('click', () => showPopup(loginPopup));
}
if (adminLogoutBtn) {
    adminLogoutBtn.addEventListener('click', () => {
        localStorage.removeItem('adminAuthenticated');
        adminLoginHeaderBtn.style.display = 'block';
        adminLogoutBtn.style.display = 'none';
        showPopup(loginPopup);
        console.log('Admin logged out');
    });
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
      if (!localStorage.getItem('adminAuthenticated')) {
        alert('Please login to edit the schedule.');
        showPopup(loginPopup);
        return;
      }

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

        // Update in-memory data
        if (!SCHEDULE_LOOKUP[b]) SCHEDULE_LOOKUP[b] = {};
        if (!SCHEDULE_LOOKUP[b][dayKey]) SCHEDULE_LOOKUP[b][dayKey] = {};
        SCHEDULE_LOOKUP[b][dayKey].start_time = start_time;

      } catch (err) {
        console.error(err);
        alert('Error saving time: ' + err.message);
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
        setTimeout(closeEditPopup, 600);
    } catch (err) {
        console.error('save schedule error:', err);
        editMsg.textContent = err.message || 'Save failed';
    }
});


// --- Initial Load ---
async function loadInitial() {
    if (localStorage.getItem('adminAuthenticated') === 'true') {
        adminLoginHeaderBtn.style.display = 'none';
        adminLogoutBtn.style.display = 'block';
        hideAllPopups(); 
    } else {
        adminLoginHeaderBtn.style.display = 'block';
        adminLogoutBtn.style.display = 'none';
        showPopup(loginPopup); 
    }
    // --- END NEW ---

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