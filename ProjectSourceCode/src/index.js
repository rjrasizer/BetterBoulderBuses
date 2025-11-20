// //Allow for relative path usage
// app.use(express.static(__dirname + '/'));

// *****************************************************
// <!-- Section 1 : Import Dependencies -->
// *****************************************************

require('dotenv').config();
const express = require('express'); // To build an application server or API
const app = express();
const handlebars = require('express-handlebars');
const Handlebars = require('handlebars');
const path = require('path');
const pgp = require('pg-promise')(); // To connect to the Postgres DB from the node server
const bodyParser = require('body-parser');
const session = require('express-session'); // To set the session object. To store or access session data, use the `req.session`, which is (generally) serialized as JSON by the store.
const bcrypt = require('bcryptjs'); //  To hash passwords
const axios = require('axios'); // To make HTTP requests from our server. We'll learn more about it in Part C.

// *****************************************************
// <!-- Section 2 : Connect to DB -->
// *****************************************************

// create `ExpressHandlebars` instance and configure the layouts and partials dir.

// database configuration
const dbConfig = {
  host: 'db', // the database server
  port: 5432, // the database port
  database: process.env.POSTGRES_DB, // the database name
  user: process.env.POSTGRES_USER, // the user account to connect with
  password: process.env.POSTGRES_PASSWORD, // the password of the user account
};

const db = pgp(dbConfig);

// test your database
db.connect()
  .then(obj => {
    console.log('Database connection successful'); // you can view this message in the docker compose logs
    obj.done(); // success, release the connection;
  })
  .catch(error => {
    console.log('ERROR:', error.message || error);
  });

// *****************************************************
// <!-- Section 3 : App Settings -->
// *****************************************************

// Register `hbs` as our view engine using its bound `engine()` function.
app.engine('hbs', 
    handlebars.engine({
        extname: 'hbs',
        layoutsDir: path.join(__dirname, 'views', 'layouts'),
        partialsDir: path.join(__dirname, 'views', 'partials'),
        defaultLayout: 'main',
        helpers: {
          eq: (a, b) => a === b,
        }
    })
);
app.set('view engine', 'hbs');
app.set('views', path.join(__dirname, 'views'));

app.use(bodyParser.json()); // specify the usage of JSON for parsing request body.
app.use(bodyParser.urlencoded({ extended: true }));

app.use(
  session({
    secret: process.env.SESSION_SECRET,
    saveUninitialized: false,
    resave: false,
  })
);

const auth = (req, res, next) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  next();
};

// ===== Change Password Logic =====
app.post('/settings/change-password', auth, async (req, res) => {
  const { currentPassword, newPassword, confirmPassword } = req.body;
  const username = req.session.user.username;

  try {
    if (newPassword !== confirmPassword) {
      return res.render('pages/settings', {
        activeTab: "profile",
        userData: { username },
        message: "New passwords do not match",
        error: true
      });
    }

    // Get user from DB
    const user = await db.oneOrNone(
      'SELECT * FROM users WHERE username = $1',
      [username]
    );

    if (!user) {
      return res.redirect('/login');
    }

    // Check current password is correct
    const match = await bcrypt.compare(currentPassword, user.password);
    if (!match) {
      return res.render('pages/settings', {
        activeTab: "profile",
        userData: { username },
        message: "Current password is incorrect",
        error: true
      });
    }

    // Hash and update new password
    const hashed = await bcrypt.hash(newPassword, 10);

    await db.none(
      'UPDATE users SET password = $1 WHERE username = $2',
      [hashed, username]
    );

    res.render('pages/settings', {
      activeTab: "profile",
      userData: { username },
      message: "Password updated successfully",
      success: true
    });

  } catch (err) {
    console.error('Password update error:', err);
    res.render('pages/settings', {
      activeTab: "profile",
      userData: { username },
      message: "Something went wrong",
      error: true
    });
  }
});

app.use(express.static(path.join(__dirname, 'resources')));


// initialize session variables
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    saveUninitialized: false,
    resave: false,
  })
);

// *****************************************************
// <!-- Section 4 : API Routes -->
// *****************************************************

// ------------ Authentication Middleware ----------

app.get('/welcome', (req, res) => {
  res.json({status: 'success', message: 'Welcome!'});
});

// Authentication Required
// app.use(auth);

// ---------- Routes -----------
app.get('/', (req, res) => {
  res.redirect('/login');
});

// ========== API: Routes and map data ==========
// List routes for sidebar
app.get('/api/routes', async (req, res) => {
  try {
    const rows = await db.any(`
      SELECT route_id, route_short_name, route_long_name
      FROM routes
      ORDER BY 
        CASE WHEN route_short_name ~ '^[0-9]+$' THEN route_short_name::int END NULLS LAST,
        route_short_name,
        route_long_name
    `);
    res.json(rows);
  } catch (e) {
    console.error('routes api error', e);
    res.status(500).json({ error: 'Failed to load routes' });
  }
});

// Directions available for a route based on representative trips
app.get('/api/routes/:route_id/directions', async (req, res) => {
  try {
    const rows = await db.any(
      `SELECT direction_id FROM route_representatives WHERE route_id = $1 ORDER BY direction_id`,
      [req.params.route_id]
    );
    res.json(rows.map(r => r.direction_id));
  } catch (e) {
    console.error('directions api error', e);
    res.status(500).json({ error: 'Failed to load directions' });
  }
});

// Route shape as GeoJSON (precomputed with fallback to live build)
app.get('/api/routes/:route_id/shape', async (req, res) => {
  const routeId = req.params.route_id;
  const q = req.query.direction_id;
  const directionId = Number.isFinite(Number(q)) ? Number(q) : 0;
  try {
    const pre = await db.oneOrNone(
      `SELECT geojson FROM route_shapes_geojson WHERE route_id = $1 AND direction_id = $2`,
      [routeId, directionId]
    );
    if (pre && pre.geojson) return res.json(pre.geojson);

    const rep = await db.oneOrNone(
      `SELECT shape_id FROM route_representatives WHERE route_id = $1 AND direction_id = $2`,
      [routeId, directionId]
    );
    if (!rep || !rep.shape_id) return res.status(404).json({ error: 'Shape not found for route/direction' });

    const pts = await db.any(
      `SELECT COALESCE(NULLIF(shape_pt_sequence,'')::int, 0) AS seq,
              shape_pt_lon::float AS lng,
              shape_pt_lat::float AS lat
       FROM shapes WHERE shape_id = $1 ORDER BY seq`,
      [rep.shape_id]
    );
    if (!pts.length) return res.status(404).json({ error: 'Shape points missing for representative shape' });

    const coords = pts.map(p => [p.lng, p.lat]);
    const fc = { type: 'FeatureCollection', features: [ { type: 'Feature', properties: { route_id: routeId, direction_id: directionId }, geometry: { type: 'LineString', coordinates: coords } } ] };
    res.json(fc);
  } catch (e) {
    console.error('shape api error', e);
    res.status(500).json({ error: 'Failed to load shape' });
  }
});

// Ordered stops for a route/direction (precomputed with fallback)
app.get('/api/routes/:route_id/stops', async (req, res) => {
  const routeId = req.params.route_id;
  const q = req.query.direction_id;
  const directionId = Number.isFinite(Number(q)) ? Number(q) : 0;
  try {
    let rows = await db.any(
      `SELECT stop_id, stop_name, lon, lat, stop_sequence
       FROM route_stops_ordered
       WHERE route_id = $1 AND direction_id = $2
       ORDER BY stop_sequence`,
      [routeId, directionId]
    );
    if (rows.length) return res.json(rows);

    const rep = await db.oneOrNone(
      `SELECT trip_id FROM route_representatives WHERE route_id = $1 AND direction_id = $2`,
      [routeId, directionId]
    );
    if (!rep || !rep.trip_id) return res.status(404).json({ error: 'Stops not found for route/direction' });

    rows = await db.any(
      `SELECT sp.stop_id,
              sp.stop_name,
              sp.stop_lon::float AS lon,
              sp.stop_lat::float AS lat,
              COALESCE(NULLIF(st.stop_sequence,'')::int, 0) AS stop_sequence
       FROM stop_times st
       JOIN stops sp ON sp.stop_id = st.stop_id
       WHERE st.trip_id = $1
       ORDER BY stop_sequence`,
      [rep.trip_id]
    );
    res.json(rows);
  } catch (e) {
    console.error('stops api error', e);
    res.status(500).json({ error: 'Failed to load stops' });
  }
});

// Estimate current bus position (skeleton)
app.get('/api/routes/:route_id/estimate', async (req, res) => {
  const routeId = req.params.route_id;
  const directionId = Number.isFinite(Number(req.query.direction_id)) ? Number(req.query.direction_id) : 0;
  const sqlNow = `
    SELECT
      (EXTRACT(EPOCH FROM (now() AT TIME ZONE 'America/Denver')::time))::int AS now_secs,
      to_char((now() AT TIME ZONE 'America/Denver'), 'YYYY-MM-DD HH24:MI:SS') AS now_local,
      (now() AT TIME ZONE 'America/Denver')::date AS today
  `;
  try {
    const { now_secs: nowSecs, now_local: nowLocal, today } = await db.one(sqlNow);

    // Active service_ids for today from service_dates
    const active = await db.any(
      `SELECT service_id FROM service_dates WHERE service_date = $1 AND active = true`,
      [today]
    );
    const serviceIds = active.map(r => r.service_id);

    // Trips for this route/direction that run today
    const tripsToday = await db.any(
      `SELECT trip_id
       FROM trips
       WHERE route_id = $1
         AND COALESCE(NULLIF(direction_id,'')::int,0) = $2
         AND service_id = ANY($3)`,
      [routeId, directionId, serviceIds]
    );

    // Compute time spans for those trips (first/last timed stop)
    let chosen = null;
    let inProgress = false;
    let spans = [];
    if (tripsToday.length) {
      spans = await db.any(
        `SELECT st.trip_id,
                MIN(st.departure_secs)::int AS start_secs,
                MAX(st.departure_secs)::int AS end_secs
         FROM stop_times st
         WHERE st.trip_id = ANY($1)
           AND st.departure_secs IS NOT NULL
         GROUP BY st.trip_id`,
        [tripsToday.map(t => t.trip_id)]
      );

      // Pick the trip currently in progress, else the next to start
      chosen = spans.find(s => s.start_secs <= nowSecs && s.end_secs >= nowSecs) || null;
      if (chosen) {
        inProgress = true;
      } else if (spans.length) {
        const upcoming = spans.filter(s => s.start_secs > nowSecs).sort((a,b)=>a.start_secs-b.start_secs)[0];
        chosen = upcoming || spans.sort((a,b)=>a.start_secs-b.start_secs)[0];
      }
    }

    // If we have a chosen trip, compute estimated position along the route shape
    if (chosen && chosen.trip_id) {
      // Representative shape for this route/direction
      const rep = await db.oneOrNone(
        `SELECT shape_id FROM route_representatives WHERE route_id=$1 AND direction_id=$2`,
        [routeId, directionId]
      );
      if (rep && rep.shape_id) {
        const pts = await db.any(
          `SELECT COALESCE(NULLIF(shape_pt_sequence,'')::int,0) AS seq,
                  shape_pt_lon::float AS lng,
                  shape_pt_lat::float AS lat
           FROM shapes WHERE shape_id = $1 ORDER BY seq`,
          [rep.shape_id]
        );
        if (pts && pts.length >= 2) {
          // Stop times for the chosen trip
          const stops = await db.any(
            `SELECT sp.stop_id,
                    sp.stop_lon::float AS lon,
                    sp.stop_lat::float AS lat,
                    COALESCE(NULLIF(st.stop_sequence,'')::int,0) AS stop_sequence,
                    st.departure_secs
             FROM stop_times st
             JOIN stops sp ON sp.stop_id = st.stop_id
             WHERE st.trip_id = $1 AND st.departure_secs IS NOT NULL
             ORDER BY stop_sequence`,
            [chosen.trip_id]
          );

          if (stops && stops.length >= 2) {
            // Helpers for distances
            const toRad = (x) => x * Math.PI / 180;
            const haversine = (a, b) => {
              const R = 6371000; // meters
              const dLat = toRad(b.lat - a.lat);
              const dLng = toRad(b.lng - a.lng);
              const la1 = toRad(a.lat), la2 = toRad(b.lat);
              const h = Math.sin(dLat/2)**2 + Math.cos(la1)*Math.cos(la2)*Math.sin(dLng/2)**2;
              return 2*R*Math.asin(Math.sqrt(h));
            };

            const poly = pts.map(p => ({ lng: p.lng, lat: p.lat }));
            const cum = new Array(poly.length).fill(0);
            for (let i = 1; i < poly.length; i++) cum[i] = cum[i-1] + haversine(poly[i-1], poly[i]);
            const totalDist = cum[cum.length - 1] || 1;

            // Snap stops to nearest polyline vertex distance (simple approximation)
            const nearestDistAlong = (lng, lat) => {
              let bestIdx = 0;
              let best = Infinity;
              for (let i = 0; i < poly.length; i++) {
                const dx = poly[i].lng - lng;
                const dy = poly[i].lat - lat;
                const d = dx*dx + dy*dy; // fast rough metric is fine for snapping to vertex
                if (d < best) { best = d; bestIdx = i; }
              }
              return cum[bestIdx];
            };

            const stopMap = stops.map(s => ({
              seq: s.stop_sequence,
              departure_secs: s.departure_secs,
              dist: nearestDistAlong(s.lon, s.lat)
            })).sort((a,b) => a.seq - b.seq);

            // Find the surrounding stops around now
            let idx = stopMap.findIndex(s => s.departure_secs >= nowSecs);
            if (idx <= 0) idx = 1; // clamp to first segment
            if (idx === -1) idx = stopMap.length - 1; // after last stop
            const A = stopMap[idx - 1];
            const B = stopMap[idx];

            const span = Math.max(1, (B.departure_secs - A.departure_secs));
            const t = Math.min(1, Math.max(0, (nowSecs - A.departure_secs) / span));
            const targetDist = A.dist + t * (B.dist - A.dist);

            // Interpolate coordinate on polyline at targetDist
            let seg = 1;
            while (seg < cum.length && cum[seg] < targetDist) seg++;
            const s0 = Math.max(0, seg - 1);
            const segLen = (cum[seg] - cum[s0]) || 1;
            const ft = (targetDist - cum[s0]) / segLen;
            const P = poly[s0];
            const Q = poly[seg] || poly[poly.length - 1];
            const lng = P.lng + (Q.lng - P.lng) * ft;
            const lat = P.lat + (Q.lat - P.lat) * ft;
            const bearing = Math.atan2((Q.lng - P.lng), (Q.lat - P.lat)) * 180 / Math.PI;

            return res.json({
              ok: true,
              route_id: routeId,
              direction_id: directionId,
              now_secs: nowSecs,
              now_local: nowLocal,
              service_ids_today: serviceIds,
              service_count_today: serviceIds.length,
              chosen_trip_id: chosen.trip_id,
              trip_start_secs: chosen.start_secs,
              trip_end_secs: chosen.end_secs,
              trip_in_progress: inProgress,
              next_stop_seq: B.seq,
              prev_stop_seq: A.seq,
              progress_pct: Math.max(0, Math.min(100, Math.round(100 * (targetDist / totalDist)))),
              position: { lng, lat, bearing }
            });
          }
        }
      }
    }

    // Fallback: return meta only when we couldn't compute position
    res.json({
      ok: true,
      route_id: routeId,
      direction_id: directionId,
      now_secs: nowSecs,
      now_local: nowLocal,
      service_ids_today: serviceIds,
      service_count_today: serviceIds.length,
      chosen_trip_id: chosen ? chosen.trip_id : null,
      trip_start_secs: chosen ? chosen.start_secs : null,
      trip_end_secs: chosen ? chosen.end_secs : null,
      trip_in_progress: inProgress
    });
  } catch (e) {
    console.error('estimate now error', e);
    res.status(500).json({ error: 'now failed' });
  }
});

// -------- LOGIN ----------
app.get('/login', (req, res) => {
  res.render('pages/login')
});

app.post('/login', async (req, res) => {
  try {
    const user = await db.oneOrNone(
      "SELECT * FROM users WHERE username = $1",
      [req.body.username]
    );

    if (!user) {
      return res.redirect('/register');
    }

    // check if password from request matches with password in DB
    const match = await bcrypt.compare(req.body.password, user.password);

    if (!match) {
      return res.render('pages/login', {
        message: "Incorrect username or password",
        error: true
      });
    }
    
    req.session.user = user;
    req.session.save();
    res.redirect('/home');
  } catch (error) {
    console.error('Login error:', error);
    res.render('pages/login', {
      message: "An error occurred while trying to login.",
      error: true
    });
  }
});

// --------- Register -----------
app.get('/register', (req, res) => {
  res.render('pages/register')
});

app.post('/register', async (req, res) => {
  try {

    const { username, password } = req.body;

    if (!username || !password || typeof username !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ message: 'Invalid input' });
    }

    const hash = await bcrypt.hash(password, 10);
    await db.none(
      'INSERT INTO users (username, password) VALUES ($1, $2)',
      [username, hash]
    );

    console.log(`User: ${username} registered`);
    //res.status(200).json({ message: 'Success' });
    res.redirect('/login');
  } catch (error) {
    console.error("Error registering user:", error);
    res.status(400).json({ message: 'Invalid input' });
  }
});

//Test route for redirect testing
app.get('/test', (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  res.send('Authenticated test page');
});

// ------- Home route ----------
app.get('/home', auth, (req, res) => {
  res.render('pages/home', {
    title: 'Better Boulder Buses Home',
    mapboxToken: process.env.MAPBOX_ACCESS_TOKEN,
  });
});

app.get('/settings', auth, (req, res) => {
  const activeTab = req.query.tab || "profile";

  const userData = {
    username: req.body.username,
    name: "",
    email: "",
    avatar: "",
  }

  res.render('pages/settings', { userData, activeTab, title: "Settings" });
});

app.get('/logout', (req, res) => {
  if(!req.session.user) return res.redirect('/login');
  req.session.destroy(err => {
    if (err) {
      return res.render('pages/logout', { message: 'Error logging out. Please try again.' });
    }
    res.render('pages/logout', { message: 'Logged out successfully' });
  });
});


module.exports = app.listen(3000, () => console.log('Server running on port 3000'));

//eq helper for settings page
// import exphbs from "express-handlebars";

// const hbs = exphbs.create({
//   helpers: {
//     eq: (a, b) => a === b,
//   }
// })

// app.engine("hbs", hbs.engine);
// app.set("view engine", "hbs");
