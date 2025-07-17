import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import unzipper from 'unzipper';
import multer from 'multer';
import { exec } from 'child_process';
import { fileURLToPath } from 'url';
import { pool, pooluser } from './src/db/connections.js';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import './src/db/schema.js';

dotenv.config();
const app = express();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());



// Configure multer
const storage = multer.diskStorage({
  destination: 'uploads/',
  filename: (req, file, cb) => {
    cb(null, file.originalname); // keep original file name
  }
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (
      file.mimetype === 'application/zip' ||
      file.mimetype === 'application/x-zip-compressed'
    ) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only ZIP files are allowed.'));
    }
  }
});

// 🟢 JWT Middleware
function authenticateJWT(req, res, next) {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.sendStatus(401);
  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
}

// 🔐 Login route
app.post('/', async(req, res) => {
  const { username, password } = req.body;
  console.log(req.body);
  

  const result = await pooluser.query('SELECT * FROM admins WHERE username = $1', [username]);
    const client = result.rows[0];
    const role = result.rows[0].role;
    console.log(client);
    
    if ( !client ||username!=client.username || !(await bcrypt.compare(password, client.password))) {
      const data = { message: 'Invalid Credentials!!', title: "Oops?", icon: "warning", redirect:"/" };
      return res.status(401).json(data);
    }

  const token = jwt.sign({ username: username, role: role }, process.env.JWT_SECRET, { expiresIn: '2h' });
  res.json({ token });
});


// 📁 List departments
app.get('/api', async (req, res) => {
  const result = await pooluser.query('SELECT DISTINCT department FROM layer_metadata');
  res.json(result.rows.map(r => r.department));
});

// 📂 List layers in a department
app.get('/api/:department', async (req, res) => {
  const { department } = req.params;
  console.log(req.params);
  
  console.log(`SELECT layer_name FROM layer_metadata WHERE department = ${department};`)
  
  const result = await pooluser.query(
    'SELECT layer_name FROM layer_metadata WHERE department = $1',
    [department]
  );
  res.json(result.rows);
});

// 🌍 Get GeoJSON of a layer
app.get('/api/:department/:layer', async (req, res) => {
  const { department, layer } = req.params;
  try {
    const result = await pool.query(`
      SELECT *, ST_AsGeoJSON(geom)::json AS geometry 
      FROM "${layer}"
    `);

    const features = result.rows.map(row => {
      const { geometry, geom, ...props } = row;
      return {
        type: 'Feature',
        geometry,
        properties: props
      };
    });

    res.json({ type: 'FeatureCollection', features });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load layer' });
  }
});

// 📝 Get metadata
app.get('/api/:department/:layer/metainfo', authenticateJWT, async (req, res) => {
  const { department, layer } = req.params;
  const result = await pooluser.query(
    'SELECT title, description FROM layer_metadata WHERE department = $1 AND layer_name = $2',
    [department, layer]
  );
  if (result.rowCount === 0) return res.status(404).json({ error: 'Metadata not found' });
  res.json(result.rows[0]);
});

// ✏️ Update metadata
app.put('/api/:department/:layer/metainfo', authenticateJWT, async (req, res) => {
  const { department, layer } = req.params;
  const { title, description } = req.body;

  await pooluser.query(`
    UPDATE layer_metadata 
    SET title = $1, description = $2 
    WHERE department = $3 AND layer_name = $4
  `, [title, description, department, layer]);

  res.json({ message: 'Metadata updated' });
});

// ⬆️ Upload shapefile ZIP and update layer
app.put('/:department/:layer/data', authenticateJWT, upload.single('file'), async (req, res) => {
  const { department, layer } = req.params;
  const file = req.file;
  const schema = department.toLowerCase();
  const table = layer.toLowerCase();
  const uploadDir = `uploads/${Date.now()}`;

  try {
    await fs.promises.mkdir(uploadDir, { recursive: true });

    await fs.createReadStream(file.path)
      .pipe(unzipper.Extract({ path: uploadDir }))
      .promise();

    const shpFile = fs.readdirSync(uploadDir).find(f => f.endsWith('.shp'));
    if (!shpFile) throw new Error('No .shp file found');

    const shpPath = path.join(uploadDir, shpFile);
    const sqlFile = path.join(uploadDir, `${table}.sql`);

    // Drop & Create using shp2pgsql
    const shp2pgsqlCmd = `shp2pgsql -s 4326 -I -W "UTF-8" -g geom -d "${shpPath}" "${schema}.${table}" > "${sqlFile}"`;
    await execPromise(shp2pgsqlCmd);

    const psqlCmd = `psql -U ${process.env.DB_USER} -d ${process.env.DB_NAME} -f "${sqlFile}"`;
    await execPromise(psqlCmd);

    // Get geometry info
    const metaRes = await pooluser.query(`
      SELECT srid, type FROM geometry_columns
      WHERE f_table_schema = $1 AND f_table_name = $2
    `, [schema, table]);

    if (metaRes.rowCount === 0) throw new Error('Geometry not found');

    const { srid, type: geometry_type } = metaRes.rows[0];

    // Upsert metadata
    await pooluser.query(`
      INSERT INTO layer_metadata (department, layer_name, srid, geometry_type)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (department, layer_name)
      DO UPDATE SET srid = $3, geometry_type = $4
    `, [department, layer, srid, geometry_type]);

    res.json({ message: 'Layer updated successfully' });

  } catch (err) {
    console.error('Upload failed:', err);
    res.status(500).json({ error: err.message || 'Upload failed' });
  } finally {
    fs.promises.rm(uploadDir, { recursive: true, force: true }).catch(() => {});
    fs.promises.unlink(file.path).catch(() => {});
  }
});

app.post('/upload', upload.single('file'), async (req, res) => {
  const { department,filename  } = req.body;
  const db = 'geodatasets';

  // if (!filename || !file_type || !theme || !srid) {
  //   return res.status(400).json({ message: 'All fields are required' });
  // }

  const client = await pool.connect();
// if (!filename || !file_type || !theme || !srid) {
//     return res.status(400).json({ message: 'All fields are required' });
//   }

  try {
    // Check if layer already exists
    const check = await client.query(`SELECT 1 FROM geodatasets WHERE filename = $1`, [filename]);
    if (check.rowCount > 0) {
      return res.status(400).json({ message: 'Shapefile name already exists' });
    }

    // Unzip
    const zipPath = req.file.path;
    const unzipPath = path.join('shpuploads', filename);
    new AdmZip(zipPath).extractAllTo(unzipPath, true);

    // Find .shp file
    const shpFile = fs.readdirSync(unzipPath).find(f => f.endsWith('.shp'));
    if (!shpFile) throw new Error('No .shp file found in zip');

    const shpPath = path.join(unzipPath, shpFile);
    const cmd = `shp2pgsql -I -s ${srid} "${shpPath}" ${filename} | psql -U ${process.env.db_user} -d ${theme}`;

    // Upload to DB
    exec(cmd, { env: { ...process.env, PGPASSWORD: process.env.PGPASSWORD } }, async (err, stdout, stderr) => {
      if (err) {
        console.error(stderr);
        return res.status(500).json({ message: 'Error uploading shapefile' });
      }

      // Save original zip
      const catalogDir = path.join(process.cwd(), 'catalog');
      if (!fs.existsSync(catalogDir)) fs.mkdirSync(catalogDir);
      const zipDest = path.join(catalogDir, `${filename}.zip`);
      fs.copyFileSync(zipPath, zipDest);

      // Insert metadata
      await client.query(
        `INSERT INTO catalog (filename, file_type, theme, srid, visibility, is_published)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [filename, file_type, theme, srid, false, false]
      );

    

      res.status(201).json({ message: 'Shapefile uploaded successfully' });
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Upload failed' });
  } finally {
    client.release();
  }
});



function execPromise(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, { env: process.env }, (err, stdout, stderr) => {
      if (err) return reject(stderr);
      resolve(stdout);
    });
  });
}

// // 🔚 Default route
// app.get('/', (req, res) => {
//   res.sendFile(path.join(__dirname, 'public', 'login.html'));
// });

app.get('/', (req, res) => {
  res.redirect('/login.html');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running at http://localhost:${PORT}`));
