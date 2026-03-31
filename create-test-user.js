#!/usr/bin/env node

/**
 * Simple script to create a test user in the database.
 * Usage: node create-test-user.js [email] [name] [password]
 */

const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');

const email = process.argv[2] || 'test@example.com';
const name = process.argv[3] || 'Test User';
const password = process.argv[4] || 'TestPassword123!';
const isApproved = process.argv[5] === 'approve' ? 1 : 0;

// Connect to database
const dbPath = path.join(__dirname, 'data', 'plm-sharepoint.db');
const db = new Database(dbPath);

// Hash password
const hash = bcrypt.hashSync(password, 12);

// Create user
const stmt = db.prepare(`
  INSERT INTO users (email, name, company, password_hash, is_approved, is_admin, reason, requested_at)
  VALUES (?, ?, ?, ?, ?, 0, ?, ?)
`);

try {
  const result = stmt.run(
    email,
    name,
    'Test Company',
    hash,
    isApproved,
    'Test user created via script',
    new Date().toISOString()
  );

  console.log(`✅ Test user created successfully!`);
  console.log(`   Email: ${email}`);
  console.log(`   Name: ${name}`);
  console.log(`   Password: ${password}`);
  console.log(`   Approved: ${isApproved === 1 ? 'Yes' : 'No (requires admin approval)'}`);
  console.log(`   User ID: ${result.lastInsertRowid}`);
} catch (err) {
  if (err.message.includes('UNIQUE constraint failed')) {
    console.error(`❌ Error: User with email "${email}" already exists.`);
  } else {
    console.error(`❌ Error creating user:`, err.message);
  }
  process.exit(1);
}

db.close();
