'use client';

import { useEffect } from 'react';
import { initLandingPage } from '../../src/main';

const landingHtml = `
    <!-- Background grid elements -->
    <div class="bg-grid"></div>
    <div class="bg-radial"></div>
    
    <!-- Glowing decorative orbs -->
    <div class="glow-orb orb-1"></div>
    <div class="glow-orb orb-2"></div>
    <div class="glow-orb orb-3"></div>

    <!-- Fullscreen 3D Canvas Background -->
    <div id="canvas-container">
      <canvas id="canvas-3d"></canvas>
    </div>

    <!-- Navigation Header -->
    <header id="nav-header">
      <div class="nav-container">
        <a href="#hero" class="logo" id="logo-link">
          <div class="logo-dot"></div>
          <span>intervieHire</span>
        </a>
        <nav>
          <ul>
            <li><a href="#problem">The Problem</a></li>
            <li><a href="#solution">The Solution</a></li>
            <li><a href="#matrix">Market Fit</a></li>
            <li><a href="#calculator">ROI Calculator</a></li>
            <li><a href="#contact">Contact</a></li>
          </ul>
        </nav>
        <div class="nav-actions">
          <button class="sound-toggle muted" id="sound-toggle-btn" aria-label="Toggle Sound" title="Toggle Interactive Sound">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>
            </svg>
          </button>
          <a href="/dashboard" class="btn btn-secondary" style="padding: 10px 20px; font-size: 0.9rem; margin-right: 8px;">Dashboard</a>
          <a href="#contact" class="btn btn-primary" style="padding: 10px 20px; font-size: 0.9rem; background: var(--color-gold); color: #0A0A0A; border: none;">Book a Demo</a>
        </div>
      </div>
    </header>

    <!-- Hero Section -->
    <section class="hero" id="hero">
      <div class="hero-container">
        <div class="hero-left">
          <div class="badge badge-glow">The Future of HR Tech</div>
          <h1>Precision Hiring.<br>Powered by AI,<br>Validated by <span class="gradient-accent">Experts.</span></h1>
          <p>We replace your fragmented hiring stack with role-specific AI screening and vetted industry experts. Filter the noise, hire the best.</p>
          <div class="hero-cta">
            <a href="#contact" class="btn btn-primary" id="hero-cta-primary">
              Start Free Pilot
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-left: 2px;"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
            </a>
            <a href="#solution" class="btn btn-secondary" id="hero-cta-secondary">See How it Works</a>
          </div>
        </div>
        <div class="hero-right">
          <div class="hero-visual-cluster" id="hero-visual-cluster">
            <!-- Connection path curve -->
            <svg class="hero-svg-connector" viewBox="0 0 400 350" fill="none">
              <path d="M 330,65 C 240,90 260,200 170,230 C 120,250 90,270 230,290" stroke="url(#hero-gradient-path)" stroke-width="2.5" stroke-dasharray="6,4" />
              <defs>
                <linearGradient id="hero-gradient-path" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stop-color="#ffd700" stop-opacity="0.6" />
                  <stop offset="50%" stop-color="#ff0d3f" stop-opacity="0.8" />
                  <stop offset="100%" stop-color="#ffc72c" stop-opacity="0.6" />
                </linearGradient>
              </defs>
            </svg>
            
            <!-- Floating cards -->
            <div class="hero-card card-match glass-card" id="card-match-3d">
              <div class="card-match-header">
                <div class="card-icon-round"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent-cyan)" stroke-width="2.5"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="9" y1="3" x2="9" y2="21"></line><line x1="15" y1="3" x2="15" y2="21"></line><line x1="3" y1="9" x2="21" y2="9"></line><line x1="3" y1="15" x2="21" y2="15"></line></svg></div>
                <span class="card-match-title">AI Match: <span class="highlight-val">98%</span></span>
              </div>
              <div class="progress-bar-container">
                <div class="progress-bar-fill" id="hero-progress-fill"></div>
              </div>
            </div>
            
            <div class="hero-card card-review glass-card" id="card-review-3d">
              <div class="card-review-header">
                <span class="card-review-title">Expert Review</span>
                <div class="badge-check-icon"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="3"><polyline points="20 6 9 17 4 12"></polyline></svg></div>
              </div>
              <div class="card-review-body">
                <div class="card-avatar">SJ</div>
                <div class="card-review-details">
                  <div class="card-reviewer-name">Sarah J.</div>
                  <div class="card-reviewer-role">Sr. Engineer @ TechCorp</div>
                </div>
              </div>
            </div>
            
            <div class="hero-card card-hired glass-card" id="card-hired-3d">
              <div class="card-hired-inner">
                <div class="pulsing-hired-dot"></div>
                <span class="card-hired-text">Hired.</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Problem Section -->
    <section class="container" id="problem">
      <div class="section-header">
        <div class="badge">The Status Quo</div>
        <h2>The Hiring Process is <span class="gradient-accent">Broken.</span></h2>
        <p>Startups and enterprises lose valuable resources every day trying to manage disconnected workflows and biased evaluation tools.</p>
      </div>
      
      <div class="problem-grid">
        <!-- Card 1 -->
        <div class="glass-card problem-card" id="problem-card-cost">
          <div class="metric">$100B</div>
          <h3>Lost Yearly</h3>
          <p>Wasted globally in slow, biased, or highly inefficient talent acquisition strategies that fail to predict performance.</p>
        </div>
        <!-- Card 2 -->
        <div class="glass-card problem-card" id="problem-card-time">
          <div class="metric">35%</div>
          <h3>Manager Time Drained</h3>
          <p>Managers spend over a third of their work week in screening calls and early-stage interviews, costing thousands per hire.</p>
        </div>
        <!-- Card 3 -->
        <div class="glass-card problem-card" id="problem-card-tools">
          <div class="metric">6+</div>
          <h3>Fragmented Tools</h3>
          <p>Teams run ATS, scheduling, assessments, CRMs, and manual background checks separately, creating operational chaos.</p>
        </div>
      </div>
    </section>

    <!-- Transition Morph Section -->
    <section class="transition-morph-section" id="transition-morph">
      <div class="morph-container">
        
        <!-- Left Text Column -->
        <div class="morph-text-column">
          <div class="morph-text-item" id="morph-text-1">Meet your current interviewer.</div>
          <div class="morph-text-item" id="morph-text-2">Tired. Biased. Unavailable.</div>
          <div class="morph-text-item" id="morph-text-3">Meet your next one.</div>
        </div>

        <!-- Center Figures Container -->
        <div class="morph-visual-container">
          <!-- Cyber HUD Telemetry Details -->
          <div class="hud-panel hud-left">
            <div class="hud-title">SYSTEM DIAGNOSTIC</div>
            <div class="hud-item">MODE: <span id="hud-val-mode" class="hud-glow-red">TRADITIONAL</span></div>
            <div class="hud-item">COGNITIVE BIAS: <span id="hud-val-bias" class="hud-glow-red">84.2%</span></div>
            <div class="hud-item">REASONING LATENCY: <span id="hud-val-latency">420MS</span></div>
          </div>
          
          <div class="hud-panel hud-right">
            <div class="hud-title">AGENT PARAMETERS</div>
            <div class="hud-item">OBJECTIVITY: <span id="hud-val-objectivity">N/A</span></div>
            <div class="hud-item">CONSISTENCY: <span id="hud-val-consistency">LOW</span></div>
            <div class="hud-item">AVAILABILITY: <span id="hud-val-availability">20%</span></div>
          </div>

          <!-- SVG with glow filter defs -->
          <svg style="position: absolute; width: 0; height: 0;">
            <defs>
              <filter id="neon-glow-red" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="4" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
              <filter id="neon-glow-gold" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="5" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
          </svg>

          <!-- Human figure -->
          <div class="morph-figure-wrapper human-wrapper" id="morph-human-wrapper">
            <svg viewBox="0 0 200 260" fill="none" xmlns="http://www.w3.org/2000/svg" class="morph-svg" filter="url(#neon-glow-red)">
              <circle cx="100" cy="60" r="32" stroke="#ff0d3f" stroke-width="1.8"/>
              <path d="M88 90 L88 108 M112 90 L112 108" stroke="#ff0d3f" stroke-width="1.8" stroke-linecap="round"/>
              <path d="M40 140 C40 120 70 110 100 110 C130 110 160 120 160 140 L160 220 L40 220 Z" stroke="#ff0d3f" stroke-width="1.8" fill="none"/>
              <path d="M100 110 L88 145 M100 110 L112 145" stroke="#ff0d3f" stroke-width="1" stroke-opacity="0.5"/>
              <path d="M40 140 L20 185 M160 140 L180 185" stroke="#ff0d3f" stroke-width="1.8" stroke-linecap="round" stroke-opacity="0.6"/>
            </svg>
            <div class="morph-scan-line" id="morph-scan-line"></div>
          </div>

          <!-- AI figure -->
          <div class="morph-figure-wrapper ai-wrapper" id="morph-ai-wrapper">
            <svg viewBox="0 0 200 260" fill="none" xmlns="http://www.w3.org/2000/svg" class="morph-svg" filter="url(#neon-glow-gold)">
              <path d="M100 28 L130 45 L130 79 L100 96 L70 79 L70 45 Z" stroke="#d4af37" stroke-width="2"/>
              <path d="M100 28 L100 96 M70 45 L130 79 M130 45 L70 79" stroke="#d4af37" stroke-width="0.5" stroke-opacity="0.4"/>
              <rect x="83" y="54" width="8" height="6" rx="1" fill="#d4af37" fill-opacity="0.9"/>
              <rect x="109" y="54" width="8" height="6" rx="1" fill="#d4af37" fill-opacity="0.9"/>
              <circle cx="100" cy="62" r="18" stroke="#d4af37" stroke-width="0.5" stroke-opacity="0.25"/>
              <path d="M88 96 L88 116 M112 96 L112 116" stroke="#d4af37" stroke-width="2"/>
              <path d="M50 150 L50 116 C50 116 70 110 100 110 C130 110 150 116 150 116 L150 150" stroke="#d4af37" stroke-width="2"/>
              <rect x="50" y="150" width="100" height="70" rx="4" stroke="#d4af37" stroke-width="2"/>
              <circle cx="66" cy="168" r="3" fill="#00f2fe" style="filter: drop-shadow(0 0 5px #00f2fe);"/>
              <circle cx="134" cy="165" r="3" fill="#00f2fe" style="filter: drop-shadow(0 0 5px #00f2fe);"/>
              <path d="M50 125 L22 160 L22 195" stroke="#d4af37" stroke-width="2" stroke-linecap="round" stroke-opacity="0.7"/>
              <path d="M150 125 L178 160 L178 195" stroke="#d4af37" stroke-width="2" stroke-linecap="round" stroke-opacity="0.7"/>
              <ellipse cx="100" cy="62" rx="45" ry="45" stroke="#d4af37" stroke-width="0.3" stroke-opacity="0.15" stroke-dasharray="4 6"/>
            </svg>
          </div>
        </div>

        <!-- Figure Labels -->
        <div class="morph-labels-container">
          <div class="morph-label traditional-label" id="morph-label-traditional">The Traditional Interviewer</div>
          <div class="morph-label agent-label" id="morph-label-agent">Your intervieHire Agent</div>
        </div>

        <!-- Scroll hint -->
        <div class="morph-scroll-hint" id="morph-scroll-hint">SCROLL TO CONVERT</div>

      </div>
    </section>

    <!-- Solution Section -->
    <section id="solution" class="solution-section">
      <div class="solution-container">
        <div class="section-header">
          <div class="badge badge-glow">Our Solution</div>
          <h2>3 Layers of <span class="gradient-accent">Confidence.</span></h2>
          <p>A unified, end-to-end service mapping early-stage screening to verified human onboarding.</p>
        </div>

        <!-- Interactive tabs -->
        <div class="solution-tabs" id="solution-tabs-container">
          <button class="tab-btn active" data-tab="layer1" id="tab-layer1">Layer 1: AI Screening</button>
          <button class="tab-btn" data-tab="layer2" id="tab-layer2">Layer 2: Expert Vetting</button>
          <button class="tab-btn" data-tab="layer3" id="tab-layer3">Layer 3: Decisive Hiring</button>
        </div>

        <!-- Interactive Card Stack -->
        <div class="solution-layers" id="solution-layers-stack">
          <!-- Layer 1 Card -->
          <div class="glass-card solution-card active" id="card-layer1">
            <span class="badge" style="background: rgba(212, 175, 55, 0.1); border-color: rgba(212, 175, 55, 0.2); color: var(--accent-cyan);">Automated Screening</span>
            <h3>Sift through the noise instantly.</h3>
            <p>AI shortlists resumes and deploys tailored, role-specific assessments. Evaluating reasoning, communication, and core skillsets dynamically.</p>
            <div class="layer-highlights">
              <div class="highlight-item">
                <div class="highlight-icon">✓</div>
                <p>Filters out the bottom 70-80% of applicants automatically.</p>
              </div>
              <div class="highlight-item">
                <div class="highlight-icon">✓</div>
                <p>Custom scenario-based technical & communication scoring.</p>
              </div>
            </div>
          </div>

          <!-- Layer 2 Card -->
          <div class="glass-card solution-card" id="card-layer2">
            <span class="badge" style="background: rgba(255, 13, 63, 0.1); border-color: rgba(255, 13, 63, 0.2); color: var(--accent-indigo);">Expert Network</span>
            <h3>Vetted Industry Specialists.</h3>
            <p>Shortlisted candidates are interviewed live by verified, top-tier industry operators (operators, managers, and consultants).</p>
            <div class="layer-highlights">
              <div class="highlight-item">
                <div class="highlight-icon">✓</div>
                <p>24/7 global coverage—hiring never pauses.</p>
              </div>
              <div class="highlight-item">
                <div class="highlight-icon">✓</div>
                <p>Standardized objective rubrics to eliminate manager bias.</p>
              </div>
            </div>
          </div>

          <!-- Layer 3 Card -->
          <div class="glass-card solution-card" id="card-layer3">
            <span class="badge" style="background: rgba(255, 199, 44, 0.1); border-color: rgba(255, 199, 44, 0.2); color: var(--accent-purple);">Verified Decisions</span>
            <h3>Hire with complete confidence.</h3>
            <p>Receive comprehensive, high-fidelity candidate reports combining AI logs, human expert feedback, and verified background details.</p>
            <div class="layer-highlights">
              <div class="highlight-item">
                <div class="highlight-icon">✓</div>
                <p>Reduces average Time-To-Fill by over 60%.</p>
              </div>
              <div class="highlight-item">
                <div class="highlight-icon">✓</div>
                <p>Zero bias. Zero hassle. Fully-vouched shortlist.</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="solution-video-fullwidth">
        <div class="pipeline-video-container">
          <video id="pipeline-video" src="/mp_.mp4" autoplay muted loop playsinline></video>
          <div class="video-overlay-glow"></div>
          
          <!-- Hotspots to allow clicking directly on the graphic to select layers -->
          <div class="video-hotspots-container">
            <button class="video-hotspot hotspot-layer1 active" data-tab="layer1" aria-label="Select Layer 1: AI Screening">
              <span class="hotspot-dot"></span>
              <span class="hotspot-label">AI Screening</span>
            </button>
            <button class="video-hotspot hotspot-layer2" data-tab="layer2" aria-label="Select Layer 2: Expert Vetting">
              <span class="hotspot-dot"></span>
              <span class="hotspot-label">Expert Vetting</span>
            </button>
            <button class="video-hotspot hotspot-layer3" data-tab="layer3" aria-label="Select Layer 3: Decisive Hiring">
              <span class="hotspot-dot"></span>
              <span class="hotspot-label">Decisive Hiring</span>
            </button>
          </div>
          
          <!-- Dynamic floating highlights based on active layer -->
          <div class="video-status-badge">
            <div class="status-dot"></div>
            <span id="video-status-text">AI Screening & Filtering</span>
          </div>
        </div>
      </div>
    </section>

    <!-- Competitive Quadrant Matrix Section -->
    <section class="container" id="matrix">
      <div class="matrix-container">
        <div class="matrix-info">
          <div class="badge">Market Moat</div>
          <h2>Redefining the <br><span class="gradient-accent">HR Tech Landscape.</span></h2>
          <p style="margin-bottom: 25px;">Traditional processes force you to choose between high-automation bots that lack deep vetting, or legacy agencies that don't scale. </p>
          <p>intervieHire sits in the elite, high-automation, end-to-end integration segment. We leverage technology to amplify human intelligence, rather than replace it.</p>
        </div>
        
        <div class="matrix-grid" id="market-quadrant">
          <div class="matrix-axis-y">← Intelligence & Automation →</div>
          <div class="matrix-axis-x">← Integration & Scope →</div>
          
          <div style="display: flex; justify-content: space-between; width: 100%;">
            <span class="matrix-quadrant-label">AI Bots (Narrow)</span>
            <span class="matrix-quadrant-label" style="text-align: right; color: var(--accent-cyan);">Unified platform</span>
          </div>
          
          <div style="display: flex; justify-content: space-between; width: 100%; align-items: flex-end;">
            <span class="matrix-quadrant-label">Siloed Apps</span>
            <span class="matrix-quadrant-label" style="text-align: right;">Legacy Recruiting</span>
          </div>

          <!-- Dynamic Competitors plotted -->
          <div class="competitor comp-naukri">Naukri RMS</div>
          <div class="competitor comp-hirevue">HireVue</div>
          <div class="competitor comp-zeko">Zeko AI</div>
          <div class="competitor comp-adecco">Adecco</div>
          <div class="competitor us comp-us">intervieHire</div>
        </div>
      </div>
    </section>

    <!-- Calculator Section -->
    <section class="container" id="calculator">
      <div class="section-header">
        <div class="badge badge-glow">Cost Savings</div>
        <h2>Measure Your <span class="gradient-accent">Savings.</span></h2>
        <p>Use our interactive estimator to see how much recruiting costs and team hours you save with intervieHire.</p>
      </div>

      <div class="calculator-layout">
        <!-- Sliders -->
        <div class="glass-card slider-container">
          <div class="slider-group">
            <div class="slider-header">
              <label for="hires-slider">Hires Planned Per Year</label>
              <span class="slider-value" id="val-hires">10</span>
            </div>
            <input type="range" id="hires-slider" min="2" max="100" value="10">
          </div>

          <div class="slider-group">
            <div class="slider-header">
              <label for="salary-slider">Average Annual Role Salary ($)</label>
              <span class="slider-value" id="val-salary">$60,000</span>
            </div>
            <input type="range" id="salary-slider" min="20000" max="250000" step="5000" value="60000">
          </div>
        </div>

        <!-- Calculated Savings Display -->
        <div class="calc-results">
          <div class="result-card highlight">
            <p>Annual Recruiting Cost Saved</p>
            <div class="result-number" id="saved-money">$25,000</div>
          </div>
          <div class="result-card">
            <p>Manager Interview Hours Saved</p>
            <div class="result-number" id="saved-hours">350 hrs</div>
          </div>
        </div>
      </div>
    </section>

    <!-- Contact & Pitch Section -->
    <section class="container" id="contact">
      <div class="contact-layout">
        <div class="contact-info">
          <div class="badge">Join the Pilot</div>
          <h2>Ready to Hire <span class="gradient-accent">Decisively?</span></h2>
          <p>Get started with a free pilot. Have our industry experts interview your next round of applicants for free and see the feedback depth yourself.</p>
          
          <div class="contact-details">
            <div class="contact-item">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent-cyan)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>
              <span>interviehire@gmail.com</span>
            </div>
            <div class="contact-item">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent-cyan)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>
              <span>interviehire.com</span>
            </div>
            <div class="contact-item">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent-cyan)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
              <span>Co-Founders: Devasri Bali & Aditya Rana</span>
            </div>
          </div>
        </div>

        <div class="glass-card contact-form">
          <form id="pilot-form">
            <div class="form-group">
              <label for="form-name">Full Name</label>
              <input type="text" id="form-name" placeholder="Devasri Bali" required>
            </div>
            <div class="form-group">
              <label for="form-email">Work Email</label>
              <input type="email" id="form-email" placeholder="devasri@company.com" required>
            </div>
            <div class="form-group">
              <label for="form-company">Company / Startup</label>
              <input type="text" id="form-company" placeholder="intervieHire" required>
            </div>
            <div class="form-group">
              <label for="form-notes">Role Details (Optional)</label>
              <textarea id="form-notes" rows="4" placeholder="Tell us about the roles you are looking to hire for..."></textarea>
            </div>
            <button type="submit" class="btn btn-primary" style="width: 100%; border-radius: 10px;">Request Pilot & Demo</button>
            <div id="form-success" style="display: none; color: #22c55e; text-align: center; margin-top: 10px; font-weight: 600;">
              ✓ Request submitted! Our team will reach out shortly.
            </div>
          </form>
        </div>
      </div>
    </section>

    <!-- Footer -->
    <footer>
      <div class="footer-content">
        <div class="footer-logo">
          <div class="logo-dot" style="display: inline-block; margin-right: 6px; vertical-align: middle;"></div>
          intervieHire
        </div>
        <div class="footer-copy">
          &copy; 2026 intervieHire (BITS Pilani Startup Portfolio). All rights reserved.
        </div>
      </div>
    </footer>

    <!-- Custom Cursor elements -->
    <div class="custom-cursor" id="custom-cursor"></div>
    <div class="cursor-follower" id="cursor-follower"></div>
`;

export default function LandingPage() {
  useEffect(() => {
    const cleanup = initLandingPage();
    return () => {
      if (cleanup) cleanup();
    };
  }, []);

  return <div dangerouslySetInnerHTML={{ __html: landingHtml }} />;
}
