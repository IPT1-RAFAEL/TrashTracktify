
const socket = io("https://trashtracktify.onrender.com");

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

let truckMarkers = {};
const SIMULATED_TRUCK_ID = "Truck-Simulator";

const simMarker = L.marker([14.667, 120.967], { icon: truckIcon, draggable: true }).addTo(map);
simMarker.bindPopup(`<b>${SIMULATED_TRUCK_ID}</b><br>Drag me or let me follow you!`).openPopup();
truckMarkers[SIMULATED_TRUCK_ID] = simMarker;

let polygons = [];
let streetGroups = {};
let allStreetMarkers = [];
const markerColors = { Tugatog: "green", Acacia: "blue", Tinajeros: "red" };

// Cooldown to prevent spammy notifications (5 minutes)
const notificationCooldown = new Map();
const COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

// Load Turf.js dynamically for client-side geofencing
const script = document.createElement('script');
script.src = 'https://cdn.jsdelivr.net/npm/@turf/turf@6/turf.min.js';
script.onload = () => console.log('[Client] Turf.js loaded');
document.head.appendChild(script);

function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Earth's radius in meters
  const toRad = x => x * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

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
      allStreetMarkers.push({ ...item, barangay });
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

function sendLocationUpdate(latLng, source) {
  const dataToSend = {
    latitude: latLng.lat,
    longitude: latLng.lng,
    truckId: SIMULATED_TRUCK_ID,
    driverId: "SimDriver",
    tripId: "SimTrip",
    source: source
  };
  console.log(`[Client] Sending location update:`, dataToSend);
  socket.emit('update-location', dataToSend);

  // Check for street marker collision or polygon entry
  let notificationData = { latitude: latLng.lat, longitude: latLng.lng };
  let triggerNotification = false;
  let notificationKey = null;

  // Street marker collision (within 15 meters)
  if (allStreetMarkers.length > 0) {
    const nearestStreet = allStreetMarkers.reduce((closest, item) => {
      if (!item.coords || item.coords.length !== 2) return closest;
      const distance = getDistance(latLng.lat, latLng.lng, item.coords[0], item.coords[1]);
      return distance < closest.distance ? { ...item, distance } : closest;
    }, { distance: Infinity });

    if (nearestStreet.distance <= 15) {
      notificationData.streetName = nearestStreet.name;
      notificationData.barangay = nearestStreet.barangay;
      notificationKey = `street-${nearestStreet.name}`;
      triggerNotification = true;
    }
  }

  // Polygon entry
  if (window.turf && polygons.length > 0) {
    const point = turf.point([latLng.lng, latLng.lat]);
    const turfPolygons = polygons.map(p => {
      const ring = p.coords.map(c => [c[1], c[0]]);
      if (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]) {
        ring.push([...ring[0]]);
      }
      return { name: p.name, turf: turf.polygon([ring]) };
    }).filter(Boolean);

    for (const zone of turfPolygons) {
      if (turf.booleanPointInPolygon(point, zone.turf)) {
        notificationData.barangay = zone.name;
        notificationKey = `polygon-${zone.name}`;
        triggerNotification = true;
        break;
      }
    }
  }

  // Apply cooldown check
  if (triggerNotification && notificationKey) {
    const lastSent = notificationCooldown.get(notificationKey);
    const now = Date.now();
    if (!lastSent || now - lastSent >= COOLDOWN_MS) {
      console.log(`[Client] Triggering SMS for ${notificationKey}:`, notificationData);
      socket.emit('simulator-moved-trigger-sms', notificationData);
      notificationCooldown.set(notificationKey, now);
    } else {
      console.log(`[Client] Notification for ${notificationKey} on cooldown`);
    }
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);
  fetch(`/eta/${SIMULATED_TRUCK_ID}`, { signal: controller.signal })
    .then(response => {
      clearTimeout(timeoutId);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      return response.json();
    })
    .then(etaData => {
      let etaText = "ETA Unknown";
      if (etaData && etaData.etaMinutes !== undefined) {
        if (etaData.etaMinutes >= 0) {
          etaText = `ETA: ${etaData.etaMinutes} min${etaData.etaMinutes !== 1 ? 's' : ''}`;
        } else if (etaData.error) {
          etaText = `ETA: ${etaData.error}`;
        }
      }
      simMarker.setPopupContent(`<b>${SIMULATED_TRUCK_ID}</b><br>Next: ${etaData.nextStop || 'N/A'}<br>${etaText}`);
    })
    .catch(error => {
      clearTimeout(timeoutId);
      console.error(`Error fetching ETA for ${SIMULATED_TRUCK_ID}:`, error);
      let errorMessage = "Could not fetch ETA";
      if (error.name === 'AbortError') {
        errorMessage = "ETA request timed out";
      } else if (error.message.includes('404')) {
        errorMessage = "Truck location not found on server";
      }
      simMarker.setPopupContent(`<b>${SIMULATED_TRUCK_ID}</b><br>Lat: ${latLng.lat.toFixed(6)}, Lon: ${latLng.lng.toFixed(6)}<br>${errorMessage}`);
    });
}

if ("geolocation" in navigator) {
  navigator.geolocation.watchPosition(
    (position) => {
      const { latitude, longitude } = position.coords;
      const newLatLng = L.latLng(latitude, longitude);
      simMarker.setLatLng(newLatLng);
      console.log(`[Geolocation] Received position: Lat=${latitude}, Lon=${longitude}`);
      sendLocationUpdate(newLatLng, "simulator-live");
    },
    (error) => {
      console.error("❌ Geolocation error:", error.message);
      let errorMsg;
      switch(error.code) {
        case error.PERMISSION_DENIED:
          errorMsg = "User denied the request for Geolocation.";
          break;
        case error.POSITION_UNAVAILABLE:
          errorMsg = "Location information is unavailable.";
          break;
        case error.TIMEOUT:
          errorMsg = "The request to get user location timed out.";
          break;
        default:
          errorMsg = "An unknown error occurred.";
      }
      simMarker.setPopupContent(`<b>${SIMULATED_TRUCK_ID}</b><br>Geolocation error: ${errorMsg}`);
      alert(errorMsg);
    },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
  );
} else {
  console.warn("Geolocation not supported. Simulator is drag-only.");
  simMarker.setPopupContent(`<b>${SIMULATED_TRUCK_ID}</b><br>Geolocation not supported; drag to simulate`);
}

socket.on("location-update", (data) => {
  const { latitude, longitude, truckId, source } = data;
  if (latitude === undefined || longitude === undefined || !truckId) {
    console.warn("Received incomplete location update:", data);
    return;
  }
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

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);
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
      console.error(`Error fetching ETA for ${truckId}:`, error);
      let errorMessage = "Could not fetch ETA";
      if (error.name === 'AbortError') {
        errorMessage = "ETA request timed out";
      } else if (error.message.includes('404')) {
        errorMessage = "Truck location not found on server";
      }
      currentMarker.setPopupContent(`<b>${truckId}</b><br>Lat: ${latitude.toFixed(6)}, Lon: ${longitude.toFixed(6)}<br>${errorMessage}`);
    });
});

simMarker.on('dragend', () => {
  const truckPos = simMarker.getLatLng();
  console.log(`[Drag] Marker moved to: Lat=${truckPos.lat}, Lon=${truckPos.lng}`);
  sendLocationUpdate(truckPos, "simulator-drag");
});

loadAndDrawMapData();

const daysOfWeek = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

async function loadSchedule() {
  try {
    const response = await fetch('/schedule');
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const schedules = await response.json();

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