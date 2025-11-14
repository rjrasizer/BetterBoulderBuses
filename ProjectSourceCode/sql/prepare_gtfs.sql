-- GTFS preparation for fast querying
-- Safe to re-run (uses IF NOT EXISTS/ON CONFLICT where applicable)

-- Verify tables (optional)
SELECT table_name
FROM information_schema.tables
WHERE table_schema='public'
  AND table_name IN ('routes','stops','trips','stop_times','shapes','calendar','calendar_dates')
ORDER BY 1;

-- Quick counts (optional)
DO $$ BEGIN
  IF to_regclass('public.routes') IS NOT NULL AND
     to_regclass('public.stops') IS NOT NULL AND
     to_regclass('public.trips') IS NOT NULL AND
     to_regclass('public.stop_times') IS NOT NULL AND
     to_regclass('public.shapes') IS NOT NULL AND
     to_regclass('public.calendar') IS NOT NULL THEN
    RAISE NOTICE 'routes: %, stops: %, trips: %, stop_times: %, shapes: %, calendar: %',
      (SELECT count(*) FROM routes),
      (SELECT count(*) FROM stops),
      (SELECT count(*) FROM trips),
      (SELECT count(*) FROM stop_times),
      (SELECT count(*) FROM shapes),
      (SELECT count(*) FROM calendar);
  END IF;
END $$;

ANALYZE;

-- Indexes
CREATE INDEX IF NOT EXISTS trips_route_dir_idx ON trips(route_id, direction_id);
CREATE INDEX IF NOT EXISTS trips_shape_idx ON trips(shape_id);
CREATE INDEX IF NOT EXISTS stop_times_trip_seq_idx ON stop_times(trip_id, stop_sequence);
CREATE INDEX IF NOT EXISTS stop_times_stop_time_idx ON stop_times(stop_id, departure_time);
CREATE INDEX IF NOT EXISTS shapes_id_seq_idx ON shapes(shape_id, shape_pt_sequence);
CREATE INDEX IF NOT EXISTS stops_id_idx ON stops(stop_id);
CREATE INDEX IF NOT EXISTS calendar_service_idx ON calendar(service_id);

-- Ensure calendar_dates exists (some feeds omit it)
CREATE TABLE IF NOT EXISTS calendar_dates(
  service_id text,
  date text,
  exception_type int
);
-- Only create index if table exists and has columns
DO $$ BEGIN
  IF to_regclass('public.calendar_dates') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS calendar_dates_service_date_idx ON calendar_dates(service_id, date)';
  END IF;
END $$;

-- Time helper: seconds since midnight for departure_time
ALTER TABLE stop_times ADD COLUMN IF NOT EXISTS departure_secs integer;
UPDATE stop_times
SET departure_secs =
  split_part(departure_time,':',1)::int * 3600 +
  split_part(departure_time,':',2)::int * 60 +
  split_part(departure_time,':',3)::int
WHERE departure_time IS NOT NULL
  AND departure_time <> ''
  AND departure_secs IS NULL;
CREATE INDEX IF NOT EXISTS stop_times_stop_secs_idx ON stop_times(stop_id, departure_secs);

-- Service dates (expands calendar + applies calendar_dates exceptions)
CREATE TABLE IF NOT EXISTS service_dates(
  service_id text,
  service_date date,
  active boolean,
  PRIMARY KEY(service_id, service_date)
);

-- Expand calendar weekdays into dates
INSERT INTO service_dates(service_id, service_date, active)
SELECT c.service_id, d::date, true
FROM calendar c
JOIN generate_series(to_date(c.start_date,'YYYYMMDD'), to_date(c.end_date,'YYYYMMDD'), interval '1 day') d
  ON (CASE extract(dow from d)
        WHEN 0 THEN COALESCE(NULLIF(c.sunday,'')::int, 0)
        WHEN 1 THEN COALESCE(NULLIF(c.monday,'')::int, 0)
        WHEN 2 THEN COALESCE(NULLIF(c.tuesday,'')::int, 0)
        WHEN 3 THEN COALESCE(NULLIF(c.wednesday,'')::int, 0)
        WHEN 4 THEN COALESCE(NULLIF(c.thursday,'')::int, 0)
        WHEN 5 THEN COALESCE(NULLIF(c.friday,'')::int, 0)
        WHEN 6 THEN COALESCE(NULLIF(c.saturday,'')::int, 0)
      END) = 1
ON CONFLICT DO NOTHING;

-- Apply calendar_dates removals (exception_type=2)
DELETE FROM service_dates sd
USING calendar_dates cd
WHERE sd.service_id = cd.service_id
  AND sd.service_date = to_date(cd.date,'YYYYMMDD')
  AND COALESCE(NULLIF(cd.exception_type,'')::int, 0) = 2;

-- Apply calendar_dates additions (exception_type=1)
INSERT INTO service_dates(service_id, service_date, active)
SELECT cd.service_id, to_date(cd.date,'YYYYMMDD'), true
FROM calendar_dates cd
WHERE COALESCE(NULLIF(cd.exception_type,'')::int, 0) = 1
ON CONFLICT (service_id, service_date) DO UPDATE SET active = EXCLUDED.active;

-- Representative trip per route+direction
CREATE TABLE IF NOT EXISTS route_representatives(
  route_id text,
  direction_id int,
  trip_id text,
  shape_id text,
  PRIMARY KEY(route_id, direction_id)
);

WITH trip_shapes AS (
  SELECT t.route_id,
         COALESCE(NULLIF(t.direction_id,'')::int, 0) AS direction_id,
         t.trip_id,
         t.shape_id,
         COUNT(st.stop_sequence) AS stops,
         (SELECT COUNT(*) FROM shapes s WHERE s.shape_id = t.shape_id) AS shape_pts
  FROM trips t
  LEFT JOIN stop_times st ON st.trip_id = t.trip_id
  GROUP BY t.route_id, t.direction_id, t.trip_id, t.shape_id
),
ranked AS (
  SELECT *,
         ROW_NUMBER() OVER (
           PARTITION BY route_id, direction_id
           ORDER BY shape_pts DESC NULLS LAST, stops DESC NULLS LAST, trip_id
         ) rn
  FROM trip_shapes
)
INSERT INTO route_representatives(route_id, direction_id, trip_id, shape_id)
SELECT route_id, direction_id, trip_id, shape_id
FROM ranked
WHERE rn = 1
ON CONFLICT (route_id, direction_id)
DO UPDATE SET trip_id = EXCLUDED.trip_id, shape_id = EXCLUDED.shape_id;

-- Precomputed shapes as GeoJSON-like JSONB (no PostGIS required)
CREATE TABLE IF NOT EXISTS route_shapes_geojson(
  route_id text,
  direction_id int,
  geojson jsonb,
  PRIMARY KEY(route_id, direction_id)
);

WITH pts AS (
  SELECT rr.route_id,
         rr.direction_id,
         COALESCE(NULLIF(s.shape_pt_sequence,'')::int, 0) AS seq,
         s.shape_pt_lon AS lng,
         s.shape_pt_lat AS lat
  FROM route_representatives rr
  JOIN shapes s ON s.shape_id = rr.shape_id
),
grouped AS (
  SELECT route_id,
         direction_id,
         jsonb_agg(jsonb_build_array(lng, lat) ORDER BY seq) AS coords
  FROM pts
  GROUP BY route_id, direction_id
)
INSERT INTO route_shapes_geojson(route_id, direction_id, geojson)
SELECT route_id,
       direction_id,
       jsonb_build_object(
         'type','FeatureCollection',
         'features', jsonb_build_array(
           jsonb_build_object(
             'type','Feature',
             'properties', jsonb_build_object('route_id', route_id, 'direction_id', direction_id),
             'geometry', jsonb_build_object('type','LineString','coordinates', coords)
           )
         )
       )
FROM grouped
ON CONFLICT (route_id, direction_id)
DO UPDATE SET geojson = EXCLUDED.geojson;

-- Ordered stops for representative trip per route+direction
CREATE TABLE IF NOT EXISTS route_stops_ordered(
  route_id text,
  direction_id int,
  stop_id text,
  stop_sequence int,
  stop_name text,
  lon double precision,
  lat double precision,
  PRIMARY KEY(route_id, direction_id, stop_id, stop_sequence)
);

INSERT INTO route_stops_ordered(route_id, direction_id, stop_id, stop_sequence, stop_name, lon, lat)
SELECT t.route_id,
       COALESCE(NULLIF(t.direction_id,'')::int, 0) AS direction_id,
       st.stop_id,
       COALESCE(NULLIF(st.stop_sequence,'')::int, 0) AS stop_sequence,
       sp.stop_name,
        NULLIF(sp.stop_lon,'')::double precision AS lon,
        NULLIF(sp.stop_lat,'')::double precision AS lat
FROM route_representatives rr
JOIN trips t ON t.trip_id = rr.trip_id
JOIN stop_times st ON st.trip_id = t.trip_id
JOIN stops sp ON sp.stop_id = st.stop_id
ON CONFLICT DO NOTHING;

-- Quick verifies
SELECT route_id, direction_id, jsonb_typeof(geojson) AS geojson_type
FROM route_shapes_geojson
LIMIT 5;

SELECT route_id, direction_id, COUNT(*) AS stops
FROM route_stops_ordered
GROUP BY 1,2
ORDER BY 1,2
LIMIT 10;
