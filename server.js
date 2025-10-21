require('dotenv').config();
const express = require('express');
const path = require('path');
const mysql = require('mysql2/promise');
const http = require('http');
const { Server } = require('socket.io');
const turf = require('@turf/turf');
const fs = require('fs');
const cors = require('cors');
const bcrypt = require('bcrypt');
const net = require('net');

const app = express();
const port = process.env.PORT || 3000;

const ARDUINO_IP = "172.20.10.14";
const ARDUINO_PORT = 8888;

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
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

let polygons = [];
let turfPolygons = [];
let allStreetMarkers = [];

try {
  const rawPoly = fs.readFileSync(path.join(__dirname, 'public/data/polygon.json'));
  polygons = JSON.parse(rawPoly);

  turfPolygons = polygons.map(p => {
    if (!p.coords || p.coords.length < 3) return null;
    const ring = p.coords.map(c => [c[1], c[0]]);
    if (ring[0][0] !== ring.at(-1)[0] || ring[0][1] !== ring.at(-1)[1]) {
      ring.push([...ring[0]]);
    }
     try {
        return { name: p.name, turf: turf.polygon([ring]) };
    } catch (e) {
        console.error(`Error creating polygon ${p.name}: ${e.message}`);
        return null;
    }
  }).filter(Boolean);
  console.log('✅ Geographic polygon data loaded.');

  const rawStreets = fs.readFileSync(path.join(__dirname, 'public/data/streets.json'));
  const streetGroups = JSON.parse(rawStreets);
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
}

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
     if (!allStreetMarkers || allStreetMarkers.length === 0) {
         console.warn("Street markers not loaded, cannot find nearest street.");
         return null;
     }
     let closestStreet = null;
     let minDistance = Infinity;
     allStreetMarkers.forEach(item => {
        if (item.coords && typeof item.coords[0] === 'number' && typeof item.coords[1] === 'number') {
            const distance = getDistance(latitude, longitude, item.coords[0], item.coords[1]);
            if (distance < minDistance) {
                minDistance = distance;
                closestStreet = { ...item, distance: minDistance };
            }
        }
    });
    return closestStreet;
}

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

app.get('/users', async (req, res) => {
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

app.get('/schedule', async (req, res) => {
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

app.post('/schedule', async (req, res) => {
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
    io.emit('schedule-update');
    res.send('✅ Schedule updated successfully!');
  } catch (err) {
    console.error('❌ Error updating schedule:', err);
    res.status(500).send('Error updating schedule');
  }
});

const streetProximity = 15;

app.get('/eta/:truckId', async (req, res) => {
  const { truckId } = req.params;

  if (!app.locals.lastKnownLocations) {
      app.locals.lastKnownLocations = {};
  }

  const lastKnown = app.locals.lastKnownLocations[truckId];

  if (!lastKnown) {
    return res.status(404).json({ etaMinutes: -1, nextStop: "Unknown", error: "Truck location not yet received by server" });
  }

  try {
    const currentLat = parseFloat(lastKnown.latitude);
    const currentLon = parseFloat(lastKnown.longitude);
    const nearestMarkerToCurrent = findNearestStreet(currentLat, currentLon);
    const predictedNextMarkerName = nearestMarkerToCurrent ? nearestMarkerToCurrent.name : "Unknown";
    let etaMinutes = -1;

    if (nearestMarkerToCurrent) {
        if (nearestMarkerToCurrent.distance <= streetProximity) {
            etaMinutes = 0;
        } else {
            const fallbackSpeedMetersPerSecond = 5.5;
            const secondsToReach = nearestMarkerToCurrent.distance / fallbackSpeedMetersPerSecond;
            etaMinutes = Math.round(secondsToReach / 60);
        }
    }
    console.log(`[ETA] Calculation for ${truckId}: Lat=${currentLat}, Lon=${currentLon}, Nearest=${predictedNextMarkerName}, Dist=${nearestMarkerToCurrent?.distance.toFixed(1)}m, ETA=${etaMinutes}min`);
    res.json({ etaMinutes: etaMinutes, nextStop: predictedNextMarkerName });
  } catch (error) {
    console.error(`❌ Error calculating ETA for ${truckId}:`, error);
    res.status(500).json({ etaMinutes: -1, nextStop: "Error", error: "Server error during ETA calculation" });
  }
});

let arduinoClient = null;
let connectionAttempts = 0;
const MAX_ATTEMPTS = 5;
const RETRY_DELAY = 10000;

function connectToArduino() {
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
      return;
  }
  console.log(`[TCP] Attempt ${connectionAttempts + 1}/${MAX_ATTEMPTS} to connect to Arduino at ${ARDUINO_IP}:${ARDUINO_PORT}...`);
  connectionAttempts++;
  arduinoClient = new net.Socket();
  arduinoClient.connecting = true;
  arduinoClient.setTimeout(5000, () => {
    if (arduinoClient.connecting) {
        console.error(`[TCP] Connection attempt timed out.`);
        arduinoClient.destroy();
    }
  });
  arduinoClient.connect(ARDUINO_PORT, ARDUINO_IP, () => {
    console.log(`✅ [TCP] Connected to Arduino (${ARDUINO_IP}:${ARDUINO_PORT})`);
    arduinoClient.connecting = false;
    connectionAttempts = 0;
    arduinoClient.setTimeout(0);
  });
  arduinoClient.on('data', (data) => {
    console.log(`[TCP] Received from Arduino: ${data.toString().trim()}`);
  });
  arduinoClient.on('close', (hadError) => {
    console.log(`🔌 [TCP] Connection to Arduino closed ${hadError ? 'due to error' : 'normally'}.`);
    arduinoClient.connecting = false;
    arduinoClient = null;
    console.log(`[TCP] Retrying connection in ${RETRY_DELAY / 1000} seconds...`);
    setTimeout(connectToArduino, RETRY_DELAY);
  });
  arduinoClient.on('error', (err) => {
    console.error(`❌ [TCP] Connection error: ${err.message}`);
    arduinoClient.connecting = false;
    if (arduinoClient && !arduinoClient.destroyed) {
        arduinoClient.destroy();
    }
    arduinoClient = null;
  });
}

if (ARDUINO_IP && ARDUINO_IP !== "YOUR_ROUTER_PUBLIC_IP") {
    connectToArduino();
} else {
    console.warn("⚠️ ARDUINO_IP is not set. Cannot connect to Arduino TCP server.");
}

app.post('/send-sms', (req, res) => {
    const { message, phone } = req.body;
    if (!message) {
        return res.status(400).send('Missing "message" in request body.');
    }
    if (!arduinoClient || arduinoClient.destroyed) {
        console.warn('⚠️ [TCP] Attempted to send SMS, but not connected to Arduino.');
        if (!arduinoClient?.connecting) connectToArduino(); // Try reconnecting
        return res.status(503).send('Not connected to the truck device.');
    }
    let command;
    if (phone) {
        command = `send_sms:${message.trim()} (${phone.trim()})\n`;
    } else {
        command = `send_sms:${message.trim()}\n`;
    }
    console.log(`[TCP] Sending command to Arduino: ${command.trim()}`);
    try {
        arduinoClient.write(command);
        res.send(`✅ Command sent to Arduino: ${command.trim()}`);
    } catch (err) {
        console.error(`❌ [TCP] Error sending command: ${err.message}`);
        res.status(500).send('Error sending command to device.');
    }
});

io.on('connection', socket => {
  console.log(`🟢 Client connected: ${socket.id}`);

  socket.on('update-location', data => {
    const { latitude, longitude, truckId, source } = data;
    if (!latitude || !longitude || !truckId) return;

    if (!app.locals.lastKnownLocations) {
        app.locals.lastKnownLocations = {};
    }
    app.locals.lastKnownLocations[truckId] = { latitude, longitude, timestamp: Date.now() };

    console.log(`[Socket.IO] Broadcasting location for ${truckId} from ${source || '?'}`);
    io.emit('location-update', data);
  });

  socket.on('simulator-moved-trigger-sms', async (locationData) => {
    console.log('[Socket.IO] Received simulator-moved-trigger-sms:', locationData);
    const { latitude, longitude } = locationData;
    if (latitude === undefined || longitude === undefined) {
      console.warn('⚠️ Received invalid location data for SMS trigger.');
      return;
    }

    let targetBarangay = null;
    const point = turf.point([longitude, latitude]);
    for (const zone of turfPolygons) {
      if (zone.turf && turf.booleanPointInPolygon(point, zone.turf)) {
        targetBarangay = zone.name;
        console.log(`📍 Simulator location is inside Barangay: ${targetBarangay}`);
        break;
      }
    }

    if (!targetBarangay) {
      console.log('📍 Simulator location is not inside any known Barangay polygon.');
      return;
    }

    let usersToSend = [];
    let conn;
    try {
      conn = await dbPool.getConnection();
      const [users] = await conn.query('SELECT phone FROM users WHERE barangay = ?', [targetBarangay]);
      usersToSend = users;
      console.log(`Found ${usersToSend.length} users in ${targetBarangay}.`);
    } catch (dbError) {
      console.error(`❌ Error querying users for ${targetBarangay}:`, dbError);
    } finally {
      if (conn) conn.release();
    }

    if (usersToSend.length > 0) {
      if (!arduinoClient || arduinoClient.destroyed) {
        console.warn('⚠️ Cannot send SMS commands: Not connected to Arduino.');
        if (!arduinoClient?.connecting) connectToArduino();
        return;
      }
      const baseMessage = `Trash truck is near Brgy ${targetBarangay}`;
      usersToSend.forEach(user => {
        if (user.phone) {
          const command = `send_sms:${baseMessage} (${user.phone})\n`;
          console.log(`[TCP] Sending command to Arduino: ${command.trim()}`);
          try {
            arduinoClient.write(command);
          } catch (tcpError) {
            console.error(`❌ [TCP] Error sending command: ${tcpError.message}`);
          }
        }
      });
    }
  });

  socket.on('disconnect', () => {
    console.log(`🔴 Client disconnected: ${socket.id}`);
    // Optional: Clean up truckSockets if you were tracking simulator sockets
  });
});

server.listen(port, () => {
  console.log(`🚀 Server running at http://localhost:${port} or your Render URL`);
});