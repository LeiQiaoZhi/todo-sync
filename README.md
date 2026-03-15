# GitHub Todo Sync

A simple single-user todo list web app that runs entirely in the browser, can be hosted on GitHub Pages, and syncs by reading and writing `todos.json` in the same repository through the GitHub REST API.

## Project structure

```text
.
|-- README.md
|-- app.js
|-- index.html
|-- styles.css
`-- todos.json
```

## How it works

- `index.html` renders the app UI.
- `styles.css` provides the responsive styling.
- `app.js` loads todos from GitHub, updates them in the browser, and commits changes back to `todos.json`.
- `todos.json` stores the synced todo data.

## Configure GitHub access

1. Create a GitHub repository and add these files.
2. Create a personal access token.
3. Give the token permission to read and write repository contents.
   - Fine-grained token: repository access to this repo, `Contents: Read and write`.
   - Classic token: `repo` scope works too.
4. Open the deployed app or open `index.html` locally in a browser.
5. Fill in:
   - GitHub owner
   - Repository name
   - Branch name, usually `main`
   - Personal access token
6. Click `Save Settings`.
7. Click `Load Todos`.

The app stores the token and repo settings in `localStorage` on that device only. Nothing is stored in a backend server.

## Deploy with GitHub Pages

1. Push the project to GitHub.
2. In the repository, open `Settings > Pages`.
3. Under `Build and deployment`, choose:
   - `Source`: `Deploy from a branch`
   - Branch: `main`
   - Folder: `/ (root)`
4. Save the settings.
5. GitHub Pages will publish the site at:
   - `https://YOUR_USERNAME.github.io/YOUR_REPOSITORY/`

## Notes

- The app calls `GET /repos/{owner}/{repo}/contents/todos.json` to load todos.
- The app calls `PUT /repos/{owner}/{repo}/contents/todos.json` to commit updates.
- The JSON content is base64-encoded before upload, as required by the GitHub Contents API.
- Because this is a single-user app, the sync model stays intentionally simple.
