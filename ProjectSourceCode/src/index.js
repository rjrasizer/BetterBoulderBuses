// //Allow for relative path usage
// app.use(express.static(__dirname + '/'));
// *****************************************************
// Section 1 : Import Dependencies
// *****************************************************

require('dotenv').config();
const express = require('express');
const app = express(); // <-- exportable Express app
const handlebars = require('express-handlebars');
const Handlebars = require('handlebars');
const path = require('path');
const pgp = require('pg-promise')();
const bodyParser = require('body-parser');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const axios = require('axios');

// *****************************************************
// Section 2 : Connect to DB
// *****************************************************

const dbConfig = {
  host: process.env.POSTGRES_HOST,
  port: 5432,
  database: process.env.POSTGRES_DB,
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
};

const db = pgp(dbConfig);

// Fallback location (CU Boulder Engineering Center) when user location is not available
const FALLBACK_LAT = 40.0063;
const FALLBACK_LNG = -105.2620;

db.connect()
  .then(obj => {
    console.log('Database connection successful');
    obj.done();
  })
  .catch(error => {
    console.log('ERROR:', error.message || error);
  });

// *****************************************************
// Section 3 : App Settings
// *****************************************************

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

app.use(bodyParser.json());
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

app.use(express.static(path.join(__dirname, 'resources')));

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

// All routes, sorted by distance to a given lat/lng (or fallback location)
app.get('/api/routes/nearby', async (req, res) => {
  const qLat = parseFloat(req.query.lat);
  const qLng = parseFloat(req.query.lng);

  let lat = FALLBACK_LAT;
  let lng = FALLBACK_LNG;
  let source = 'fallback';

  if (
    Number.isFinite(qLat) && Number.isFinite(qLng) &&
    qLat >= -90 && qLat <= 90 &&
    qLng >= -180 && qLng <= 180
  ) {
    lat = qLat;
    lng = qLng;
    source = 'user';
  }

  try {
    const rows = await db.any(
      `
        WITH with_dist AS (
          SELECT
            rso.route_id,
            rso.direction_id,
            rso.stop_id,
            rso.stop_name,
            rso.lon,
            rso.lat,
            ((rso.lon - $1)^2 + (rso.lat - $2)^2) AS dist2,
            ROW_NUMBER() OVER (
              PARTITION BY rso.route_id
              ORDER BY ((rso.lon - $1)^2 + (rso.lat - $2)^2)
            ) AS rn
          FROM route_stops_ordered rso
        ),
        routes_with_nearest AS (
          SELECT
            wd.route_id,
            wd.direction_id,
            wd.stop_id,
            wd.stop_name,
            wd.lon,
            wd.lat,
            wd.dist2,
            r.route_short_name,
            r.route_long_name
          FROM with_dist wd
          JOIN routes r ON r.route_id = wd.route_id
          WHERE wd.rn = 1
        )
        SELECT *
        FROM routes_with_nearest
        ORDER BY dist2 ASC
      `,
      [lng, lat]
    );

    const toRad = (x) => x * Math.PI / 180;
    const R = 6371000; // meters

    const routes = rows.map((row) => {
      const dLat = toRad(row.lat - lat);
      const dLng = toRad(row.lon - lng);
      const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRad(lat)) * Math.cos(toRad(row.lat)) *
        Math.sin(dLng / 2) * Math.sin(dLng / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      const distanceMeters = R * c;

      return {
        route_id: row.route_id,
        route_short_name: row.route_short_name,
        route_long_name: row.route_long_name,
        direction_id: row.direction_id,
        nearest_stop: {
          stop_id: row.stop_id,
          stop_name: row.stop_name,
          lat: row.lat,
          lon: row.lon,
          distance_meters: distanceMeters
        }
      };
    });

    return res.json({
      location: {
        lat,
        lng,
        source
      },
      routes
    });
  } catch (e) {
    console.error('routes nearby api error', e);
    res.status(500).json({ error: 'Failed to load nearby routes' });
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

// Nearest route + stop to a given lat/lng
app.get('/api/nearest', async (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lng = parseFloat(req.query.lng);

  if (!Number.isFinite(lat) || !Number.isFinite(lng) ||
      lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return res.status(400).json({ error: 'Invalid or missing lat/lng query parameters' });
  }

  try {
    // Find nearest stop across all routes/directions using a simple squared-distance metric
    const nearest = await db.oneOrNone(
      `
        SELECT
          rso.route_id,
          rso.direction_id,
          rso.stop_id,
          rso.stop_name,
          rso.lon,
          rso.lat,
          ((rso.lon - $1)^2 + (rso.lat - $2)^2) AS dist2
        FROM route_stops_ordered rso
        ORDER BY dist2
        LIMIT 1
      `,
      [lng, lat]
    );

    if (!nearest) {
      return res.status(404).json({ error: 'No stops found' });
    }

    // Optionally enrich with route metadata
    const routeMeta = await db.oneOrNone(
      `
        SELECT route_id, route_short_name, route_long_name
        FROM routes
        WHERE route_id = $1
      `,
      [nearest.route_id]
    );

    // Compute approximate distance in meters using a simple haversine
    const toRad = (x) => x * Math.PI / 180;
    const R = 6371000; // meters
    const dLat = toRad(nearest.lat - lat);
    const dLng = toRad(nearest.lon - lng);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat)) * Math.cos(toRad(nearest.lat)) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distanceMeters = R * c;

    return res.json({
      route_id: nearest.route_id,
      direction_id: nearest.direction_id,
      route_short_name: routeMeta ? routeMeta.route_short_name : null,
      route_long_name: routeMeta ? routeMeta.route_long_name : null,
      distance_meters: distanceMeters,
      stop: {
        stop_id: nearest.stop_id,
        stop_name: nearest.stop_name,
        lat: nearest.lat,
        lon: nearest.lon
      },
      query: {
        lat,
        lng
      }
    });
  } catch (e) {
    console.error('nearest api error', e);
    res.status(500).json({ error: 'Failed to compute nearest stop' });
  }
});

// Route timing + per-stop ETAs for a specific route/direction
app.get('/api/routes/:route_id/timing', async (req, res) => {
  const routeId = req.params.route_id;
  const qDir = req.query.direction_id;
  const directionId = Number.isFinite(Number(qDir)) ? Number(qDir) : 0;

  const qLat = parseFloat(req.query.lat);
  const qLng = parseFloat(req.query.lng);

  let lat = FALLBACK_LAT;
  let lng = FALLBACK_LNG;
  let source = 'fallback';

  if (
    Number.isFinite(qLat) && Number.isFinite(qLng) &&
    qLat >= -90 && qLat <= 90 &&
    qLng >= -180 && qLng <= 180
  ) {
    lat = qLat;
    lng = qLng;
    source = 'user';
  }

  const toRad = (x) => x * Math.PI / 180;
  const R = 6371000; // meters

  try {
    // Route metadata
    const routeMeta = await db.oneOrNone(
      `
        SELECT route_id, route_short_name, route_long_name
        FROM routes
        WHERE route_id = $1
      `,
      [routeId]
    );

    // Nearest stop for this route/direction relative to reference location
    const nearest = await db.oneOrNone(
      `
        SELECT
          stop_id,
          stop_name,
          lon,
          lat,
          stop_sequence,
          ((lon - $1)^2 + (lat - $2)^2) AS dist2
        FROM route_stops_ordered
        WHERE route_id = $3
          AND direction_id = $4
        ORDER BY dist2
        LIMIT 1
      `,
      [lng, lat, routeId, directionId]
    );

    if (!nearest) {
      return res.status(404).json({ error: 'No stops for route/direction' });
    }

    const dLatNearest = toRad(nearest.lat - lat);
    const dLngNearest = toRad(nearest.lon - lng);
    const aNearest =
      Math.sin(dLatNearest / 2) * Math.sin(dLatNearest / 2) +
      Math.cos(toRad(lat)) * Math.cos(toRad(nearest.lat)) *
      Math.sin(dLngNearest / 2) * Math.sin(dLngNearest / 2);
    const cNearest = 2 * Math.atan2(Math.sqrt(aNearest), Math.sqrt(1 - aNearest));
    const nearestDistanceMeters = R * cNearest;

    // Current time in local Denver time
    const { now_secs: nowSecs, now_local: nowLocal, today } = await db.one(
      `
        SELECT
          (EXTRACT(EPOCH FROM (now() AT TIME ZONE 'America/Denver')::time))::int AS now_secs,
          to_char((now() AT TIME ZONE 'America/Denver'), 'YYYY-MM-DD HH24:MI:SS') AS now_local,
          (now() AT TIME ZONE 'America/Denver')::date AS today
      `
    );

    // Active service_ids for today
    const active = await db.any(
      `SELECT service_id FROM service_dates WHERE service_date = $1 AND active = true`,
      [today]
    );
    const serviceIds = active.map(r => r.service_id);

    let tripMeta = null;
    let stopsWithEta = [];
    let nearestEtaSeconds = null;
    let nearestEtaLabel = null;

    if (serviceIds.length) {
      // Trips for this route/direction that run today
      const tripsToday = await db.any(
        `SELECT trip_id
         FROM trips
         WHERE route_id = $1
           AND COALESCE(NULLIF(direction_id,'')::int,0) = $2
           AND service_id = ANY($3)`,
        [routeId, directionId, serviceIds]
      );

      if (tripsToday.length) {
        // Compute time spans for those trips
        const spans = await db.any(
          `SELECT st.trip_id,
                  MIN(st.departure_secs)::int AS start_secs,
                  MAX(st.departure_secs)::int AS end_secs
           FROM stop_times st
           WHERE st.trip_id = ANY($1)
             AND st.departure_secs IS NOT NULL
           GROUP BY st.trip_id`,
          [tripsToday.map(t => t.trip_id)]
        );

        let chosen = null;
        let inProgress = false;
        if (spans.length) {
          chosen = spans.find(s => s.start_secs <= nowSecs && s.end_secs >= nowSecs) || null;
          if (chosen) {
            inProgress = true;
          } else {
            const upcoming = spans
              .filter(s => s.start_secs > nowSecs)
              .sort((a, b) => a.start_secs - b.start_secs)[0];
            chosen = upcoming || spans.sort((a, b) => a.start_secs - b.start_secs)[0];
          }
        }

        if (chosen && chosen.trip_id) {
          tripMeta = {
            trip_id: chosen.trip_id,
            now_secs: nowSecs,
            now_local: nowLocal,
            start_secs: chosen.start_secs,
            end_secs: chosen.end_secs,
            in_progress: inProgress,
            service_ids_today: serviceIds
          };

          const stopRows = await db.any(
            `SELECT sp.stop_id,
                    sp.stop_name,
                    sp.stop_lon::float AS lon,
                    sp.stop_lat::float AS lat,
                    COALESCE(NULLIF(st.stop_sequence,'')::int,0) AS stop_sequence,
                    st.departure_secs
             FROM stop_times st
             JOIN stops sp ON sp.stop_id = st.stop_id
             WHERE st.trip_id = $1
               AND st.departure_secs IS NOT NULL
             ORDER BY stop_sequence`,
            [chosen.trip_id]
          );

          stopsWithEta = stopRows.map(row => {
            const etaSeconds = row.departure_secs - nowSecs;
            let etaLabel;
            let isPassed = false;
            if (etaSeconds <= -60) {
              isPassed = true;
              etaLabel = 'Departed';
            } else if (etaSeconds < 0) {
              etaLabel = 'Due';
            } else {
              const mins = Math.round(etaSeconds / 60);
              etaLabel = mins + ' min';
            }

            return {
              stop_id: row.stop_id,
              stop_name: row.stop_name,
              lat: row.lon ? row.lat : row.lat,
              lon: row.lon,
              stop_sequence: row.stop_sequence,
              eta_seconds: etaSeconds,
              eta_label: etaLabel,
              is_passed: isPassed,
              is_nearest: false
            };
          });

          // Mark nearest stop in the list and capture its ETA
          const idxNearest = stopsWithEta.findIndex(s => s.stop_id === nearest.stop_id);
          if (idxNearest >= 0) {
            stopsWithEta[idxNearest].is_nearest = true;
            nearestEtaSeconds = stopsWithEta[idxNearest].eta_seconds;
            nearestEtaLabel = stopsWithEta[idxNearest].eta_label;
          }
        }
      }
    }

    return res.json({
      route_id: routeId,
      direction_id: directionId,
      route_short_name: routeMeta ? routeMeta.route_short_name : null,
      route_long_name: routeMeta ? routeMeta.route_long_name : null,
      user_location: {
        lat,
        lng,
        source
      },
      trip: tripMeta,
      nearest_stop: {
        stop_id: nearest.stop_id,
        stop_name: nearest.stop_name,
        lat: nearest.lat,
        lon: nearest.lon,
        distance_meters: nearestDistanceMeters,
        eta_seconds: nearestEtaSeconds,
        eta_label: nearestEtaLabel
      },
      stops: stopsWithEta
    });
  } catch (e) {
    console.error('route timing api error', e);
    res.status(500).json({ error: 'Failed to compute route timing' });
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
    if (error.code === '23505') {
      // Duplicate username
      return res.render('pages/register', {
        message: "An account with this email already exists.",
        error: true
      });
    }
  
    console.error("Error registering user:", error);
    return res.render('pages/register', {
      message: "Registration failed. Please try again.",
      error: true
    });
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
    username: req.session.user.username,
    name: req.session.user.name || "",
    email: req.session.user.email || ""
  };

  const message = req.query.msg || null;
  const error = req.query.error === "true";

  res.render('pages/settings', { 
    userData, 
    activeTab, 
    message, 
    error, 
    title: "Settings" 
  });
});

app.post('/settings/profile/update', auth, async (req, res) => {
  try {
    const { name, email } = req.body;
    const username = req.session.user.username;

    await db.none(
      `UPDATE users SET name=$1, email=$2 WHERE username=$3`,
      [name, email, username]
    );

    // Update session values
    req.session.user.name = name;
    req.session.user.email = email;

    return res.redirect('/settings?tab=profile&msg=Profile updated successfully!');
  } catch (err) {
    console.error(err);
    return res.redirect('/settings?tab=profile&error=true&msg=Failed to update profile.');
  }
});

app.post('/settings/change-password', auth, async (req, res) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body;
    const username = req.session.user.username;

    const user = await db.one(
      "SELECT * FROM users WHERE username=$1",
      [username]
    );

    // Check current password
    const valid = await bcrypt.compare(currentPassword, user.password);
    if (!valid) {
      return res.redirect('/settings?tab=profile&error=true&msg=Current password is incorrect');
    }

    // Check match
    if (newPassword !== confirmPassword) {
      return res.redirect('/settings?tab=profile&error=true&msg=Passwords do not match');
    }

    // Update password
    const hash = await bcrypt.hash(newPassword, 10);
    await db.none(
      "UPDATE users SET password=$1 WHERE username=$2",
      [hash, username]
    );

    return res.redirect('/settings?tab=profile&msg=Password updated successfully!');
  } catch (err) {
    console.error(err);
    return res.redirect('/settings?tab=profile&error=true&msg=Failed to update password');
  }
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

// *****************************************************
// Section 5 : Server Start + GTFS
// *****************************************************

// Only start the server if not in test mode
if (process.env.NODE_ENV !== 'test') {
  const PORT = process.env.PORT || 3000;
  // Default to running the GTFS import/prep pipeline unless explicitly disabled.
  // This makes hosted environments like Render "just work" as long as POSTGRES_*
  // env vars and google_transit.zip are present.
  const RUN_GTFS = process.env.RUN_GTFS === 'false' ? false : true;

  app.listen(PORT, async () => {
    console.log(`Server running on port ${PORT}`);
    if (RUN_GTFS) {
      try {
        console.log("Waiting for database...");
        const waitModule = await import('../scripts/wait_for_db.cjs');
        const waitForDb = waitModule.default || waitModule;
        const ready = await waitForDb();

        if (!ready) {
          console.error("Database did not become ready in time; skipping GTFS import/prep.");
          return;
        }

        console.log("Running GTFS import (google_transit.zip -> raw GTFS tables)...");
        await import('../importGtfs.cjs');
        console.log("GTFS import finished.");

        console.log("Preparing GTFS helper tables (service_dates, route_stops_ordered, etc.)...");
        await import('../scripts/prepare_gtfs.cjs');
        console.log("GTFS preparation finished.");
      } catch (err) {
        console.error("GTFS setup failed:", err);
      }
    } else {
      console.log("RUN_GTFS explicitly disabled — skipping GTFS import and preparation.");
    }
  });
}

// Export app for testing
module.exports = app;
