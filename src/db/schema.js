import { pool, pooluser } from "./connections.js";

async function createTables() {
  try {
    await pooluser.query(`
      CREATE TABLE IF NOT EXISTS credentials (
        id SERIAL PRIMARY KEY,
        username VARCHAR(100) NOT NULL,
        role VARCHAR(10) NOT NULL DEFAULT 'admin',
        email VARCHAR(100) NOT NULL,
        password TEXT NOT NULL
      ); 

        CREATE TABLE IF NOT EXISTS layer_metadata (
          id SERIAL PRIMARY KEY,
          department TEXT NOT NULL,
          layer_name TEXT NOT NULL,

          title TEXT,
          description TEXT,
          abstract TEXT,
          purpose TEXT,
          topic_category TEXT,

          contact_name TEXT,
          contact_organization TEXT,
          contact_email TEXT,
          contact_phone TEXT,

          geometry_type TEXT,
          srid INTEGER,
          scale_denominator TEXT,

          metadata_date DATE DEFAULT CURRENT_DATE,

          positional_accuracy TEXT,
          attribute_accuracy TEXT,
          lineage TEXT,

          citation_title TEXT,
          citation_date DATE,
          publisher TEXT
        );



    `);
    console.log("Tables created successfully.");
  } catch (error) {
    console.error("Error creating tables:", error);
  }
}

createTables();
