-- PLM SharePoint Database Initialization
-- This script creates the necessary tables and initial data

-- Create users table
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    role VARCHAR(50) DEFAULT 'user',
    status VARCHAR(50) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create groups table
CREATE TABLE IF NOT EXISTS groups (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) UNIQUE NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create user_groups junction table
CREATE TABLE IF NOT EXISTS user_groups (
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    group_id INTEGER REFERENCES groups(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, group_id)
);

-- Create projects table
CREATE TABLE IF NOT EXISTS projects (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    status VARCHAR(50) DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create locations table
CREATE TABLE IF NOT EXISTS locations (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create project_locations junction table
CREATE TABLE IF NOT EXISTS project_locations (
    project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
    location_id INTEGER REFERENCES locations(id) ON DELETE CASCADE,
    PRIMARY KEY (project_id, location_id)
);

-- Create drawings table
CREATE TABLE IF NOT EXISTS drawings (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    file_path VARCHAR(500),
    project_id INTEGER REFERENCES projects(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create sessions table
CREATE TABLE IF NOT EXISTS sessions (
    sid VARCHAR(255) PRIMARY KEY,
    sess JSON NOT NULL,
    expire TIMESTAMP NOT NULL
);

-- Insert initial admin user
INSERT INTO users (email, name, role, status) 
VALUES ('admin@example.com', 'Admin User', 'admin', 'approved')
ON CONFLICT (email) DO NOTHING;

-- Insert initial groups
INSERT INTO groups (name, description) VALUES
    ('Administrators', 'System administrators with full access'),
    ('Engineers', 'Engineering team members'),
    ('Managers', 'Project managers and team leads'),
    ('Viewers', 'Read-only access users')
ON CONFLICT (name) DO NOTHING;

-- Insert sample projects
INSERT INTO projects (name, description) VALUES
    ('Sample Project 1', 'First sample project for testing'),
    ('Sample Project 2', 'Second sample project for testing')
ON CONFLICT DO NOTHING;

-- Insert sample locations
INSERT INTO locations (name, description) VALUES
    ('Main Building', 'Primary facility location'),
    ('Warehouse', 'Storage and logistics facility'),
    ('Remote Office', 'Secondary office location')
ON CONFLICT DO NOTHING;