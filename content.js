// The Missing Link
// Enhances GitHub PRs with GitLab pipeline links and Jira ticket links

// Settings loaded from storage
let settings = {
  gitlabProject: '',  // Full URL like https://gitlab.example.com/group/project
  gitlabPat: '',
  githubRepo: '',     // Full URL like https://github.com/owner/repo
  jiraBaseUrl: ''
};

// Parsed from settings
let gitlabBaseUrl = '';
let gitlabProjectPath = '';

// Cache for API responses (with expiry)
const CACHE_TTL_MS = 60000; // 1 minute
const failedJobsCache = new Map();

// Currently visible popup and its associated link
let activePopup = null;
let activeLink = null;
let popupTimeout = null;
let currentFetchId = 0; // For race condition prevention

// Check if extension context is still valid
function isExtensionValid() {
  try {
    return chrome.runtime && !!chrome.runtime.id;
  } catch (e) {
    return false;
  }
}

// Load settings from storage
async function loadSettings() {
  if (!isExtensionValid()) {
    return false;
  }

  try {
    const result = await chrome.storage.local.get(['gitlabProject', 'gitlabPat', 'githubRepo', 'jiraBaseUrl']);
    settings = {
      gitlabProject: result.gitlabProject || '',
      gitlabPat: result.gitlabPat || '',
      githubRepo: result.githubRepo || '',
      jiraBaseUrl: result.jiraBaseUrl || ''
    };

    // Parse GitLab URL into base and project path
    if (settings.gitlabProject) {
      try {
        const url = new URL(settings.gitlabProject);
        gitlabBaseUrl = url.origin;
        gitlabProjectPath = url.pathname.replace(/^\/+|\/+$/g, '');
      } catch (e) {
        gitlabBaseUrl = '';
        gitlabProjectPath = '';
      }
    }
    return true;
  } catch (e) {
    return false;
  }
}

function getPipelineUrl(pipelineId) {
  return gitlabBaseUrl + '/' + gitlabProjectPath + '/-/pipelines/' + pipelineId;
}

function getJobUrl(jobId) {
  return gitlabBaseUrl + '/' + gitlabProjectPath + '/-/jobs/' + jobId;
}

function isOnConfiguredRepo() {
  if (!settings.githubRepo) return false;
  try {
    const configuredUrl = new URL(settings.githubRepo);
    return window.location.origin === configuredUrl.origin &&
           window.location.pathname.startsWith(configuredUrl.pathname);
  } catch (e) {
    return false;
  }
}

async function linkifyPipelineIds() {
  // Check if extension is still valid
  if (!isExtensionValid()) {
    observer.disconnect();
    return;
  }

  // Ensure settings are loaded
  if (!settings.gitlabProject) {
    const loaded = await loadSettings();
    if (!loaded) return;
  }

  // Skip if not configured
  if (!gitlabBaseUrl || !gitlabProjectPath) {
    return;
  }

  // Skip if not on configured GitHub repo
  if (!isOnConfiguredRepo()) {
    return;
  }

  // Find all status check containers using the stable data attribute
  const containers = document.querySelectorAll('[data-listview-item-title-container="true"]');

  containers.forEach(container => {
    // Skip if already processed
    if (container.dataset.pipelineLinked) return;

    // Check if this is a GitLab status check (look for "GitLab" in heading)
    const heading = container.querySelector('h4');
    if (!heading || !/gitlab/i.test(heading.textContent)) return;

    // Find text nodes with pipeline IDs
    const walker = document.createTreeWalker(
      container,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          if (parent.tagName === 'A') return NodeFilter.FILTER_REJECT;
          if (/\d{6,}/.test(node.textContent)) {
            return NodeFilter.FILTER_ACCEPT;
          }
          return NodeFilter.FILTER_REJECT;
        }
      }
    );

    const nodesToProcess = [];
    while (walker.nextNode()) {
      nodesToProcess.push(walker.currentNode);
    }

    nodesToProcess.forEach(node => {
      const text = node.textContent;
      const match = text.match(/(\d{6,})/);

      if (match) {
        const pipelineId = match[1];
        const beforeText = text.substring(0, match.index);
        const afterText = text.substring(match.index + match[0].length);

        // Create the link element
        const link = document.createElement('a');
        link.href = getPipelineUrl(pipelineId);
        link.textContent = pipelineId;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.className = 'gitlab-pipeline-link';
        link.dataset.pipelineId = pipelineId;

        // Add hover event listeners
        link.addEventListener('mouseenter', handleLinkHover);
        link.addEventListener('mouseleave', handleLinkLeave);

        // Create a document fragment to hold the new nodes
        const fragment = document.createDocumentFragment();

        if (beforeText) {
          fragment.appendChild(document.createTextNode(beforeText));
        }
        fragment.appendChild(link);
        if (afterText) {
          fragment.appendChild(document.createTextNode(afterText));
        }

        // Replace the text node with the fragment
        node.parentElement.replaceChild(fragment, node);
      }
    });

    // Mark container as processed
    container.dataset.pipelineLinked = 'true';
  });
}

function isDarkTheme() {
  const html = document.documentElement;
  const colorMode = html.getAttribute('data-color-mode');

  // Explicit dark mode
  if (colorMode === 'dark') return true;

  // Auto mode - check computed background color
  if (colorMode === 'auto') {
    const bgColor = getComputedStyle(document.body).backgroundColor;
    const match = bgColor.match(/\d+/g);
    if (match) {
      const [r, g, b] = match.map(Number);
      return (r + g + b) / 3 < 128;
    }
  }

  return false;
}

async function handleLinkHover(event) {
  const link = event.currentTarget;
  const pipelineId = link.dataset.pipelineId;

  // Clear any pending hide timeout
  if (popupTimeout) {
    clearTimeout(popupTimeout);
    popupTimeout = null;
  }

  // If already showing popup for this link, keep it
  if (activeLink === link && activePopup) {
    return;
  }

  // Hide any existing popup
  hidePopup();

  // Track this link
  activeLink = link;

  // Create and show popup
  const popup = createPopup(link);
  activePopup = popup;

  // Increment fetch ID to handle race conditions
  const fetchId = ++currentFetchId;

  // Check cache first (with expiry)
  const cached = failedJobsCache.get(pipelineId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    renderJobs(popup, cached.jobs);
    return;
  }

  // Check if extension is still valid
  if (!isExtensionValid()) {
    setPopupContent(popup, 'error', 'Extension reloaded. Please refresh the page.');
    return;
  }

  // Check if token is configured
  if (!settings.gitlabPat) {
    setPopupContent(popup, 'info', 'Add GitLab token in extension options to see failed jobs');
    return;
  }

  // Show loading state
  setPopupContent(popup, 'loading', 'Loading failed jobs...');

  // Fetch failed jobs
  try {
    const jobs = await fetchFailedJobs(pipelineId);

    // Check if this fetch is still relevant (no newer hover)
    if (fetchId !== currentFetchId) return;

    failedJobsCache.set(pipelineId, { jobs, timestamp: Date.now() });
    renderJobs(popup, jobs);
  } catch (error) {
    // Check if this fetch is still relevant
    if (fetchId !== currentFetchId) return;

    // Handle extension context invalidated
    if (error.message && error.message.includes('Extension context invalidated')) {
      setPopupContent(popup, 'error', 'Extension reloaded. Please refresh the page.');
    } else {
      setPopupContent(popup, 'error', error.message);
    }
  }
}

function handleLinkLeave(event) {
  // Delay hiding to allow moving to popup
  popupTimeout = setTimeout(() => {
    hidePopup();
  }, 300);
}

function createPopup(link) {
  const popup = document.createElement('div');
  popup.className = 'gitlab-pipeline-popup';

  // Apply theme class
  if (isDarkTheme()) {
    popup.classList.add('gitlab-popup-dark');
  }

  // Position near the link, adjusting for viewport edges
  positionPopup(popup, link);

  // Allow hovering over popup
  popup.addEventListener('mouseenter', () => {
    if (popupTimeout) {
      clearTimeout(popupTimeout);
      popupTimeout = null;
    }
  });
  popup.addEventListener('mouseleave', () => {
    popupTimeout = setTimeout(() => {
      hidePopup();
    }, 100);
  });

  document.body.appendChild(popup);

  return popup;
}

function positionPopup(popup, link) {
  const linkRect = link.getBoundingClientRect();
  const popupRect = popup.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  let top = linkRect.bottom + window.scrollY + 5;
  let left = linkRect.left + window.scrollX;

  // Adjust if popup goes off right edge
  if (left + popupRect.width > viewportWidth + window.scrollX - 10) {
    left = viewportWidth + window.scrollX - popupRect.width - 10;
  }

  // Adjust if popup goes off bottom edge - show above link instead
  if (linkRect.bottom + popupRect.height > viewportHeight - 10) {
    top = linkRect.top + window.scrollY - popupRect.height - 5;
  }

  // Ensure not off left edge
  if (left < window.scrollX + 10) {
    left = window.scrollX + 10;
  }

  popup.style.top = top + 'px';
  popup.style.left = left + 'px';
}

function hidePopup() {
  if (activePopup) {
    activePopup.remove();
    activePopup = null;
    activeLink = null;
  }
  if (popupTimeout) {
    clearTimeout(popupTimeout);
    popupTimeout = null;
  }
}

async function fetchFailedJobs(pipelineId) {
  // Validate pipeline ID is numeric only
  if (!/^\d+$/.test(pipelineId)) {
    throw new Error('Invalid pipeline ID');
  }

  const projectId = encodeURIComponent(gitlabProjectPath);
  const url = `${gitlabBaseUrl}/api/v4/projects/${projectId}/pipelines/${pipelineId}/jobs?scope[]=failed`;

  let response;
  try {
    response = await fetch(url, {
      headers: {
        'PRIVATE-TOKEN': settings.gitlabPat
      }
    });
  } catch (fetchError) {
    // Network errors (CORS, DNS, connection refused, etc.)
    if (fetchError.message.includes('NetworkError') || fetchError.name === 'TypeError') {
      throw new Error('Cannot reach GitLab. Check: 1) GitLab URL is correct, 2) GitLab allows CORS from GitHub, 3) VPN if required');
    }
    throw new Error('Network error: ' + fetchError.message);
  }

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('Invalid GitLab token (401). Check PAT has read_api scope');
    }
    if (response.status === 403) {
      throw new Error('Access denied (403). Check PAT permissions for this project');
    }
    if (response.status === 404) {
      throw new Error('Not found (404). Check GitLab project URL matches pipeline');
    }
    throw new Error('GitLab API error: ' + response.status + ' ' + response.statusText);
  }

  return await response.json();
}

function formatDuration(seconds) {
  if (seconds < 60) {
    return seconds + 's';
  }
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins < 60) {
    return secs > 0 ? mins + 'm ' + secs + 's' : mins + 'm';
  }
  const hours = Math.floor(mins / 60);
  const remainingMins = mins % 60;
  return hours + 'h ' + remainingMins + 'm';
}

function setPopupContent(popup, type, message) {
  // Clear existing content safely
  popup.textContent = '';

  const div = document.createElement('div');
  div.className = 'gitlab-popup-' + type;
  div.textContent = message;
  popup.appendChild(div);

  // Reposition after content change
  if (activeLink) {
    requestAnimationFrame(() => positionPopup(popup, activeLink));
  }
}

function renderJobs(popup, jobs) {
  // Clear existing content safely
  popup.textContent = '';

  if (!jobs || jobs.length === 0) {
    const div = document.createElement('div');
    div.className = 'gitlab-popup-empty';
    div.textContent = 'No failed jobs';
    popup.appendChild(div);
    return;
  }

  const header = document.createElement('div');
  header.className = 'gitlab-popup-header';
  header.textContent = 'Failed Jobs (' + jobs.length + ')';
  popup.appendChild(header);

  const list = document.createElement('ul');
  list.className = 'gitlab-popup-list';

  jobs.forEach(job => {
    // Validate job ID is numeric
    if (!job.id || !/^\d+$/.test(String(job.id))) return;

    const item = document.createElement('li');
    item.className = 'gitlab-popup-job';

    // Job link
    const link = document.createElement('a');
    link.href = getJobUrl(job.id);
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.className = 'gitlab-popup-job-link';
    // Sanitize job name - only use textContent (never innerHTML)
    link.textContent = job.name || 'Unknown job';
    if (job.stage) {
      link.title = 'Stage: ' + job.stage;
    }
    item.appendChild(link);

    // Duration
    if (job.duration) {
      const duration = document.createElement('span');
      duration.className = 'gitlab-popup-job-duration';
      duration.textContent = formatDuration(Math.round(job.duration));
      item.appendChild(duration);
    }

    list.appendChild(item);
  });

  popup.appendChild(list);

  // Reposition after content change
  if (activeLink) {
    requestAnimationFrame(() => positionPopup(popup, activeLink));
  }
}

function linkifyJiraTickets() {
  // Check if extension is still valid
  if (!isExtensionValid()) {
    return;
  }

  // Skip if Jira not configured
  if (!settings.jiraBaseUrl) {
    return;
  }

  // Skip if not on configured GitHub repo
  if (!isOnConfiguredRepo()) {
    return;
  }

  // Find PR title element
  const prTitle = document.querySelector('.js-issue-title, .markdown-title');
  if (!prTitle || prTitle.dataset.jiraLinked) return;

  // Find text nodes with LVPN-xxx pattern
  const walker = document.createTreeWalker(
    prTitle,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: (node) => {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (parent.tagName === 'A') return NodeFilter.FILTER_REJECT;
        if (/LVPN-\d+/i.test(node.textContent)) {
          return NodeFilter.FILTER_ACCEPT;
        }
        return NodeFilter.FILTER_REJECT;
      }
    }
  );

  const nodesToProcess = [];
  while (walker.nextNode()) {
    nodesToProcess.push(walker.currentNode);
  }

  nodesToProcess.forEach(node => {
    const text = node.textContent;
    const regex = /(LVPN-\d+)/gi;
    const parts = [];
    let lastIndex = 0;
    let match;

    while ((match = regex.exec(text)) !== null) {
      // Add text before match
      if (match.index > lastIndex) {
        parts.push(document.createTextNode(text.substring(lastIndex, match.index)));
      }

      // Create link for ticket
      const ticketId = match[1].toUpperCase();
      const link = document.createElement('a');
      link.href = settings.jiraBaseUrl.replace(/\/+$/, '') + '/browse/' + ticketId;
      link.textContent = match[1];
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.className = 'jira-ticket-link';
      link.title = 'Open ' + ticketId + ' in Jira';
      parts.push(link);

      lastIndex = regex.lastIndex;
    }

    // Add remaining text
    if (lastIndex < text.length) {
      parts.push(document.createTextNode(text.substring(lastIndex)));
    }

    // Replace node if we found matches
    if (parts.length > 0) {
      const fragment = document.createDocumentFragment();
      parts.forEach(part => fragment.appendChild(part));
      node.parentElement.replaceChild(fragment, node);
    }
  });

  // Mark as processed
  prTitle.dataset.jiraLinked = 'true';
}

// Initialize
loadSettings().then(() => {
  linkifyPipelineIds();
  linkifyJiraTickets();
});

// Use MutationObserver to handle dynamically loaded content
const observer = new MutationObserver((mutations) => {
  let shouldRun = false;

  for (const mutation of mutations) {
    if (mutation.addedNodes.length > 0) {
      shouldRun = true;
      break;
    }
  }

  if (shouldRun) {
    // Debounce to avoid running too frequently
    clearTimeout(observer.timeout);
    observer.timeout = setTimeout(() => {
      linkifyPipelineIds();
      linkifyJiraTickets();
    }, 100);
  }
});

observer.observe(document.body, {
  childList: true,
  subtree: true
});

// Listen for storage changes to update settings
chrome.storage.onChanged.addListener((changes) => {
  if (changes.gitlabProject || changes.gitlabPat || changes.githubRepo || changes.jiraBaseUrl) {
    loadSettings();
  }
});
