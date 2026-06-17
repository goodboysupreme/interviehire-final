-- Seed default Org. Admin
INSERT INTO users (id, name, email, designation, user_type, status)
VALUES ('e7b78912-32a1-4f9e-9d8b-1a2c3d4e5f60', 'Devasri', 'devasri@interviehire.ai', 'Org. Admin', 'org_admin', 'active')
ON CONFLICT (email) DO NOTHING;

-- Seed default jobs
INSERT INTO jobs (id, custom_job_id, role_name, title, status, experience_band, is_job_listed, created_by_id)
VALUES 
('d5089c1e-920f-48d6-a241-d56e7f8a9b0c', 'AKRO62EF45E26EA1', 'Government Tender & Proposal Executive', 'Government Tender & Proposal Executive..', 'published', 'Upto 2 Years', TRUE, 'e7b78912-32a1-4f9e-9d8b-1a2c3d4e5f60'),
('a123bc45-de67-890a-bc12-d345ef67890a', 'AKRO62EF45E26DF5', 'Full Stack Developer', 'Full Stack Developer Hiring - Demo', 'published', '1-4 Years', TRUE, 'e7b78912-32a1-4f9e-9d8b-1a2c3d4e5f60')
ON CONFLICT DO NOTHING;

-- Seed default applicants
INSERT INTO applicants (name, email, source, job_id, resume_analysed, screening_status, functional_status, functional_score, cheat_probability, report_url)
VALUES
('Aditya Rana', 'aditya@interviehire.com', 'direct_link', 'a123bc45-de67-890a-bc12-d345ef67890a', TRUE, NULL, 'completed', 94.0, 'low', '#'),
('Devasri Bali', 'devasri@company.com', 'direct_link', 'd5089c1e-920f-48d6-a241-d56e7f8a9b0c', TRUE, NULL, 'completed', 96.0, 'low', '#')
ON CONFLICT DO NOTHING;

INSERT INTO applicants (name, email, source, job_id, resume_analysed, screening_status, screening_score, functional_status)
VALUES
('Ines Caetano', 'ines@design.io', 'scheduled', 'd5089c1e-920f-48d6-a241-d56e7f8a9b0c', TRUE, 'scheduled', 87.0, NULL),
('Sarah Jenkins', 'sarah.j@techcorp.com', 'scheduled', 'd5089c1e-920f-48d6-a241-d56e7f8a9b0c', TRUE, 'scheduled', 91.0, NULL)
ON CONFLICT DO NOTHING;

-- Seed organisation settings
INSERT INTO organisations (org_name, domain, contact_email, website_link, location, description)
VALUES ('devasri-tech', 'devasri-tech', 'devasri@interviehire.ai', 'https://interviehire.ai', 'Remote', 'Build the future of technology with us.')
ON CONFLICT DO NOTHING;
