// Modified index.js with Socket.IO emit added for location updates

const socket = io("https://trashtracktify.onrender.com");
const map = L.map('map').setView([14.667, 120.967], 15);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

const truckIcon = L.icon({
  iconUrl: 'truck.png',
  iconSize: [32, 32],
  iconAnchor: [16, 32],
  popupAnchor: [0, -32]
});

// Draggable marker - start outside geofence
const marker = L.marker([0, 0], { icon: truckIcon }).addTo(map);

// Define multiple polygons (geofences)
const polygons = [
  {
    name: "Tugatog",
    color: "green",
    coords: [
      [14.667871, 120.964536], [14.666513, 120.965168], [14.666122, 120.964999], [14.664592, 120.964911],
      [14.663411, 120.965118], [14.662579, 120.966265], [14.660938, 120.966458],
      [14.659740909279662, 120.96661735582619], [14.659641, 120.967963],
      [14.660064, 120.969569], [14.662041, 120.972947], [14.66285210360636, 120.97304574338634], [14.667255440496355, 120.9727049132521],
      [14.667162, 120.972561], [14.666428, 120.970429], [14.666855, 120.969847], [14.666429, 120.968604],
      [14.666396, 120.967794], [14.667825, 120.967165], [14.667449, 120.965986], [14.667449, 120.965986], [14.668056, 120.965745]
    ]
  },
  {
    name: "Acacia",
    color: "blue",
    coords: [
      [14.668071, 120.965749], [14.667449, 120.965986], [14.667825, 120.967165], [14.666396, 120.967794],
      [14.666429, 120.968604], [14.666855, 120.969847], [14.666428, 120.970429], [14.667255440496355, 120.9727049132521],
      [14.670432, 120.972290], [14.668071, 120.965749]
    ]
  },
  {
    name: "Tinajeros",
    color: "red",
    coords: [
      [14.667972, 120.964049], [14.667887, 120.964860], [14.668071, 120.965749], [14.670432, 120.972290],
      [14.677715, 120.971895], [14.678770, 120.969644], [14.679010, 120.968854], [14.678903, 120.968223],
      [14.677966, 120.966727], [14.677305, 120.966309], [14.674017, 120.964780], [14.673719, 120.964359],
      [14.673714, 120.962970], [14.674023, 120.961546], [14.667972, 120.964049]
    ]
  }
];
// ===============================
// 📍 STREET MARKERS PER BARANGAY
// ===============================
const streetGroups = {
  Tugatog:[
    { name: "Marcelo H. del Pilar St", coords: [14.6642407, 120.9676182] },
    { name: "Inocensia St", coords: [14.6610889, 120.9705267] },
    { name: "Inocensia St", coords: [14.6622423, 120.9721002] },
    { name: "Pacensia", coords: [14.6618927, 120.9721652] },
    { name: "Prelaya St", coords: [14.6614240, 120.9702511] },
    { name: "Prelaya St", coords: [14.6620681, 120.9711201] },
    { name: "Pureza St", coords: [14.6617113, 120.9698961] },
    { name: "Pureza St", coords: [14.6623967, 120.9708519] },
    { name: "Paz St", coords: [14.6627409, 120.9705311] },
    { name: "Libertad St", coords: [14.6623380, 120.9692805] },
    { name: "Libertad St", coords: [14.6631067, 120.9702907] },
    { name: "Constancia St", coords: [14.6626497, 120.9690036] },
    { name: "Constancia St", coords: [14.6634334, 120.9700369] },
    { name: "Nirvana St", coords: [14.663331, 120.969155] },
    { name: "Nirvana St", coords: [14.6637558, 120.9697455] },
    { name: "Progreso St", coords: [14.6633795, 120.9685315] },
    { name: "Progreso St", coords: [14.6641109, 120.9695105] },
    { name: "Commercio", coords: [14.6636478, 120.9682720] },
    { name: "Commercio", coords: [14.6644450, 120.9692211] },
    { name: "Industria St", coords: [14.6651884, 120.9694542] },
    { name: "Frugalidad St", coords: [14.6653633, 120.9688195] },
    { name: "Frugalidad St", coords: [14.6657917, 120.9699544] },
    { name: "Lingkod ng Nayon St", coords: [14.6657917, 120.9699544] },
    { name: "Prosperidad St", coords: [14.6652397, 120.9698069] },
    { name: "Prosperidad St", coords: [14.6650571, 120.9700325] },
    { name: "Prosperidad St", coords: [14.6647629, 120.9703718] },
    { name: "Prosperidad St", coords: [14.6644703, 120.9707141] },
    { name: "Prosperidad St", coords: [14.6641839, 120.9710843] },
    { name: "Prosperidad St", coords: [14.6638868, 120.9714447] },
    { name: "Prosperidad St", coords: [14.6636263, 120.9717599] },
    { name: "Prosperidad St", coords: [14.6633322, 120.9721065] },
    { name: "Prosperidad St", coords: [14.6630513, 120.9724458] },
    { name: "Caridad St", coords: [14.6627749, 120.9722202] },
    { name: "Caridad St", coords: [14.6625099, 120.9724364] },
    { name: "De Vachan", coords: [14.6622861, 120.9726225] },
    { name: "M. L. Quezon", coords: [14.664559, 120.971529] },
    { name: "M. L. Quezon", coords: [14.663974, 120.972242] },
    { name: "J. P. Rizal", coords: [14.664956, 120.972179] },
    { name: "J. P. Rizal", coords: [14.6654625, 120.9715248] },
    { name: "Maria Clara St", coords: [14.6667946, 120.9699168] },
    { name: "Liwayway St", coords: [14.6664265, 120.9704499] },
    { name: "Ma. Clara", coords: [14.665887, 120.972219] },
    { name: "Maclara", coords: [14.6662569, 120.9717568] },
    { name: "Ligaya St", coords: [14.666413, 120.972244] },
    { name: "Sisa St", coords: [14.6671057, 120.9725769] },
    { name: "A. Bonifacio St", coords: [14.6665280, 120.9726235] },
    { name: "A. Bonifacio", coords: [14.6655037, 120.9726886] },
    { name: "A. Bonifacio", coords: [14.6645037, 120.9727694] },
    { name: "A. Bonifacio", coords: [14.6635037, 120.9728730] },
    { name: "A. Bonifacio", coords: [14.6629309, 120.9729162] },
    { name: "Martin St", coords: [14.664665, 120.967586] },
    { name: "Lt. L. Roque St", coords: [14.6656928, 120.9667116] },
    { name: "Lt. L. Roque St", coords: [14.6663856, 120.9677811] },
    { name: "Zinc St", coords: [14.666322, 120.966714] },
    { name: "Paz", coords: [14.6619880, 120.9693388] },
    { name: "Dr. Lascano St", coords: [14.6617315, 120.9690025] },
    { name: "Dr. Lascano St", coords: [14.6602297, 120.9670740] },
    { name: "Bronze St", coords: [14.6617801, 120.9689663] },
    { name: "Acero St", coords: [14.6615359, 120.9686163] },
    { name: "Aluminio St", coords: [14.6612861, 120.9682901] },
    { name: "Estanio St", coords: [14.6610243, 120.9679484] },
    { name: "Asogue St", coords: [14.6607503, 120.9676259] },
    { name: "Mercurio St", coords: [14.6629257, 120.9686099] },
    { name: "Mercurio St", coords: [14.6624220, 120.9679246] },
    { name: "Bronze St", coords: [14.6627266, 120.9682354] },
    { name: "Acero St", coords: [14.6632144, 120.9672816] },
    { name: "Aluminio St", coords: [14.6621911, 120.9675719] },
    { name: "Estanio St", coords: [14.6619702, 120.9671941] },
    { name: "Plata St", coords: [14.6637405, 120.9679317] },
    { name: "Plata St", coords: [14.6635073, 120.9676179] },
    { name: "Plata St", coords: [14.6630448, 120.9669952] },
    { name: "Oro St", coords: [14.6645161, 120.9673366] },
    { name: "Oro St", coords: [14.6642744, 120.9669993] },
    { name: "Oro St", coords: [14.6640318, 120.9666677] },
    { name: "Bronze St", coords: [14.663901, 120.967284] },
    { name: "Acero St", coords: [14.6648268, 120.9661986] },
    { name: "Cobre St", coords: [14.6652763, 120.9667612] },
    { name: "Cobre St", coords: [14.6650269, 120.9664156] },
    { name: "15 Lingkod Na Nayon", coords: [14.665925, 120.969107] },
    { name: "Bronze St", coords: [14.6660418, 120.9660424] },
    { name: "Bronze St", coords: [14.6661998, 120.9663643] },
    { name: "Marcelo H. del Pilar St", coords: [14.6680317, 120.9657770] },
    { name: "Elias St", coords: [14.667057, 120.967120] },
    { name: "Elias St", coords: [14.667362, 120.966567] }
  ],
  Acacia: [
    { name: "Basilio St", coords: [14.668166, 120.968061] },
    { name: "Basilio St", coords: [14.669360, 120.971379] },
    { name: "Basilio St", coords: [14.668600, 120.969262] },
    { name: "Maria Clara St", coords: [14.667648, 120.968876] },
    { name: "Isagani St", coords: [14.667121, 120.967453] },
    { name: "Marcelo H. Del Pilar St", coords: [14.667780, 120.965857] },
    { name: "Flerida St", coords: [14.667271, 120.968021] },
    { name: "Lt. L Roque St", coords: [14.666539, 120.967994] },
    { name: "Consuelo St", coords: [14.666879, 120.969872] },
    { name: "Consuelo St", coords: [14.666528, 120.968807] },
    { name: "Liwayway St", coords: [14.666782, 120.971383] },
    { name: "Ibarra St", coords: [14.668687, 120.970459] },
    { name: "Ibarra St", coords: [14.669329, 120.970227] },
    { name: "Ibarra St", coords: [14.668144, 120.970641] },
    { name: "Kapitan Tiago St", coords: [14.667675, 120.970254] },
    { name: "Kapitan Tiago St", coords: [14.667148, 120.968797] },
    { name: "Kapitan Tiago St", coords: [14.668204, 120.971790] },
    { name: "Simoun St", coords: [14.668281, 120.970223] },
    { name: "Simoun St", coords: [14.668745, 120.971558] },
    { name: "Sisa St", coords: [14.669375, 120.972402] },
    { name: "Sisa St", coords: [14.670043, 120.972340] },
    { name: "Sisa St", coords: [14.668247, 120.972482] },
  ],
  Tinajeros: [
  { name: "Crispin St", coords: [14.670385, 120.968170] },
  { name: "Crispin St", coords: [14.671316, 120.970805] },
  { name: "Celia St", coords: [14.669850, 120.968497] },
  { name: "Celia St", coords: [14.670738, 120.971036] },
  { name: "Sarmiento St", coords: [14.671504, 120.967175] },
  { name: "Dizon St", coords: [14.671773, 120.968368] },
  { name: "B. Rivera St", coords: [14.671035, 120.969586] },
  { name: "Sanchez St", coords: [14.672736, 120.967478] },
  { name: "Sanchez St", coords: [14.673590, 120.964354] },
  { name: "Sanchez St", coords: [14.673277, 120.965831] },
  { name: "Sanchez St", coords: [14.673015, 120.966506] },
  { name: "Sanchez St", coords: [14.672638, 120.968098] },
  { name: "Sanchez St", coords: [14.672398, 120.968897] },
  { name: "Mejorada St", coords: [14.670650, 120.965632] },
  { name: "Esperanza St", coords: [14.670830, 120.967303] },
  { name: "Concha St", coords: [14.671101, 120.965579] },
  { name: "Concha St", coords: [14.670672, 120.966285] },
  { name: "Trabajo St", coords: [14.671337, 120.966029] },
  { name: "Villarba St", coords: [14.671919, 120.964654] },
  { name: "D. Dela Cruz St", coords: [14.671224, 120.968727] },
  { name: "Talilong St", coords: [14.671898, 120.965807] },
  { name: "Mesina St", coords: [14.672656, 120.964892] },
  { name: "Arasity St", coords: [14.672907, 120.969584] },
  { name: "Arasity St", coords: [14.672152, 120.969455] },
  { name: "Arasity St", coords: [14.673805, 120.971293] },
  { name: "Platinum St", coords: [14.674529, 120.970574] },
  { name: "Platinum St", coords: [14.675180, 120.970521] },
  { name: "Platinum St", coords: [14.675519, 120.971441] },
  { name: "Platinum St", coords: [14.675502, 120.970103] },
  { name: "Platinum St", coords: [14.675413, 120.967200] },
  { name: "Platinum St", coords: [14.675766, 120.966130] },
  { name: "Doña Victoria St", coords: [14.673104, 120.970274] },
  { name: "Doña Victoria St", coords: [14.673411, 120.971225] },
  { name: "M. Dick St", coords: [14.673768, 120.970376] },
  { name: "Platinum St", coords: [14.675473, 120.968749] },
  { name: "Uranium St", coords: [14.676161, 120.970644] },
  { name: "Radium St", coords: [14.676145, 120.969405] },
  { name: "Bustamante St", coords: [14.671774, 120.963254] },
  { name: "Kaybasco St", coords: [14.673271, 120.963525] },
  { name: "Sevilla St", coords: [14.672713, 120.965940] },
  { name: "Col. Espiritu St", coords: [14.673538, 120.967497] },
  { name: "Col. Espiritu St", coords: [14.673793, 120.966695] },
  { name: "Col. Espiritu St", coords: [14.673442, 120.968241] },
  { name: "Col. Espiritu St", coords: [14.673372, 120.968844] },
  { name: "Col. Espiritu St", coords: [14.672796, 120.968863] },
  { name: "Kab. Martin St", coords: [14.673251, 120.967075] },
  { name: "St. Paul St", coords: [14.678577, 120.968242] },
  { name: "St. James St", coords: [14.677370, 120.967603] },
  { name: "St. James St", coords: [14.677125, 120.967284] },
  { name: "St. James St", coords: [14.676472, 120.966880] },
  { name: "St. James St", coords: [14.677674, 120.968665] },
  { name: "Sanciangco St", coords: [14.673278, 120.962184] },
  { name: "Crispin St", coords: [14.671366, 120.971818] },
  { name: "Crispin St", coords: [14.671658, 120.971758] },
  { name: "Crispin St", coords: [14.671855, 120.971449] },
  { name: "Crispin St", coords: [14.672155, 120.971340] },
  { name: "Crispin St", coords: [14.672431, 120.971206] },
  { name: "Sisa St", coords: [14.676609, 120.971786] },
  { name: "Sisa St", coords: [14.676666, 120.971261] },
  { name: "MXGC+VP6", coords: [14.677162, 120.971751] },
  { name: "St. James Ave", coords: [14.677684, 120.970444] },
  { name: "MXG9+WJ4", coords: [14.677274, 120.969066] },
  { name: "Magnesium", coords: [14.673200, 120.971515] },
  { name: "Magnesium", coords: [14.672880, 120.971638] },
  { name: "Sociego St", coords: [14.670420, 120.965891] },
  { name: "Sociego St", coords: [14.670185, 120.966510] },
  { name: "Sociego St", coords: [14.670224, 120.965763] },
  { name: "Sociego St", coords: [14.670446, 120.967203] },
  { name: "Actividad St", coords: [14.670730, 120.966810] },
  { name: "Col. Espiritu St", coords: [14.674489, 120.966105] },
  { name: "Bustamante St", coords: [14.670618, 120.963904] },
  { name: "Bustamante St", coords: [14.672234, 120.963004] },
  { name: "168 Marcelo H. Del Pilar St", coords: [14.673463, 120.962928] },
  { name: "228 Marcelo H. Del Pilar St", coords: [14.672453, 120.963450] },
  { name: "267 Marcelo H. Del Pilar St", coords: [14.671788, 120.963973] },
  { name: "184-92 Marcelo H. Del Pilar St", coords: [14.670724, 120.964564] },
  { name: "163 Marcelo H. Del Pilar St", coords: [14.670724, 120.964564] },
  { name: "162 Marcelo H. Del Pilar St", coords: [14.669229, 120.965276] },
  { name: "153 Marcelo H. Del Pilar St", coords: [14.668161, 120.965731] },
  { name: "Gov. Pascual", coords: [14.668557, 120.966983] },
  { name: "Gov. Pascual", coords: [14.669115, 120.968538] },
  { name: "Gov. Pascual", coords: [14.669417, 120.969507] },
    { name: "Gov. Pascual", coords: [14.669925, 120.970844] },
    { name: "Gov. Pascual", coords: [14.670242, 120.971747] }
  ]
};

// Marker color codes
const markerColors = {
  Tugatog: "green",
  Acacia: "blue",
  Tinajeros: "red"
};

// 📍 ADD STREET MARKERS
Object.entries(streetGroups).forEach(([barangay, streets]) => {
  streets.forEach(item => {
    const coords = item.coords;
    const name = item.name;
    if (!coords || coords.length !== 2) {
      console.warn(`Skipping invalid coordinates for ${name || 'unknown street'}`);
      return;
    }

    // Create marker
    const streetMarker = L.circleMarker(coords, {
      radius: 5,
      color: markerColors[barangay],
      fillColor: markerColors[barangay],
      fillOpacity: 0.9
    }).addTo(map).bindPopup(`<b>${name}</b><br>${barangay}`);
    
    // Attach marker to item for later style changes
    item.marker = streetMarker;
  });
});

if ("geolocation" in navigator) {
  navigator.geolocation.watchPosition(
    (position) => {
      const { latitude, longitude } = position.coords;
      const newLatLng = [latitude, longitude];

      // Update marker position and map center
      marker.setLatLng(newLatLng);
      map.setView(newLatLng, map.getZoom());
      console.log(`📍 Live position: ${latitude}, ${longitude}`);

      // Emit the location update to the server via Socket.IO
      // This will allow the server to broadcast it to other clients (e.g., register.js)
      socket.emit('update-location', { latitude, longitude });

      // ===============================
      // 🧭 GEOFENCE (Barangay zone logic)
      // ===============================
      const point = turf.point([longitude, latitude]);
      let insideZone = null;

      for (const zone of turfPolygons) {
        if (zone.turf && turf.booleanPointInPolygon(point, zone.turf)) {
          insideZone = zone.name;
          break;
        }
      }

      if (insideZone && insideZone !== currentZone) {
        console.log(`🟢 Entered zone: ${insideZone}`);
        currentZone = insideZone;
        sendSMSToBarangay(insideZone);
      } else if (!insideZone && currentZone) {
        console.log(`⚪ Exited zone: ${currentZone}`);
        currentZone = null;
      }

      // ====================================
      // 🚛 COLLISION / STREET PROXIMITY LOGIC
      // ====================================
      Object.entries(streetGroups).forEach(([barangay, streets]) => {
        streets.forEach(item => {
          const coords = item.coords;
          const name = item.name;

          if (!coords || coords.length !== 2) return;

          const distance = getDistance(latitude, longitude, coords[0], coords[1]);

          // Same collision threshold as before
          if (distance <= streetProximity) {
            console.log(`🚛 Near ${barangay}, ${name} (${distance.toFixed(1)}m)`);

            // Collision trigger: send SMS or update alert
            sendSMSToStreet(barangay, name);

            // Optional visual: highlight nearby street marker
            if (item.marker) {
              item.marker.setStyle({ color: 'red' });
              setTimeout(() => item.marker.setStyle({ color: markerColors[barangay] }), 2000);
            }
          }
        });
      });
    },
    (error) => {
      console.error("❌ Geolocation error:", error.message);
    },
    {
      enableHighAccuracy: true,
      maximumAge: 5000,
      timeout: 10000
    }
  );
} else {
  console.warn("⚠️ Geolocation not supported in this browser.");
}

// Draw polygons and prepare Turf polygons (auto-close rings)
const turfPolygons = [];

for (const p of polygons) {
  const leafletPoly = L.polygon(p.coords, {
    color: p.color,
    fillColor: p.color,
    fillOpacity: 0.4,
    interactive: false, // 🧱 makes polygon non-clickable
    bubblingMouseEvents: false // prevent map event interference
  }).addTo(map);

  const ring = p.coords.map(coord => [coord[1], coord[0]]);
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push([...first]);

  let turfPoly = null;
  try {
    turfPoly = turf.polygon([ring]);
  } catch (err) {
    console.error(`Failed to create Turf polygon for ${p.name}:`, err);
  }

  turfPolygons.push({ name: p.name, leaflet: leafletPoly, turf: turfPoly });
}

// Minimum distance to count as "collision" (in meters)
const streetProximity = 5;

// Function to calculate distance between two points (Haversine formula)
function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000; // meters
  const toRad = x => x * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

let currentZone = null;
let lastSentZone = null;
let lastSentTime = 0;
const cooldown = 30000; // 30 seconds cooldown

// Function: Send SMS when entering a polygon
function sendSMSToBarangay(zoneName) {
  const now = Date.now();
  if (now - lastSentTime < cooldown || zoneName === lastSentZone) return;

  lastSentZone = zoneName;
  lastSentTime = now;

  console.log(`📱 Sending SMS for zone: ${zoneName}`);

  fetch('/send-sms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: `Truck entered ${zoneName}`, barangay: zoneName })
  })
    .then(res => res.text())
    .then(data => console.log('✅ SMS sent:', data))
    .catch(err => console.error('❌ SMS error:', err));
}

// -----------------------------
// Street SMS helper + cooldown
// -----------------------------
let lastStreet = null;
let lastStreetTime = 0;
const streetCooldown = 30000; // 30s cooldown for street SMS

function sendSMSToStreet(barangay, street) {
  const now = Date.now();
  // prevent spamming same street within cooldown
  if (now - lastStreetTime < streetCooldown && lastStreet === `${barangay}-${street}`) return;

  lastStreet = `${barangay}-${street}`;
  lastStreetTime = now;

  console.log(`📬 Sending SMS: Barangay: ${barangay}, Street: ${street}`);

  fetch('/send-sms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: `Barangay: ${barangay}, Street: ${street}`,
      barangay: barangay,
      street: street
    })
  })
    .then(res => res.text())
    .then(data => console.log('✅ Street SMS sent:', data))
    .catch(err => console.error('❌ Street SMS error:', err));
}

// ===============================
// 🛻 STREET COLLISION DETECTION
// ===============================
marker.on('drag', () => {
  const truckPos = marker.getLatLng();

  // For each barangay and its street list
  Object.entries(streetGroups).forEach(([barangay, streets]) => {
    streets.forEach(item => {
      let coords, name;
      if (Array.isArray(item)) {
        coords = item;
        name = `${barangay} Street`;
      } else if (item.coords) {
        coords = item.coords;
        name = item.name;
      }

      if (!coords || coords.length !== 2) return;

      const distance = getDistance(truckPos.lat, truckPos.lng, coords[0], coords[1]);

      if (distance <= streetProximity) {
        console.log(`🚛 Near ${barangay}, ${name} (${distance.toFixed(1)}m)`);
        sendSMSToStreet(barangay, name);
      }
    });
  });
});