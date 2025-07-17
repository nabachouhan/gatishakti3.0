import { pool } from "./connections.js";

async function createTables() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS admins (
        id SERIAL PRIMARY KEY,
        username VARCHAR(100) NOT NULL,
        role VARCHAR(10) NOT NULL DEFAULT 'admin',
        email VARCHAR(100) NOT NULL,
        password TEXT NOT NULL
      ); 

      CREATE TABLE IF NOT EXISTS clients (
        id SERIAL PRIMARY KEY,
        username VARCHAR(100) NOT NULL,
        role VARCHAR(10) NOT NULL DEFAULT 'client',
        email VARCHAR(100) NOT NULL,
        password TEXT NOT NULL
      ); 
      
      CREATE OR REPLACE FUNCTION notify_layer_change()
        RETURNS trigger AS $$
        BEGIN
        PERFORM pg_notify('layer_update', TG_TABLE_NAME);
        RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        CREATE TABLE IF NOT EXISTS layer_metadata (
        id SERIAL PRIMARY KEY,
        department TEXT NOT NULL,
        layer_name TEXT NOT NULL,
        title TEXT,
        description TEXT,
        srid INTEGER,
        geometry_type TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(department, layer_name)
);


    `);
    console.log("Tables created successfully.");
  } catch (error) {
    console.error("Error creating tables:", error);
  }
}

createTables();
