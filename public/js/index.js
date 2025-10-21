// This file is used for BOTH simulation (draggable marker) AND viewing
// It fetches geographic data and ETA from the server.
// NOW includes watchPosition to use live location.

// *** IMPORTANT: Change this to your Render URL ***
const socket = io("https://trashtracktify.onrender.com");
// const socket = io("http://localhost:3000"); // Use this ONLY when running locally

const map = L.map('map').setView([14.667, 120.967], 15);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

const truckIcon = L.icon({
  iconUrl: 'truck.png', // Make sure truck.png is in the public folder
  iconSize: [32, 32],
  iconAnchor: [16, 32],
  popupAnchor: [0, -32]
});

let truckMarkers = {};
const SIMULATED_TRUCK_ID = "Truck-Simulator";

const simMarker = L.marker([14.667, 120.967], { icon: truckIcon, draggable: true }).addTo(map);
simMarker.bindPopup(`<b>${SIMULATED_TRUCK_ID}</b><br>Drag me or let me follow you!`).openPopup();
truckMarkers[SIMULATED_TRUCK_ID] = simMarker;

let polygons = []; // Will be loaded
let streetGroups = {}; // Will be loaded
const markerColors = { Tugatog: "green", Acacia: "blue", Tinajeros: "red" }; // Matches polygon colors

function drawPolygons() {
  if (!map || polygons.length === 0) return;
  polygons.forEach(p => {
    L.polygon(p.coords, { // Uses coords from polygon.json
      color: p.color, fillColor: p.color, fillOpacity: 0.3, interactive: false
    }).addTo(map).bindPopup(`<b>${p.name}</b>`);
  });
}

function drawStreetMarkers() {
  if (!map || Object.keys(streetGroups).length === 0) return;
  Object.entries(streetGroups).forEach(([barangay, streets]) => {
    streets.forEach(item => {
      if (!item.coords || item.coords.length !== 2) return;
      L.circleMarker(item.coords, { // Uses coords from streets.json
        radius: 5, color: markerColors[barangay], fillColor: markerColors[barangay], fillOpacity: 0.9
      }).addTo(map).bindPopup(`<b>${item.name}</b><br>${barangay}`); // Displays street name and barangay
    });
  });
}

async function loadAndDrawMapData() {
  try {
    const polyResponse = await fetch('/data/polygon.json'); // Fetches polygon data
    if (!polyResponse.ok) throw new Error(`HTTP error! status: ${polyResponse.status}`);
    polygons = await polyResponse.json();

    const streetResponse = await fetch('/data/streets.json'); // Fetches street data
    if (!streetResponse.ok) throw new Error(`HTTP error! status: ${streetResponse.status}`);
    streetGroups = await streetResponse.json();

    drawPolygons();
    drawStreetMarkers();
  } catch (error) {
    console.error("Failed to load map data:", error);
  }
}

// Helper function to send location update AND trigger SMS command
function sendLocationUpdate(latLng, source) {
  const dataToSend = {
    latitude: latLng.lat,
    longitude: latLng.lng,
    truckId: SIMULATED_TRUCK_ID,
    driverId: "SimDriver",
    tripId: "SimTrip",
    source: source // "simulator-live" or "simulator-drag"
  };
  // 1. Send location for map update
  socket.emit('update-location', dataToSend);

  // *** NEW: 2. Send location data specifically to trigger SMS via server ***
  socket.emit('simulator-moved-trigger-sms', { latitude: latLng.lat, longitude: latLng.lng });

  // (Keep the ETA fetching logic as it was)
  fetch(`/eta/${SIMULATED_TRUCK_ID}`)
    .then(response => {
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      return response.json();
    })
    .then(etaData => {
      if (etaData && etaData.etaMinutes !== undefined) {
        let etaText = "ETA Unknown";
        if (etaData.etaMinutes >= 0) {
          etaText = `ETA: ${etaData.etaMinutes} min${etaData.etaMinutes !== 1 ? 's' : ''}`;
        }
        simMarker.setPopupContent(`<b>${SIMULATED_TRUCK_ID}</b><br>Next: ${etaData.nextStop || 'N/A'}<br>${etaText}`);
      }
    })
    .catch(error => {
      console.error(`Error fetching ETA for ${SIMULATED_TRUCK_ID}:`, error);
      simMarker.setPopupContent(`<b>${SIMULATED_TRUCK_ID}</b><br>Could not fetch ETA`);
    });
}

// GEOLOCATION WATCHER
if ("geolocation" in navigator) {
  navigator.geolocation.watchPosition(
    (position) => {
      const { latitude, longitude } = position.coords;
      const newLatLng = L.latLng(latitude, longitude);
      simMarker.setLatLng(newLatLng);
      // Don't force map view if user has panned away
      // map.setView(newLatLng, 16);
      sendLocationUpdate(newLatLng, "simulator-live"); // Sends location + triggers SMS event
    },
    (error) => {
      console.error("❌ Geolocation error:", error.message);
    }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
  );
} else {
  console.warn("Geolocation not supported. Simulator is drag-only.");
}

// Socket.IO Listener (for OTHER trucks - no changes needed here)
socket.on("location-update", (data) => {
  const { latitude, longitude, truckId, source } = data;
  if (latitude === undefined || longitude === undefined || !truckId) return;

  // Ignore updates for our own simulator marker
  if (truckId === SIMULATED_TRUCK_ID) return;

  const newLatLng = [latitude, longitude];
  let currentMarker = truckMarkers[truckId];

  if (!currentMarker) {
    currentMarker = L.marker(newLatLng, { icon: truckIcon }).addTo(map);
    currentMarker.bindPopup(`<b>${truckId}</b><br>Calculating ETA...`).openPopup();
    truckMarkers[truckId] = currentMarker;
  } else {
    currentMarker.setLatLng(newLatLng);
  }

  // Fetch and Display ETA for the *other* truck
  fetch(`/eta/${truckId}`)
    .then(response => {
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      return response.json();
    })
    .then(etaData => {
       if (etaData && etaData.etaMinutes !== undefined) {
         let etaText = "ETA Unknown";
         if(etaData.etaMinutes >= 0) {
            etaText = `ETA: ${etaData.etaMinutes} minute${etaData.etaMinutes !== 1 ? 's' : ''}`;
         } else if (etaData.error) {
             etaText = "ETA Error";
         }
         currentMarker.setPopupContent(`<b>${truckId}</b><br>Next: ${etaData.nextStop || 'N/A'}<br>${etaText}`);
         // Only open popup if it's closed to avoid annoyance
         // if(!currentMarker.isPopupOpen()) currentMarker.openPopup();
      }
    })
    .catch(error => {
      console.error(`Error fetching ETA for ${truckId}:`, error);
      currentMarker.setPopupContent(`<b>${truckId}</b><br>Could not fetch ETA`);
    });
});

// SIMULATION ONLY: Emit location when draggable marker moves
simMarker.on('dragend', () => { // Changed to dragend to avoid spamming
  const truckPos = simMarker.getLatLng();
  sendLocationUpdate(truckPos, "simulator-drag"); // Sends location + triggers SMS event
});

// Load map data initially
loadAndDrawMapData();

// --- Schedule Display Logic ---
const daysOfWeek = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

async function loadSchedule() {
  try {
    const response = await fetch('/schedule'); // Fetches schedule data from server
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const schedules = await response.json();

    const scheduleByBarangay = {};
    schedules.forEach(s => {
      if (!scheduleByBarangay[s.barangay]) scheduleByBarangay[s.barangay] = {};
      scheduleByBarangay[s.barangay][s.day] = s.start_time;
    });

    ['Tugatog', 'Acacia', 'Tinajeros'].forEach(barangay => { // Matches barangays in HTML
      const daysContainer = document.getElementById(`${barangay}-days`);
      if (!daysContainer) return; // Add check if element exists
      daysContainer.innerHTML = ''; // Clear previous entries
      daysOfWeek.forEach(day => {
        const time = scheduleByBarangay[barangay]?.[day] || 'N/A'; // Default to N/A if no schedule
        const span = document.createElement('span');
        span.textContent = `${day}: ${time !== 'N/A' ? time.slice(0, 5) : time}`; // Format time HH:MM
        daysContainer.appendChild(span);
      });
    });
  } catch (error) {
    console.error('Error loading schedule:', error);
  }
}

// Reload schedule if server broadcasts an update
socket.on('schedule-update', () => {
  console.log('Schedule updated, refreshing display...');
  loadSchedule();
});

// Initial load
loadSchedule();