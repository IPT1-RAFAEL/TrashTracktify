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

adminLoginBtn.onclick = () => show(loginModal);
document.getElementById('showRegister').onclick = () => { hide(loginModal); show(registerModal); };
document.getElementById('showLogin').onclick = () => { hide(registerModal); show(loginModal); };

document.getElementById('loginSubmit').onclick = async () => {
  const username = document.getElementById('loginUser').value.trim();
  const password = document.getElementById('loginPass').value.trim();
  const msg = document.getElementById('loginMsg');
  if (!username || !password) return msg.textContent = "Please fill in all fields.";

  const res = await fetch('/admin-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  const text = await res.text();
  if (res.ok) {
    msg.style.color = 'green';
    msg.textContent = "Login successful!";
    localStorage.setItem('adminUser', username);
    setTimeout(() => location.reload(), 1000);
  } else {
    msg.style.color = 'red';
    msg.textContent = text;
  }
};

document.getElementById('regSubmit').onclick = async () => {
  const username = document.getElementById('regUser').value.trim();
  const password = document.getElementById('regPass').value.trim();
  const msg = document.getElementById('regMsg');
  if (!username || !password) return msg.textContent = "Please fill in all fields.";

  const res = await fetch('/admin-register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  const text = await res.text();
  msg.textContent = text;
  msg.style.color = res.ok ? 'green' : 'red';
  if (res.ok) setTimeout(() => { hide(registerModal); show(loginModal); }, 1000);
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

// Load schedules
async function loadSchedule() {
  const res = await fetch('/schedule');
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
}

socket.on('schedule-update', loadSchedule);

async function loadResidents() {
  const res = await fetch('/users');
  const data = await res.json();
  const tbody = document.querySelector('#residentsTable tbody');
  tbody.innerHTML = '';
  data.forEach(u => {
    const row = `<tr><td>${u.id}</td><td>${u.name}</td><td>${u.phone}</td><td>${u.barangay}</td></tr>`;
    tbody.innerHTML += row;
  });
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
  const start_time = e.target.start_time.value;
  const msg = document.getElementById('editMsg');
  const res = await fetch('/schedule', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ barangay, day, start_time, updated_by: currentAdmin })
  });
  msg.textContent = await res.text();
  msg.style.color = res.ok ? 'green' : 'red';
  if (res.ok) {
    socket.emit('schedule-update');
    setTimeout(() => {
      hide(document.getElementById('editSchedulePopup'));
      msg.textContent = '';
    }, 1500);
  }
};
