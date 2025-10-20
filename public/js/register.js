// This file is for viewing truck locations and ETAs only.
// It fetches geographic data and ETA from the server.

const socket = io("https://trashtracktify.onrender.com"); // Your server URL
const map = L.map('map').setView([14.667, 120.967], 15);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

const truckIcon = L.icon({
  iconUrl: "truck.png", // Ensure truck.png exists in public/
  iconSize: [32, 32],
  iconAnchor: [16, 32],
  popupAnchor: [0, -32],
});

// --- Store markers for multiple trucks ---
let truckMarkers = {};

// --- Variables to hold fetched data ---
let polygons = [];
let streetGroups = {};
const markerColors = { Tugatog: "green", Acacia: "blue", Tinajeros: "red" }; // Keep this simple map

// --- Function to draw polygons once data is loaded ---
function drawPolygons() {
    if (!map || polygons.length === 0) return;
    console.log("Drawing polygons...");
    polygons.forEach(p => {
         L.polygon(p.coords, {
             color: p.color, fillColor: p.color, fillOpacity: 0.3, interactive: false
         }).addTo(map).bindPopup(`<b>${p.name}</b>`);
    });
}

// --- Function to draw street markers once data is loaded ---
function drawStreetMarkers() {
    if (!map || Object.keys(streetGroups).length === 0) return;
    console.log("Drawing street markers...");
    Object.entries(streetGroups).forEach(([barangay, streets]) => {
        streets.forEach(item => {
            if (!item.coords || item.coords.length !== 2) return;
            L.circleMarker(item.coords, {
                radius: 5, color: markerColors[barangay], fillColor: markerColors[barangay], fillOpacity: 0.9
            }).addTo(map).bindPopup(`<b>${item.name}</b><br>${barangay}`);
        });
    });
}

// --- Function to load data and then draw ---
async function loadAndDrawMapData() {
    console.log("Loading map data...");
    try {
        const polyResponse = await fetch('/data/polygon.json'); // Corrected filename
        if (!polyResponse.ok) throw new Error(`HTTP error! status: ${polyResponse.status}`);
        polygons = await polyResponse.json();
        console.log("Polygons loaded:", polygons.length);

        const streetResponse = await fetch('/data/streets.json');
        if (!streetResponse.ok) throw new Error(`HTTP error! status: ${streetResponse.status}`);
        streetGroups = await streetResponse.json();
        console.log("Street groups loaded:", Object.keys(streetGroups).length);

        // Now that data is loaded, draw them
        drawPolygons();
        drawStreetMarkers();

    } catch (error) {
        console.error("Failed to load map data:", error);
    }
}

// --- Function to Calculate Distance (Can be removed if not used elsewhere) ---
// function getDistance(lat1, lon1, lat2, lon2) { /* ... same as server ... */ }

// --- Load map data after map is ready ---
loadAndDrawMapData();

// --- Socket.IO Listener ---
socket.on("location-update", (data) => {
  const { latitude, longitude, truckId, source } = data; // Expect truckId
   if (latitude === undefined || longitude === undefined || !truckId) {
      console.warn("Received incomplete location update:", data);
      return;
  }

  const newLatLng = [latitude, longitude];
  let currentMarker = truckMarkers[truckId];

  if (!currentMarker) {
    // Create marker if it doesn't exist
    console.log(`Creating marker for new truck: ${truckId}`);
    currentMarker = L.marker(newLatLng, { icon: truckIcon }).addTo(map); // Non-draggable
    currentMarker.bindPopup(`<b>${truckId}</b><br>Calculating ETA...`).openPopup();
    truckMarkers[truckId] = currentMarker;
  } else {
    // Update existing marker position
    currentMarker.setLatLng(newLatLng);
  }

  // --- Fetch and Display ETA ---
  fetch(`/eta/${truckId}`) // Call the server's ETA endpoint
     .then(response => {
        if (!response.ok) {
             throw new Error(`HTTP error fetching ETA! status: ${response.status}`);
        }
        return response.json();
     })
    .then(etaData => {
       if (etaData && etaData.etaMinutes !== undefined) {
         let etaText = "ETA Unknown";
         if(etaData.etaMinutes >= 0) {
            etaText = `ETA: ${etaData.etaMinutes} minute${etaData.etaMinutes !== 1 ? 's' : ''}`;
         } else if (etaData.error) {
             etaText = "ETA Error";
             console.warn(`ETA Error for ${truckId}: ${etaData.error}`);
         }
         currentMarker.setPopupContent(`<b>${truckId}</b><br>Next: ${etaData.nextStop || 'N/A'}<br>${etaText}`);
         if(!currentMarker.isPopupOpen()) {
             currentMarker.openPopup();
         }
      } else {
         currentMarker.setPopupContent(`<b>${truckId}</b><br>ETA data unavailable`);
      }
    })
    .catch(error => {
      console.error(`Error fetching ETA for ${truckId}:`, error);
      currentMarker.setPopupContent(`<b>${truckId}</b><br>Could not fetch ETA`);
    });

  console.log(`🛰 Synced position for ${truckId} from ${source || 'unknown'}: ${latitude}, ${longitude}`);
});

// --- Optional: Center map on first truck update ---
let initialCenterSet = false;
socket.on("location-update", (data) => {
    if (!initialCenterSet && data.latitude && data.longitude) {
        map.setView([data.latitude, data.longitude], 16);
        initialCenterSet = true;
    }
});


// --- Handle Registration Form Submission --- (Keep this section)
const form = document.getElementById('popupForm');
const msgBox = document.getElementById('popupMsg');

if (form) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const data = Object.fromEntries(formData.entries());
    msgBox.textContent = ''; // Clear previous message

    try {
      const res = await fetch('/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });

      const text = await res.text();
      msgBox.textContent = text;
      msgBox.style.color = res.ok ? 'green' : 'red';

      if (res.ok) {
        e.target.reset();
        setTimeout(() => {
          document.getElementById('registerPopup').classList.remove('show');
        }, 2000);
      }
    } catch (err) {
      msgBox.textContent = 'Error connecting to server: ' + err.message;
      msgBox.style.color = 'red';
    }
  });
}