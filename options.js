// Options page for The Missing Link

const gitlabProjectInput = document.getElementById('gitlabProject');
const patInput = document.getElementById('pat');
const githubRepoInput = document.getElementById('githubRepo');
const jiraBaseUrlInput = document.getElementById('jiraBaseUrl');
const saveButton = document.getElementById('save');
const resetButton = document.getElementById('reset');
const statusDiv = document.getElementById('status');

const STORAGE_KEYS = ['gitlabProject', 'gitlabPat', 'githubRepo', 'jiraBaseUrl'];

// Load saved settings on page load
chrome.storage.local.get(STORAGE_KEYS, (result) => {
  if (result.gitlabProject) {
    gitlabProjectInput.value = result.gitlabProject;
  }
  if (result.gitlabPat) {
    patInput.value = result.gitlabPat;
  }
  if (result.githubRepo) {
    githubRepoInput.value = result.githubRepo;
  }
  if (result.jiraBaseUrl) {
    jiraBaseUrlInput.value = result.jiraBaseUrl;
  }
  updateResetButton();
});

// Save settings when button clicked
saveButton.addEventListener('click', () => {
  const gitlabProject = gitlabProjectInput.value.trim().replace(/\/+$/, '');
  const pat = patInput.value.trim();
  const githubRepo = githubRepoInput.value.trim().replace(/\/+$/, '');
  const jiraBaseUrl = jiraBaseUrlInput.value.trim().replace(/\/+$/, '');

  if (!gitlabProject) {
    showStatus('Please enter GitLab Project URL', 'error');
    return;
  }

  if (!githubRepo) {
    showStatus('Please enter GitHub Repository URL', 'error');
    return;
  }

  chrome.storage.local.set({
    gitlabProject,
    gitlabPat: pat,
    githubRepo,
    jiraBaseUrl
  }, () => {
    if (chrome.runtime.lastError) {
      showStatus('Error saving: ' + chrome.runtime.lastError.message, 'error');
    } else {
      showStatus('Settings saved!', 'success');
      setTimeout(() => {
        window.close();
      }, 1000);
    }
  });
});

// Reset settings when button clicked
resetButton.addEventListener('click', () => {
  chrome.storage.local.remove(STORAGE_KEYS, () => {
    if (chrome.runtime.lastError) {
      showStatus('Error resetting: ' + chrome.runtime.lastError.message, 'error');
    } else {
      gitlabProjectInput.value = '';
      patInput.value = '';
      githubRepoInput.value = '';
      jiraBaseUrlInput.value = '';
      updateResetButton();
      showStatus('Settings reset', 'success');
      setTimeout(() => {
        window.close();
      }, 1000);
    }
  });
});

function updateResetButton() {
  chrome.storage.local.get(STORAGE_KEYS, (result) => {
    const hasAnyValue = STORAGE_KEYS.some(key => result[key]);
    resetButton.disabled = !hasAnyValue;
  });
}

function showStatus(message, type) {
  statusDiv.textContent = message;
  statusDiv.className = 'status ' + type;
}
