// This file is used for BOTH simulation (draggable marker) AND viewing
// It fetches geographic data and ETA from the server.

const socket = io("https://trashtracktify.onrender.com"); // Your server URL
const map = L.map('map').setView([14.667, 120.967], 15);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

const truckIcon = L.icon({
  iconUrl: 'truck.png', // Ensure truck.png exists in public/
  iconSize: [32, 32],
  iconAnchor: [16, 32],
  popupAnchor: [0, -32]
});

// --- Store markers for multiple trucks ---
let truckMarkers = {};
// --- SIMULATION ONLY: Define an ID for the draggable marker ---
const SIMULATED_TRUCK_ID = "Truck-Simulator";

// --- Draggable marker (for simulation) ---
const simMarker = L.marker([0, 0], { icon: truckIcon, draggable: true }).addTo(map);
simMarker.bindPopup(`<b>${SIMULATED_TRUCK_ID}</b><br>Drag me!`).openPopup();
truckMarkers[SIMULATED_TRUCK_ID] = simMarker;

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
        // Maybe display an error message on the page
    }
}

// --- Function to Calculate Distance (Optional on client, but needed if used) ---
function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000; // meters
  const toRad = x => x * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}


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

  // Prevent simulated marker from being moved by non-simulator updates for same ID
  if (truckId === SIMULATED_TRUCK_ID && source !== 'simulator') {
       if (currentMarker) {
           // currentMarker.setLatLng(newLatLng); // Decide if you want external updates to move sim
           console.log(`🛰 Ignoring external update for simulator ID ${truckId}`);
       }
       return;
  }

  if (!currentMarker) {
    // Create marker if it doesn't exist
    console.log(`Creating marker for new truck: ${truckId}`);
    currentMarker = L.marker(newLatLng, { icon: truckIcon, draggable: (truckId === SIMULATED_TRUCK_ID) }).addTo(map);
    currentMarker.bindPopup(`<b>${truckId}</b><br>Calculating ETA...`).openPopup();
    truckMarkers[truckId] = currentMarker;
  } else {
    // Update existing marker position (only if not dragging the simulator itself)
    if (!(truckId === SIMULATED_TRUCK_ID && currentMarker.dragging && currentMarker.dragging.enabled())) {
         currentMarker.setLatLng(newLatLng);
    }
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
         // Only open if not already open to prevent annoying flicker
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


// --- SIMULATION ONLY: Emit location when draggable marker moves ---
simMarker.on('drag', () => {
  const truckPos = simMarker.getLatLng();
  const dataToSend = {
      latitude: truckPos.lat,
      longitude: truckPos.lng,
      truckId: SIMULATED_TRUCK_ID,
      driverId: "SimDriver", // Example Driver ID
      tripId: "SimTrip",     // Example Trip ID
      source: "simulator"    // Identify as simulated data
  };

  // Emit location for the SIMULATED truck
  socket.emit('update-location', dataToSend);

  // Also manually trigger the display update/ETA fetch for the dragged marker
  // (since io.emit on server doesn't send back to sender by default)
  socket.emit('update-location', dataToSend); // Send again to trigger self-update via broadcast, OR call handler manually:
  // handleLocationUpdate(dataToSend); // Assumes you refactor the socket.on handler into a function

  // Fetch ETA for the simulated truck's current position (optional, could rely on broadcast)
  fetch(`/eta/${SIMULATED_TRUCK_ID}`)
    .then(response => response.json())
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
});

// --- Optional: Center map on first truck update ---
let initialCenterSet = false;
socket.on("location-update", (data) => {
    if (!initialCenterSet && data.latitude && data.longitude) {
        map.setView([data.latitude, data.longitude], 16); // Zoom in a bit more on first update
        initialCenterSet = true;
    }
});