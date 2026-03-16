# The Missing Link

A browser extension that enhances GitHub PRs with clickable links to GitLab pipelines and Jira tickets.

## Features

- **GitLab Pipeline Links** - Converts pipeline IDs to clickable links
- **Failed Jobs Preview** - Hover to see failed jobs with duration
- **Jira Ticket Links** - Links LVPN-xxx tickets in PR titles to Jira
- **Theme Support** - Adapts to GitHub light/dark theme
- **Caching** - API responses cached to reduce requests

## Installation

### Chrome / Brave / Edge

1. Open `chrome://extensions/` (or `brave://extensions/` / `edge://extensions/`)
2. Enable "Developer mode" (toggle in top right)
3. Click "Load unpacked"
4. Select the `the-missing-link` folder

### Firefox

1. Open `about:debugging#/runtime/this-firefox`
2. Click "Load Temporary Add-on..."
3. Select the `manifest.json` file

## Setup

1. Click the extension icon > Options
2. Enter your GitLab project URL (e.g., `https://gitlab.example.com/group/project`)
3. Enter your GitHub repository URL (e.g., `https://github.com/owner/repo`)
4. Enter your GitLab PAT (requires `read_api` scope)
5. Optionally enter your Jira base URL (e.g., `https://company.atlassian.net`)

## Compatibility

- Chrome
- Brave
- Edge
- Firefox

## Security

- Tokens stored locally (not synced)
- Only sent to configured instances
- All input validated
- No innerHTML usage
