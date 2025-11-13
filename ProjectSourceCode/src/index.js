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
const auth = (req, res, next) => {
  if (!req.session.user) {
    // Default to login page.
    return res.redirect('/login');
  }
  next();
};

app.get('/welcome', (req, res) => {
  res.json({status: 'success', message: 'Welcome!'});
});

// Authentication Required
// app.use(auth);

// ---------- Routes -----------
app.get('/', (req, res) => {
  res.redirect('/login');
});

// ========== API: Routes list ==========
// Returns a list of routes with id and display names for sidebar use
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

// Available directions for a route (based on representative trips we computed)
app.get('/api/routes/:route_id/directions', async (req, res) => {
  try {
    const rows = await db.any(
      `SELECT direction_id
       FROM route_representatives
       WHERE route_id = $1
       ORDER BY direction_id`,
      [req.params.route_id]
    );
    return res.json(rows.map(r => r.direction_id));
  } catch (e) {
    console.error('directions api error', e);
    return res.status(500).json({ error: 'Failed to load directions' });
  }
});

// Route shape GeoJSON (precomputed FeatureCollection with a LineString)
app.get('/api/routes/:route_id/shape', async (req, res) => {
  const routeId = req.params.route_id;
  const q = req.query.direction_id;
  const directionId = Number.isFinite(Number(q)) ? Number(q) : 0;
  try {
    const row = await db.oneOrNone(
      `SELECT geojson
       FROM route_shapes_geojson
       WHERE route_id = $1 AND direction_id = $2`,
      [routeId, directionId]
    );
    if (!row) return res.status(404).json({ error: 'Shape not found for route/direction' });
    return res.json(row.geojson);
  } catch (e) {
    console.error('shape api error', e);
    return res.status(500).json({ error: 'Failed to load shape' });
  }
});

// Ordered stops for a route/direction (from representative trip)
app.get('/api/routes/:route_id/stops', async (req, res) => {
  const routeId = req.params.route_id;
  const q = req.query.direction_id;
  const directionId = Number.isFinite(Number(q)) ? Number(q) : 0;
  try {
    const rows = await db.any(
      `SELECT stop_id, stop_name, lon, lat, stop_sequence
       FROM route_stops_ordered
       WHERE route_id = $1 AND direction_id = $2
       ORDER BY stop_sequence`,
      [routeId, directionId]
    );
    return res.json(rows);
  } catch (e) {
    console.error('stops api error', e);
    return res.status(500).json({ error: 'Failed to load stops' });
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
