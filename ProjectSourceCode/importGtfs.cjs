// importGtfs.cjs
const fs = require('fs');
const path = require('path');
const unzipper = require('unzipper');
const pgp = require('pg-promise')();
const { from } = require('pg-copy-streams');
const dotenv = require('dotenv');
dotenv.config();

const dbConfig = {
  host: 'db',
  port: 5432,
  database: process.env.POSTGRES_DB,
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD
};

const db = pgp(dbConfig);
const zipPath = path.join(__dirname, 'google_transit.zip');
const extractPath = path.join(__dirname, 'gtfs_unzipped');

async function unzipGtfs() {
  console.log('Unzipping GTFS file...');
  if (fs.existsSync(extractPath)) fs.rmSync(extractPath, { recursive: true });
  fs.mkdirSync(extractPath);
  await fs.createReadStream(zipPath).pipe(unzipper.Extract({ path: extractPath })).promise();
  console.log('✅ GTFS files extracted.');
}

async function createTableFromHeader(tableName, headers) {
  const columns = headers.map(h => `${h} TEXT`).join(', ');
  const sql = `CREATE TABLE IF NOT EXISTS "${tableName}" (${columns});`;
  await db.none(sql);
  console.log(`🧱 Created table: ${tableName}`);
}

async function importCsvToTable(tableName, filePath) {
  console.log(`⬆️  Importing ${tableName}...`);
  const client = await db.connect();
  const fileStream = fs.createReadStream(filePath);

  try {
    const copyStream = client.client.query(from(`COPY "${tableName}" FROM STDIN WITH CSV HEADER`));
    await new Promise((resolve, reject) => {
      fileStream.pipe(copyStream)
        .on('finish', resolve)
        .on('error', reject);
    });
    console.log(`✅ Imported: ${tableName}`);
  } catch (err) {
    console.error(`⚠️  Failed importing ${tableName}:`, err.message);
  } finally {
    client.done();
  }
}

async function runImport() {
  try {
    console.log('Connecting to database...');
    const obj = await db.connect();
    console.log('✅ Connected to database!');
    obj.done();

    await unzipGtfs();

    // Get all .txt files in extracted GTFS folder
    const txtFiles = fs.readdirSync(extractPath).filter(f => f.endsWith('.txt'));
    if (txtFiles.length === 0) {
      console.error('❌ No GTFS .txt files found.');
      return;
    }

    for (const file of txtFiles) {
      const tableName = path.basename(file, '.txt');
      const filePath = path.join(extractPath, file);
      const firstLine = fs.readFileSync(filePath, 'utf8').split('\n')[0];
      const headers = firstLine.split(',').map(h => h.trim().replace(/\r/g, '')).filter(Boolean);

      if (!headers.length) {
        console.warn(`Skipping ${file} (no headers found)`);
        continue;
      }

      await createTableFromHeader(tableName, headers);
      await importCsvToTable(tableName, filePath);
    }

    console.log('🎉 All GTFS files imported successfully!');
  } catch (err) {
    console.error('❌ Import failed:', err.message);
  } finally {
    pgp.end();
  }
}

runImport();
