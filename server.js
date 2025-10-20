require('dotenv').config();
const express = require('express');
const path = require('path');
const mysql = require('mysql2/promise'); // Using promise wrapper
const http = require('http');
const { Server } = require('socket.io');
const turf = require('@turf/turf');
const fs = require('fs');

const app = express();
const port = process.env.PORT || 3000;

// --- Database Connection Pool ---
const dbPool = mysql.createPool({
  connectionLimit: 10,
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT || 3306,
  waitForConnections: true,
  queueLimit: 0
});

dbPool.getConnection()
  .then(connection => {
    console.log('✅ Connected to MySQL database pool.');
    connection.release();
  })
  .catch(err => {
    console.error('❌ Database connection pool failed:', err);
    process.exit(1);
  });

// --- Middleware ---
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- Load Geographic Data from JSON Files ---
let polygons = [];
let streetGroups = {};
let turfPolygons = [];
let allStreetMarkers = []; // Flattened list for easier lookup by name

try {
    console.log("Loading geographic data from JSON files...");
    let rawPolyData = fs.readFileSync(path.join(__dirname, 'public/data/polygon.json')); // Corrected filename
    polygons = JSON.parse(rawPolyData);
    console.log(`✅ Loaded ${polygons.length} polygons.`);

    let rawStreetData = fs.readFileSync(path.join(__dirname, 'public/data/streets.json'));
    streetGroups = JSON.parse(rawStreetData);
    console.log(`✅ Loaded street groups for ${Object.keys(streetGroups).length} barangays.`);

    // Create Turf Polygons & Flatten Street Markers
    turfPolygons = polygons.map(p => { /* ... see previous code ... */ }).filter(tp => tp.turf !== null);
     Object.entries(streetGroups).forEach(([barangay, streets]) => {
        streets.forEach(street => {
            if (street.coords && street.coords.length === 2) {
                allStreetMarkers.push({ ...street, barangay }); // Add barangay info
            }
        });
    });
    console.log(`✅ Created ${turfPolygons.length} valid Turf polygons.`);
    console.log(`✅ Indexed ${allStreetMarkers.length} street markers.`);

} catch (err) {
    console.error("❌❌❌ FATAL ERROR: Could not load geographic data:", err);
    process.exit(1);
}

const streetProximity = 15; // Increased proximity slightly for marker identification
const markerVisitThresholdSeconds = 60 * 2; // Time window (seconds) to consider being "at" a marker

// --- Helper Functions ---
function getDistance(lat1, lon1, lat2, lon2) { /* ... same as before ... */ }

function findNearestStreet(latitude, longitude) {
     let closestStreet = null;
     let minDistance = Infinity;
     allStreetMarkers.forEach(item => {
        const distance = getDistance(latitude, longitude, item.coords[0], item.coords[1]);
        if (distance < minDistance) {
            minDistance = distance;
            closestStreet = { ...item, distance: minDistance };
        }
    });
    return closestStreet;
}

// --- API Routes ---

// Registration form handler
app.post('/register', async (req, res) => { /* ... same as before ... */ });

// Reset History Endpoint
app.post('/reset-history', async (req, res) => { /* ... same as before ... */ });

// --- ETA Calculation Endpoint ---
app.get('/eta/:truckId', async (req, res) => {
  const { truckId } = req.params;
  let connection;

  try {
    connection = await dbPool.getConnection();

    // 1. Get current state (last ~5-10 points for direction/current segment)
    const [history] = await connection.query(
      `SELECT latitude, longitude, driver_id, trip_id, timestamp
       FROM location_history
       WHERE truck_id = ?
       ORDER BY timestamp DESC
       LIMIT 10`, // Get a few recent points
      [truckId]
    );

    if (history.length === 0) {
      return res.status(404).json({ etaMinutes: -1, nextStop: "Unknown", error: "Truck location not found" });
    }

    const currentLoc = history[0]; // Most recent point
    const currentLat = parseFloat(currentLoc.latitude);
    const currentLon = parseFloat(currentLoc.longitude);
    const currentTripId = currentLoc.trip_id;
    const currentDriverId = currentLoc.driver_id; // Needed for driver-specific history

    // --- Advanced Logic Area ---

    // 2. Identify the *last visited marker* on the current trip
    //    Requires querying history for the current tripId, finding points close to markers
    let lastVisitedMarker = null;
    // (Conceptual Query: Find latest point in current trip within `streetProximity` of any marker)
    // You'd likely iterate backwards through `history` or do a more complex DB query.
    // For simplicity, let's find the nearest marker overall as a proxy (not accurate for actual path)
    const nearestMarkerToCurrent = findNearestStreet(currentLat, currentLon);
    // !!! This simplistic approach doesn't know the *previous distinct marker visited on this trip* !!!


    // 3. Predict the *next marker* based on historical routes
    //    - Analyze past `trip_id`s for this `driver_id` or `truck_id`.
    //    - Find common sequences of visited markers.
    //    - Based on the (properly identified) `lastVisitedMarker`, predict the next one.
    //    - Placeholder: Use the overall nearest marker again (very inaccurate prediction)
    const predictedNextMarkerName = nearestMarkerToCurrent ? nearestMarkerToCurrent.name : "Unknown";
    const lastMarkerName = "PLACEHOLDER_LAST_MARKER"; // Needs proper identification

    // 4. Query Historical Average Time for the segment (Last Marker -> Next Marker)
    let averageSeconds = -1;
    if (predictedNextMarkerName !== "Unknown" && lastMarkerName !== "PLACEHOLDER_LAST_MARKER") {
        console.log(`Querying history for ${truckId}/${currentDriverId}: ${lastMarkerName} -> ${predictedNextMarkerName}`);
        // Conceptual Query:
        // Needs refinement - GROUP BY trip_id, find pairs of marker visits within trips, average the time diff.
        // Consider time of day, day of week filters here.
       /*
       const [avgResult] = await connection.query(
           `SELECT AVG(TIMESTAMPDIFF(SECOND, t1.timestamp, MIN(t2.timestamp))) as avg_duration
            FROM location_history t1
            JOIN location_history t2 ON t1.trip_id = t2.trip_id AND t2.timestamp > t1.timestamp
            WHERE t1.truck_id = ? AND t1.driver_id = ?
              AND t1.marker_name = ? -- Requires identifying points near markers
              AND t2.marker_name = ?
              AND t1.timestamp > DATE_SUB(NOW(), INTERVAL 7 DAY) -- Look at recent history
            GROUP BY t1.trip_id
            HAVING MIN(t2.timestamp) IS NOT NULL;`, // Ensure a next marker was found in the trip
           [truckId, currentDriverId, lastMarkerName, predictedNextMarkerName]
       );
       if (avgResult.length > 0 && avgResult[0].avg_duration) {
           averageSeconds = parseFloat(avgResult[0].avg_duration);
           console.log(`Historical average found: ${averageSeconds.toFixed(1)}s`);
       } else {
           console.log("No specific historical average found for this segment.");
       }
       */
       // USING SIMULATED VALUE FOR NOW
       if (predictedNextMarkerName === "Caridad St") averageSeconds = 180;
       else if (predictedNextMarkerName === "Inocensia St") averageSeconds = 120;

    }

    // --- End Advanced Logic Area ---

    let etaMinutes = -1;
    if (averageSeconds > 0) {
      etaMinutes = Math.round(averageSeconds / 60);
      console.log(`ETA for ${truckId} to ${predictedNextMarkerName}: Using historical (${etaMinutes} min)`);
    } else if (nearestMarkerToCurrent && nearestMarkerToCurrent.distance > streetProximity) { // Only use fallback if not *at* the marker
       // Fallback: Simple distance/speed to the NEAREST marker (less accurate)
       const fallbackSpeed = 5.5; // m/s
       etaMinutes = Math.round((nearestMarkerToCurrent.distance / fallbackSpeed) / 60);
       console.log(`ETA for ${truckId} to ${predictedNextMarkerName}: Using fallback (${etaMinutes} min)`);
    } else if (nearestMarkerToCurrent && nearestMarkerToCurrent.distance <= streetProximity) {
        etaMinutes = 0; // Already at or very near the closest marker
        console.log(`ETA for ${truckId}: At or near ${predictedNextMarkerName}`);
    } else {
        console.log(`ETA for ${truckId}: Could not determine ETA.`);
    }

    res.json({ etaMinutes: etaMinutes, nextStop: predictedNextMarkerName });

  } catch (error) {
    console.error(`Error calculating ETA for ${truckId}:`, error);
    res.status(500).json({ etaMinutes: -1, nextStop: "Error", error: "Server error calculating ETA" });
  } finally {
      if (connection) connection.release();
  }
});


// --- HTTP Server & Socket.IO Setup ---
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// --- Store connected truck sockets ---
let truckSockets = {}; // Map: { truckId: socket }

// --- Socket.IO Connection Logic ---
io.on('connection', (socket) => {
    // ... (Connection/Disconnect logic same as previous version) ...
    console.log(`🟢 Client connected: ${socket.id}`);
    let connectedTruckId = null;

    socket.on('update-location', async (data) => {
        // ... (Validation, Database Logging, Broadcasting - same as previous version, ensures driverId/tripId are saved) ...
        if (typeof data !== 'object' || data.latitude === undefined || data.longitude === undefined || !data.truckId) { /* ... */ return; }
        const { latitude, longitude, truckId, driverId, tripId, source } = data;
        // console.log(`📍 Loc Update [${truckId} via ${source || 'browser'}]: ${latitude}, ${longitude}`); // Less verbose

        if (source === 'device') {
            connectedTruckId = truckId;
            truckSockets[truckId] = socket;
        }

        // DB Logging
        let dbConn;
        try {
            dbConn = await dbPool.getConnection();
            await dbConn.query(
              'INSERT INTO location_history (latitude, longitude, truck_id, driver_id, trip_id) VALUES (?, ?, ?, ?, ?)',
              [latitude, longitude, truckId, driverId || null, tripId || null]
            );
            dbConn.release();
        } catch (err) { /* ... error handling ... */ }

        // Geofence & Proximity Checks for SMS (only for device source)
        if (source === 'device' && turfPolygons.length > 0 && allStreetMarkers.length > 0) {
            const point = turf.point([longitude, latitude]);
            let currentZone = null;
            for (const zone of turfPolygons) {
                if (zone.turf && turf.booleanPointInPolygon(point, zone.turf)) { currentZone = zone.name; break; }
            }

            const nearestStreet = findNearestStreet(latitude, longitude);

            // Trigger SMS based on state change
            if (currentZone && currentZone !== socket.lastZone) {
              console.log(`🚚 Truck ${truckId} entered zone: ${currentZone}`);
              socket.lastZone = currentZone; socket.lastNearStreet = null; // Reset street when changing zone
              triggerSmsSend(currentZone, null, truckId);
            } else if (!currentZone && socket.lastZone) {
                 console.log(`🚚 Truck ${truckId} exited zone: ${socket.lastZone}`);
                 socket.lastZone = null;
            }

            if (nearestStreet && nearestStreet.distance <= streetProximity) {
                 const streetIdentifier = `${nearestStreet.barangay}-${nearestStreet.name}`;
                 if (streetIdentifier !== socket.lastNearStreet) {
                     console.log(`🚚 Truck ${truckId} near street: ${nearestStreet.name} in ${nearestStreet.barangay}`);
                     socket.lastNearStreet = streetIdentifier;
                     triggerSmsSend(nearestStreet.barangay, nearestStreet.name, truckId);
                 }
            }
        }

        // Broadcast to all clients
        io.emit('location-update', data);
    });

    socket.on('disconnect', () => {
       // ... (same disconnect logic) ...
        console.log(`🔴 Client disconnected: ${socket.id}`);
        if (connectedTruckId && truckSockets[connectedTruckId] === socket) {
          console.log(`🚛 Truck ${connectedTruckId} disconnected.`);
          delete truckSockets[connectedTruckId];
        }
    });
});

// --- Function to Trigger SMS Sending ---
async function triggerSmsSend(barangay, street, triggeringTruckId) {
    // ... (no changes needed here from previous version) ...
     const alertMessage = street ? `Truck near ${street}, ${barangay}` : `Truck entered ${barangay}`;
    let connection;
    try {
        connection = await dbPool.getConnection();
        const [users] = await connection.query('SELECT phone FROM users WHERE barangay = ?', [barangay]);
        connection.release();

        if (users.length === 0) { /* ... no users log ... */ return; }

        users.forEach(user => {
            const truckSocket = truckSockets[triggeringTruckId];
            if (truckSocket) {
                truckSocket.emit('send_sms_command', { phone: user.phone, message: alertMessage });
                console.log(`📱 Queued SMS via Socket.IO to Truck ${triggeringTruckId} for ${user.phone}`);
            } else { /* ... warning log ... */ }
        });
    } catch (err) { /* ... error handling ... */ }
}

// --- Start Server ---
server.listen(port, () => {
  console.log(`🚀 Server running at http://localhost:${port}`);
});