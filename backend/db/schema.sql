-- Enable UUID extension if not enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Enum Types
CREATE TYPE user_status AS ENUM ('active', 'invited', 'inactive');
CREATE TYPE user_type AS ENUM ('org_admin', 'member');
CREATE TYPE job_status AS ENUM ('published', 'draft', 'archived');
CREATE TYPE interview_status AS ENUM ('pending', 'scheduled', 'completed', 'slot_missed', 'incomplete');
CREATE TYPE cheat_probability AS ENUM ('low', 'medium', 'high');
CREATE TYPE applicant_source AS ENUM ('career_page', 'bulk_upload', 'direct_link', 'scheduled', 'ats');

-- Users Table
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR NOT NULL,
    email VARCHAR UNIQUE NOT NULL,
    designation VARCHAR,
    user_type user_type DEFAULT 'member',
    status user_status DEFAULT 'invited',
    hashed_password VARCHAR,
    registered_on TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_users_email ON users(email);

-- Jobs Table
CREATE TABLE jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    custom_job_id VARCHAR,
    title VARCHAR NOT NULL,
    role_name VARCHAR NOT NULL,
    status job_status DEFAULT 'draft',
    experience_band VARCHAR,
    tags VARCHAR,
    description TEXT,
    location VARCHAR,
    job_type VARCHAR,
    is_job_listed BOOLEAN DEFAULT FALSE,
    resume_parameters TEXT,
    screening_parameters TEXT,
    functional_parameters TEXT,
    resume_analysis_enabled BOOLEAN DEFAULT TRUE,
    recruiter_screening_enabled BOOLEAN DEFAULT TRUE,
    functional_interview_enabled BOOLEAN DEFAULT TRUE,
    created_by_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Applicants Table
CREATE TABLE applicants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR NOT NULL,
    email VARCHAR NOT NULL,
    phone VARCHAR,
    source applicant_source,
    resume_url VARCHAR,
    remarks TEXT,
    job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    resume_analysed BOOLEAN DEFAULT FALSE,
    resume_shortlisted BOOLEAN DEFAULT FALSE,
    resume_waitlisted BOOLEAN DEFAULT FALSE,
    screening_status interview_status,
    screening_score FLOAT,
    screening_scheduled_at TIMESTAMP WITH TIME ZONE,
    functional_status interview_status,
    functional_score FLOAT,
    functional_scheduled_at TIMESTAMP WITH TIME ZONE,
    cheat_probability cheat_probability,
    report_url VARCHAR,
    match_score FLOAT,
    resume_analysis_report TEXT,
    resume_text TEXT,
    decision TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_applicants_email ON applicants(email);

-- Organisations Table
CREATE TABLE organisations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_name VARCHAR NOT NULL,
    domain VARCHAR,
    contact_email VARCHAR,
    website_link VARCHAR,
    location VARCHAR,
    logo_url VARCHAR,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Job Collaborators Table (Junction table for User to Job Many-to-Many)
CREATE TABLE job_collaborators (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    added_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (job_id, user_id)
);
