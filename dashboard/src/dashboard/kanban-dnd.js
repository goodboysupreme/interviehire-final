import { document, setInterval, clearInterval } from './runtime.js';
import { recalculateJobPipelines, renderKanbanBoard } from './kanban-swarm.js';
import { renderAnalyticsTable, renderTeamTable, updateSummaryMetrics } from './render-views.js';
import { saveStateToLocalStorage } from './ai-api.js';
import { soundEngine } from './sound.js';
import { showPremiumToast } from './sourcing.js';
import { AppState } from './state.js';
import { getDataSource, apiMoveApplicantStage } from './api.js';

// === Drag and Drop, Column Customization, Stage Panes and Agent Customization ===

let activeCardPlayerId = null;
let activeCardInterval = null;
let activeCardTime = 0; // ms
const cardDuration = 15000; // 15 seconds

function initKanbanDragAndDrop() {
  const cols = {
    Resume: document.getElementById('col-resume'),
    Screening: document.getElementById('col-screening'),
    Functional: document.getElementById('col-functional'),
    Hired: document.getElementById('col-hired')
  };

  Object.entries(cols).forEach(([stage, col]) => {
    if (!col) return;

    col.addEventListener('dragover', (e) => {
      e.preventDefault();
      col.classList.add('drag-hover');
    });

    col.addEventListener('dragleave', () => {
      col.classList.remove('drag-hover');
    });

    col.addEventListener('drop', async (e) => {
      e.preventDefault();
      col.classList.remove('drag-hover');
      
      const candidateId = e.dataTransfer.getData('text/plain');
      const candidate = AppState.candidates.find(c => c.id === candidateId);
      
      if (candidate && candidate.status !== stage) {
        const oldStatus = candidate.status;
        candidate.status = stage;
        saveStateToLocalStorage();
        
        soundEngine.playChime([329.63, 440.00, 523.25], 0.2, 0.08);
        showPremiumToast(`${candidate.name} moved from ${oldStatus} to ${stage}`, 'success');
        
        recalculateJobPipelines();
        updateSummaryMetrics();
        renderAnalyticsTable();
        renderKanbanBoard();

        if (getDataSource() === 'api' && candidate._backend) {
          try {
            const keep = { jobApplied: candidate.jobApplied, jobId: candidate.jobId, registeredOn: candidate.registeredOn };
            const updated = await apiMoveApplicantStage(candidate.backendId || candidate.id, stage);
            if (updated) {
              Object.assign(candidate, updated);
              if (keep.jobApplied) candidate.jobApplied = keep.jobApplied;
              if (keep.jobId) candidate.jobId = keep.jobId;
              if (keep.registeredOn) candidate.registeredOn = keep.registeredOn;
            }
            saveStateToLocalStorage();
            recalculateJobPipelines();
            updateSummaryMetrics();
            renderAnalyticsTable();
            renderKanbanBoard();
          } catch (err) {
            console.warn('Stage drag sync failed:', err);
            candidate.status = oldStatus;
            saveStateToLocalStorage();
            recalculateJobPipelines();
            updateSummaryMetrics();
            renderAnalyticsTable();
            renderKanbanBoard();
            showPremiumToast(`Could not sync ${candidate.name}'s stage to the backend.`, 'error');
          }
        }
      }
    });
  });
}

function renderColumnsSelectorDropdowns() {
  const popToggle = document.getElementById('pop-columns-toggle');
  const popTeam = document.getElementById('pop-columns-team');

  if (popToggle) {
    popToggle.innerHTML = '';
    if (AppState.analyticsSubtab === 'jobs-data') {
      const columns = [
        { id: 'id', label: 'Job ID' },
        { id: 'roleName', label: 'Role Name' },
        { id: 'cardName', label: 'Card Name' },
        { id: 'customJobId', label: 'Custom Job ID' },
        { id: 'experienceBand', label: 'Experience Band' },
        { id: 'tags', label: 'Tags' },
        { id: 'createdBy', label: 'Created By' },
        { id: 'collaborators', label: 'Collaborators' },
        { id: 'recruiters', label: 'Recruiters' }
      ];
      columns.forEach(col => {
        const checked = AppState.visibleColumnsAnalyticsJobs.includes(col.id) ? 'checked' : '';
        const label = document.createElement('label');
        label.className = 'columns-popup-item';
        label.innerHTML = `<input type="checkbox" data-col-id="${col.id}" ${checked} /> <span>${col.label}</span>`;
        label.querySelector('input').addEventListener('change', (e) => {
          const isChecked = e.target.checked;
          if (isChecked) {
            if (!AppState.visibleColumnsAnalyticsJobs.includes(col.id)) {
              AppState.visibleColumnsAnalyticsJobs.push(col.id);
            }
          } else {
            AppState.visibleColumnsAnalyticsJobs = AppState.visibleColumnsAnalyticsJobs.filter(id => id !== col.id);
          }
          soundEngine.playClick();
          renderAnalyticsTable();
        });
        popToggle.appendChild(label);
      });
    } else {
      const columns = [
        { id: 'id', label: 'Candidate ID' },
        { id: 'name', label: 'Candidate Name' },
        { id: 'jobApplied', label: 'Job Applied' },
        { id: 'registeredOn', label: 'Registered On' },
        { id: 'status', label: 'Pipeline Stage' },
        { id: 'score', label: 'Match Score' },
        { id: 'actions', label: 'Actions' }
      ];
      columns.forEach(col => {
        const checked = AppState.visibleColumnsAnalyticsCandidates.includes(col.id) ? 'checked' : '';
        const label = document.createElement('label');
        label.className = 'columns-popup-item';
        label.innerHTML = `<input type="checkbox" data-col-id="${col.id}" ${checked} /> <span>${col.label}</span>`;
        label.querySelector('input').addEventListener('change', (e) => {
          const isChecked = e.target.checked;
          if (isChecked) {
            if (!AppState.visibleColumnsAnalyticsCandidates.includes(col.id)) {
              AppState.visibleColumnsAnalyticsCandidates.push(col.id);
            }
          } else {
            AppState.visibleColumnsAnalyticsCandidates = AppState.visibleColumnsAnalyticsCandidates.filter(id => id !== col.id);
          }
          soundEngine.playClick();
          renderAnalyticsTable();
        });
        popToggle.appendChild(label);
      });
    }
  }

  if (popTeam) {
    popTeam.innerHTML = '';
    const columns = [
      { id: 'member', label: 'Team Member' },
      { id: 'designation', label: 'Designation' },
      { id: 'usertype', label: 'Usertype Role' },
      { id: 'registeredOn', label: 'Registered On' },
      { id: 'status', label: 'Status' },
      { id: 'actions', label: 'Actions' }
    ];
    columns.forEach(col => {
      const checked = AppState.visibleColumnsTeam.includes(col.id) ? 'checked' : '';
      const label = document.createElement('label');
      label.className = 'columns-popup-item';
      label.innerHTML = `<input type="checkbox" data-col-id="${col.id}" ${checked} /> <span>${col.label}</span>`;
      label.querySelector('input').addEventListener('change', (e) => {
        const isChecked = e.target.checked;
        if (isChecked) {
          if (!AppState.visibleColumnsTeam.includes(col.id)) {
            AppState.visibleColumnsTeam.push(col.id);
          }
        } else {
          AppState.visibleColumnsTeam = AppState.visibleColumnsTeam.filter(id => id !== col.id);
        }
        soundEngine.playClick();
        renderTeamTable();
      });
      popTeam.appendChild(label);
    });
  }
}


function stopActiveCardPlayer() {
  if (activeCardInterval) {
    clearInterval(activeCardInterval);
    activeCardInterval = null;
  }
  if (activeCardPlayerId) {
    const oldId = activeCardPlayerId;
    const playBtn = document.querySelector(`[data-play-id="${oldId}"]`);
    if (playBtn) {
      playBtn.querySelector('.play-icon').style.display = 'block';
      playBtn.querySelector('.pause-icon').style.display = 'none';
    }
    const timeLabel = document.querySelector(`[data-time-id="${oldId}"]`);
    if (timeLabel) timeLabel.textContent = '0:00 / 0:15';
    
    const bars = document.querySelectorAll(`.player-wave-bars[data-wave-id="${oldId}"] .player-wave-bar`);
    bars.forEach(b => {
      b.classList.remove('played');
      b.style.setProperty('--wave-height', (Math.floor(Math.random() * 70 + 20)) / 100);
    });
    activeCardPlayerId = null;
  }
}

function toggleCardPlayer(id) {
  if (activeCardPlayerId === id) {
    clearInterval(activeCardInterval);
    activeCardInterval = null;
    activeCardPlayerId = null;
    const playBtn = document.querySelector(`[data-play-id="${id}"]`);
    if (playBtn) {
      playBtn.querySelector('.play-icon').style.display = 'block';
      playBtn.querySelector('.pause-icon').style.display = 'none';
    }
    soundEngine.playClick();
  } else {
    stopActiveCardPlayer();
    
    activeCardPlayerId = id;
    activeCardTime = 0;
    soundEngine.playChime([440, 554.37], 0.1, 0.05);
    
    const playBtn = document.querySelector(`[data-play-id="${id}"]`);
    if (playBtn) {
      playBtn.querySelector('.play-icon').style.display = 'none';
      playBtn.querySelector('.pause-icon').style.display = 'block';
    }
    
    const timeLabel = document.querySelector(`[data-time-id="${id}"]`);
    const bars = document.querySelectorAll(`.player-wave-bars[data-wave-id="${id}"] .player-wave-bar`);
    
    activeCardInterval = setInterval(() => {
      activeCardTime += 100;
      if (activeCardTime >= cardDuration) {
        stopActiveCardPlayer();
        soundEngine.playChime([523.25, 392], 0.15, 0.08);
        return;
      }
      
      if (timeLabel) {
        const secs = Math.floor(activeCardTime / 1000);
        timeLabel.textContent = `0:${secs.toString().padStart(2, '0')} / 0:15`;
      }
      
      const progress = activeCardTime / cardDuration;
      const activeIndex = Math.floor(progress * bars.length);
      
      bars.forEach((bar, idx) => {
        if (idx <= activeIndex) {
          bar.classList.add('played');
        } else {
          bar.classList.remove('played');
        }
      });
    }, 100);
  }
}


export { activeCardInterval, activeCardPlayerId, activeCardTime, cardDuration, initKanbanDragAndDrop, renderColumnsSelectorDropdowns, stopActiveCardPlayer, toggleCardPlayer };
