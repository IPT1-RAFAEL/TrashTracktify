const socket = io("https://trashtracktify.onrender.com");
const map = L.map('map').setView([14.667, 120.967], 15);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

const truckIcon = L.icon({
  iconUrl: 'truck.png',
  iconSize: [32, 32],
  iconAnchor: [16, 32]
});

let truckMarkers = {};

socket.on("location-update", data => {
  const { latitude, longitude, truckId } = data;
  if (!latitude || !longitude || !truckId) return;
  const newLatLng = [latitude, longitude];
  if (!truckMarkers[truckId]) {
    truckMarkers[truckId] = L.marker(newLatLng, { icon: truckIcon }).addTo(map);
    truckMarkers[truckId].bindPopup(`<b>${truckId}</b>`).openPopup();
  } else {
    truckMarkers[truckId].setLatLng(newLatLng);
  }
});

const daysOfWeek = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
let currentAdmin = localStorage.getItem('adminUser') || null;

function show(el) { el.classList.add('show'); }
function hide(el) { el.classList.remove('show'); }

const loginModal = document.getElementById('loginModal');
const registerModal = document.getElementById('registerModal');
const adminLoginBtn = document.getElementById('adminLoginBtn');
const adminLogoutBtn = document.getElementById('adminLogoutBtn');
const regSubmitBtn = document.getElementById('regSubmit');

adminLoginBtn.onclick = () => show(loginModal);
document.getElementById('showRegister').onclick = () => { hide(loginModal); show(registerModal); };
document.getElementById('showLogin').onclick = () => { hide(registerModal); show(loginModal); };

document.getElementById('loginSubmit').onclick = async () => {
  const username = document.getElementById('loginUser').value.trim();
  const password = document.getElementById('loginPass').value.trim();
  const msg = document.getElementById('loginMsg');
  if (!username || !password) {
    msg.style.color = 'red';
    return msg.textContent = "Please fill in all fields.";
  }
  msg.textContent = "Logging in...";
  try {
    const res = await fetch('/admin-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (res.ok) {
      msg.style.color = 'green';
      msg.textContent = data.message;
      localStorage.setItem('adminUser', username);
      setTimeout(() => location.reload(), 1000);
    } else {
      msg.style.color = 'red';
      msg.textContent = data.error || 'Invalid username or password';
    }
  } catch (err) {
    msg.style.color = 'red';
    msg.textContent = `Login failed: ${err.message}`;
  }
};

regSubmitBtn.onclick = async () => {
  const username = document.getElementById('regUser').value.trim();
  const password = document.getElementById('regPass').value.trim();
  const msg = document.getElementById('regMsg');
  if (!username || !password) {
    msg.style.color = 'red';
    return msg.textContent = "Please fill in all fields.";
  }
  if (username.length < 3) {
    msg.style.color = 'red';
    return msg.textContent = "Username must be at least 3 characters.";
  }
  if (password.length < 8) {
    msg.style.color = 'red';
    return msg.textContent = "Password must be at least 8 characters.";
  }
  regSubmitBtn.disabled = true;
  msg.textContent = "Registering...";
  try {
    const res = await fetch('/admin-register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (res.ok) {
      msg.style.color = 'green';
      msg.textContent = data.message;
      // Auto-login after successful registration
      const loginRes = await fetch('/admin-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      if (loginRes.ok) {
        localStorage.setItem('adminUser', username);
        setTimeout(() => location.reload(), 1000);
      } else {
        hide(registerModal);
        show(loginModal);
      }
    } else {
      msg.style.color = 'red';
      msg.textContent = data.error || 'Registration failed';
    }
  } catch (err) {
    msg.style.color = 'red';
    msg.textContent = `Registration failed: ${err.message}`;
  } finally {
    regSubmitBtn.disabled = false;
  }
};

if (currentAdmin) {
  adminLoginBtn.style.display = 'none';
  adminLogoutBtn.style.display = 'inline-block';
  loadSchedule();
  loadResidents();
} else {
  show(loginModal);
}

adminLogoutBtn.onclick = () => {
  localStorage.removeItem('adminUser');
  location.reload();
};

async function loadSchedule() {
  try {
    const res = await fetch('/schedule');
    if (!res.ok) throw new Error('Failed to fetch schedule');
    const schedules = await res.json();
    const byBrgy = {};
    schedules.forEach(s => {
      if (!byBrgy[s.barangay]) byBrgy[s.barangay] = {};
      byBrgy[s.barangay][s.day] = s.start_time;
    });
    ['Tugatog', 'Acacia', 'Tinajeros'].forEach(b => {
      const el = document.getElementById(`${b}-days`);
      el.innerHTML = '';
      daysOfWeek.forEach(day => {
        const time = byBrgy[b]?.[day] || '08:00:00';
        const span = document.createElement('span');
        span.textContent = `${day}: ${time.slice(0, 5)}`;
        span.classList.add('editable');
        span.onclick = () => openEditPopup(b, day, time);
        el.appendChild(span);
      });
    });
  } catch (err) {
    console.error(`[Schedule] Error loading schedule: ${err.message}`);
  }
}

socket.on('schedule-update', loadSchedule);

async function loadResidents() {
  try {
    const res = await fetch('/users');
    if (!res.ok) throw new Error('Failed to fetch residents');
    const data = await res.json();
    const tbody = document.querySelector('#residentsTable tbody');
    tbody.innerHTML = '';
    data.forEach(u => {
      const row = `<tr><td>${u.id}</td><td>${u.name}</td><td>${u.phone}</td><td>${u.barangay}</td></tr>`;
      tbody.innerHTML += row;
    });
  } catch (err) {
    console.error(`[Residents] Error loading residents: ${err.message}`);
  }
}

function openEditPopup(barangay, day, time) {
  const popup = document.getElementById('editSchedulePopup');
  document.getElementById('editBarangay').textContent = barangay;
  document.getElementById('editDay').textContent = day;
  document.querySelector('#editScheduleForm [name="start_time"]').value = time.slice(0, 5);
  show(popup);
}

document.getElementById('editScheduleForm').onsubmit = async e => {
  e.preventDefault();
  const barangay = document.getElementById('editBarangay').textContent;
  const day = document.getElementById('editDay').textContent;
  let start_time = e.target.start_time.value.trim();
  const msg = document.getElementById('editMsg');
  console.log('[Debug] Raw start_time:', start_time); // Debug log
  // Validate and format start_time
  if (!start_time) {
    msg.style.color = 'red';
    return msg.textContent = 'Time is required';
  }
  const timeParts = start_time.split(':');
  if (timeParts.length !== 2 || timeParts[0] > 23 || timeParts[1] > 59) {
    msg.style.color = 'red';
    return msg.textContent = 'Invalid time format (HH:MM)';
  }
  start_time = `${start_time}:00`; // Ensure HH:MM:SS
  console.log('[Debug] Formatted start_time:', start_time); // Debug log
  try {
    const res = await fetch('/schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ barangay, day, start_time, updated_by: currentAdmin })
    });
    const data = await res.json();
    msg.textContent = data.message || data.error;
    msg.style.color = res.ok ? 'green' : 'red';
    if (res.ok) {
      socket.emit('schedule-update');
      setTimeout(() => {
        hide(document.getElementById('editSchedulePopup'));
        msg.textContent = '';
      }, 1500);
    }
  } catch (err) {
    msg.style.color = 'red';
    msg.textContent = `Failed to update schedule: ${err.message}`;
  }
};