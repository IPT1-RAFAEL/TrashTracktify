// Suppress unhandled promise rejections
window.addEventListener('unhandledrejection', (event) => {
  if (event.reason?.message?.includes('message channel closed')) {
    console.warn('[Driver-Schedule] Suppressing message channel error:', event.reason);
    event.preventDefault();
  }
});

document.addEventListener('DOMContentLoaded', () => {
  // Ensure socket is available
  if (!window.socket) {
    console.error('[Driver-Schedule] window.socket not defined. Ensure Socket.IO is loaded.');
    return;
  }

  console.log('[Driver-Schedule] DOM Loaded. Checking login status...');

  const storedTruckId = localStorage.getItem('truckId');
  if (!storedTruckId || storedTruckId === 'Default-Truck-ID') {
    console.log('[Driver-Schedule] Not logged in, redirecting to driver.html?action=login');
    window.location.href = 'driver.html?action=login';
    return;
  }

  // Populate driver name in the tooltip
  const driverNameTooltip = document.getElementById('driverNameTooltip');
  if (driverNameTooltip) {
    const driverName = localStorage.getItem('driverName') || 'Driver';
    driverNameTooltip.textContent = `Driver: ${driverName}`;
  }

  // Update barangay to use driverBarangay
  const savedBarangay = localStorage.getItem('driverBarangay') || 'Not registered';
  const topBarangay = document.getElementById('topBarangay');
  if (topBarangay) topBarangay.textContent = savedBarangay;

  // Initialize top info and calendar
  if (typeof initTopInfo === 'function') {
    try {
      initTopInfo();
    } catch (err) {
      console.error('[Driver-Schedule] Error in initTopInfo:', err);
    }
  }
  if (typeof generateCalendar === 'function') {
    try {
      generateCalendar();
    } catch (err) {
      console.error('[Driver-Schedule] Error in generateCalendar:', err);
    }
  }

  // Handle date popup
  const datePopup = document.getElementById('datePopup');
  if (datePopup) {
    datePopup.addEventListener('click', (e) => {
      if (e.target === datePopup) datePopup.classList.remove('show');
    });
  }

  // Fetch and display trip count
  fetchTripCount(storedTruckId).catch(err => {
    console.error('[Driver-Schedule] fetchTripCount failed:', err);
    updateTripCount(0);
  });

  // Listen for real-time trip count updates
  window.socket.on('round-trip', (data) => {
    if (data.truckId === storedTruckId) {
      console.log(`[Driver-Schedule] Received round-trip update for ${storedTruckId}: ${data.count}`);
      updateTripCount(data.count);
    }
  });

  // Handle Socket.IO errors
  window.socket.on('connect_error', (err) => {
    console.error('[Driver-Schedule] Socket.IO connection error:', err);
  });
});

// Fetch trip count from server
async function fetchTripCount(truckId) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(`/stats/round-trips?truckId=${encodeURIComponent(truckId)}`, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const tripCount = Array.isArray(data)
      ? data.find(item => item.truckId === truckId)?.count || 0
      : data[truckId]?.count || data.count || 0;
    updateTripCount(tripCount);
  } catch (err) {
    console.error('[Driver-Schedule] Error fetching trip count:', err);
    updateTripCount(0);
    throw err;
  }
}

// Update trip count display
function updateTripCount(count) {
  const tripCountEl = document.getElementById('tripCount');
  if (tripCountEl) {
    tripCountEl.textContent = count || 0;
  }
}