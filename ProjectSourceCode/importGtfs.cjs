// importGtfs.cjs
const fs = require('fs');
const path = require('path');
const unzipper = require('unzipper');
const pgp = require('pg-promise')();
const { from } = require('pg-copy-streams');
require('dotenv').config();

const dbConfig = {
  host: process.env.POSTGRES_HOST,
  port: process.env.POSTGRES_PORT,
  database: process.env.POSTGRES_DB,
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD
};

const db = pgp(dbConfig);

const zipPath = path.join(__dirname, 'google_transit.zip');
const extractPath = path.join(__dirname, 'gtfs_unzipped');

async function tableExists(tableName) {
  const query = `
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_name = $1
    );
  `;
  const result = await db.one(query, [tableName]);
  return result.exists;
}

async function unzipGtfs() {
  console.log('Unzipping GTFS file...');

  if (fs.existsSync(extractPath)) {
    fs.rmSync(extractPath, { recursive: true });
  }

  fs.mkdirSync(extractPath);

  await fs
    .createReadStream(zipPath)
    .pipe(unzipper.Extract({ path: extractPath }))
    .promise();

  console.log('GTFS files extracted.');
}

async function createTableFromHeader(tableName, headers) {
  const columns = headers.map(h => `"${h}" TEXT`).join(', ');
  const sql = `CREATE TABLE IF NOT EXISTS "${tableName}" (${columns});`;
  await db.none(sql);
  console.log(`Table ensured: ${tableName}`);
}

async function importCsvToTable(tableName, filePath, headers) {
  console.log(`Importing data into ${tableName}...`);

  const client = await db.connect();
  const fileStream = fs.createReadStream(filePath);

  try {
    const colList = headers.map(h => `"${h}"`).join(', ');
    const copySql = `COPY "${tableName}" (${colList}) FROM STDIN WITH CSV HEADER`;
    const copyStream = client.client.query(from(copySql));

    await new Promise((resolve, reject) => {
      fileStream.pipe(copyStream)
        .on('finish', resolve)
        .on('error', reject);
    });

    console.log(`Imported data for: ${tableName}`);
  } catch (err) {
    console.error(`Import failed for ${tableName}:`, err.message);
  } finally {
    client.done();
  }
}

async function runImport() {
  try {
    console.log('Testing DB connection...');
    const c = await db.connect();
    console.log('Database connection successful.');
    c.done();

    await unzipGtfs();

    const txtFiles = fs.readdirSync(extractPath).filter(f => f.endsWith('.txt'));

    if (txtFiles.length === 0) {
      console.error('No GTFS .txt files found.');
      return;
    }

    for (const file of txtFiles) {
      const tableName = path.basename(file, '.txt');

      // Skip if table already exists
      if (await tableExists(tableName)) {
        console.log(`Table already exists, skipping: ${tableName}`);
        continue;
      }

      const filePath = path.join(extractPath, file);
      const headerLine = fs.readFileSync(filePath, 'utf8').split('\n')[0];
      const headers = headerLine
        .split(',')
        .map(h => h.trim().replace(/\r/g, ''))
        .filter(Boolean);

      if (!headers.length) {
        console.warn(`Skipping ${file}: no headers found.`);
        continue;
      }

      await createTableFromHeader(tableName, headers);
      await importCsvToTable(tableName, filePath, headers);
    }

    console.log('GTFS import complete.');
  } catch (err) {
    console.error('GTFS import failed:', err.message);
  } // finally {
    //     pgp.end(); // ❌ remove this
    // }
}

runImport();
