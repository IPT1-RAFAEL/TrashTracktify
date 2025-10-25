require('dotenv').config(); // Load .env variables FIRST
const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const fs = require('fs').promises;
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const mqtt = require('mqtt');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});
const port = process.env.PORT || 3000;

// --- MQTT Setup ---
const MQTT_BROKER_URL = process.env.MQTT_BROKER;
const MQTT_TOPIC = 'trashtracktify/sms/send';

if (!MQTT_BROKER_URL) {
    console.error('❌ MQTT_BROKER environment variable not set.');
}
console.log(`[MQTT] Attempting to connect to broker at ${MQTT_BROKER_URL}...`);
const mqttClient = MQTT_BROKER_URL ? mqtt.connect(MQTT_BROKER_URL) : null;

if (mqttClient) {
    mqttClient.on('connect', () => console.log('✅ [MQTT] Connected to broker'));
    mqttClient.on('error', (err) => console.error(`[MQTT] Connection error: ${err.message}`));
    mqttClient.on('close', () => console.log('[MQTT] Disconnected from broker'));
} else {
    console.warn('[MQTT] Client not initialized (MQTT_BROKER URL missing).');
}
// --- End MQTT Setup ---

app.use(cors());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- Database Pool ---
if (!process.env.DB_HOST || !process.env.DB_USER || !process.env.DB_PASSWORD || !process.env.DB_NAME || !process.env.DB_PORT) {
    console.error('❌ Missing one or more required database environment variables.');
    process.exit(1); // Exit if DB config is incomplete
}

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

// Test DB connection on startup
dbPool.getConnection()
  .then(conn => {
    console.log('✅ Connected to MySQL database pool');
    conn.release();
  })
  .catch(err => {
    console.error('❌ Database connection pool failed:', err.message);
    process.exit(1);
  });
// --- End Database Pool ---

let allStreetMarkers = [];

// --- Load Map Data ---
async function loadMapData() {
  try {
    await fs.readFile(path.join(__dirname, 'public/data/polygon.json'));
    const rawStreets = await fs.readFile(path.join(__dirname, 'public/data/streets.json'));
    const streetGroups = JSON.parse(rawStreets);
    allStreetMarkers = [];
    Object.entries(streetGroups).forEach(([barangay, streets]) => {
      streets.forEach(st => {
        if (st.coords?.length === 2 && !isNaN(st.coords[0]) && !isNaN(st.coords[1])) {
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

// GET /users - Fetch registered users
app.get('/users', async (req, res) => {
  let conn;
  try {
    conn = await dbPool.getConnection();
    const [rows] = await conn.query('SELECT id, name, phone, barangay, street FROM users ORDER BY id DESC');
    res.json(rows);
  } catch (err) {
    console.error(`[DB] Error fetching users: ${err.message}`);
    res.status(500).json({ error: 'Failed to fetch users' });
  } finally {
    if (conn) conn.release();
  }
});

// POST /register - Register a new user
app.post('/register', async (req, res) => {
  const { name, phone, barangay, street } = req.body;
  if (!name || !phone || !barangay || !street) return res.status(400).json({ error: 'Missing required fields' });
  if (!['Tugatog', 'Acacia', 'Tinajeros'].includes(barangay)) return res.status(400).json({ error: 'Invalid barangay.' });
  if (!/^09\d{9}$/.test(phone)) return res.status(400).json({ error: 'Invalid phone number format.' });

  let conn;
  try {
    conn = await dbPool.getConnection();
    await conn.query('INSERT INTO users (name, phone, barangay, street) VALUES (?, ?, ?, ?)', [name, phone, barangay, street]);
    io.emit('registered-stats-update'); // Notify clients
    res.json({ message: '✅ Registration successful' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: 'Phone number already registered.' });
    console.error(`[DB] Error registering user: ${err.message}`);
    res.status(500).json({ error: `Failed to register: ${err.message}` });
  } finally {
    if (conn) conn.release();
  }
});

// GET /schedule - Fetch collection schedule
app.get('/schedule', async (req, res) => {
  let conn;
  try {
    conn = await dbPool.getConnection();
    const [rows] = await conn.query('SELECT barangay, day, start_time FROM schedules');
    res.json(rows);
  } catch (err) {
    console.error(`[DB] Error fetching schedule: ${err.message}`);
    res.status(500).json({ error: 'Failed to fetch schedule' });
  } finally {
    if (conn) conn.release();
  }
});

// POST /schedule - Update collection schedule (Admin)
app.post('/schedule', async (req, res) => {
  // TODO: Add admin authentication middleware here
  const { barangay, day, start_time, updated_by } = req.body;
  if (!barangay || !day || !start_time) return res.status(400).json({ error: 'Missing fields' });
  if (!['Tugatog', 'Acacia', 'Tinajeros'].includes(barangay)) return res.status(400).json({ error: 'Invalid barangay' });
  if (!['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'].includes(day)) return res.status(400).json({ error: 'Invalid day' });
  if (!/^\d{2}:\d{2}:\d{2}$/.test(start_time)) return res.status(400).json({ error: 'Invalid time format (HH:MM:SS)' });

  let conn;
  try {
    conn = await dbPool.getConnection();
    await conn.query('INSERT INTO schedules (barangay, day, start_time, updated_by) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE start_time = VALUES(start_time), updated_by = VALUES(updated_by)', [barangay, day, start_time, updated_by || 'admin']);
    io.emit('schedule-update'); // Notify clients
    res.json({ message: '✅ Schedule updated' });
  } catch (err) {
    console.error(`[DB] Error updating schedule: ${err.message}`);
    res.status(500).json({ error: `Failed to update schedule: ${err.message}` });
  } finally {
    if (conn) conn.release();
  }
});

// POST /admin-register (Example - Keep if needed)
app.post('/admin-register', async (req, res) => {
  // Implement admin registration logic if required
  res.status(501).json({ error: 'Not Implemented' });
});

// POST /admin-login (Example - Keep if needed)
app.post('/admin-login', async (req, res) => {
  // Implement admin login logic if required
  res.status(501).json({ error: 'Not Implemented' });
});

// GET /eta/:truckId - Calculate estimated time of arrival (basic)
app.get('/eta/:truckId', async (req, res) => {
  const { truckId } = req.params;
  try {
    const lastKnown = app.locals.lastKnownLocations?.[truckId];
    if (!lastKnown?.latitude || !lastKnown?.longitude) {
      return res.status(404).json({ etaMinutes: -1, nextStop: 'Unknown', error: 'No location data' });
    }
    const { latitude, longitude } = lastKnown;
    if (!allStreetMarkers || allStreetMarkers.length === 0) {
      return res.status(500).json({ etaMinutes: -1, nextStop: 'Unknown', error: 'Street markers not loaded' });
    }
    let minDistance = Infinity;
    let nextStop = null;
    allStreetMarkers.forEach(street => {
      const distance = Math.sqrt(Math.pow(latitude - street.coords[0], 2) + Math.pow(longitude - street.coords[1], 2));
      if (distance < minDistance) { minDistance = distance; nextStop = street.name; }
    });
    const etaMinutes = minDistance < 0.000135 ? 0 : Math.round(minDistance * 10000);
    res.json({ etaMinutes, nextStop });
  } catch (err) {
    console.error(`[ETA] Error for ${truckId}: ${err.message}`);
    res.status(500).json({ error: `Failed to calculate ETA: ${err.message}` });
  }
});

// GET /stats/registered - Get user counts per street
app.get('/stats/registered', async (req, res) => {
  let conn;
  try {
    conn = await dbPool.getConnection();
    const [rows] = await conn.query('SELECT barangay, street, COUNT(*) as count FROM users GROUP BY barangay, street ORDER BY barangay, street');
    res.json(rows.map(row => ({ ...row, street: row.street || 'N/A' })));
  } catch (err) {
    console.error(`[DB] Error fetching registered stats: ${err.message}`);
    res.status(500).json({ error: 'Failed to fetch statistics' });
  } finally {
    if (conn) conn.release();
  }
});

// POST /driver-register - Register a new driver
app.post('/driver-register', async (req, res) => {
  const { regName: name, regPhone: phone, regBarangay: barangay, regPassword: password } = req.body;
  if (!name || !phone || !barangay || !password) return res.status(400).json({ error: 'Missing fields' });
  if (!/^09\d{9}$/.test(phone)) return res.status(400).json({ error: 'Invalid phone format.' });
  if (!['Tugatog', 'Acacia', 'Tinajeros'].includes(barangay)) return res.status(400).json({ error: 'Invalid barangay.' });
  if (password.length < 6) return res.status(400).json({ error: 'Password too short.' });

  let conn;
  try {
    conn = await dbPool.getConnection();
    const [existing] = await conn.query('SELECT driver_id FROM drivers WHERE phone = ?', [phone]);
    if (existing.length > 0) return res.status(400).json({ error: 'Phone number already registered.' });
    const password_hash = await bcrypt.hash(password, 10);
    await conn.query('INSERT INTO drivers (name, phone, barangay, password_hash) VALUES (?, ?, ?, ?)', [name, phone, barangay, password_hash]);
    res.status(201).json({ message: '✅ Driver registration successful!' });
  } catch (err) {
    console.error(`[DB] Error registering driver: ${err.message}`);
    res.status(500).json({ error: `Driver registration failed: ${err.message}` });
  } finally {
    if (conn) conn.release();
  }
});

// POST /driver-login - Log in a driver
app.post('/driver-login', async (req, res) => {
  const { driverName: name, driverPassword: password } = req.body;
  if (!name || !password) return res.status(400).json({ error: 'Missing name or password' });

  let conn;
  try {
    conn = await dbPool.getConnection();
    const [rows] = await conn.query('SELECT driver_id, name, phone, barangay, password_hash, assigned_truck_id FROM drivers WHERE name = ?', [name]);
    if (rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });
    const driver = rows[0];
    const isMatch = await bcrypt.compare(password, driver.password_hash);
    if (!isMatch) return res.status(401).json({ error: 'Invalid credentials' });
    res.json({
      message: '✅ Login successful!',
      driver: { id: driver.driver_id, name: driver.name, phone: driver.phone, barangay: driver.barangay, truckId: driver.assigned_truck_id || `Driver-Truck-${driver.driver_id}` }
    });
  } catch (err) {
    console.error(`[DB] Error during driver login: ${err.message}`);
    res.status(500).json({ error: `Login failed: ${err.message}` });
  } finally {
    if (conn) conn.release();
  }
});

// POST /forgot-password - Handle driver password reset request
app.post('/forgot-password', async (req, res) => {
  const { resetPhone: phone } = req.body;
  if (!phone || !/^09\d{9}$/.test(phone)) return res.status(400).json({ error: 'Valid phone required.' });

  let conn;
  try {
    conn = await dbPool.getConnection();
    const [drivers] = await conn.query('SELECT driver_id, name FROM drivers WHERE phone = ?', [phone]);
    if (drivers.length === 0) {
      // Don't reveal if phone exists - security best practice
      return res.json({ message: 'If account exists, instructions sent.' });
    }
    const driver = drivers[0];
    const token = crypto.randomBytes(32).toString('hex');
    const expiryMinutes = 30;
    const expiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000);
    await conn.query('INSERT INTO password_resets (driver_id, token, expires_at) VALUES (?, ?, ?)', [driver.driver_id, token, expiresAt]);
    conn.release(); // Release early

    const resetUrl = `${req.protocol}://${req.get('host')}/reset-password?token=${token}`; // Use request host
    const smsMessage = `Hi ${driver.name}, reset TrashTracktify password (expires ${expiryMinutes} min): ${resetUrl}`;
    const formattedPhone = `+63${phone.slice(1)}`;
    const mqttPayload = `batch_sms:${smsMessage} (${formattedPhone})`;

    if (mqttClient?.connected) {
      mqttClient.publish(MQTT_TOPIC, mqttPayload, (err) => {
        if (err) console.error('[MQTT] Failed publish password reset:', err);
        else console.log(`[MQTT] Published password reset SMS command for ${phone}`);
      });
    } else console.warn('[MQTT] Client not connected, password reset SMS dropped.');
    res.json({ message: 'If account exists, instructions sent.' }); // Generic success
  } catch (err) {
    if (conn) conn.release();
    console.error(`[DB] Error processing forgot password: ${err.message}`);
    res.status(500).json({ error: 'Failed to process request.' });
  }
});

// GET /reset-password - Serve page to enter new password
app.get('/reset-password', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).send('Invalid/missing token.');

  let conn;
  try {
    conn = await dbPool.getConnection();
    const [resets] = await conn.query('SELECT driver_id FROM password_resets WHERE token = ? AND expires_at > NOW()', [token]);
    if (resets.length === 0) return res.status(400).send('Invalid/expired token.');
    // Token is valid, serve the page
    res.sendFile(path.join(__dirname, 'public', 'reset-password.html'));
  } catch (err) {
    console.error(`[DB] Error verifying reset token: ${err.message}`);
    res.status(500).send('Error verifying token.');
  } finally {
    if (conn) conn.release();
  }
});

// POST /reset-password - Update the password in the database
app.post('/reset-password', async (req, res) => {
  const { token, newPassword, confirmPassword } = req.body;
  if (!token || !newPassword || !confirmPassword) return res.status(400).json({ error: 'Missing fields.' });
  if (newPassword !== confirmPassword) return res.status(400).json({ error: 'Passwords do not match.' });
  if (newPassword.length < 6) return res.status(400).json({ error: 'Password too short.' });

  let conn;
  try {
    conn = await dbPool.getConnection();
    await conn.beginTransaction();
    const [resets] = await conn.query('SELECT driver_id FROM password_resets WHERE token = ? AND expires_at > NOW()', [token]);
    if (resets.length === 0) { await conn.rollback(); return res.status(400).json({ error: 'Invalid/expired token.' }); }
    const driverId = resets[0].driver_id;
    const newPasswordHash = await bcrypt.hash(newPassword, 10);
    await conn.query('UPDATE drivers SET password_hash = ? WHERE driver_id = ?', [newPasswordHash, driverId]);
    await conn.query('DELETE FROM password_resets WHERE token = ?', [token]); // Invalidate token
    await conn.commit();
    res.json({ message: 'Password reset successful! You can now log in.' });
  } catch (err) {
    if (conn) await conn.rollback();
    console.error(`[DB] Error resetting password: ${err.message}`);
    res.status(500).json({ error: 'Failed to reset password.' });
  } finally {
    if (conn) conn.release();
  }
});
// --- End API Routes ---


// --- Socket.IO Handling ---
app.locals.truckStats = {}; // Store truck status/stats in memory
app.locals.lastKnownLocations = {}; // Store last known locations

io.on('connection', (socket) => {
  // socket.id used for simple tracking, not reliable across disconnects
  // console.log(`🟢 Client connected: ${socket.id}`);

  // Location Updates from drivers/simulators
  socket.on('update-location', (data) => {
    const { latitude, longitude, truckId, source } = data;
    // Basic validation
    if (latitude == null || longitude == null || !truckId) {
      // console.warn(`[Socket.IO] Invalid location data received.`);
      return;
    }
    app.locals.lastKnownLocations[truckId] = { latitude, longitude, source, timestamp: Date.now() };
    // Broadcast location to all OTHER clients
    socket.broadcast.emit('location-update', data);
  });

  // SMS Trigger Logic (simplified example, depends on external MQTT listener)
  socket.on('truck-at-location-trigger-sms', async (data) => {
    const { barangay, street, truckId, lat, lon } = data;
    if (!barangay) {
        // console.warn('[SMS] Missing barangay for SMS trigger.');
        return;
    }
    let conn;
    try {
        conn = await dbPool.getConnection();
        // Find users in the specified barangay (and optionally street)
        // Adjust query as needed for street matching logic
        const [users] = await conn.query('SELECT phone FROM users WHERE barangay = ?', [barangay]);
        const phoneNumbers = users
            .map(u => u.phone)
            .filter(p => /^09\d{9}$/.test(p)) // Validate format
            .map(p => `+63${p.slice(1)}`); // Format for gateway

        if (phoneNumbers.length === 0) {
            // console.log(`[SMS] No valid recipients found for ${barangay}.`);
            return;
        }

        const locationInfo = street ? `Street: ${street}` : `nearby area (Lat: ${lat?.toFixed(4)}, Lon: ${lon?.toFixed(4)})`;
        const message = `TrashTracktify Alert: Truck ${truckId || ''} is in Brgy ${barangay}, ${locationInfo}.`;
        const mqttPayload = `batch_sms:${message} (${phoneNumbers.join(',')})`;

        if (mqttClient?.connected) {
            mqttClient.publish(MQTT_TOPIC, mqttPayload, (err) => {
                if (err) console.error('[MQTT] Failed publish SMS command:', err);
                // else console.log(`[MQTT] Published SMS command for ${barangay}`);
            });
        } else {
            console.warn('[MQTT] Client not connected, SMS command dropped.');
        }

    } catch (err) {
        console.error(`[SMS] Error processing SMS trigger for ${barangay}: ${err.message}`);
    } finally {
        if (conn) conn.release();
    }
  });


  // Driver Status Updates
  socket.on('driver:tracking_started', (data) => {
    if (!data?.truckId) return;
    const truckId = data.truckId;
    app.locals.truckStats[truckId] = {
        ...(app.locals.truckStats[truckId] || { roundTrips: 0 }),
        statusText: 'Active',
        startTime: Date.now(),
        percentFull: app.locals.truckStats[truckId]?.percentFull || 0 // Persist percentFull
    };
    io.emit('truck-status', { truckId, statusText: 'Active', percentFull: app.locals.truckStats[truckId].percentFull });
    // Emit current trip count if known
    if (app.locals.truckStats[truckId]?.roundTrips !== undefined) {
       io.emit('round-trip', { truckId, count: app.locals.truckStats[truckId].roundTrips });
    }
  });

  socket.on('driver:tracking_stopped', (data) => {
    if (!data?.truckId) return;
    const truckId = data.truckId;
    if (app.locals.truckStats[truckId]) {
        app.locals.truckStats[truckId].statusText = 'Inactive';
        app.locals.truckStats[truckId].startTime = null; // Clear start time
    }
    io.emit('truck-status', { truckId, statusText: 'Inactive' });
  });

  socket.on('driver:load_update', (data) => {
    if (data?.truckId === undefined || data?.percentFull === undefined) return;
    const { truckId, percentFull, timestamp } = data;
    const currentStats = app.locals.truckStats[truckId] || { roundTrips: 0, statusText: 'Active' };
    const oldPercent = currentStats.percentFull;

    app.locals.truckStats[truckId] = {
        ...currentStats,
        percentFull: percentFull,
        lastLoadUpdate: timestamp || Date.now()
    };
    io.emit('truck-status', { truckId, percentFull });

    // Trip counting logic
    if (percentFull >= 100) {
        io.emit('truck-full', { truckId, percentFull: 100 });
    } else if (percentFull === 0 && oldPercent >= 100) { // Count trip when going from full to empty
        app.locals.truckStats[truckId].roundTrips = (currentStats.roundTrips || 0) + 1;
        io.emit('round-trip', { truckId, count: app.locals.truckStats[truckId].roundTrips });
        console.log(`[Stats] Trip count ${truckId}: ${app.locals.truckStats[truckId].roundTrips}`);
        app.locals.truckStats[truckId].startTime = Date.now(); // Reset timer for next trip
    }
  });

  // Registered Stats Update Trigger (e.g., after successful registration)
  socket.on('registered-stats-update', async () => {
     let conn;
     try {
        conn = await dbPool.getConnection();
        const [rows] = await conn.query('SELECT barangay, street, COUNT(*) as count FROM users GROUP BY barangay, street ORDER BY barangay, street');
        io.emit('registered-stats', rows.map(r => ({ ...r, street: r.street || 'N/A' })));
     } catch (err) {
         console.error('[Socket.IO] Error fetching/emitting updated stats:', err.message);
     } finally {
        if (conn) conn.release();
     }
  });

  // Schedule Updates Trigger (e.g., after successful schedule save)
  socket.on('schedule-update', () => {
      // Broadcast to all clients except the sender (if needed, otherwise io.emit)
      socket.broadcast.emit('schedule-update');
  });

  // Disconnect Handler
  socket.on('disconnect', () => {
    // console.log(`Client disconnected: ${socket.id}`);
  });
});
// --- End Socket.IO Handling ---

// --- Start Server ---
server.listen(port, () => {
  console.log(`🚀 Server running at http://localhost:${port}`);
});

