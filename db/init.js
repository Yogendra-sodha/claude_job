/**
 * Database initialization script
 * Creates the 'jobflow' database and runs schema.sql
 * 
 * Usage: node db/init.js
 */

const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const DB_NAME = process.env.DB_NAME || 'jobflow';

async function init() {
  // Step 1: Connect to default 'postgres' database to create our database
  const adminClient = new Client({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    database: 'postgres', // connect to default db first
  });

  try {
    await adminClient.connect();
    console.log('✓ Connected to PostgreSQL');

    // Check if database exists
    const res = await adminClient.query(
      `SELECT 1 FROM pg_database WHERE datname = $1`, [DB_NAME]
    );

    if (res.rows.length === 0) {
      await adminClient.query(`CREATE DATABASE ${DB_NAME}`);
      console.log(`✓ Created database "${DB_NAME}"`);
    } else {
      console.log(`✓ Database "${DB_NAME}" already exists`);
    }
  } catch (err) {
    console.error('✗ Failed to create database:', err.message);
    process.exit(1);
  } finally {
    await adminClient.end();
  }

  // Step 2: Connect to our database and run schema
  const appClient = new Client({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    database: DB_NAME,
  });

  try {
    await appClient.connect();
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    await appClient.query(schema);
    console.log('✓ Schema applied successfully');
    console.log('✓ Database ready!');
  } catch (err) {
    console.error('✗ Failed to apply schema:', err.message);
    process.exit(1);
  } finally {
    await appClient.end();
  }
}

init();
