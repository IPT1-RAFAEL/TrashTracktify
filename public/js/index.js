// This file is used for BOTH simulation (draggable marker) AND viewing
// It fetches geographic data and ETA from the server.
// NOW includes watchPosition to use live location.

// *** FIX: Removed typo. Connect to local server for testing ***
// const socket = io("https://trashtracktify.onrender.com"); 
const socket = io("http://localhost:3000"); // Use this when running locally

const map = L.map('map').setView([14.667, 120.967], 15);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

const truckIcon = L.icon({
  iconUrl: 'truck.png',
  iconSize: [32, 32],
  iconAnchor: [16, 32],
  popupAnchor: [0, -32]
});

// --- Store markers for multiple trucks ---
let truckMarkers = {};
const SIMULATED_TRUCK_ID = "Truck-Simulator";

// --- Draggable marker (for simulation) ---
// *** FIX: Started marker in Caloocan ***
const simMarker = L.marker([14.667, 120.967], { icon: truckIcon, draggable: true }).addTo(map);
simMarker.bindPopup(`<b>${SIMULATED_TRUCK_ID}</b><br>Drag me or let me follow you!`).openPopup();
truckMarkers[SIMULATED_TRUCK_ID] = simMarker;

// --- Variables to hold fetched data ---
let polygons = [];
let streetGroups = {};
const markerColors = { Tugatog: "green", Acacia: "blue", Tinajeros: "red" };

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
        const polyResponse = await fetch('/data/polygon.json'); // Fetches from public/data/
        if (!polyResponse.ok) throw new Error(`HTTP error! status: ${polyResponse.status}`);
        polygons = await polyResponse.json();
        console.log("Polygons loaded:", polygons.length);

        const streetResponse = await fetch('/data/streets.json'); // Fetches from public/data/
        if (!streetResponse.ok) throw new Error(`HTTP error! status: ${streetResponse.status}`);
        streetGroups = await streetResponse.json();
        console.log("Street groups loaded:", Object.keys(streetGroups).length);

        drawPolygons();
        drawStreetMarkers();

    } catch (error) {
        console.error("Failed to load map data:", error);
    }
}

// --- Function to Calculate Distance ---
function getDistance(lat1, lon1, lat2, lon2) { /* ... same as before ... */ }

// --- Load map data after map is ready ---
loadAndDrawMapData();

// --- Helper function to send location update ---
function sendLocationUpdate(latLng, source) {
    const dataToSend = {
      latitude: latLng.lat,
      longitude: latLng.lng,
      truckId: SIMULATED_TRUCK_ID,
      driverId: "SimDriver",
      tripId: "SimTrip",
      source: source
    };
    socket.emit('update-location', dataToSend);
    
    // *** FIX: Use a relative URL for fetch ***
    fetch(`/eta/${SIMULATED_TRUCK_ID}`) 
      .then(response => {
          if (!response.ok) {
              console.error(`Error fetching ETA: ${response.status} (${response.statusText})`);
              throw new Error(`HTTP error! status: ${response.status}`);
          }
          return response.json();
       })
      .then(etaData => {
         if (etaData && etaData.etaMinutes !== undefined) {
           let etaText = "ETA Unknown";
           if(etaData.etaMinutes >= 0) {
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

// --- GEOLOCATION WATCHER ---
if ("geolocation" in navigator) {
  console.log("Geolocation available. Watching position...");
  navigator.geolocation.watchPosition(
    (position) => {
      const { latitude, longitude } = position.coords;
      const newLatLng = L.latLng(latitude, longitude);

      console.log(`📍 Live position update: ${latitude}, ${longitude}`);
      
      simMarker.setLatLng(newLatLng);
      map.setView(newLatLng, 16); 
      
      sendLocationUpdate(newLatLng, "simulator-live");
    },
    (error) => {
      console.error("❌ Geolocation error:", error.message);
    }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
  );
} else {
  console.warn("⚠️ Geolocation not supported. Marker will be drag-only.");
}

// --- Socket.IO Listener (for OTHER trucks) ---
socket.on("location-update", (data) => {
  const { latitude, longitude, truckId, source } = data;
  if (latitude === undefined || longitude === undefined || !truckId) { return; }

  // Ignore updates for our own simulator marker
  if (truckId === SIMULATED_TRUCK_ID) { return; }

  const newLatLng = [latitude, longitude];
  let currentMarker = truckMarkers[truckId];

  if (!currentMarker) {
    console.log(`Creating marker for new truck: ${truckId}`);
    currentMarker = L.marker(newLatLng, { icon: truckIcon }).addTo(map);
    currentMarker.bindPopup(`<b>${truckId}</b><br>Calculating ETA...`).openPopup();
    truckMarkers[truckId] = currentMarker;
  } else {
    currentMarker.setLatLng(newLatLng);
  }

  // --- Fetch and Display ETA for the *other* truck ---
  // *** FIX: Use a relative URL for fetch ***
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
         if(!currentMarker.isPopupOpen()) currentMarker.openPopup();
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

// --- SIMULATION ONLY: Emit location when draggable marker moves ---
simMarker.on('drag', () => {
  const truckPos = simMarker.getLatLng();
  sendLocationUpdate(truckPos, "simulator-drag");
});

// --- Optional: Center map on first truck update ---
let initialCenterSet = false;
socket.on("location-update", (data) => {
    if (!initialCenterSet && data.latitude && data.longitude && !("geolocation" in navigator)) {
        map.setView([data.latitude, data.longitude], 16); 
        initialCenterSet = true;
    }
});