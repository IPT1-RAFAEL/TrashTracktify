require('dotenv').config();
const express = require('express');
const path = require('path');
const mysql = require('mysql2/promise');
const http = require('http');
const { Server } = require('socket.io');
const turf = require('@turf/turf');
const fs = require('fs');
const cors = require('cors'); // <<< 1. REQUIRE CORS

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
app.use(cors()); // <<< 2. USE CORS (This allows requests from other origins)
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
    let rawPolyData = fs.readFileSync(path.join(__dirname, 'public/data/polygon.json'));
    polygons = JSON.parse(rawPolyData);
    console.log(`✅ Loaded ${polygons.length} polygons.`);

    let rawStreetData = fs.readFileSync(path.join(__dirname, 'public/data/streets.json'));
    streetGroups = JSON.parse(rawStreetData);
    console.log(`✅ Loaded street groups for ${Object.keys(streetGroups).length} barangays.`);

    // Create Turf Polygons
    turfPolygons = polygons.map(p => {
        if (!Array.isArray(p.coords) || p.coords.length < 3 || !Array.isArray(p.coords[0]) || p.coords[0].length < 2) {
            console.error(`❌ Invalid or empty coords for polygon: ${p.name}`);
            return { name: p.name, turf: null }; // Return object with null turf
        }
        const ring = p.coords.map(c => [c[1], c[0]]);
        const first = ring[0];
        const last = ring[ring.length - 1];
        if (first[0] !== last[0] || first[1] !== last[1]) {
            ring.push([...first]);
        }
        try {
            return { name: p.name, turf: turf.polygon([ring]) };
        } catch(turfError) {
             console.error(`❌ Error creating Turf polygon for ${p.name}:`, turfError.message);
             return { name: p.name, turf: null }; // Return object
        }
    }).filter(tp => {
        // Filter out any undefined or null turf objects
        return tp && tp.turf !== null;
    });

    // Flatten Street Markers
    Object.entries(streetGroups).forEach(([barangay, streets]) => {
        streets.forEach(street => {
            if (street.coords && street.coords.length === 2) {
                allStreetMarkers.push({ ...street, barangay });
            }
        });
    });
    console.log(`✅ Created ${turfPolygons.length} valid Turf polygons.`);
    console.log(`✅ Indexed ${allStreetMarkers.length} street markers.`);

} catch (err) {
    console.error("❌❌❌ FATAL ERROR: Could not load geographic data:", err);
    process.exit(1);
}

const streetProximity = 15;

// --- Helper Functions ---
function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = x => x * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

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

// Registration
app.post('/register', async (req, res) => {
  const { name, phone, barangay } = req.body;
  if (!name || !phone || !barangay) {
    return res.status(400).send('All fields are required.');
  }
  try {
    const connection = await dbPool.getConnection();
    await connection.query('INSERT INTO users (name, phone, barangay) VALUES (?, ?, ?)', [name, phone, barangay]);
    connection.release();
    console.log(`✅ New user registered: ${name} (${barangay})`);
    res.send('Registration successful!');
  } catch (err) {
    console.error('Database insert error:', err);
    res.status(500).send('Database insert error');
  }
});

// Reset History
app.post('/reset-history', async (req, res) => {
  try {
    const connection = await dbPool.getConnection();
    await connection.query('TRUNCATE TABLE location_history');
    connection.release();
    console.log('✅ Location history cleared.');
    res.send('✅ Location history has been successfully cleared.');
  } catch (err) {
    console.error('❌ Error clearing location history:', err);
    res.status(500).send('Failed to clear location history.');
  }
});

// ETA Calculation
app.get('/eta/:truckId', async (req, res) => {
  const { truckId } = req.params;
  let connection;
  try {
    connection = await dbPool.getConnection();
    const [history] = await connection.query(
      `SELECT latitude, longitude FROM location_history WHERE truck_id = ? ORDER BY timestamp DESC LIMIT 1`,
      [truckId]
    );

    if (history.length === 0) {
      return res.status(404).json({ etaMinutes: -1, nextStop: "Unknown", error: "Truck location not found" });
    }

    const currentLoc = history[0];
    const currentLat = parseFloat(currentLoc.latitude);
    const currentLon = parseFloat(currentLoc.longitude);
    
    const nearestMarkerToCurrent = findNearestStreet(currentLat, currentLon);
    const predictedNextMarkerName = nearestMarkerToCurrent ? nearestMarkerToCurrent.name : "Unknown";
    let averageSeconds = -1; 
    
    // (Add real historical query logic here later)
    
    let etaMinutes = -1;
    if (averageSeconds > 0) {
      etaMinutes = Math.round(averageSeconds / 60);
    } else if (nearestMarkerToCurrent && nearestMarkerToCurrent.distance > streetProximity) { 
       const fallbackSpeed = 5.5; // m/s
       etaMinutes = Math.round((nearestMarkerToCurrent.distance / fallbackSpeed) / 60);
    } else if (nearestMarkerToCurrent && nearestMarkerToCurrent.distance <= streetProximity) {
        etaMinutes = 0;
    }

    res.json({ etaMinutes: etaMinutes, nextStop: predictedNextMarkerName });

  } catch (error) {
    console.error(`Error calculating ETA for ${truckId}:`, error);
    res.status(500).json({ etaMinutes: -1, nextStop: "Error", error: "Server error" });
  } finally {
      if (connection) connection.release();
  }
});

// --- HTTP Server & Socket.IO Setup ---
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // Allow all origins for Socket.IO
    methods: ["GET", "POST"]
  }
});

let truckSockets = {};

// --- Socket.IO Connection Logic ---
io.on('connection', (socket) => {
    console.log(`🟢 Client connected: ${socket.id}`);
    let connectedTruckId = null;

    socket.on('update-location', async (data) => {
        if (typeof data !== 'object' || data.latitude === undefined || !data.truckId) { 
            console.warn(`⚠️ Invalid location data from ${socket.id}`);
            return; 
        }
        const { latitude, longitude, truckId, driverId, tripId, source } = data;

        if (source === 'device' || source === 'simulator') {
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
        } catch (err) { 
            if (dbConn) dbConn.release();
            console.error('❌ Error saving location to database:', err);
        }

        // Geofence & Proximity Checks
        if ((source === 'device' || source === 'simulator') && turfPolygons.length > 0) {
            const point = turf.point([longitude, latitude]);
            let currentZone = null;
            for (const zone of turfPolygons) {
                if (zone.turf && turf.booleanPointInPolygon(point, zone.turf)) { currentZone = zone.name; break; }
            }

            const nearestStreet = findNearestStreet(latitude, longitude);

            // Trigger SMS
            if (currentZone && currentZone !== socket.lastZone) {
              console.log(`🚚 Truck ${truckId} entered zone: ${currentZone}`);
              socket.lastZone = currentZone; socket.lastNearStreet = null;
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

        io.emit('location-update', data);
    });

    socket.on('disconnect', () => {
        console.log(`🔴 Client disconnected: ${socket.id}`);
        if (connectedTruckId && truckSockets[connectedTruckId] === socket) {
          console.log(`🚛 Truck ${connectedTruckId} disconnected.`);
          delete truckSockets[connectedTruckId];
        }
    });
});

// --- Function to Trigger SMS Sending ---
async function triggerSmsSend(barangay, street, triggeringTruckId) {
     const alertMessage = street ? `Truck near ${street}, ${barangay}` : `Truck entered ${barangay}`;
    let connection;
    try {
        connection = await dbPool.getConnection();
        const [users] = await connection.query('SELECT phone FROM users WHERE barangay = ?', [barangay]);
        connection.release();

        if (users.length === 0) { 
            console.log(`ℹ️ No registered users in ${barangay} for SMS alert.`);
            return; 
        }

        const truckSocket = truckSockets[triggeringTruckId];
        if (truckSocket) {
             users.forEach(user => {
                truckSocket.emit('send_sms_command', { phone: user.phone, message: alertMessage });
                console.log(`📱 Queued SMS via Socket.IO to Truck ${triggeringTruckId} for ${user.phone}`);
            });
        } else { 
            console.warn(`⚠️ Truck ${triggeringTruckId} not connected via Socket.IO, cannot send SMS command.`);
        }
    } catch (err) { 
        if (connection) connection.release();
        console.error(`❌ Error querying users or sending SMS command for ${barangay}:`, err);
    }
}

// --- Start Server ---
server.listen(port, () => {
  console.log(`🚀 Server running at http://localhost:${port}`);
});