const STORAGE_KEY = "github-todo-sync-config";
const TODOS_PATH = "todos.json";
const APP_VERSION = "2026-03-15 13:25";
const APP_COMMIT_MESSAGE = "Make todo edits sync in background";

const state = {
  config: loadSavedConfig(),
  todos: [],
  lastSyncedTodos: [],
  currentSha: null,
  isBusy: false,
  isSyncing: false,
  hasUnsyncedChanges: false,
  pendingCommitMessage: "",
};

const elements = {
  settingsPanel: document.getElementById("settingsPanel"),
  toggleSettingsButton: document.getElementById("toggleSettingsButton"),
  settingsForm: document.getElementById("settingsForm"),
  ownerInput: document.getElementById("ownerInput"),
  repoInput: document.getElementById("repoInput"),
  branchInput: document.getElementById("branchInput"),
  tokenInput: document.getElementById("tokenInput"),
  clearButton: document.getElementById("clearButton"),
  configBadge: document.getElementById("configBadge"),
  buildVersion: document.getElementById("buildVersion"),
  statusText: document.getElementById("statusText"),
  syncBadge: document.getElementById("syncBadge"),
  todoForm: document.getElementById("todoForm"),
  todoInput: document.getElementById("todoInput"),
  todoCount: document.getElementById("todoCount"),
  refreshButton: document.getElementById("refreshButton"),
  todoList: document.getElementById("todoList"),
  emptyState: document.getElementById("emptyState"),
  todoItemTemplate: document.getElementById("todoItemTemplate"),
};

initialize();

function initialize() {
  populateSettingsForm();
  elements.buildVersion.textContent = `Version ${APP_VERSION} | ${APP_COMMIT_MESSAGE}`;
  updateConfigBadge();
  updateSettingsVisibility();
  renderTodos();

  elements.toggleSettingsButton.addEventListener("click", () => {
    elements.settingsPanel.toggleAttribute("hidden");
    updateSettingsToggleLabel();
  });

  elements.settingsForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void saveSettingsFromForm();
  });

  elements.clearButton.addEventListener("click", () => {
    localStorage.removeItem(STORAGE_KEY);
    state.config = emptyConfig();
    state.todos = [];
    state.lastSyncedTodos = [];
    state.currentSha = null;
    state.isSyncing = false;
    state.hasUnsyncedChanges = false;
    state.pendingCommitMessage = "";
    populateSettingsForm();
    updateConfigBadge();
    updateSettingsVisibility();
    setStatus("Saved settings cleared from this browser.", "idle");
    renderTodos();
  });

  elements.refreshButton.addEventListener("click", () => {
    if (state.hasUnsyncedChanges || state.isSyncing) {
      void flushPendingSync({ manual: true });
      return;
    }

    void fetchTodosFromGitHub();
  });

  elements.todoForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = elements.todoInput.value.trim();
    if (!text) {
      return;
    }

    const nextTodos = [
      {
        id: crypto.randomUUID(),
        text,
        completed: false,
        created_at: new Date().toISOString(),
      },
      ...state.todos,
    ];

    elements.todoInput.value = "";
    void updateTodos(nextTodos, `Add todo: ${truncateCommitText(text)}`);
  });

  if (isConfigReady()) {
    void fetchTodosFromGitHub({ isStartup: true });
  } else {
    setStatus("Add your GitHub settings to connect this app.", "idle");
  }
}

function emptyConfig() {
  return {
    owner: "",
    repo: "",
    branch: "main",
    token: "",
  };
}

function loadSavedConfig() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    return {
      ...emptyConfig(),
      ...parsed,
    };
  } catch (error) {
    return emptyConfig();
  }
}

function populateSettingsForm() {
  elements.ownerInput.value = state.config.owner;
  elements.repoInput.value = state.config.repo;
  elements.branchInput.value = state.config.branch || "main";
  elements.tokenInput.value = state.config.token;
}

async function saveSettingsFromForm() {
  state.config = {
    owner: elements.ownerInput.value.trim(),
    repo: elements.repoInput.value.trim(),
    branch: elements.branchInput.value.trim() || "main",
    token: elements.tokenInput.value.trim(),
  };

  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.config));
  updateConfigBadge();

  if (!isConfigReady()) {
    updateSettingsVisibility();
    setStatus("Please complete all GitHub settings.", "error");
    return;
  }

  updateSettingsVisibility();
  setStatus("Settings saved. Connecting to GitHub...", "idle");
  await fetchTodosFromGitHub();
}

function updateConfigBadge() {
  if (isConfigReady()) {
    elements.configBadge.textContent = `${state.config.owner}/${state.config.repo}`;
    elements.configBadge.className = "badge badge-success";
  } else {
    elements.configBadge.textContent = "Not configured";
    elements.configBadge.className = "badge badge-muted";
  }
}

function isConfigReady() {
  const { owner, repo, branch, token } = state.config;
  return Boolean(owner && repo && branch && token);
}

function updateSettingsVisibility() {
  if (isConfigReady()) {
    elements.settingsPanel.setAttribute("hidden", "");
  } else {
    elements.settingsPanel.removeAttribute("hidden");
  }

  updateSettingsToggleLabel();
}

function updateSettingsToggleLabel() {
  const isHidden = elements.settingsPanel.hasAttribute("hidden");
  const label = isHidden ? "Edit GitHub settings" : "Hide GitHub settings";

  elements.toggleSettingsButton.setAttribute("aria-label", label);
  elements.toggleSettingsButton.setAttribute("title", label);
}

function renderTodos() {
  elements.todoList.innerHTML = "";

  state.todos.forEach((todo, index) => {
    const item = elements.todoItemTemplate.content.firstElementChild.cloneNode(true);
    const checkbox = item.querySelector(".todo-checkbox");
    const text = item.querySelector(".todo-text");
    const deleteButton = item.querySelector(".delete-button");
    const moveUpButton = item.querySelector(".move-up-button");
    const moveDownButton = item.querySelector(".move-down-button");

    checkbox.checked = todo.completed;
    text.textContent = todo.text;
    item.classList.toggle("completed", todo.completed);

    checkbox.addEventListener("change", () => {
      const nextTodos = state.todos.map((currentTodo) =>
        currentTodo.id === todo.id
          ? { ...currentTodo, completed: checkbox.checked }
          : currentTodo
      );
      void updateTodos(nextTodos, `${checkbox.checked ? "Complete" : "Reopen"} todo`);
    });

    deleteButton.addEventListener("click", () => {
      const nextTodos = state.todos.filter((currentTodo) => currentTodo.id !== todo.id);
      void updateTodos(nextTodos, `Delete todo: ${truncateCommitText(todo.text)}`);
    });

    moveUpButton.disabled = index === 0;
    moveDownButton.disabled = index === state.todos.length - 1;

    moveUpButton.addEventListener("click", () => {
      void moveTodo(index, index - 1);
    });

    moveDownButton.addEventListener("click", () => {
      void moveTodo(index, index + 1);
    });

    elements.todoList.appendChild(item);
  });

  const count = state.todos.length;
  elements.todoCount.textContent = `${count} item${count === 1 ? "" : "s"}`;
  elements.emptyState.hidden = count > 0;
}

async function moveTodo(fromIndex, toIndex) {
  if (toIndex < 0 || toIndex >= state.todos.length) {
    return;
  }

  const nextTodos = [...state.todos];
  const [movedTodo] = nextTodos.splice(fromIndex, 1);
  nextTodos.splice(toIndex, 0, movedTodo);
  await updateTodos(nextTodos, "Reorder todos");
}

async function fetchTodosFromGitHub(options = {}) {
  const { isStartup = false } = options;

  if (!isConfigReady()) {
    setStatus("Please save your GitHub owner, repo, branch, and token first.", "error");
    return;
  }

  try {
    setBusy(true, "Loading todos from GitHub...", "idle");
    const response = await githubRequest("GET", buildContentsUrl(true, true), undefined, {
      retries: isStartup ? 2 : 1,
    });

    if (response.status === 404) {
      state.todos = [];
      state.lastSyncedTodos = [];
      state.currentSha = null;
      state.hasUnsyncedChanges = false;
      renderTodos();
      setStatus("Connected. No todos yet, so your first save will create todos.json.", "idle");
      return;
    }

    if (!response.ok) {
      throw new Error(await readErrorMessage(response));
    }

    const payload = await response.json();
    const parsed = parseTodosFile(fromBase64(payload.content || ""));
    if (state.hasUnsyncedChanges || state.isSyncing) {
      setStatus("Local changes are still syncing. Try Sync Now again in a moment.", "idle");
      return;
    }

    state.todos = parsed.todos;
    state.lastSyncedTodos = cloneTodos(parsed.todos);
    state.currentSha = payload.sha || null;
    renderTodos();
    setStatus("Synced with GitHub.", "success");
  } catch (error) {
    setStatus(formatGitHubError(error, isStartup), "error");
  } finally {
    setBusy(false);
  }
}

async function updateTodos(nextTodos, commitMessage) {
  if (!isConfigReady()) {
    setStatus("Please save your GitHub settings before editing todos.", "error");
    return;
  }

  state.todos = cloneTodos(nextTodos);
  state.hasUnsyncedChanges = true;
  state.pendingCommitMessage = commitMessage;
  renderTodos();
  setStatus("Saving changes...", "idle");
  void flushPendingSync();
}

async function commitTodos(nextTodos, commitMessage, hasRetried = false) {
  const latestFile = await fetchLatestSha();
  const payload = {
    todos: nextTodos,
  };

  const response = await githubRequest(
    "PUT",
    buildContentsUrl(false),
    {
      message: commitMessage,
      content: toBase64(JSON.stringify(payload, null, 2) + "\n"),
      sha: latestFile.sha || undefined,
      branch: state.config.branch,
    },
    { retries: 1 }
  );

  if (response.ok) {
    return response.json();
  }

  const errorMessage = await readErrorMessage(response);
  const looksLikeShaConflict =
    response.status === 409 ||
    (response.status === 422 && /sha/i.test(errorMessage));

  if (looksLikeShaConflict && !hasRetried) {
    return commitTodos(nextTodos, commitMessage, true);
  }

  throw new Error(errorMessage);
}

async function flushPendingSync(options = {}) {
  const { manual = false } = options;

  if (!isConfigReady()) {
    setStatus("Please save your GitHub settings before editing todos.", "error");
    return;
  }

  if (state.isSyncing) {
    if (manual) {
      setStatus("Still syncing your latest changes...", "idle");
    }
    return;
  }

  if (!state.hasUnsyncedChanges) {
    if (manual) {
      await fetchTodosFromGitHub();
    }
    return;
  }

  state.isSyncing = true;
  setStatus("Syncing latest changes...", "idle");

  try {
    while (state.hasUnsyncedChanges) {
      const snapshot = cloneTodos(state.todos);
      const commitMessage = state.pendingCommitMessage || "Update todos";
      state.hasUnsyncedChanges = false;

      const data = await commitTodos(snapshot, commitMessage);
      state.currentSha = data.content?.sha || null;
      state.lastSyncedTodos = cloneTodos(snapshot);

      if (!todosEqual(state.todos, snapshot)) {
        state.hasUnsyncedChanges = true;
      }
    }

    setStatus("Changes synced to GitHub.", "success");
  } catch (error) {
    state.hasUnsyncedChanges = true;
    setStatus(formatGitHubError(error, false), "error");
  } finally {
    state.isSyncing = false;
  }
}

async function fetchLatestSha() {
  const response = await githubRequest("GET", buildContentsUrl(true, true), undefined, {
    retries: 1,
  });

  if (response.status === 404) {
    return { sha: null };
  }

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  const data = await response.json();
  state.currentSha = data.sha || null;
  return { sha: state.currentSha };
}

function parseTodosFile(rawContent) {
  if (!rawContent.trim()) {
    return { todos: [] };
  }

  const parsed = JSON.parse(rawContent);
  if (!Array.isArray(parsed.todos)) {
    throw new Error("todos.json is invalid. Expected a top-level todos array.");
  }

  return {
    todos: parsed.todos.map((todo) => ({
      id: String(todo.id),
      text: String(todo.text),
      completed: Boolean(todo.completed),
      created_at: String(todo.created_at || new Date().toISOString()),
    })),
  };
}

function buildContentsUrl(includeRef, bustCache = false) {
  const { owner, repo, branch } = state.config;
  const url = new URL(`https://api.github.com/repos/${owner}/${repo}/contents/${TODOS_PATH}`);
  if (includeRef) {
    url.searchParams.set("ref", branch);
  }
  if (bustCache) {
    url.searchParams.set("_", Date.now().toString());
  }
  return url.toString();
}

async function githubRequest(method, url, body, options = {}) {
  const { retries = 0 } = options;

  try {
    return await fetch(url, {
      method,
      cache: "no-store",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${state.config.token}`,
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (error) {
    if (retries > 0) {
      await delay(500);
      return githubRequest(method, url, body, { retries: retries - 1 });
    }

    throw new Error("Could not reach GitHub.");
  }
}

function setBusy(isBusy, nextStatusText = "", tone = "idle") {
  state.isBusy = isBusy;
  elements.refreshButton.disabled = isBusy;
  elements.settingsForm.querySelectorAll("button").forEach((button) => {
    button.disabled = isBusy;
  });

  if (nextStatusText) {
    setStatus(nextStatusText, tone);
  }
}

function setStatus(message, tone) {
  elements.statusText.textContent = message;

  if (tone === "success") {
    elements.syncBadge.textContent = "Synced";
    elements.syncBadge.className = "badge badge-success";
    return;
  }

  if (tone === "error") {
    elements.syncBadge.textContent = "Error";
    elements.syncBadge.className = "badge badge-danger";
    return;
  }

  elements.syncBadge.textContent = state.isSyncing ? "Syncing" : state.isBusy ? "Working" : "Idle";
  elements.syncBadge.className = "badge badge-muted";
}

async function readErrorMessage(response) {
  try {
    const errorPayload = await response.json();
    return errorPayload.message || `GitHub API error (${response.status})`;
  } catch (error) {
    return `GitHub API error (${response.status})`;
  }
}

function toBase64(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";

  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return btoa(binary);
}

function fromBase64(value) {
  const binary = atob(value.replace(/\n/g, ""));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function truncateCommitText(text) {
  return text.length > 48 ? `${text.slice(0, 45)}...` : text;
}

function cloneTodos(todos) {
  return todos.map((todo) => ({ ...todo }));
}

function todosEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function formatGitHubError(error, isStartup) {
  if (/Could not reach GitHub/i.test(error?.message || "")) {
    return isStartup
      ? "Could not connect to GitHub on startup. Tap Sync Now to retry."
      : "Could not reach GitHub. Check your connection and try Sync Now.";
  }

  return error?.message || "GitHub sync failed.";
}

function delay(milliseconds) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}
