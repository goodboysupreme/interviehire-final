import { document, window, MutationObserver, setTimeout, clearTimeout } from './runtime';
import { drawFunnelSVG, drawScoreDistributionSVG } from './funnel-charts';
import { filterCandidatesByDateRange } from './render-views';
import { AppState } from './state';
import { getDataSource } from './api';
import type { Job, Candidate } from '../types/models';

// ==========================================
// CRYSTAL GLASS SLIDING PILLS ENGINE (iOS-style Segmented Control)
// ==========================================
function updateSlidingPill(container: HTMLElement | null) {
  if (!container) return;

  // Ensure track container has correct position styling
  const containerStyle = window.getComputedStyle(container);
  if (containerStyle.position === 'static') {
    container.style.position = 'relative';
  }

  let pill = container.querySelector('.sliding-pill') as HTMLElement | null;
  if (!pill) {
    pill = document.createElement('span');
    pill.className = 'sliding-pill';
    container.insertBefore(pill, container.firstChild);
  }
  
  setTimeout(() => {
    const activeTab = container.querySelector('.active') || 
                      container.querySelector('.active-sub') ||
                      container.querySelector('.nav-item.active') || 
                      container.querySelector('.filter-tab.active') || 
                      container.querySelector('.table-tab-btn.active') || 
                      container.querySelector('.report-tab-btn.active') || 
                      container.querySelector('.jd-tab.active');
                      
    if (!activeTab) {
      pill!.style.opacity = '0';
      return;
    }
    
    // Bounds calculations relative to parent track container
    const rect = activeTab.getBoundingClientRect();
    const parentRect = container.getBoundingClientRect();
    
    const top = rect.top - parentRect.top;
    const left = rect.left - parentRect.left;
    const width = rect.width;
    const height = rect.height;
    
    // Check if the tab is hidden or has 0 width (e.g. inactive views)
    if (width === 0 || height === 0) {
      pill!.style.opacity = '0';
      return;
    }

    pill!.style.opacity = '1';
    pill!.style.width = `${width}px`;
    pill!.style.height = `${height}px`;
    pill!.style.transform = `translate3d(${left}px, ${top}px, 0)`;

    const activeStyle = window.getComputedStyle(activeTab);
    pill!.style.borderRadius = activeStyle.borderRadius || '8px';
  }, 20);
}

function updateAllSlidingPills() {
  const tracks = document.querySelectorAll('.sidebar-nav ul, .filter-options, .table-tabs, #team-status-tabs, .report-tabs, .jd-tabs, .sub-nav, .sourcing-mode-toggle');
  tracks.forEach(track => updateSlidingPill(track as HTMLElement));
}

function initSlidingPills() {
  const tracks = document.querySelectorAll('.sidebar-nav ul, .filter-options, .table-tabs, #team-status-tabs, .report-tabs, .jd-tabs, .sub-nav, .sourcing-mode-toggle');
  
  tracks.forEach(track => {
    // Initial paint
    updateSlidingPill(track as HTMLElement);

    // Auto-listen to click events within track
    track.addEventListener('click', (e) => {
      const isTab = (e.target as Element).closest('.nav-item, .filter-tab, .table-tab-btn, .report-tab-btn, .jd-tab, .sub-nav li, .mode-toggle-btn');
      if (isTab) {
        updateSlidingPill(track as HTMLElement);
      }
    });
  });
  
  // Recalculate on window resize
  window.addEventListener('resize', updateAllSlidingPills);

  let chartResizeTimer: any;
  window.addEventListener('resize', () => {
    clearTimeout(chartResizeTimer);
    chartResizeTimer = setTimeout(() => {
      if (AppState.activeTab === 'job-detail' && AppState.activeJobId) {
        const activeJob: Job | undefined = AppState.jobs.find((j: Job) => j.id === AppState.activeJobId);
        if (activeJob) {
          const jobCandidates = filterCandidatesByDateRange(AppState.candidates).filter((c: Candidate) => {
            if (getDataSource() === 'api' && activeJob._backend) {
              return c.jobId === activeJob.id;
            }
            return c.jobApplied === activeJob.roleName || c.jobApplied === activeJob.cardName;
          });
          drawFunnelSVG(activeJob, jobCandidates);
          drawScoreDistributionSVG(activeJob, jobCandidates);
        }
      }
    }, 150);
  });
  
  // Also watch for DOM changes (like when views are rendered dynamically or hidden/shown)
  const observer = new MutationObserver((mutations) => {
    let shouldUpdate = false;
    for (let mutation of mutations) {
      if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
        shouldUpdate = true;
        break;
      }
    }
    if (shouldUpdate) {
      updateAllSlidingPills();
    }
  });
  
  tracks.forEach(track => {
    observer.observe(track, { attributes: true, subtree: true, attributeFilter: ['class'] });
  });
  
  // Set up initial trigger for tabs in hidden/active views
  setTimeout(updateAllSlidingPills, 100);
  setTimeout(updateAllSlidingPills, 300); // Back up for view rendering latency
}


export { initSlidingPills, updateAllSlidingPills, updateSlidingPill };
