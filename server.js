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

if (!MQTT_BROKER_URL) console.error('❌ MQTT_BROKER environment variable not set.');
console.log(`[MQTT] Attempting to connect to broker at ${MQTT_BROKER_URL}...`);
const mqttClient = MQTT_BROKER_URL ? mqtt.connect(MQTT_BROKER_URL) : null;
if (mqttClient) {
  mqttClient.on('connect', () => console.log('✅ [MQTT] Connected'));
  mqttClient.on('error', (err) => console.error(`[MQTT] Error: ${err.message}`));
  mqttClient.on('close', () => console.log('[MQTT] Disconnected'));
} else console.warn('[MQTT] Client not initialized.');
// --- End MQTT Setup ---

app.use(cors());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- Database Pool ---
if (!process.env.DB_HOST || !process.env.DB_USER || !process.env.DB_PASSWORD || !process.env.DB_NAME || !process.env.DB_PORT) {
  console.error('❌ Missing required database environment variables.'); process.exit(1);
}
const dbPool = mysql.createPool({
  connectionLimit: 10, host: process.env.DB_HOST, user: process.env.DB_USER,
  password: process.env.DB_PASSWORD, database: process.env.DB_NAME, port: process.env.DB_PORT,
  waitForConnections: true, queueLimit: 0
});
dbPool.getConnection().then(conn => { console.log('✅ DB Pool Connected'); conn.release(); }).catch(err => { console.error('❌ DB Pool Failed:', err.message); process.exit(1); });
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

// *** MODIFIED ENDPOINT ***
// POST /schedule - Update schedule AND log the change
app.post('/schedule', async (req, res) => {
    const { barangay, day, start_time, updated_by } = req.body;
    if (!barangay || !day || !start_time || !/^\d{2}:\d{2}:\d{2}$/.test(start_time)) return res.status(400).json({ error: 'Invalid input' });
    if (!['Tugatog', 'Acacia', 'Tinajeros'].includes(barangay)) return res.status(400).json({ error: 'Invalid barangay' });
    if (!['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'].includes(day)) return res.status(400).json({ error: 'Invalid day' });

    let conn;
    try {
        conn = await dbPool.getConnection();
        await conn.beginTransaction();

        // 1. Update the main schedule
        await conn.query(
            'INSERT INTO schedules (barangay, day, start_time, updated_by) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE start_time = VALUES(start_time), updated_by = VALUES(updated_by)',
            [barangay, day, start_time, updated_by || 'admin']
        );

        // 2. Log this change to the calendar_events table for today's date
        const todayDate = new Date().toISOString().split('T')[0];
        const logDescription = `Schedule changed: ${barangay} ${day} to ${start_time.slice(0, 5)} by ${updated_by || 'admin'}`;
        
        // Use REPLACE to add/overwrite any event for *today*
        await conn.query(
            'REPLACE INTO calendar_events (event_date, event_type, description) VALUES (?, ?, ?)',
            [todayDate, 'TIME_LOG', logDescription]
        );

        await conn.commit();

        io.emit('schedule-update'); 
        io.emit('calendar-update'); 
        
        res.json({ message: '✅ Schedule updated and change logged' });

    } catch (err) {
        if (conn) await conn.rollback();
        console.error(`[DB] Error updating schedule/logging: ${err.message}`);
        res.status(500).json({ error: `Failed to update schedule: ${err.message}` });
    } finally {
        if (conn) conn.release();
    }
});

// Calculate ETA
app.get('/eta/:truckId', async (req, res) => {
    const { truckId } = req.params;
    try {
        const lastKnown = app.locals.lastKnownLocations?.[truckId];
        if (!lastKnown?.latitude || !lastKnown?.longitude) return res.status(404).json({ error: 'No location data' });
        const { latitude, longitude } = lastKnown;
        if (!allStreetMarkers || allStreetMarkers.length === 0) return res.status(500).json({ error: 'Street markers not loaded' });

        let minDistance = Infinity; let nextStop = null;
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

// Get user counts per street
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

// Get latest truck capacity
app.get('/stats/current-capacity', (req, res) => {
    const stats = app.locals.truckStats || {};
    let latestPercent = 0;
    let latestTime = 0;
    
    // Find the most recently updated truck's capacity
    Object.values(stats).forEach(truck => {
        if (truck.lastLoadUpdate && truck.lastLoadUpdate > latestTime) {
            latestTime = truck.lastLoadUpdate;
            latestPercent = truck.percentFull || 0;
        }
    });
    
    res.json({ percentFull: latestPercent });
});

// Get total round trips
app.get('/stats/round-trips', (req, res) => {
    const stats = app.locals.truckStats || {};
    let totalTrips = 0;
    
    // Sum up trips from all trucks
    Object.values(stats).forEach(truck => {
        totalTrips += (truck.roundTrips || 0);
    });
    
    res.json({ count: totalTrips });
});

// Register a new driver
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
        if (existing.length > 0) return res.status(400).json({ error: 'Phone already registered.' });
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

app.post('/driver-login', async (req, res) => {
  const { driverName: name, driverPassword: password } = req.body;
  if (!name || !password) return res.status(400).json({ error: 'Missing name or password' });
  let conn;
  try {
    conn = await dbPool.getConnection();
    const [rows] = await conn.query(
      'SELECT driver_id, name, phone, barangay, password_hash, assigned_truck_id FROM drivers WHERE name = ?',
      [name]
    );
    console.log(`[DEBUG] Login query for name ${name}: ${rows.length} rows found`);
    if (rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });
    const driver = rows[0];
    console.log(`[DEBUG] Retrieved driver_id: ${driver.driver_id}, password_hash: ${driver.password_hash.substring(0, 20)}...`); // Partial hash for security
    const isMatch = await bcrypt.compare(password, driver.password_hash);
    console.log(`[DEBUG] Password match result for ${name}: ${isMatch}`);
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

// POST /admin-register - Register a new admin
app.post('/admin-register', async (req, res) => {
    const { regName: name, regPhone: phone, regPassword: password } = req.body;
    if (!name || !phone || !password) return res.status(400).json({ error: 'Missing fields' });
    if (!/^09\d{9}$/.test(phone)) return res.status(400).json({ error: 'Invalid phone format.' });
    if (password.length < 6) return res.status(400).json({ error: 'Password too short.' });
    
    let conn;
    try {
        conn = await dbPool.getConnection();
        const [existing] = await conn.query('SELECT admin_id FROM admins WHERE phone = ? OR name = ?', [phone, name]);
        if (existing.length > 0) return res.status(400).json({ error: 'Name or phone already registered.' });
        
        const password_hash = await bcrypt.hash(password, 10);
        await conn.query('INSERT INTO admins (name, phone, password_hash) VALUES (?, ?, ?)', [name, phone, password_hash]);
        res.status(201).json({ message: '✅ Admin registration successful!' });
    } catch (err) {
        console.error(`[DB] Error registering admin: ${err.message}`);
        res.status(500).json({ error: `Admin registration failed: ${err.message}` });
    } finally {
        if (conn) conn.release();
    }
});

// POST /admin-login - Log in an admin
app.post('/admin-login', async (req, res) => {
    const { adminName: name, adminPassword: password } = req.body;
    if (!name || !password) return res.status(400).json({ error: 'Missing name or password' });
    
    let conn;
    try {
        conn = await dbPool.getConnection();
        const [rows] = await conn.query('SELECT admin_id, name, password_hash FROM admins WHERE name = ?', [name]);
        if (rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });
        
        const admin = rows[0];
        const isMatch = await bcrypt.compare(password, admin.password_hash);
        if (!isMatch) return res.status(401).json({ error: 'Invalid credentials' });
        
        res.json({
            message: '✅ Admin login successful!',
            admin: { id: admin.admin_id, name: admin.name }
        });
    } catch (err) {
        console.error(`[DB] Error during admin login: ${err.message}`);
        res.status(500).json({ error: `Login failed: ${err.message}` });
    } finally {
        if (conn) conn.release();
    }
});

// --- OTP PASSWORD RESET FLOW ---

// POST /forgot-password - Handle reset request (OTP VERSION)
app.post('/forgot-password', async (req, res) => {
  const { resetPhone: phone } = req.body;
  if (!phone || !/^09\d{9}$/.test(phone)) return res.status(400).json({ error: 'Valid phone required.' });

  let conn;
  try {
    conn = await dbPool.getConnection();
    const [drivers] = await conn.query('SELECT driver_id, name FROM drivers WHERE phone = ?', [phone]);
    if (drivers.length === 0) {
      // Don't reveal if phone exists
      return res.json({ message: 'If account exists, instructions sent.' });
    }
    const driver = drivers[0];
    
    // Generate 6-digit code
    const token = Math.floor(100000 + Math.random() * 900000).toString();
    console.log(`[DEBUG] Generated OTP for phone ${phone}: ${token}`); 

    const expiryMinutes = 10; // Shorter expiry for OTP
    const expiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000);

    await conn.query('DELETE FROM password_resets WHERE driver_id = ?', [driver.driver_id]);
    await conn.query(
        'INSERT INTO password_resets (driver_id, token, expires_at) VALUES (?, ?, ?)', 
        [driver.driver_id, token, expiresAt]
    );
    conn.release(); // Release early

    // Change SMS message (no URL)
    const smsMessage = `Your TrashTracktify password reset code is: ${token}. It expires in ${expiryMinutes} minutes.`;
    const formattedPhone = `+63${phone.slice(1)}`;
    const mqttPayload = `batch_sms:${smsMessage} (${formattedPhone})`;

    if (mqttClient?.connected) {
      mqttClient.publish(MQTT_TOPIC, mqttPayload, (err) => {
        if (err) console.error('[MQTT] Failed publish password reset:', err);
        else console.log(`[MQTT] Published password reset SMS (OTP) for ${phone}`);
      });
    } else console.warn('[MQTT] Client not connected, password reset SMS dropped.');
    
    res.json({ message: 'Reset code sent to your phone.' }); 

  } catch (err) {
    if (conn) conn.release();
    console.error(`[DB] Error processing forgot password: ${err.message}`);
    res.status(500).json({ error: 'Failed to process request.' });
  }
});

// POST /admin-forgot-password - Handle admin reset request (OTP VERSION)
app.post('/admin-forgot-password', async (req, res) => {
  const { resetPhone: phone } = req.body;
  if (!phone || !/^09\d{9}$/.test(phone)) return res.status(400).json({ error: 'Valid phone required.' });

  let conn;
  try {
    conn = await dbPool.getConnection();
    const [admins] = await conn.query('SELECT admin_id, name FROM admins WHERE phone = ?', [phone]);
    if (admins.length === 0) {
      // Don't reveal if phone exists
      return res.json({ message: 'If account exists, instructions sent.' });
    }
    const admin = admins[0];
    
    // Generate 6-digit code
    const token = Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit code
    console.log(`[DEBUG] Generated OTP for admin phone ${phone}: ${token}`);

    const expiryMinutes = 10; // Shorter expiry for OTP
    const expiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000);

    // Delete any existing reset tokens for this admin
    await conn.query('DELETE FROM password_resets WHERE admin_id = ?', [admin.admin_id]);
    // Insert new reset token with user_type = 'ADMIN'
    await conn.query(
        'INSERT INTO password_resets (admin_id, token, expires_at, user_type) VALUES (?, ?, ?, ?)', 
        [admin.admin_id, token, expiresAt, 'ADMIN']
    );
    conn.release(); // Release early

    // Send SMS with OTP
    const smsMessage = `Your TrashTracktify admin password reset code is: ${token}. It expires in ${expiryMinutes} minutes.`;
    const formattedPhone = `+63${phone.slice(1)}`;
    const mqttPayload = `batch_sms:${smsMessage} (${formattedPhone})`;

    if (mqttClient?.connected) {
      mqttClient.publish(MQTT_TOPIC, mqttPayload, (err) => {
        if (err) console.error('[MQTT] Failed publish admin password reset:', err);
        else console.log(`[MQTT] Published admin password reset SMS (OTP) for ${phone}`);
      });
    } else console.warn('[MQTT] Client not connected, admin password reset SMS dropped.');
    
    res.json({ message: 'Reset code sent to your phone.' }); 

  } catch (err) {
    if (conn) conn.release();
    console.error(`[DB] Error processing admin forgot password: ${err.message}`);
    res.status(500).json({ error: 'Failed to process request.' });
  }
});

// GET /reset-password - No longer needed with OTP flow
app.get('/reset-password', (req, res) => {  
  res.status(404).send('Invalid page. Please use the driver app to reset your password.');
});

app.post('/reset-password', async (req, res) => {
  const { phone, token, newPassword, confirmPassword } = req.body;
  if (!phone || !token || !newPassword || !confirmPassword) return res.status(400).json({ error: 'Missing fields.' });
  if (newPassword !== confirmPassword) return res.status(400).json({ error: 'Passwords do not match.' });
  if (newPassword.length < 6) return res.status(400).json({ error: 'Password too short.' });
  if (!/^\d{6}$/.test(token)) return res.status(400).json({ error: 'Invalid code format.' });
  if (!/^09\d{9}$/.test(phone)) return res.status(400).json({ error: 'Invalid phone format.' });

  let conn;
  try {
    conn = await dbPool.getConnection();
    await conn.beginTransaction();

    // Find and lock the driver row to prevent concurrent changes
    const [drivers] = await conn.query('SELECT driver_id FROM drivers WHERE phone = ? FOR UPDATE', [phone]);
    if (drivers.length === 0) {
      await conn.rollback();
      return res.status(400).json({ error: 'Invalid phone or code.' });
    }
    if (drivers.length > 1) {
      await conn.rollback();
      console.error(`[DB] Multiple drivers found for phone ${phone} - phone should be unique!`);
      return res.status(500).json({ error: 'Internal error: Duplicate phone entries.' });
    }
    const driverId = drivers[0].driver_id;
    console.log(`[DEBUG] Found and locked driver_id: ${driverId} for phone: ${phone}`);

    // Check if the code is valid
    const [resets] = await conn.query(
      'SELECT driver_id FROM password_resets WHERE driver_id = ? AND token = ? AND expires_at > NOW()',
      [driverId, token]
    );
    if (resets.length === 0) {
      await conn.rollback();
      return res.status(400).json({ error: 'Invalid or expired code.' });
    }

    // Update password and check if it actually affected a row
    const newPasswordHash = await bcrypt.hash(newPassword, 10);
    console.log(`[DEBUG] Generated new password hash for driver_id: ${driverId}`);
    const [updateResult] = await conn.query(
      'UPDATE drivers SET password_hash = ? WHERE driver_id = ?',
      [newPasswordHash, driverId]
    );
    console.log(`[DEBUG] Update result: affectedRows=${updateResult.affectedRows}`);

    if (updateResult.affectedRows === 0) {
      await conn.rollback();
      console.error(`[DB] Password update failed: 0 rows affected for driver_id ${driverId} (possible concurrency issue or mismatch)`);
      return res.status(500).json({ error: 'Failed to update password: No changes applied.' });
    }

    // Delete used token
    await conn.query('DELETE FROM password_resets WHERE driver_id = ? AND token = ?', [driverId, token]);
    console.log(`[DEBUG] Deleted password reset token for driver_id: ${driverId}`);

    await conn.commit();
    console.log(`[DEBUG] Transaction committed for password reset of driver_id: ${driverId}`);
    res.json({ message: 'Password reset successful! You can now log in.' });
  } catch (err) {
    if (conn) await conn.rollback();
    console.error(`[DB] Error resetting password: ${err.message}`);
    res.status(500).json({ error: 'Failed to reset password.' });
  } finally {
    if (conn) conn.release();
  }
});

// POST /admin-reset-password - Reset admin password with OTP
app.post('/admin-reset-password', async (req, res) => {
  const { phone, token, newPassword, confirmPassword } = req.body;
  if (!phone || !token || !newPassword || !confirmPassword) return res.status(400).json({ error: 'Missing fields.' });
  if (newPassword !== confirmPassword) return res.status(400).json({ error: 'Passwords do not match.' });
  if (newPassword.length < 6) return res.status(400).json({ error: 'Password too short.' });
  if (!/^\d{6}$/.test(token)) return res.status(400).json({ error: 'Invalid code format.' });
  if (!/^09\d{9}$/.test(phone)) return res.status(400).json({ error: 'Invalid phone format.' });

  let conn;
  try {
    conn = await dbPool.getConnection();
    await conn.beginTransaction();

    // Find and lock the admin row to prevent concurrent changes
    const [admins] = await conn.query('SELECT admin_id FROM admins WHERE phone = ? FOR UPDATE', [phone]);
    if (admins.length === 0) {
      await conn.rollback();
      return res.status(400).json({ error: 'Invalid phone or code.' });
    }
    if (admins.length > 1) {
      await conn.rollback();
      console.error(`[DB] Multiple admins found for phone ${phone} - phone should be unique!`);
      return res.status(500).json({ error: 'Internal error: Duplicate phone entries.' });
    }
    const adminId = admins[0].admin_id;
    console.log(`[DEBUG] Found and locked admin_id: ${adminId} for phone: ${phone}`);

    // Check if the code is valid
    const [resets] = await conn.query(
      'SELECT admin_id FROM password_resets WHERE admin_id = ? AND token = ? AND expires_at > NOW() AND user_type = ?',
      [adminId, token, 'ADMIN']
    );
    if (resets.length === 0) {
      await conn.rollback();
      return res.status(400).json({ error: 'Invalid or expired code.' });
    }

    // Update password
    const newPasswordHash = await bcrypt.hash(newPassword, 10);
    console.log(`[DEBUG] Generated new password hash for admin_id: ${adminId}`);
    const [updateResult] = await conn.query(
      'UPDATE admins SET password_hash = ? WHERE admin_id = ?',
      [newPasswordHash, adminId]
    );
    console.log(`[DEBUG] Update result: affectedRows=${updateResult.affectedRows}`);

    if (updateResult.affectedRows === 0) {
      await conn.rollback();
      console.error(`[DB] Password update failed: 0 rows affected for admin_id ${adminId}`);
      return res.status(500).json({ error: 'Failed to update password: No changes applied.' });
    }

    // Delete used token
    await conn.query('DELETE FROM password_resets WHERE admin_id = ? AND token = ? AND user_type = ?', [adminId, token, 'ADMIN']);
    console.log(`[DEBUG] Deleted password reset token for admin_id: ${adminId}`);

    await conn.commit();
    console.log(`[DEBUG] Transaction committed for password reset of admin_id: ${adminId}`);
    res.json({ message: 'Password reset successful! You can now log in.' });
  } catch (err) {
    if (conn) await conn.rollback();
    console.error(`[DB] Error resetting admin password: ${err.message}`);
    res.status(500).json({ error: 'Failed to reset password.' });
  } finally {
    if (conn) conn.release();
  }
});

// --- END OTP FLOW ---


// --- Calendar Event API Endpoints ---

// GET /calendar/events - Fetch events
app.get('/calendar/events', async (req, res) => {
    let conn;
    try {
        conn = await dbPool.getConnection();
        
        // Use DATE_FORMAT to force MySQL to return a 'YYYY-MM-DD' string
        // This avoids all JavaScript Date object and timezone conversion issues.
        const [events] = await conn.query(
            "SELECT DATE_FORMAT(event_date, '%Y-%m-%d') AS event_date, event_type, description FROM calendar_events ORDER BY event_date ASC"
        );
        
        // The data is already perfectly formatted, so just send it.
        res.json(events);

    } catch (err) {
        console.error(`[DB] Error fetching calendar events: ${err.message}`);
        res.status(500).json({ error: 'Failed to fetch calendar events' });
    } finally {
        if (conn) conn.release();
    }
});

// --- End API Routes ---


// --- Socket.IO Handling ---
app.locals.truckStats = {};
app.locals.lastKnownLocations = {};
io.on('connection', (socket) => {

    socket.on('update-location', (data) => {
        const { latitude, longitude, truckId, source } = data;
        if (latitude == null || longitude == null || !truckId) return;
        app.locals.lastKnownLocations[truckId] = { latitude, longitude, source, timestamp: Date.now() };
        socket.broadcast.emit('location-update', data);
    });

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
    
    socket.on('schedule-update', () => socket.broadcast.emit('schedule-update'));
    

    socket.on('disconnect', () => {});
});
// --- End Socket.IO Handling ---

server.listen(port, () => {
    console.log(`🚀 Server running on port ${port}`); // Use actual port
});