// *** FIX: Connect to the Render hosting URL ***
const socket = io("https://trashtracktify.onrender.com");
// const socket = io("http://localhost:3000"); // Use this ONLY when running locally

const map = L.map('map').setView([14.667, 120.967], 15);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

const truckIcon = L.icon({
  iconUrl: "truck.png", //
  iconSize: [32, 32],
  iconAnchor: [16, 32],
  popupAnchor: [0, -32],
});

let truckMarkers = {};

let polygons = []; //
let streetGroups = {}; //
const markerColors = { Tugatog: "green", Acacia: "blue", Tinajeros: "red" }; //

function drawPolygons() {
  if (!map || polygons.length === 0) return;
  polygons.forEach(p => {
    L.polygon(p.coords, { //
      color: p.color, fillColor: p.color, fillOpacity: 0.3, interactive: false
    }).addTo(map).bindPopup(`<b>${p.name}</b>`);
  });
}

function drawStreetMarkers() {
  if (!map || Object.keys(streetGroups).length === 0) return;
  Object.entries(streetGroups).forEach(([barangay, streets]) => {
    streets.forEach(item => {
      if (!item.coords || item.coords.length !== 2) return;
      L.circleMarker(item.coords, { //
        radius: 5, color: markerColors[barangay], fillColor: markerColors[barangay], fillOpacity: 0.9
      }).addTo(map).bindPopup(`<b>${item.name}</b><br>${barangay}`); //
    });
  });
}

async function loadAndDrawMapData() {
  try {
    const polyResponse = await fetch('/data/polygon.json'); //
    if (!polyResponse.ok) throw new Error(`HTTP error! status: ${polyResponse.status}`);
    polygons = await polyResponse.json();

    const streetResponse = await fetch('/data/streets.json'); //
    if (!streetResponse.ok) throw new Error(`HTTP error! status: ${streetResponse.status}`);
    streetGroups = await streetResponse.json();

    drawPolygons();
    drawStreetMarkers();
  } catch (error) {
    console.error("Failed to load map data:", error);
  }
}

loadAndDrawMapData();

// Listen for location updates from the server
socket.on("location-update", (data) => { //
  const { latitude, longitude, truckId, source } = data;
  if (latitude === undefined || longitude === undefined || !truckId) {
    console.warn("Received incomplete location update:", data);
    return;
  }

  const newLatLng = [latitude, longitude];
  let currentMarker = truckMarkers[truckId];

  if (!currentMarker) {
    // Create a new marker if it doesn't exist for this truckId
    currentMarker = L.marker(newLatLng, { icon: truckIcon }).addTo(map);
    currentMarker.bindPopup(`<b>${truckId}</b><br>Calculating ETA...`).openPopup();
    truckMarkers[truckId] = currentMarker;
  } else {
    // Update existing marker's position
    currentMarker.setLatLng(newLatLng);
  }

  // Fetch ETA for the truck
  fetch(`/eta/${truckId}`) // Calls the /eta/:truckId endpoint on the server
    .then(response => {
      // Check if response is successful
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      return response.json(); // Parse JSON response
    })
    .then(etaData => {
      // Update marker popup with ETA info
      if (etaData && etaData.etaMinutes !== undefined) {
        let etaText = "ETA Unknown";
        if (etaData.etaMinutes >= 0) {
          etaText = `ETA: ${etaData.etaMinutes} minute${etaData.etaMinutes !== 1 ? 's' : ''}`;
        } else if (etaData.error) {
          etaText = "ETA Error";
        }
        currentMarker.setPopupContent(`<b>${truckId}</b><br>Next: ${etaData.nextStop || 'N/A'}<br>${etaText}`);
        // Optionally open popup if not already open
        // if(!currentMarker.isPopupOpen()) currentMarker.openPopup();
      } else {
         currentMarker.setPopupContent(`<b>${truckId}</b><br>ETA data unavailable`);
      }
    })
    .catch(error => {
      // Handle errors during ETA fetch
      console.error(`Error fetching ETA for ${truckId}:`, error);
      currentMarker.setPopupContent(`<b>${truckId}</b><br>Could not fetch ETA`);
    });
});

// Center map on the first location update received
let initialCenterSet = false;
socket.on("location-update", (data) => { //
  if (!initialCenterSet && data.latitude && data.longitude) {
    map.setView([data.latitude, data.longitude], 16); // Set map view to the first coordinate
    initialCenterSet = true;
  }
});

// Handle the registration form submission
const form = document.getElementById('popupForm'); //
const msgBox = document.getElementById('popupMsg'); //

if (form) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault(); // Prevent default form submission
    const formData = new FormData(e.target);
    const data = Object.fromEntries(formData.entries()); // Get form data
    msgBox.textContent = ''; // Clear previous messages

    try {
      // Send registration data to the server
      const res = await fetch('/register', { // POSTs to /register endpoint
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data) // Send data as JSON
      });

      const text = await res.text(); // Get response text
      msgBox.textContent = text; // Display response message
      msgBox.style.color = res.ok ? 'green' : 'red'; // Style message based on success/failure

      if (res.ok) {
        e.target.reset(); // Clear form on success
        // Hide popup after a delay
        setTimeout(() => {
          document.getElementById('registerPopup').classList.remove('show'); //
        }, 2000);
      }
    } catch (err) {
      // Handle network or connection errors
      msgBox.textContent = 'Error connecting to server: ' + err.message;
      msgBox.style.color = 'red';
    }
  });
}

// --- Schedule Display Logic ---
const daysOfWeek = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

async function loadSchedule() {
  try {
    const response = await fetch('/schedule'); // Fetch schedule data
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const schedules = await response.json();

    // Group schedules by barangay for easier lookup
    const scheduleByBarangay = {};
    schedules.forEach(s => {
      if (!scheduleByBarangay[s.barangay]) scheduleByBarangay[s.barangay] = {};
      scheduleByBarangay[s.barangay][s.day] = s.start_time;
    });

    // Populate the schedule display for each barangay
    ['Tugatog', 'Acacia', 'Tinajeros'].forEach(barangay => { // Matches barangays in HTML
      const daysContainer = document.getElementById(`${barangay}-days`); //
       if (!daysContainer) return; // Check if element exists
      daysContainer.innerHTML = ''; // Clear previous schedule
      daysOfWeek.forEach(day => {
        const time = scheduleByBarangay[barangay]?.[day] || 'N/A'; // Get time or default
        const span = document.createElement('span');
        span.textContent = `${day}: ${time !== 'N/A' ? time.slice(0, 5) : time}`; // Format as DAY: HH:MM
        daysContainer.appendChild(span);
      });
    });
  } catch (error) {
    console.error('Error loading schedule:', error);
  }
}

// Listen for schedule updates broadcast by the server
socket.on('schedule-update', () => { //
  console.log('Schedule updated, refreshing display...');
  loadSchedule(); // Reload schedule data
});

// Load the schedule when the page loads
loadSchedule();