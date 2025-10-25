const socket = io("https://trashtracktify.onrender.com");
// const socket = io("http://localhost:3000");

let map = null; // Initialize map later

// Initialize map as soon as the container is ready
document.addEventListener('DOMContentLoaded', () => {
  if (!map) { // Prevent re-initialization
      map = L.map('map').setView([14.667, 120.967], 15);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors'
      }).addTo(map);
      console.log("Map initialized in map.js");
      loadAndDrawMapData(); // Load data after map is ready
  }
});


const truckIcon = L.icon({
  iconUrl: "img/garbage-truck.png",
  iconSize: [32, 32],
  iconAnchor: [16, 32],
  popupAnchor: [0, -28],
});

let truckMarkers = {};
let polygons = [];
let streetGroups = {};
const markerColors = { Tugatog: "green", Acacia: "blue", Tinajeros: "red" };
let initialCenterSet = false;
let lastTruckLocation = null;

// --- NEW: Variables to store paths for each truck ---
let truckPaths = {}; // Object to hold coordinate arrays: { truckId: [[lat,lng], [lat,lng]], ... }
let truckPathLayers = {}; // Object to hold Leaflet layer objects: { truckId: L.polyline(...), ... }
// --- END NEW ---

// Draw polygons (from /data/polygon.json)
function drawPolygons() {
  if (!map || !polygons || polygons.length === 0) return;
  polygons.forEach(p => {
    L.polygon(p.coords, {
      color: p.color, fillColor: p.color, fillOpacity: 0.25, weight: 2
    }).addTo(map).bindPopup(`<b>${p.name}</b>`);
  });
}

// Draw street markers
function drawStreetMarkers() {
  if (!map || !streetGroups) return;
  Object.entries(streetGroups).forEach(([barangay, streets]) => {
    streets.forEach(item => {
      if (!item.coords || item.coords.length !== 2) return;
      L.circleMarker(item.coords, {
        radius: 5,
        color: markerColors[barangay] || '#555',
        fillColor: markerColors[barangay] || '#555',
        fillOpacity: 0.9
      }).addTo(map).bindPopup(`<b>${item.name}</b><br>${barangay}`);
    });
  });
}

// Load polygon and street data
async function loadAndDrawMapData() {
  // Wait until the map is definitely initialized
  if (!map) {
      console.warn("Map not ready for data loading, trying again soon...");
      setTimeout(loadAndDrawMapData, 200); // Retry shortly
      return;
  }
  try {
    console.log("Loading map data...");
    const polyRes = await fetch('/data/polygon.json');
    if (polyRes.ok) polygons = await polyRes.json();

    const streetsRes = await fetch('/data/streets.json');
    if (streetsRes.ok) streetGroups = await streetsRes.json();

    drawPolygons();
    drawStreetMarkers();
    console.log("Map data drawn.");
  } catch (err) {
    console.error('Error loading map data', err);
  }
}

// Helper to update truck status UI (progress ring)
function setTruckStatus(percent, stateText){
  const fg = document.querySelector('.progress-ring .fg');
  const tsPercent = document.getElementById('tsPercent');
  const tsState = document.getElementById('tsState');
  percent = Math.max(0, Math.min(100, Math.round(percent)));
  const dash = 100 - percent;
  if (fg) fg.style.strokeDashoffset = `${dash}`;
  if (tsPercent) tsPercent.textContent = `${percent}%`;
  if (tsState) tsState.textContent = stateText || '';
}

// --- NEW: Function to update the path line on the map ---
function updateTruckPathOnMap(truckId) {
    if (!map || !truckPaths[truckId]) return; // Exit if no map or no path data

    // Remove the old path layer if it exists
    if (truckPathLayers[truckId] && map.hasLayer(truckPathLayers[truckId])) {
        map.removeLayer(truckPathLayers[truckId]);
    }

    // Draw the new path if there are coordinates
    if (truckPaths[truckId].length > 1) { // Need at least 2 points for a line
        const newPathLayer = L.polyline(truckPaths[truckId], {
            color: 'blue', // Or choose color based on truckId?
            weight: 4,
            opacity: 0.7
        }).addTo(map);
        truckPathLayers[truckId] = newPathLayer; // Store the new layer
    } else {
        truckPathLayers[truckId] = null; // Clear layer if not enough points
    }
}
// --- END NEW ---

// Handle incoming truck locations from socket
socket.on("location-update", (data) => {
  const { latitude, longitude, truckId, source } = data;
  if (latitude === undefined || longitude === undefined || !truckId) {
    console.warn('map.js: incomplete location', data);
    return;
  }

  // Ensure map is initialized before proceeding
  if (!map) {
      console.warn("Received location update but map is not ready yet.");
      return;
  }

  const newLatLng = [latitude, longitude];
  lastTruckLocation = newLatLng; // Keep track of the latest for centering

  let marker = truckMarkers[truckId];
  if (!marker) {
    marker = L.marker(newLatLng, { icon: truckIcon }).addTo(map);
    marker.bindPopup(`<b>${truckId}</b><br>Loading ETA...`);
    truckMarkers[truckId] = marker;
  } else {
    // Only update if marker is still on the map
    if (map.hasLayer(marker)) {
        marker.setLatLng(newLatLng);
    } else {
        // If marker was removed somehow, recreate it
        console.warn(`Marker for ${truckId} was missing, recreating.`);
        marker = L.marker(newLatLng, { icon: truckIcon }).addTo(map);
        marker.bindPopup(`<b>${truckId}</b><br>Loading ETA...`);
        truckMarkers[truckId] = marker;
        // Also reset path for this truck if marker was missing
        truckPaths[truckId] = [];
        if (truckPathLayers[truckId] && map.hasLayer(truckPathLayers[truckId])) {
           map.removeLayer(truckPathLayers[truckId]);
        }
        truckPathLayers[truckId] = null;
    }
  }

  // --- NEW: Add coordinate to path and update line ---
  if (!truckPaths[truckId]) {
      truckPaths[truckId] = []; // Initialize array if first time for this truck
  }
  // Add the new coordinate
  truckPaths[truckId].push(newLatLng);

  // Redraw the path line for this specific truck
  updateTruckPathOnMap(truckId);
  // --- END NEW ---


  // Center on first location received (any truck)
  if (!initialCenterSet) {
    map.setView(newLatLng, 16);
    initialCenterSet = true;
  }
});

// Server emits 'truck-status' { truckId: ..., percentFull: ... }
socket.on("truck-status", (status) => {
  if (!status) return;
  const p = typeof status.percentFull === 'number' ? status.percentFull : 0;
  setTruckStatus(p, status.state || 'Status');
});

// When a truck marker is created/updated, attempt to fetch ETA for that truck (debounced)
function requestETA(truckId, latitude, longitude){
  if (!truckId) return;
  // Ensure map is ready before proceeding
  if (!map) return;
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);
  fetch(`/eta/${encodeURIComponent(truckId)}`, { signal: controller.signal })
    .then(res => {
      clearTimeout(timeoutId);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .then(etaData => {
      const marker = truckMarkers[truckId];
      if (!marker || !map.hasLayer(marker)) return; // Check if marker exists and is on map

      let etaText = 'ETA Unknown';
      if (etaData && etaData.etaMinutes !== undefined) {
        if (etaData.etaMinutes >= 0) {
          etaText = `ETA: ${etaData.etaMinutes} minute${etaData.etaMinutes !== 1 ? 's' : ''}`;
        } else if (etaData.error) {
          etaText = `ETA: ${etaData.error}`;
        }
      }
      marker.setPopupContent(`<b>${truckId}</b><br>Next: ${etaData.nextStop || 'N/A'}<br>${etaText}`);
    })
    .catch(err => {
      clearTimeout(timeoutId);
      console.error('Error fetching ETA', err);
      const marker = truckMarkers[truckId];
      if (!marker || !map.hasLayer(marker)) return; // Check again

      const msg = err.name === 'AbortError' ? 'ETA request timed out' : 'Could not fetch ETA';
      marker.setPopupContent(`<b>${truckId}</b><br>Lat: ${latitude.toFixed(6)}, Lon: ${longitude.toFixed(6)}<br>${msg}`);
    });
}

// Connect ETA fetch to location updates but keep it light
const etaCooldown = {};
socket.on("location-update", (data) => {
  const { truckId, latitude, longitude } = data;
  if (!truckId || !latitude || !longitude) return;
  const now = Date.now();
  if (!etaCooldown[truckId] || now - etaCooldown[truckId] > 12000) {
    etaCooldown[truckId] = now;
    requestETA(truckId, latitude, longitude);
  }
});

// center button behavior
const centerBtn = document.getElementById('centerBtn');
if (centerBtn) { // Add check in case element doesn't exist
    centerBtn.addEventListener('click', () => {
      // Ensure map exists before trying to use it
      if (!map) return;
      
      if (lastTruckLocation) {
        map.setView(lastTruckLocation, 16, { animate: true });
      } else if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(pos => {
          map.setView([pos.coords.latitude, pos.coords.longitude], 15, { animate: true });
        }, err => {
          console.warn('Geolocation failed', err);
          // Fallback: center on default view if geolocation fails
           map.setView([14.667, 120.967], 15);
        }, { timeout: 8000 });
      } else {
           // Fallback if no last location and no geolocation
           map.setView([14.667, 120.967], 15);
      }
    });
     // small accessibility: allow keyboard to focus center button
    centerBtn.tabIndex = 0;
}


// Make popups open on marker click (already handled) and tidy mobile behavior
const style = document.createElement('style');
style.innerHTML = `.leaflet-popup-content-wrapper{font-family:Georgia, serif;padding:8px 12px;font-size:13px} .leaflet-popup-content{line-height:1.25}`;
document.head.appendChild(style);


// When the socket disconnects/reconnects update status ring
socket.on('connect', () => {
  setTruckStatus(100, 'Connected'); // Assuming status applies globally or needs reset logic
  setTimeout(()=> setTruckStatus(0,'Initializing...'), 1200);
  // We might need to re-fetch initial state or clear paths on reconnect?
});
socket.on('disconnect', () => {
  setTruckStatus(0, 'Disconnected');
  // Clear paths or show an indication that data might be stale?
  // For now, paths will remain as they were.
});
