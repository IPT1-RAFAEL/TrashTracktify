const socket = io("https://trashtracktify.onrender.com");

const map = L.map('map').setView([14.667, 120.967], 15);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

const truckIcon = L.icon({
  iconUrl: "truck.png",
  iconSize: [32, 32],
  iconAnchor: [16, 32],
  popupAnchor: [0, -32],
});

let truckMarkers = {};
let polygons = [];
let streetGroups = {};
const markerColors = { Tugatog: "green", Acacia: "blue", Tinajeros: "red" };
let initialCenterSet = false;

function drawPolygons() {
  if (!map || polygons.length === 0) return;
  polygons.forEach(p => {
    L.polygon(p.coords, {
      color: p.color, fillColor: p.color, fillOpacity: 0.3, interactive: false
    }).addTo(map).bindPopup(`<b>${p.name}</b>`);
  });
}

function drawStreetMarkers() {
  if (!map || Object.keys(streetGroups).length === 0) return;
  Object.entries(streetGroups).forEach(([barangay, streets]) => {
    streets.forEach(item => {
      if (!item.coords || item.coords.length !== 2) return;
      L.circleMarker(item.coords, {
        radius: 5, color: markerColors[barangay], fillColor: markerColors[barangay], fillOpacity: 0.9
      }).addTo(map).bindPopup(`<b>${item.name}</b><br>${barangay}`);
    });
  });
}

async function loadAndDrawMapData() {
  try {
    const polyResponse = await fetch('/data/polygon.json');
    if (!polyResponse.ok) throw new Error(`HTTP error! status: ${polyResponse.status}`);
    polygons = await polyResponse.json();

    const streetResponse = await fetch('/data/streets.json');
    if (!streetResponse.ok) throw new Error(`HTTP error! status: ${streetResponse.status}`);
    streetGroups = await streetResponse.json();

    drawPolygons();
    drawStreetMarkers();
  } catch (error) {
    console.error("Failed to load map data:", error);
  }
}

loadAndDrawMapData();

socket.on("location-update", (data) => {
  const { latitude, longitude, truckId, source } = data;
  if (latitude === undefined || longitude === undefined || !truckId) {
    console.warn("[Register] Received incomplete location update:", data);
    return;
  }

  const newLatLng = [latitude, longitude];
  let currentMarker = truckMarkers[truckId];

  if (!currentMarker) {
    currentMarker = L.marker(newLatLng, { icon: truckIcon }).addTo(map);
    currentMarker.bindPopup(`<b>${truckId}</b><br>Calculating ETA...`).openPopup();
    truckMarkers[truckId] = currentMarker;
  } else {
    currentMarker.setLatLng(newLatLng);
  }

  if (!initialCenterSet && latitude && longitude) {
    map.setView([latitude, longitude], 16);
    initialCenterSet = true;
    console.log(`[Register] Map centered on first location: Lat=${latitude}, Lon=${longitude}`);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000); // Increased to 15s
  fetch(`/eta/${truckId}`, { signal: controller.signal })
    .then(response => {
      clearTimeout(timeoutId);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      return response.json();
    })
    .then(etaData => {
      let etaText = "ETA Unknown";
      if (etaData && etaData.etaMinutes !== undefined) {
        if (etaData.etaMinutes >= 0) {
          etaText = `ETA: ${etaData.etaMinutes} minute${etaData.etaMinutes !== 1 ? 's' : ''}`;
        } else if (etaData.error) {
          etaText = `ETA: ${etaData.error}`;
        }
      }
      currentMarker.setPopupContent(`<b>${truckId}</b><br>Next: ${etaData.nextStop || 'N/A'}<br>${etaText}`);
    })
    .catch(error => {
      console.error(`[Register] Error fetching ETA for ${truckId}:`, error);
      let errorMessage = "Could not fetch ETA";
      if (error.name === 'AbortError') {
        errorMessage = "ETA request timed out";
      } else if (error.message.includes('404')) {
        errorMessage = "Truck location not found on server";
      }
      currentMarker.setPopupContent(`<b>${truckId}</b><br>Lat: ${latitude.toFixed(6)}, Lon: ${longitude.toFixed(6)}<br>${errorMessage}`);
    });
});

const form = document.getElementById('popupForm');
const msgBox = document.getElementById('popupMsg');

if (form) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const data = Object.fromEntries(formData.entries());
    data.name = data.name.trim();
    data.phone = data.phone.trim();
    data.barangay = data.barangay.trim();
    console.log('[Register] Form data:', data);
    msgBox.textContent = '';

    if (!data.name) {
      msgBox.textContent = 'Name is required';
      msgBox.style.color = 'red';
      return;
    }

    if (!/^09\d{9}$/.test(data.phone)) {
      msgBox.textContent = 'Phone number must be 11 digits starting with 09 (e.g., 09123456789)';
      msgBox.style.color = 'red';
      return;
    }

    if (!['Tugatog', 'Acacia', 'Tinajeros'].includes(data.barangay)) {
      msgBox.textContent = 'Invalid barangay. Please select Tugatog, Acacia, or Tinajeros.';
      msgBox.style.color = 'red';
      return;
    }

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

      const result = await res.json(); 

     if (!res.ok) {
          throw new Error(result.error || `Server error: ${res.status}`);
      }

      msgBox.textContent = result.message || '✅ Registration successful!'; 

      msgBox.style.color = 'green';

      e.target.reset();
      setTimeout(() => {
          document.getElementById('registerPopup').classList.remove('show');
      }, 2000);

    } catch (err) {
      console.error('[Register] Registration error:', err);
      msgBox.textContent = err.name === 'AbortError' 
          ? 'Request timed out. Please try again.'
          : err.message; // Display the actual error message
      msgBox.style.color = 'red';
    }
  });
}

const daysOfWeek = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

async function loadSchedule() {
  try {
    const response = await fetch('/schedule');
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const schedules = await response.json();
    console.log('[Register] Loaded schedules:', schedules);

    const scheduleByBarangay = {};
    schedules.forEach(s => {
      if (!scheduleByBarangay[s.barangay]) scheduleByBarangay[s.barangay] = {};
      scheduleByBarangay[s.barangay][s.day] = s.start_time;
    });

    ['Tugatog', 'Acacia', 'Tinajeros'].forEach(barangay => {
      const daysContainer = document.getElementById(`${barangay}-days`);
      if (!daysContainer) return;
      daysContainer.innerHTML = '';
      daysOfWeek.forEach(day => {
        const time = scheduleByBarangay[barangay]?.[day] || 'N/A';
        const span = document.createElement('span');
        span.textContent = `${day}: ${time !== 'N/A' ? time.slice(0, 5) : time}`;
        daysContainer.appendChild(span);
      });
    });
  } catch (error) {
    console.error('Error loading schedule:', error);
  }
}

socket.on('schedule-update', () => {
  console.log('Schedule updated, refreshing display...');
  loadSchedule();
});

loadSchedule();