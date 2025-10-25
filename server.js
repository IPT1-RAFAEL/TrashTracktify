require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const fs = require('fs').promises;
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const mqtt = require('mqtt');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});
const port = process.env.PORT || 3000;

// --- MQTT Setup ---
const MQTT_BROKER_URL = 'mqtt://broker.hivemq.com';
const MQTT_TOPIC = 'trashtracktify/sms/send';

console.log(`[MQTT] Connecting to broker at ${MQTT_BROKER_URL}...`);
const mqttClient = mqtt.connect(MQTT_BROKER_URL);

mqttClient.on('connect', () => {
  console.log('✅ [MQTT] Connected to broker');
});
mqttClient.on('error', (err) => {
  console.error(`[MQTT] Connection error: ${err.message}`);
});
mqttClient.on('close', () => {
  console.log('[MQTT] Disconnected from broker');
});
// --- End MQTT Setup ---

app.use(cors());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- Database Pool ---
const dbPool = mysql.createPool({
  connectionLimit: 10,
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT,
  waitForConnections: true,
  queueLimit: 0
});

dbPool.getConnection()
  .then(conn => {
    console.log('✅ Connected to MySQL database pool');
    conn.release();
  })
  .catch(err => {
    console.error('❌ Database connection pool failed:', err);
    process.exit(1);
  });
// --- End Database Pool ---

let allStreetMarkers = [];

// --- Load Map Data ---
async function loadMapData() {
  try {
    await fs.readFile(path.join(__dirname, 'public/data/polygon.json'));
    console.log('✅ Geographic polygon data loaded');
    const rawStreets = await fs.readFile(path.join(__dirname, 'public/data/streets.json'));
    const streetGroups = JSON.parse(rawStreets);
    allStreetMarkers = [];
    Object.entries(streetGroups).forEach(([barangay, streets]) => {
      streets.forEach(st => {
        if (st.coords && st.coords.length === 2 && !isNaN(st.coords[0]) && !isNaN(st.coords[1])) {
          allStreetMarkers.push({ ...st, barangay });
        }
      });
    });
    console.log(`✅ Street marker data loaded: ${allStreetMarkers.length} markers`);
  } catch (err) {
    console.error('[Server] Error loading map data:', err.message);
  }
}
loadMapData();
// --- End Load Map Data ---


// --- API Routes ---
app.get('/users', async (req, res) => {
  try {
    const conn = await dbPool.getConnection();
    const [rows] = await conn.query('SELECT id, name, phone, barangay, street FROM users ORDER BY id DESC');
    conn.release();
    res.json(rows);
  } catch (err) {
    console.error(`[DB] Error fetching users: ${err.message}`);
    res.status(500).json({ error: 'Failed to fetch users: Database unavailable' });
  }
});

app.post('/register', async (req, res) => {
  const { name, phone, barangay, street } = req.body;
  console.log(`[POST /register] Received data:`, { name, phone, barangay, street });

  if (!name || !phone || !barangay || !street) {
    return res.status(400).json({ error: 'Missing required fields (name, phone, barangay, street)' });
  }
  if (!['Tugatog', 'Acacia', 'Tinajeros'].includes(barangay)) {
    return res.status(400).json({ error: 'Invalid barangay. Must be Tugatog, Acacia, or Tinajeros.' });
  }
  if (!/^09\d{9}$/.test(phone)) {
    console.warn(`[POST /register] Invalid phone number format: ${phone}`);
    return res.status(400).json({ error: 'Invalid phone number format. Must be 11 digits starting with 09.' });
  }
  try {
    const conn = await dbPool.getConnection();
    await conn.query(
      'INSERT INTO users (name, phone, barangay, street) VALUES (?, ?, ?, ?)',
      [name, phone, barangay, street]
    );
    conn.release();
    console.log(`[DB] Registered user: ${name}, ${phone}, ${barangay}, ${street}`);
    io.emit('registered-stats-update'); // Signal stats page to refresh
    res.json({ message: '✅ Registration successful' });
  } catch (err) {
    console.error(`[DB] Error registering user: ${err.message}`);
    if (err.code === 'ER_DUP_ENTRY') {
         return res.status(400).json({ error: 'Phone number already registered.' });
    }
    res.status(500).json({ error: `Failed to register: Database unavailable - ${err.message}` });
  }
});

app.get('/schedule', async (req, res) => {
  try {
    const conn = await dbPool.getConnection();
    const [rows] = await conn.query('SELECT barangay, day, start_time FROM schedules');
    conn.release();
    console.log(`[GET /schedule] Fetched ${rows.length} schedule entries`);
    res.json(rows);
  } catch (err) {
    console.error(`[DB] Error fetching schedule: ${err.message}`);
    res.status(500).json({ error: 'Failed to fetch schedule: Database unavailable' });
  }
});

app.post('/schedule', async (req, res) => {
  // TODO: Add admin authentication check here later
  const { barangay, day, start_time, updated_by } = req.body;
  console.log(`[POST /schedule] Received data:`, { barangay, day, start_time, updated_by });

  if (!barangay || !day || !start_time) return res.status(400).json({ error: 'Missing required fields' });
  if (!['Tugatog', 'Acacia', 'Tinajeros'].includes(barangay)) return res.status(400).json({ error: 'Invalid barangay' });
  if (!['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'].includes(day)) return res.status(400).json({ error: 'Invalid day' });
  if (!/^\d{2}:\d{2}:\d{2}$/.test(start_time)) return res.status(400).json({ error: 'Invalid time format (HH:MM:SS)' });

  try {
    const conn = await dbPool.getConnection();
    await conn.query(
      'INSERT INTO schedules (barangay, day, start_time, updated_by) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE start_time = VALUES(start_time), updated_by = VALUES(updated_by)',
      [barangay, day, start_time, updated_by || 'admin']
    );
    conn.release();
    io.emit('schedule-update'); // Notify all clients
    console.log(`[DB] Updated schedule: ${barangay}, ${day}, ${start_time}`);
    res.json({ message: '✅ Schedule updated successfully' });
  } catch (err) {
    console.error(`[DB] Error updating schedule: ${err.message}`);
    res.status(500).json({ error: `Failed to update schedule: Database unavailable - ${err.message}` });
  }
});

// Admin registration/login (Code added from repository file)
app.post('/admin-register', async (req, res) => {
  const { username, password } = req.body;
  console.log(`[POST /admin-register] Received data:`, { username });
  if (!username || !password) {
    return res.status(400).json({ error: 'Missing username or password' });
  }
  if (username.length < 3) {
    return res.status(400).json({ error: 'Username must be at least 3 characters' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  try {
    const conn = await dbPool.getConnection();
    const [existing] = await conn.query('SELECT username FROM admins WHERE username = ?', [username]);
    if (existing.length > 0) {
      conn.release();
      return res.status(400).json({ error: 'Username already exists' });
    }
    const hashed = await bcrypt.hash(password, 10);
    await conn.query(
      'INSERT INTO admins (username, password) VALUES (?, ?)',
      [username, hashed]
    );
    conn.release();
    console.log(`[DB] Registered admin: ${username}`);
    res.json({ message: '✅ Admin registration successful' });
  } catch (err) {
    console.error(`[DB] Error registering admin: ${err.message}`);
    res.status(500).json({ error: `Failed to register admin: ${err.message}` });
  }
});

app.post('/admin-login', async (req, res) => {
  const { username, password } = req.body;
  console.log(`[POST /admin-login] Received data:`, { username });
  if (!username || !password) {
    return res.status(400).json({ error: 'Missing username or password' });
  }
  try {
    const conn = await dbPool.getConnection();
    const [rows] = await conn.query('SELECT * FROM admins WHERE username = ?', [username]);
    conn.release();
    if (rows.length === 0) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    const admin = rows[0];
    const isMatch = await bcrypt.compare(password, admin.password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    console.log(`[DB] Admin login successful: ${username}`);
    res.json({
      message: '✅ Login successful',
      id: admin.id,
      username: admin.username
    });
  } catch (err) {
    console.error(`[DB] Error logging in admin: ${err.message}`);
    res.status(5500).json({ error: `Failed to login: Database unavailable - ${err.message}` });
  }
});

// ETA calculation (Code added from repository file)
app.get('/eta/:truckId', async (req, res) => {
  const { truckId } = req.params;
  console.log(`[ETA] Received request for truckId: ${truckId}`);
  try {
    const lastKnown = app.locals.lastKnownLocations?.[truckId];
    if (!lastKnown) {
      console.warn(`[ETA] No location data for ${truckId}`);
      return res.status(404).json({ etaMinutes: -1, nextStop: 'Unknown', error: 'No location data' });
    }
    const { latitude, longitude } = lastKnown;
    if (isNaN(latitude) || isNaN(longitude)) {
      console.warn(`[ETA] Invalid coordinates for ${truckId}:`, lastKnown);
      return res.status(500).json({ etaMinutes: -1, nextStop: 'Unknown', error: 'Invalid coordinates' });
    }
    if (!allStreetMarkers || allStreetMarkers.length === 0) {
      console.warn(`[ETA] No street markers loaded for ${truckId}`);
      return res.status(500).json({ etaMinutes: -1, nextStop: 'Unknown', error: 'Street markers not loaded' });
    }
    let minDistance = Infinity;
    let nextStop = null;
    for (const street of allStreetMarkers) {
      // Using simpler distance calculation as in the repository file
      const distance = Math.sqrt(
        Math.pow(latitude - street.coords[0], 2) +
        Math.pow(longitude - street.coords[1], 2)
      );
      if (distance < minDistance) {
        minDistance = distance;
        nextStop = street.name;
      }
    }
    // Very basic ETA calculation based on distance, as in the repository file
    const etaMinutes = minDistance < 0.000135 ? 0 : Math.round(minDistance * 10000);
    console.log(`[ETA] Calculated for ${truckId}: Lat=${latitude}, Lon=${longitude}, NextStop=${nextStop}, ETA=${etaMinutes}min`);
    res.json({ etaMinutes, nextStop });
  } catch (err) {
    console.error(`[ETA] Error for ${truckId}: ${err.message}`);
    res.status(500).json({ error: `Failed to calculate ETA: ${err.message}` });
  }
});

// Statistics Endpoint
app.get('/stats/registered', async (req, res) => {
    console.log('[GET /stats/registered] Fetching user counts per street...');
    try {
        const conn = await dbPool.getConnection();
        const [rows] = await conn.query(
            'SELECT barangay, street, COUNT(*) as count FROM users GROUP BY barangay, street ORDER BY barangay, street'
        );
        conn.release();
        const stats = rows.map(row => ({
            barangay: row.barangay,
            street: row.street || 'Unknown Street',
            count: row.count
        }));
        console.log(`[GET /stats/registered] Found stats for ${stats.length} locations.`);
        res.json(stats);
    } catch (err) {
        console.error(`[DB] Error fetching registered stats: ${err.message}`);
        res.status(500).json({ error: 'Failed to fetch statistics' });
    }
});

// --- Driver Registration ---
app.post('/driver-register', async (req, res) => {
    const { regName: name, regPhone: phone, regBarangay: barangay, regPassword: password } = req.body;
    console.log(`[POST /driver-register] Received data:`, { name, phone, barangay });

    if (!name || !phone || !barangay || !password) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    if (!/^09\d{9}$/.test(phone)) {
        return res.status(400).json({ error: 'Invalid phone number format. Must be 11 digits starting with 09.' });
    }
    if (!['Tugatog', 'Acacia', 'Tinajeros'].includes(barangay)) {
         return res.status(400).json({ error: 'Invalid barangay.' });
    }
    if (password.length < 6) {
        return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
    }

    try {
        const conn = await dbPool.getConnection();
        const [existing] = await conn.query('SELECT driver_id FROM drivers WHERE phone = ?', [phone]);
        if (existing.length > 0) {
            conn.release();
            return res.status(400).json({ error: 'Phone number is already registered.' });
        }
        const saltRounds = 10;
        const password_hash = await bcrypt.hash(password, saltRounds);
        await conn.query(
            'INSERT INTO drivers (name, phone, barangay, password_hash) VALUES (?, ?, ?, ?)',
            [name, phone, barangay, password_hash]
        );
        conn.release();
        console.log(`[DB] Registered new driver: ${name}, Phone: ${phone}`);
        res.status(201).json({ message: '✅ Driver registration successful!' });

    } catch (err) {
        console.error(`[DB] Error registering driver: ${err.message}`);
        res.status(500).json({ error: `Driver registration failed: ${err.message}` });
    }
});

// --- Driver Login ---
app.post('/driver-login', async (req, res) => {
    const { driverName: name, driverPassword: password } = req.body;
    console.log(`[POST /driver-login] Attempting login for driver: ${name}`);

    if (!name || !password) {
        return res.status(400).json({ error: 'Missing driver name or password' });
    }

    try {
        const conn = await dbPool.getConnection();
        const [rows] = await conn.query(
            'SELECT driver_id, name, phone, barangay, password_hash, assigned_truck_id FROM drivers WHERE name = ?',
            [name]
        );
        conn.release();
        if (rows.length === 0) {
            console.log(`[Auth] Login failed: Driver not found - ${name}`);
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        const driver = rows[0];
        const isMatch = await bcrypt.compare(password, driver.password_hash);
        if (!isMatch) {
            console.log(`[Auth] Login failed: Incorrect password for driver - ${name}`);
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        console.log(`[Auth] Login successful for driver: ${driver.name} (ID: ${driver.driver_id})`);
        res.json({
            message: '✅ Login successful!',
            driver: {
                id: driver.driver_id,
                name: driver.name,
                phone: driver.phone,
                barangay: driver.barangay,
                truckId: driver.assigned_truck_id || `Driver-Truck-${driver.driver_id}`
            }
        });
    } catch (err) {
        console.error(`[DB] Error during driver login: ${err.message}`);
        res.status(500).json({ error: `Login failed: ${err.message}` });
    }
});
// --- End API Routes ---

// --- Socket.IO Handling ---
app.locals.truckStats = {};

io.on('connection', (socket) => {
  console.log(`🟢 Client connected: ${socket.id}`);

  // Location Updates
  socket.on('update-location', (data) => {
    const { latitude, longitude, truckId, source } = data;
    if (!latitude || !longitude || !truckId) {
      console.warn(`[Socket.IO] Invalid location data: ${JSON.stringify(data)}`);
      return;
    }
    app.locals.lastKnownLocations = app.locals.lastKnownLocations || {};
    app.locals.lastKnownLocations[truckId] = { latitude, longitude, source, timestamp: Date.now() };
    console.log(`[Socket.IO] Stored location for ${truckId}: Lat=${latitude}, Lon=${longitude}, Source=${source || 'unknown'}`);
    socket.broadcast.emit('location-update', data);
  });

  // SMS Trigger Logic
  socket.on('simulator-moved-trigger-sms', async (data) => {
    console.log(`[Socket.IO] Received simulator-moved-trigger-sms: ${JSON.stringify(data)}`);
    const { barangay, truckId, latitude, longitude } = data;
    if (!barangay) {
      console.warn('[Socket.IO] Missing barangay for SMS:', data);
      return;
    }
    try {
      let lat = latitude;
      let lon = longitude;
      if (truckId && !latitude && !longitude) {
        const lastKnown = app.locals.lastKnownLocations?.[truckId];
        if (!lastKnown) {
          console.warn(`[Socket.IO] No location data for truckId: ${truckId}`);
          return;
        }
        lat = lastKnown.latitude;
        lon = lastKnown.longitude;
      }
      if (!lat || !lon || isNaN(lat) || isNaN(lon)) {
        console.warn(`[Socket.IO] Invalid coordinates for SMS:`, { lat, lon, truckId });
        return;
      }
      if (!allStreetMarkers || allStreetMarkers.length === 0) {
        console.warn('[Socket.IO] No street markers loaded for SMS');
        return;
      }
      let minDistance = Infinity;
      let closestStreet = 'Unknown';
      for (const street of allStreetMarkers) {
        if (street.barangay === barangay) {
          const distance = Math.sqrt(
            Math.pow(lat - street.coords[0], 2) +
            Math.pow(lon - street.coords[1], 2)
          );
          if (distance < minDistance) {
            minDistance = distance;
            closestStreet = street.name;
          }
        }
      }

      const conn = await dbPool.getConnection();
      const [users] = await conn.query('SELECT phone FROM users WHERE barangay = ?', [barangay]);
      conn.release();
      console.log(`[Socket.IO] Found ${users.length} users in ${barangay}:`, users.map(u => u.phone));
      const phoneNumbers = users
        .map(user => {
          const phone = user.phone;
          if (/^09\d{9}$/.test(phone)) {
            return `+63${phone.slice(1)}`;
          }
          return null;
        })
        .filter(phone => phone !== null);
      if (phoneNumbers.length === 0) {
        console.log(`[Socket.IO] No valid phone numbers for barangay: ${barangay}`);
        return;
      }
      console.log(`[Socket.IO] Sending SMS to ${phoneNumbers.length} valid users in ${barangay}: ${phoneNumbers.join(', ')}`);
      const message = `Truck is in Brgy ${barangay}, Street: ${closestStreet}`;
      const payload = `batch_sms:${message} (${phoneNumbers.join(',')})`;

      if (mqttClient.connected) {
        mqttClient.publish(MQTT_TOPIC, payload, (err) => {
          if (err) {
            console.error('[MQTT] Failed to publish SMS command:', err);
          } else {
            console.log(`[MQTT] Published to ${MQTT_TOPIC}: ${payload.substring(0, 50)}...`);
          }
        });
      } else {
        console.warn('[MQTT] Client not connected, SMS command dropped.');
      }

    } catch (err) {
      console.error(`[Socket.IO] Error processing SMS for ${barangay}: ${err.message}`);
    }
  });

  socket.on('truck-at-location-trigger-sms', async (data) => { /* ... similar logic as simulator-moved ... */ });

  // Driver Status Listeners
  socket.on('driver:tracking_started', (data) => {
      if (!data || !data.truckId) return;
      console.log(`[Socket.IO] Truck ${data.truckId} started tracking.`);
      app.locals.truckStats[data.truckId] = {
          ...(app.locals.truckStats[data.truckId] || {}),
          statusText: 'Active',
          startTime: Date.now(),
          percentFull: app.locals.truckStats[data.truckId]?.percentFull || 0
      };
      io.emit('truck-status', { truckId: data.truckId, statusText: 'Active', percentFull: app.locals.truckStats[data.truckId].percentFull });
      if (app.locals.truckStats[data.truckId]?.roundTrips !== undefined) {
         io.emit('round-trip', { truckId: data.truckId, count: app.locals.truckStats[data.truckId].roundTrips });
      }
  });

  socket.on('driver:tracking_stopped', (data) => {
      if (!data || !data.truckId) return;
      console.log(`[Socket.IO] Truck ${data.truckId} stopped tracking.`);
       if (app.locals.truckStats[data.truckId]) {
           app.locals.truckStats[data.truckId].statusText = 'Inactive';
           app.locals.truckStats[data.truckId].startTime = null;
       }
      io.emit('truck-status', { truckId: data.truckId, statusText: 'Inactive' });
  });

  // --- THIS IS THE FIX ---
  // Modify this handler to only count trips when percentage goes from >=100 to 0.
  socket.on('driver:load_update', (data) => {
      if (!data || data.truckId === undefined || data.percentFull === undefined) return;
      console.log(`[Socket.IO] Received load update for ${data.truckId}: ${data.percentFull}%`);

      // Get the current stats *before* updating
      const currentStats = app.locals.truckStats[data.truckId] || { roundTrips: 0, statusText: 'Active' };
      const oldPercent = currentStats.percentFull; // Store the old percentage

      // Update the stats object with the new percentage
      app.locals.truckStats[data.truckId] = {
         ...currentStats,
         percentFull: data.percentFull,
         lastLoadUpdate: data.timestamp || Date.now()
      };

      // Emit the new status to all clients
      io.emit('truck-status', { truckId: data.truckId, percentFull: data.percentFull });

      // --- NEW LOGIC ---
      if (data.percentFull >= 100) {
          // Truck is full, just emit the full event
          io.emit('truck-full', { truckId: data.truckId, percentFull: 100 });
      
      } else if (data.percentFull === 0) {
          // This is the "Finished Emptying" signal
          
          // Check if the *previous* state was full (e.g., >= 100)
          // This prevents adding a trip count just for starting at 0
          if (oldPercent >= 100) { 
              app.locals.truckStats[data.truckId].roundTrips = (app.locals.truckStats[data.truckId].roundTrips || 0) + 1;
              io.emit('round-trip', { truckId: data.truckId, count: app.locals.truckStats[data.truckId].roundTrips });
              console.log(`[Stats] Incremented round trips for ${data.truckId} to ${app.locals.truckStats[data.truckId].roundTrips} (on empty)`);
          }
          
          // Reset start time for the new trip
          app.locals.truckStats[data.truckId].startTime = Date.now();
      }
      // --- END NEW LOGIC ---
  });
  // --- END FIX ---

  // Registered Stats Update Trigger
  socket.on('registered-stats-update', async () => {
       console.log('[Socket.IO] Triggering registered stats refresh (event received).');
       try {
          const conn = await dbPool.getConnection();
          const [rows] = await conn.query(
              'SELECT barangay, street, COUNT(*) as count FROM users GROUP BY barangay, street ORDER BY barangay, street'
          );
          conn.release();
          const stats = rows.map(row => ({
              barangay: row.barangay,
              street: row.street || 'Unknown Street',
              count: row.count
          }));
          io.emit('registered-stats', stats);
       } catch (err) {
           console.error('[Socket.IO] Error fetching/emitting updated stats:', err);
       }
  });

  // Schedule Updates
  socket.on('schedule-update', () => {
      console.log('[Socket.IO] schedule-update event received, broadcasting...');
      socket.broadcast.emit('schedule-update');
  });

  // Disconnect
  socket.on('disconnect', () => {
    console.log(`[Socket.IO] Client disconnected: ${socket.id}`);
  });
});
// --- End Socket.IO Handling ---

// --- Start Server ---
server.listen(port, () => {
  console.log(`🚀 Server running at http://localhost:${port}`);
});