import pkg from 'pg';
const { Pool } = pkg;
import dotenv from 'dotenv';
dotenv.config();

const pool = new Pool({
    user: process.env.db_user,
    host: process.env.db_host,
    database: process.env.db_name,
    password: process.env.db_pw,
    port: process.env.db_port,
});

const pooluser = new Pool({
    user: process.env.db_user,
    host: process.env.db_host,
    database: process.env.user_db_name,
    password: process.env.db_pw,
    port: process.env.db_port,
});

export { pool, pooluser };

console.log("connected")