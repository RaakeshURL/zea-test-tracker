# ZEA CRM Test Tracker

A local manual test execution tracker for exploring/testing ZEA CRM.

## Requirements

- Windows
- Node.js LTS

## Start

Option 1: double-click `start.bat`.

Option 2:

```bash
npm install
npm start
```

Open:

`http://localhost:3000`

## Data storage

No browser localStorage, sessionStorage, IndexedDB, or cookies are used for application data.

The source of truth is:

- `data/test-cases.json` - original test definitions
- `data/execution-results.json` - your execution results
- `attachments/` - uploaded evidence screenshots
- `reports/backups/` - timestamped backups

## Test execution

Each test can be marked:

- PASS
- FAIL
- SKIPPED
- NOT APPLICABLE

For failed tests, record:

- Actual Result
- Remarks
- Steps to Reproduce
- Bug ID
- Severity
- Priority
- Evidence

Changes are automatically sent to the Node.js backend and written to disk.

## Exports

Use the buttons in the application to export:

- JSON
- CSV
- HTML report

## Backup

Click Backup to create a timestamped copy of `execution-results.json`.

Reset All automatically creates a backup before clearing execution results.

## Important

Do not open `public/index.html` directly with `file://`.

Run the Node.js server so the application can read/write files safely.
