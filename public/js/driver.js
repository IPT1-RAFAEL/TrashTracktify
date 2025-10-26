const socket = io("https://trashtracktify.onrender.com");


const statusPanel = document.getElementById('statusPanel');
const statusDropdown = document.getElementById('statusDropdown');
const statusOptions = document.getElementById('statusOptions');
const statusButtons = statusOptions.querySelectorAll('button[data-value]');
const statusFinishedButton = document.getElementById('statusFinished');

// --- Popup Elements ---
const loginPopup = document.getElementById('loginPopup');
const registerPopup = document.getElementById('registerPopup');
const forgotPasswordPopup = document.getElementById('forgotPasswordPopup');
const resetWithCodePopup = document.getElementById('resetWithCodePopup'); 

const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');
const forgotPasswordForm = document.getElementById('forgotPasswordForm');
const resetWithCodeForm = document.getElementById('resetWithCodeForm');

const loginBtn = document.getElementById('loginBtn');
const registerBtn = document.getElementById('registerBtn');
const sendResetBtn = document.getElementById('sendResetBtn');
const submitResetBtn = document.getElementById('submitResetBtn'); 

// Buttons to switch popups
const showRegisterBtn = document.getElementById('showRegisterPopupBtn');
const showForgotPasswordBtn = document.getElementById('showForgotPasswordBtn');
const backToLoginFromRegister = document.getElementById('backToLoginFromRegister');
const backToLoginFromForgot = document.getElementById('backToLoginFromForgot');
const backToLoginFromCode = document.getElementById('backToLoginFromCode'); 

// Message areas
const loginMsg = document.getElementById('loginMsg');
const registerMsg = document.getElementById('registerMsg');
const forgotMsg = document.getElementById('forgotMsg');
const resetCodeMsg = document.getElementById('resetCodeMsg'); 
// --- End Popup Elements ---


const toggleEl = document.getElementById('trackingToggle');
const labelEl = document.getElementById('trackingLabel');
const mapElement = document.getElementById('map');

// --- Global State Variables ---
let currentLoadPercent = 0;
let trackingEnabled = false; 
let geoWatchId = null; 
let driverMarker = null; 
let truckMarkers = {}; 
let truckPath = null; 
let truckPathCoords = []; 

// --- Configuration ---
let DRIVER_TRUCK_ID = localStorage.getItem('truckId') || 'Default-Truck-ID';
console.log(`Initial Truck ID: ${DRIVER_TRUCK_ID}`); 
const SIMULATED_TRUCK_ID = "Truck-Simulator"; 

// Cooldown for proximity notifications
const notificationCooldown = new Map();
const COOLDOWN_MS = 5 * 60 * 1000;

// Map and Data Variables
let map = null;
let polygons = [];
let streetGroups = {};
let allStreetMarkers = [];
const markerColors = { Tugatog: "green", Acacia: "blue", Tinajeros: "red" };

// --- Icons ---
const truckIcon = L.icon({
  iconUrl: 'img/garbage-truck.png', 
  iconSize: [32, 32],
  iconAnchor: [16, 32],
  popupAnchor: [0, -32]
});

// --- Utility Functions ---

function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = x => x * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Fetch ETA from server with timeout
async function fetchETA(truckId) {
  if (!truckId || truckId === 'Default-Truck-ID') {
      console.warn('fetchETA skipped: Invalid truckId');
      return null;
  }
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    const res = await fetch(`/eta/${encodeURIComponent(truckId)}`, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn('fetchETA failed for', truckId, err);
    return null;
  }
}

// --- Map Drawing Functions ---

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
        radius: 5, color: markerColors[barangay] || '#666', fillColor: markerColors[barangay] || '#666', fillOpacity: 0.9
      }).addTo(map).bindPopup(`<b>${item.name}</b><br>${barangay}`);
      allStreetMarkers.push({ ...item, barangay });
    });
  });
}

async function loadAndDrawMapData() {
  try {
    const polyResponse = await fetch('/data/polygon.json');
    if (polyResponse.ok) polygons = await polyResponse.json();

    const streetResponse = await fetch('/data/streets.json');
    if (streetResponse.ok) streetGroups = await streetResponse.json();

    if(map) { 
        drawPolygons();
        drawStreetMarkers();
    }
  } catch (error) {
    console.error("Failed to load map data:", error);
  }
}

// --- Status Dropdown Logic ---

function updateStatusHeader(percent) {
  if (statusDropdown) {
    statusDropdown.textContent = `Status ${percent}% ▼`;
  }
}

function sendLoadUpdate(percent) {
  console.log(`[Driver] Sending load update: ${percent}%`);
  currentLoadPercent = percent;
  updateStatusHeader(currentLoadPercent);
  socket.emit('driver:load_update', {
    truckId: DRIVER_TRUCK_ID,
    percentFull: percent,
    timestamp: Date.now()
  });
}

if (statusDropdown && statusOptions) {
  statusDropdown.addEventListener('click', () => {
    const isVisible = statusOptions.style.display === 'flex';
    statusOptions.style.display = isVisible ? 'none' : 'flex';
  });
}

statusButtons.forEach(button => {
  button.addEventListener('click', () => {
    const percent = parseInt(button.getAttribute('data-value'), 10);
    if (!isNaN(percent)) {
      sendLoadUpdate(percent);
      if (statusOptions) statusOptions.style.display = 'none';
    }
  });
});

if (statusFinishedButton) {
  statusFinishedButton.addEventListener('click', () => {
    console.log('[Driver] "Finished Emptying" button clicked. Sending 0%.');
    sendLoadUpdate(0);
    if (statusOptions) statusOptions.style.display = 'none';
  });
}

// Optional: Hide dropdown if clicking outside
document.addEventListener('click', (event) => {
   if (statusPanel && !statusPanel.contains(event.target) && statusOptions) {
     statusOptions.style.display = 'none';
   }
});

updateStatusHeader(currentLoadPercent); 


// --- Popup Switching Logic ---

function showPopup(popupToShow) {
  [loginPopup, registerPopup, forgotPasswordPopup, resetWithCodePopup].forEach(p => { 
    if (p) p.classList.remove('show');
  });
  if (popupToShow) popupToShow.classList.add('show');
  if (document.body) document.body.classList.add("locked");
}

function hideAllPopups() {
   [loginPopup, registerPopup, forgotPasswordPopup, resetWithCodePopup].forEach(p => { 
    if (p) p.classList.remove('show');
  });
   if (document.body) document.body.classList.remove('locked');
}
const existingDriver = localStorage.getItem('driverName');
if (existingDriver) {
    document.body.classList.remove('locked');
    hideAllPopups();
    initializeMapAndMarker();
    loadAndDrawMapData();
    loadSchedule();
}
// Wire up the buttons to switch popups
if (showRegisterBtn) showRegisterBtn.addEventListener('click', () => showPopup(registerPopup));
if (showForgotPasswordBtn) showForgotPasswordBtn.addEventListener('click', () => showPopup(forgotPasswordPopup));
if (backToLoginFromRegister) backToLoginFromRegister.addEventListener('click', () => showPopup(loginPopup));
if (backToLoginFromForgot) backToLoginFromForgot.addEventListener('click', () => showPopup(loginPopup));
if (backToLoginFromCode) backToLoginFromCode.addEventListener('click', () => showPopup(loginPopup));

// --- Driver Registration Form Handling ---
if (registerForm && registerBtn) {
    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        registerMsg.textContent = ''; 
        registerMsg.style.color = ''; 

        const name = document.getElementById('regName')?.value.trim();
        const phone = document.getElementById('regPhone')?.value.trim();
        const barangaySelectElement = document.getElementById('regBarangay');
        const barangay = barangaySelectElement ? barangaySelectElement.value : '';
        const password = document.getElementById('regPassword')?.value.trim();

        // Basic frontend validation
        if (!name || !phone || !barangay || !password) {
            registerMsg.textContent = 'Please fill in all fields.';
            registerMsg.style.color = 'orange';
            return;
        }
        if (!/^09\d{9}$/.test(phone)) {
             registerMsg.textContent = 'Invalid phone (must be 09xxxxxxxxx).';
             registerMsg.style.color = 'orange';
             return;
        }
        if (password.length < 6) {
             registerMsg.textContent = 'Password must be at least 6 characters.';
             registerMsg.style.color = 'orange';
             return;
        }
        // End Validation

        registerBtn.textContent = 'Registering...';
        registerBtn.disabled = true;

        try {
            const res = await fetch('/driver-register', { 
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    regName: name,
                    regPhone: phone,
                    regBarangay: barangay,
                    regPassword: password
                })
            });
            const result = await res.json();
            if (!res.ok) throw new Error(result.error || `Registration failed: ${res.status}`);

            registerMsg.textContent = result.message || 'Registration successful! Redirecting to login...';
            registerMsg.style.color = 'lightgreen';
            registerForm.reset();
            setTimeout(() => showPopup(loginPopup), 1500);

        } catch (err) {
            console.error('Driver registration error:', err);
            registerMsg.textContent = `Registration Error: ${err.message}`;
            registerMsg.style.color = 'red';
        } finally {
            registerBtn.textContent = 'Register';
            registerBtn.disabled = false;
        }
    });
} else {
    console.warn('Registration form or button not found.');
}

// --- Driver Login Form Handling ---
if (loginForm && loginBtn) {
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        loginMsg.textContent = '';
        loginMsg.style.color = '';

        const name = document.getElementById('driverName')?.value.trim();
        const password = document.getElementById('driverPassword')?.value.trim();

        if (!name || !password) {
            loginMsg.textContent = 'Please enter driver name and password.';
            loginMsg.style.color = 'orange';
             return;
        }

        loginBtn.textContent = 'Logging in...';
        loginBtn.disabled = true;

        try {
            const res = await fetch('/driver-login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ driverName: name, driverPassword: password })
            });
            const result = await res.json();
            if (!res.ok) throw new Error(result.error || `Login failed: ${res.status}`);

            // --- Login Successful ---
            loginMsg.textContent = result.message || 'Login successful!';
            loginMsg.style.color = 'lightgreen';

            // Store driver info from server response
            if (result.driver && result.driver.truckId) {
                localStorage.setItem('driverName', result.driver.name);
                localStorage.setItem('driverBarangay', result.driver.barangay || 'Unknown');
                DRIVER_TRUCK_ID = result.driver.truckId; 
                localStorage.setItem('truckId', DRIVER_TRUCK_ID); 
                console.log(`Stored and updated truckId: ${DRIVER_TRUCK_ID}`);
            } else {
                 console.warn("Login response missing truckId. Assigning default.");
                 DRIVER_TRUCK_ID = `Driver-Truck-${result.driver?.id || name.replace(/\s+/g, '-')}`;
                 localStorage.setItem('truckId', DRIVER_TRUCK_ID);
            }
            if (result.driver && result.driver.name) {
                 localStorage.setItem('driverName', result.driver.name);
            }

            // Hide popup after a short delay
            setTimeout(() => {
                hideAllPopups();
                initializeMapAndMarker();
                loadAndDrawMapData();
                loadSchedule();

            }, 800);


        } catch (err) {
            console.error('Driver login error:', err);
            loginMsg.textContent = `Login Error: ${err.message}`;
            loginMsg.style.color = 'red';
        } finally {
            loginBtn.textContent = 'Login';
            loginBtn.disabled = false;
        }
    });
} else {
    console.warn('Login form or button not found.');
}

// --- Forgot Password Form Handling (Functional - OTP Version) ---
if (forgotPasswordForm && sendResetBtn) {
    forgotPasswordForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        forgotMsg.textContent = '';
        forgotMsg.style.color = '';

        const phoneInput = document.getElementById('resetPhone');
        const phone = phoneInput?.value.trim();
        if (!phone || !/^09\d{9}$/.test(phone)) {
            forgotMsg.textContent = 'Please enter a valid phone number (09xxxxxxxxx).';
            forgotMsg.style.color = 'orange';
            return;
        }

        console.log(`[Forgot Password] Request submitted for phone: ${phone}`);
        sendResetBtn.textContent = 'Sending...';
        sendResetBtn.disabled = true;

        try {
            const res = await fetch('/forgot-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ resetPhone: phone })
            });

            const result = await res.json();
            if (!res.ok) throw new Error(result.error || `Request failed: ${res.status}`);

            // --- MODIFICATION: On success, show the *next* popup ---
            forgotMsg.textContent = result.message || 'Reset code sent!';
            forgotMsg.style.color = 'var(--accent, lightgreen)';

            // Populate the hidden phone field in the *next* form
            const hiddenPhoneField = document.getElementById('resetPhoneHidden');
            if (hiddenPhoneField) {
                hiddenPhoneField.value = phone;
            }

            // Switch popups
            setTimeout(() => {
                forgotPasswordForm.reset();
                forgotMsg.textContent = ''; 
                showPopup(resetWithCodePopup); 
            }, 1000);


        } catch (err) {
            console.error('Forgot password error:', err);
            forgotMsg.textContent = `Error: ${err.message}`;
            forgotMsg.style.color = 'red';
        } finally {
            // Re-enable button
            sendResetBtn.textContent = 'Send Reset Code';
            sendResetBtn.disabled = false;
        }
    });
}

// --- NEW: Reset With Code Form Handling ---
if (resetWithCodeForm && submitResetBtn) {
    resetWithCodeForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        resetCodeMsg.textContent = '';
        resetCodeMsg.style.color = '';

        const formData = new FormData(e.target);
        const data = Object.fromEntries(formData.entries());

        // Frontend validation
        if (data.newPassword.length < 6) {
             resetCodeMsg.textContent = 'Password must be at least 6 characters.';
             resetCodeMsg.style.color = 'orange';
             return;
        }
        if (data.newPassword !== data.confirmPassword) {
             resetCodeMsg.textContent = 'Passwords do not match.';
             resetCodeMsg.style.color = 'orange';
             return;
        }
        if (!/^\d{6}$/.test(data.token)) {
             resetCodeMsg.textContent = 'Code must be 6 digits.';
             resetCodeMsg.style.color = 'orange';
             return;
        }

        submitResetBtn.textContent = 'Updating...';
        submitResetBtn.disabled = true;

        try {
            // Send ALL fields (phone, token, newPassword, confirmPassword) to the backend
            const res = await fetch('/reset-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });

            const result = await res.json();
            if (!res.ok) throw new Error(result.error || `Update failed: ${res.status}`);

            // Success!
            resetCodeMsg.textContent = result.message || 'Password reset successful!';
            resetCodeMsg.style.color = 'var(--accent, lightgreen)';
            
            // Redirect to login page after a delay
            setTimeout(() => {
                resetWithCodeForm.reset();
                resetCodeMsg.textContent = '';
                showPopup(loginPopup);
            }, 2000);

        } catch (err) {
            console.error('Password reset error:', err);
            resetCodeMsg.textContent = `Error: ${err.message}`;
            resetCodeMsg.style.color = 'red';
        } finally {
            submitResetBtn.textContent = 'Update Password';
            submitResetBtn.disabled = false;
        }
    });
}


// --- Map Initialization (Called after login) ---
function initializeMapAndMarker() {
    if (!map && mapElement) {
        map = L.map('map').setView([14.667, 120.967], 15);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; OpenStreetMap contributors'
        }).addTo(map);
        console.log("Map initialized.");
    } else if (!mapElement) {
        console.error("Map container element not found!");
        return;
    }

    if (driverMarker && map.hasLayer(driverMarker)) {
        map.removeLayer(driverMarker);
        delete truckMarkers[driverMarker.options.truckId]; 
    }
    if (truckPath && map.hasLayer(truckPath)) {
        map.removeLayer(truckPath);
        truckPath = null;
    }
    truckPathCoords = []; 

    const initialLatLng = L.latLng(14.667, 120.967); 
    driverMarker = L.marker(initialLatLng, {
         icon: truckIcon,
         truckId: DRIVER_TRUCK_ID, 
         draggable: true 
        }).addTo(map);
    driverMarker.bindPopup(`<b>${DRIVER_TRUCK_ID} (You)</b><br>Tracking inactive...`).openPopup();
    truckMarkers[DRIVER_TRUCK_ID] = driverMarker; 
    console.log(`Driver marker created/updated for ${DRIVER_TRUCK_ID}`);

    driverMarker.on('dragend', function(e) {
        const newLatLng = driverMarker.getLatLng();
        console.log(`[Driver] Truck marker dragged to new position: Lat=${newLatLng.lat}, Lon=${newLatLng.lng}`);
        sendLocationUpdate(newLatLng, 'drag'); 
        if (trackingEnabled) {
            truckPathCoords.push([newLatLng.lat, newLatLng.lng]);
            updateTruckPath();
        }
    });

     if (truckMarkers[SIMULATED_TRUCK_ID] && map.hasLayer(truckMarkers[SIMULATED_TRUCK_ID])) {
        map.removeLayer(truckMarkers[SIMULATED_TRUCK_ID]);
        delete truckMarkers[SIMULATED_TRUCK_ID];
        console.log("Removed simulator marker.");
    }
}

// --- Update Truck Path ---
function updateTruckPath() {
    if (!map) return;
    if (truckPath && map.hasLayer(truckPath)) {
        map.removeLayer(truckPath);
    }
    if (truckPathCoords.length > 0) {
        truckPath = L.polyline(truckPathCoords, {
            color: 'blue', weight: 4, opacity: 0.7
        }).addTo(map);
    }
}

// --- Location Sending & Proximity Logic ---
async function sendLocationUpdate(latLng, source) {
  if (!trackingEnabled) return;
  if (!DRIVER_TRUCK_ID || DRIVER_TRUCK_ID === 'Default-Truck-ID') {
      console.warn("Cannot send location: DRIVER_TRUCK_ID not set.");
      return;
   }

  const payload = {
    latitude: latLng.lat, longitude: latLng.lng,
    truckId: DRIVER_TRUCK_ID, 
    driverId: localStorage.getItem('driverName') || "DriverClient", 
    tripId: "TripAuto", source: source
  };
  socket.emit('update-location', payload);

  // Proximity checks...
  let notificationData = { latitude: latLng.lat, longitude: latLng.lng };
  let shouldNotify = false;
  let notificationKey = null;

  
  if (allStreetMarkers.length > 0) {
      const nearest = allStreetMarkers.reduce((closest, item) => {
        if (!item.coords || item.coords.length !== 2) return closest;
        const dist = getDistance(latLng.lat, latLng.lng, item.coords[0], item.coords[1]);
        return dist < closest.distance ? { ...item, distance: dist } : closest;
      }, { distance: Infinity });

      if (nearest.distance <= 15) { 
        notificationData.streetName = nearest.name;
        notificationData.barangay = nearest.barangay;
        notificationKey = `street-${nearest.barangay}-${nearest.name}`;
        shouldNotify = true;
      }
  }
  if (window.turf && polygons.length > 0) {
      const point = turf.point([latLng.lng, latLng.lat]);
      for (const p of polygons) {
          const ring = p.coords.map(c => [c[1], c[0]]);
          if (ring.length > 0 && (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1])) {
               ring.push([...ring[0]]); 
          }
          if (ring.length >= 4) { 
              try {
                  const poly = turf.polygon([ring]);
                  if (turf.booleanPointInPolygon(point, poly)) {
                      notificationData.barangay = p.name;
                      if (!shouldNotify) notificationKey = `polygon-${p.name}`;
                      shouldNotify = true;
                      break;
                  }
              } catch(turfError){ console.error("Turf Error processing polygon:", p.name, turfError); }
          } else {
               console.warn("Invalid ring for polygon:", p.name);
          }
      }
  }
  if (shouldNotify && notificationKey) {
      const last = notificationCooldown.get(notificationKey) || 0;
      const now = Date.now();
      if (now - last >= COOLDOWN_MS) {
          socket.emit('truck-at-location-trigger-sms', {
              truckId: DRIVER_TRUCK_ID, lat: latLng.lat, lon: latLng.lng,
              street: notificationData.streetName || null, barangay: notificationData.barangay || null,
              source
          });
          notificationCooldown.set(notificationKey, now);
          console.log('[driver.js] emitted truck-at-location-trigger-sms', notificationData);
      }
  }

  // update ETA for driver's marker popup
  try {
    const etaData = await fetchETA(DRIVER_TRUCK_ID);
    if (driverMarker && etaData) {
      const etaText = (etaData.etaMinutes !== undefined)
        ? (etaData.etaMinutes >= 0 ? `ETA: ${etaData.etaMinutes} min${etaData.etaMinutes !== 1 ? 's' : ''}` : `ETA: ${etaData.error || 'N/A'}`)
        : 'ETA Unknown';
      if (map.hasLayer(driverMarker)) {
          driverMarker.setPopupContent(`<b>${DRIVER_TRUCK_ID} (You)</b><br>Next: ${etaData.nextStop || 'N/A'}<br>${etaText}`);
      }
    }
  } catch (err) {
    console.warn('ETA update failed', err);
  }
}

// --- Geolocation Watch Logic ---
function startGeoWatch() {
  if (!('geolocation' in navigator)) {
    console.warn('Geolocation not supported');
    alert('Geolocation not supported.');
    if (toggleEl) { toggleEl.checked = false; toggleEl.disabled = true; labelEl.textContent = 'NO GPS'; }
    return;
  }
  if (geoWatchId) return; 

  console.log('[driver.js] Starting geolocation watch...');

  navigator.geolocation.getCurrentPosition(
    position => {
      const { latitude, longitude } = position.coords;
      const latlng = L.latLng(latitude, longitude);
      console.log(`[driver.js] Initial position acquired: Lat=${latitude}, Lon=${longitude}`);

      if (driverMarker && map && map.hasLayer(driverMarker)) {
          driverMarker.setLatLng(latlng);
          map.setView(latlng, map.getZoom());
      } else {
          console.warn("Driver marker doesn't exist or isn't on map to update initial position.");
          if (map && !driverMarker) {
              initializeMapAndMarker();
              if (driverMarker) {
                   driverMarker.setLatLng(latlng);
                   map.setView(latlng, map.getZoom());
              }
          }
      }
      if (trackingEnabled) {
          truckPathCoords.push([latlng.lat, latlng.lng]);
          updateTruckPath();
      }
      sendLocationUpdate(latlng, 'geolocation');
    },
    err => {
      console.error('[driver.js] Initial geolocation error', err);
      if (driverMarker && map.hasLayer(driverMarker)) {
          driverMarker.setPopupContent(`<b>${DRIVER_TRUCK_ID} (You)</b><br>GPS Error: ${err.message}`);
      }
      if (toggleEl) setTracking(false); 
      alert(`Geolocation Error: ${err.message}. Tracking stopped.`);
    },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
  );

  geoWatchId = navigator.geolocation.watchPosition(
    position => {
      const { latitude, longitude } = position.coords;
      const latlng = L.latLng(latitude, longitude);

      if (driverMarker && map && map.hasLayer(driverMarker)) {
          driverMarker.setLatLng(latlng);
      } else {
          console.warn("Driver marker doesn't exist or isn't on map to update position.");
          if (map && !driverMarker) {
              initializeMapAndMarker();
              if (driverMarker) driverMarker.setLatLng(latlng);
          }
      }
      if (trackingEnabled) {
          truckPathCoords.push([latlng.lat, latlng.lng]);
          updateTruckPath();
      }
      sendLocationUpdate(latlng, 'geolocation');
    },
    err => {
      console.error('[driver.js] Geolocation watch error', err);
      if (driverMarker && map.hasLayer(driverMarker)) {
          driverMarker.setPopupContent(`<b>${DRIVER_TRUCK_ID} (You)</b><br>GPS Error: ${err.message}`);
      }
      if (toggleEl) setTracking(false); 
      alert(`Geolocation Error: ${err.message}. Tracking stopped.`);
    },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
  );
}

function stopGeoWatch() {
  if (geoWatchId !== null) {
    console.log('[driver.js] Stopping geolocation watch...');
    navigator.geolocation.clearWatch(geoWatchId);
    geoWatchId = null;
    if (truckPath && map.hasLayer(truckPath)) {
        map.removeLayer(truckPath);
        truckPath = null;
    }
    truckPathCoords = [];
    console.log('[Driver] Cleared truck path on tracking stop');
  }
}

// --- Tracking Toggle Control ---
function setTracking(on) {
  trackingEnabled = !!on; 
  if (trackingEnabled) {
    labelEl.textContent = 'TRACKING';
    labelEl.style.color = 'green';
    startGeoWatch(); 
    if (DRIVER_TRUCK_ID && DRIVER_TRUCK_ID !== 'Default-Truck-ID') {
        socket.emit('driver:tracking_started', { truckId: DRIVER_TRUCK_ID }); 
    } else {
         console.warn("Cannot emit driver:tracking_started, invalid DRIVER_TRUCK_ID");
         toggleEl.checked = false;
         trackingEnabled = false;
         labelEl.textContent = 'STOP';
         labelEl.style.color = 'red';
         alert("Please login first to start tracking.");
    }
  } else {
    labelEl.textContent = 'STOP';
    labelEl.style.color = 'red';
    stopGeoWatch(); 
    if (DRIVER_TRUCK_ID && DRIVER_TRUCK_ID !== 'Default-Truck-ID') {
        socket.emit('driver:tracking_stopped', { truckId: DRIVER_TRUCK_ID }); 
    }
  }
}
if (toggleEl && labelEl) {
  toggleEl.addEventListener('change', (e) => setTracking(e.target.checked));
} else {
    console.error("Tracking toggle elements not found.");
}

// --- Handle Incoming Location Updates (Other Trucks) ---
socket.on("location-update", (data) => {
  const { latitude, longitude, truckId } = data;
  if (latitude === undefined || longitude === undefined || !truckId) return;
  if (truckId === DRIVER_TRUCK_ID) return;
  if (!map) return; 

  const newLatLng = [latitude, longitude];
  let otherMarker = truckMarkers[truckId];

  if (!otherMarker) {
    console.log(`[driver.js] Creating marker for other truck: ${truckId}`);
    otherMarker = L.marker(newLatLng, { icon: truckIcon }).addTo(map);
    otherMarker.bindPopup(`<b>${truckId}</b><br>Calculating ETA...`);
    truckMarkers[truckId] = otherMarker;
  } else {
     if(map.hasLayer(otherMarker)){
        otherMarker.setLatLng(newLatLng);
     } else {
        delete truckMarkers[truckId];
        otherMarker = L.marker(newLatLng, { icon: truckIcon }).addTo(map);
        otherMarker.bindPopup(`<b>${truckId}</b><br>Calculating ETA...`);
        truckMarkers[truckId] = otherMarker;
        console.log(`[driver.js] Recreated marker for other truck: ${truckId}`);
     }
  }

  fetchETA(truckId).then(etaData => {
    if (!truckMarkers[truckId] || !etaData) return;
    let etaText = "ETA Unknown";
    if (etaData.etaMinutes !== undefined) {
      if (etaData.etaMinutes >= 0) etaText = `ETA: ${etaData.etaMinutes} min${etaData.etaMinutes !== 1 ? 's' : ''}`;
      else if (etaData.error) etaText = `ETA: ${etaData.error}`;
    }
    if(map.hasLayer(truckMarkers[truckId])){
        truckMarkers[truckId].setPopupContent(`<b>${truckId}</b><br>Next: ${etaData.nextStop || 'N/A'}<br>${etaText}`);
    }
  }).catch(err => console.warn('ETA fetch for other truck failed', truckId, err));
});

// --- Schedule Loading (If needed on driver page) ---
async function loadSchedule() {
    // Only fetch if map is initialized (meaning user is logged in)
    if (!map) return; 
    console.log("Fetching schedule data (driver page)...");
    try {
        const res = await fetch('/schedule');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const schedules = await res.json();
        console.log("Schedule data loaded:", schedules);
        // TODO: Process or display schedule if needed for driver
    } catch (err) {
        console.error('loadSchedule error on driver page', err);
    }
}
socket.on('schedule-update', loadSchedule);

// --- Initial DOM Content Loaded ---
document.addEventListener("DOMContentLoaded", () => {
    console.log("DOM Loaded. Checking login status...");

    const urlParams = new URLSearchParams(window.location.search);
    const showLoginParam = urlParams.get('action') === 'login';
    const storedTruckId = localStorage.getItem('truckId');
    
    // Show login if explicitly requested OR if not already logged in
    if (showLoginParam || !storedTruckId) {
        if (showLoginParam) console.log("URL parameter found, showing login popup.");
        else console.log("Not logged in, showing login popup.");
        
        showPopup(loginPopup);
        // Ensure map is NOT initialized yet
        if (map) {
             console.warn("Map was initialized before login, removing.");
             map.remove();
             map = null;
        }
    } else {
        // Already logged in and not redirected to login
        console.log(`Already logged in as ${storedTruckId}. Initializing map.`);
        DRIVER_TRUCK_ID = storedTruckId; 
        hideAllPopups(); 
        initializeMapAndMarker(); 
        loadAndDrawMapData();
        loadSchedule();
        if (toggleEl) {
             toggleEl.checked = false; 
             setTracking(false); 
        }
    }
});