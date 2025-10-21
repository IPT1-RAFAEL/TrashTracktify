require('dotenv').config();
const express = require('express');
const path = require('path');
const mysql = require('mysql2/promise'); // Needed for DB query
const http = require('http');
const { Server } = require('socket.io');
const turf = require('@turf/turf'); // Needed for geofencing
const fs = require('fs'); // Needed for map data
const cors = require('cors');
const bcrypt = require('bcrypt');
const net = require('net'); // REQUIRE the Node.js TCP networking module

const app = express();
const port = process.env.PORT || 3000;


const ARDUINO_IP = "172.20.10.14"; // The PUBLIC IP of your Arduino's network
const ARDUINO_PORT = 8888; // Port defined in your Arduino code
// --- End Arduino Device Configuration ---

// ✅ MySQL connection pool
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
  .then(conn => { console.log('✅ Connected to MySQL database pool.'); conn.release(); })
  .catch(err => { console.error('❌ Database connection pool failed:', err); process.exit(1); });

app.use(cors());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'))); // Serve static files like map data, js, css

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

/* ============================================================
 🔹 LOAD MAP DATA (Needed for Barangay lookup)
============================================================ */
let polygons = []; //
let turfPolygons = [];
let allStreetMarkers = []; //

try {
  const rawPoly = fs.readFileSync(path.join(__dirname, 'public/data/polygon.json'));
  polygons = JSON.parse(rawPoly); //

  turfPolygons = polygons.map(p => {
    if (!p.coords || p.coords.length < 3) return null;
    const ring = p.coords.map(c => [c[1], c[0]]); // GeoJSON uses [Lon, Lat]
    if (ring[0][0] !== ring.at(-1)[0] || ring[0][1] !== ring.at(-1)[1]) {
      ring.push([...ring[0]]); // Close the ring if needed
    }
    try {
        return { name: p.name, turf: turf.polygon([ring]) };
    } catch (e) {
        console.error(`Error creating polygon ${p.name}: ${e.message}`);
        return null;
    }
  }).filter(Boolean); // Filter out nulls from invalid polygons

  console.log('✅ Geographic polygon data loaded.');

  // Load street markers for potential use, although polygon check is primary
  const rawStreets = fs.readFileSync(path.join(__dirname, 'public/data/streets.json'));
  const streetGroups = JSON.parse(rawStreets); //
  Object.entries(streetGroups).forEach(([barangay, streets]) => {
     streets.forEach(st => {
       if (st.coords && st.coords.length === 2) {
         allStreetMarkers.push({ ...st, barangay });
       }
     });
   });
   console.log('✅ Street marker data loaded.');

} catch (err) {
  console.error('❌ Failed to load map data:', err);
  // Consider exiting if map data is critical: process.exit(1);
}

/* ============================================================
 🔹 ADMIN AUTH, USERS, SCHEDULE ENDPOINTS (Keep as is)
============================================================ */
// ... (Your /admin-register, /admin-login, /users, /schedule GET/POST endpoints remain unchanged) ...
// ✅ Admin Register
app.post('/admin-register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).send('Username and password are required.');
  }

  try {
    const hashed = await bcrypt.hash(password, 10);
    const conn = await dbPool.getConnection();
    await conn.query(
      'INSERT INTO admins (admin_id, username, password) VALUES (?, ?, ?)',
      [`Admin-${Date.now()}`, username, hashed]
    );
    conn.release();
    res.send('✅ Admin registered successfully!');
  } catch (err) {
    console.error('❌ Admin registration error:', err);
    res.status(500).send('Admin registration error');
  }
});

// ✅ Admin Login
app.post('/admin-login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).send('All fields required.');

  try {
    const conn = await dbPool.getConnection();
    const [rows] = await conn.query('SELECT * FROM admins WHERE username = ?', [username]);
    conn.release();

    if (rows.length === 0) return res.status(401).send('Invalid credentials.');
    const admin = rows[0];

    const valid = await bcrypt.compare(password, admin.password);
    if (!valid) return res.status(401).send('Invalid credentials.');

    res.json({
      message: '✅ Login successful!',
      admin_id: admin.admin_id,
      username: admin.username
    });
  } catch (err) {
    console.error('❌ Login error:', err);
    res.status(500).send('Login failed.');
  }
});
app.get('/users', async (req, res) => { //
  try {
    const conn = await dbPool.getConnection();
    const [users] = await conn.query('SELECT * FROM users ORDER BY id DESC');
    conn.release();
    res.json(users);
  } catch (err) {
    console.error('Error fetching users:', err);
    res.status(500).send('Error fetching users.');
  }
});
app.get('/schedule', async (req, res) => { //
  try {
    const conn = await dbPool.getConnection();
    const [schedules] = await conn.query('SELECT barangay, day, start_time FROM schedules');
    conn.release();
    res.json(schedules);
  } catch (err) {
    console.error('Error fetching schedule:', err);
    res.status(500).send('Error fetching schedule');
  }
});

app.post('/schedule', async (req, res) => { //
  const { barangay, day, start_time, updated_by } = req.body;
  if (!barangay || !day || !start_time) {
    return res.status(400).send('All fields required');
  }

  try {
    const conn = await dbPool.getConnection();
    await conn.query(
      'INSERT INTO schedules (barangay, day, start_time, updated_by) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE start_time = VALUES(start_time), updated_by = VALUES(updated_by)',
      [barangay, day, start_time, updated_by || 'admin']
    );
    conn.release();

    io.emit('schedule-update'); // 🔄 Broadcast schedule changes
    res.send('✅ Schedule updated successfully!');
  } catch (err) {
    console.error('❌ Error updating schedule:', err);
    res.status(500).send('Error updating schedule');
  }
});


/* ============================================================
 🔹 TCP CLIENT (Connects TO Arduino)
============================================================ */
let arduinoClient = null;
let connectionAttempts = 0;
const MAX_ATTEMPTS = 5; // Limit reconnection attempts
const RETRY_DELAY = 10000; // 10 seconds

function connectToArduino() {
  // Prevent multiple connection attempts simultaneously
  if (arduinoClient && !arduinoClient.destroyed && !arduinoClient.connecting) {
    console.log('[TCP] Already connected to Arduino.');
    return;
  }
  if (arduinoClient && arduinoClient.connecting) {
    console.log('[TCP] Connection attempt already in progress.');
    return;
  }

  if (connectionAttempts >= MAX_ATTEMPTS) {
      console.error(`❌ [TCP] Max connection attempts reached. Stopping retries for Arduino.`);
      return; // Stop trying after max attempts
  }

  console.log(`[TCP] Attempt ${connectionAttempts + 1}/${MAX_ATTEMPTS} to connect to Arduino at ${ARDUINO_IP}:${ARDUINO_PORT}...`);
  connectionAttempts++;

  arduinoClient = new net.Socket();
  arduinoClient.connecting = true; // Flag that connection is in progress

  // Set a timeout for the connection attempt
  arduinoClient.setTimeout(5000, () => {
    if (arduinoClient.connecting) {
        console.error(`[TCP] Connection attempt timed out.`);
        arduinoClient.destroy(); // Will trigger 'error' or 'close'
    }
  });

  arduinoClient.connect(ARDUINO_PORT, ARDUINO_IP, () => {
    console.log(`✅ [TCP] Connected to Arduino (${ARDUINO_IP}:${ARDUINO_PORT})`);
    arduinoClient.connecting = false;
    connectionAttempts = 0; // Reset attempts on success
    arduinoClient.setTimeout(0); // Clear connection timeout
  });

  arduinoClient.on('data', (data) => {
    console.log(`[TCP] Received from Arduino: ${data.toString().trim()}`);
  });

  arduinoClient.on('close', (hadError) => {
    console.log(`🔌 [TCP] Connection to Arduino closed ${hadError ? 'due to error' : 'normally'}.`);
    arduinoClient.connecting = false;
    arduinoClient = null;
    // Retry connection after delay
    console.log(`[TCP] Retrying connection in ${RETRY_DELAY / 1000} seconds...`);
    setTimeout(connectToArduino, RETRY_DELAY);
  });

  arduinoClient.on('error', (err) => {
    console.error(`❌ [TCP] Connection error: ${err.message}`);
    arduinoClient.connecting = false;
    // Ensure cleanup and trigger 'close'
    if (arduinoClient && !arduinoClient.destroyed) {
        arduinoClient.destroy();
    }
    arduinoClient = null;
    // 'close' event will handle reconnection logic
  });
}

// Initial connection attempt when server starts
if (ARDUINO_IP && ARDUINO_IP !== "YOUR_ROUTER_PUBLIC_IP") {
    connectToArduino();
} else {
    console.warn("⚠️ ARDUINO_IP is not set. Cannot connect to Arduino TCP server.");
}


/* ============================================================
 🔹 Socket.IO Handling (Map Updates & SMS Trigger)
============================================================ */
io.on('connection', socket => {
  console.log(`🟢 Client connected: ${socket.id}`);

  // Listener for general location updates (from simulator or maybe real devices in future)
  socket.on('update-location', data => {
    const { latitude, longitude, truckId, source } = data;
    if (!latitude || !longitude || !truckId) return;

    // Just broadcast location updates for the map
    // We handle SMS triggering separately below
    console.log(`[Socket.IO] Broadcasting location for ${truckId} from ${source || '?'}`);
    io.emit('location-update', data); // For map display
  });

  // *** NEW LISTENER: Triggered ONLY by the simulator ***
  socket.on('simulator-moved-trigger-sms', async (locationData) => {
    console.log('[Socket.IO] Received simulator-moved-trigger-sms:', locationData);
    const { latitude, longitude } = locationData;

    if (latitude === undefined || longitude === undefined) {
      console.warn('⚠️ Received invalid location data for SMS trigger.');
      return;
    }

    // 1. Determine Barangay
    let targetBarangay = null;
    const point = turf.point([longitude, latitude]); // Create Turf point [Lon, Lat]
    for (const zone of turfPolygons) {
      if (zone.turf && turf.booleanPointInPolygon(point, zone.turf)) { // Check if point is inside polygon
        targetBarangay = zone.name;
        console.log(`📍 Simulator location is inside Barangay: ${targetBarangay}`);
        break;
      }
    }

    if (!targetBarangay) {
      console.log('📍 Simulator location is not inside any known Barangay polygon.');
      // Optional: Find nearest street/barangay as fallback if needed
      return; // Stop if not in a target zone
    }

    // 2. Find Users in that Barangay
    let usersToSend = [];
    let conn;
    try {
      conn = await dbPool.getConnection();
      const [users] = await conn.query('SELECT phone FROM users WHERE barangay = ?', [targetBarangay]); // Query users table
      usersToSend = users;
      console.log(`Found ${usersToSend.length} users in ${targetBarangay}.`);
    } catch (dbError) {
      console.error(`❌ Error querying users for ${targetBarangay}:`, dbError);
    } finally {
      if (conn) conn.release();
    }

    // 3. Send SMS Commands via TCP to Arduino
    if (usersToSend.length > 0) {
      if (!arduinoClient || arduinoClient.destroyed) {
        console.warn('⚠️ Cannot send SMS commands: Not connected to Arduino.');
        // Maybe try to reconnect?
        if (!arduinoClient?.connecting) connectToArduino();
        return;
      }

      const baseMessage = `Trash truck is near Brgy ${targetBarangay}`; // Customize your message

      usersToSend.forEach(user => {
        if (user.phone) {
          // Format: send_sms:MESSAGE (PHONE)\n
          const command = `send_sms:${baseMessage} (${user.phone})\n`; // Matches Arduino code format
          console.log(`[TCP] Sending command to Arduino: ${command.trim()}`);
          try {
            arduinoClient.write(command);
          } catch (tcpError) {
            console.error(`❌ [TCP] Error sending command: ${tcpError.message}`);
            // Handle error, maybe queue message or try reconnecting
          }
        }
      });
    }
  }); // End of 'simulator-moved-trigger-sms' listener

  socket.on('disconnect', () => {
    console.log(`🔴 Client disconnected: ${socket.id}`);
  });
}); // End of io.on('connection')


/* ============================================================
 🔹 START SERVER
============================================================ */
server.listen(port, () => {
  console.log(`🚀 Server running at http://localhost:${port} or your Render URL`);
});