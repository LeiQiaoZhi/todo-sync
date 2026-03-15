const STORAGE_KEY = "github-todo-sync-config";
const THEME_KEY = "github-todo-theme";
const TODOS_PATH = "todos.json";
const APP_VERSION = "2026-03-15 15:02";
const APP_COMMIT_MESSAGE = "Accent task sections and move done chevron";
const TODO_STATUSES = ["progress", "backlog", "done"];

const state = {
  config: loadSavedConfig(),
  todos: [],
  lastSyncedTodos: [],
  currentSha: null,
  isBusy: false,
  isSyncing: false,
  hasUnsyncedChanges: false,
  pendingCommitMessage: "",
  doneCollapsed: true,
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
  toggleThemeButton: document.getElementById("toggleThemeButton"),
  todoForm: document.getElementById("todoForm"),
  todoInput: document.getElementById("todoInput"),
  todoDateInput: document.getElementById("todoDateInput"),
  clearTodoDateButton: document.getElementById("clearTodoDateButton"),
  refreshButton: document.getElementById("refreshButton"),
  progressList: document.getElementById("progressList"),
  backlogList: document.getElementById("backlogList"),
  doneList: document.getElementById("doneList"),
  progressCount: document.getElementById("progressCount"),
  backlogCount: document.getElementById("backlogCount"),
  doneCount: document.getElementById("doneCount"),
  doneToggleButton: document.getElementById("doneToggleButton"),
  doneChevron: document.getElementById("doneChevron"),
  emptyState: document.getElementById("emptyState"),
  todoItemTemplate: document.getElementById("todoItemTemplate"),
};

initialize();

function initialize() {
  applyTheme(loadThemePreference());
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

  elements.doneToggleButton.addEventListener("click", () => {
    state.doneCollapsed = !state.doneCollapsed;
    renderTodos();
  });

  elements.toggleThemeButton.addEventListener("click", () => {
    const nextTheme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    applyTheme(nextTheme);
    localStorage.setItem(THEME_KEY, nextTheme);
  });

  elements.clearTodoDateButton.addEventListener("click", () => {
    elements.todoDateInput.value = "";
    updateEntryDateClearButton();
  });

  elements.todoDateInput.addEventListener("input", () => {
    updateEntryDateClearButton();
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
        status: "progress",
        completed: false,
        created_at: new Date().toISOString(),
        due_date: elements.todoDateInput.value || null,
      },
      ...state.todos,
    ];

    elements.todoInput.value = "";
    elements.todoDateInput.value = "";
    updateEntryDateClearButton();
    void updateTodos(nextTodos, `Add todo: ${truncateCommitText(text)}`);
  });

  if (isConfigReady()) {
    void fetchTodosFromGitHub({ isStartup: true });
  } else {
    setStatus("Add your GitHub settings to connect this app.", "idle");
  }

  updateEntryDateClearButton();
}

function loadThemePreference() {
  const savedTheme = localStorage.getItem(THEME_KEY);
  if (savedTheme === "light" || savedTheme === "dark") {
    return savedTheme;
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  elements.toggleThemeButton.textContent = theme === "dark" ? "☀" : "☾";
  elements.toggleThemeButton.setAttribute(
    "aria-label",
    theme === "dark" ? "Switch to light theme" : "Switch to dark theme"
  );
  elements.toggleThemeButton.setAttribute(
    "title",
    theme === "dark" ? "Switch to light theme" : "Switch to dark theme"
  );
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

function updateEntryDateClearButton() {
  elements.clearTodoDateButton.hidden = !elements.todoDateInput.value;
}

function renderTodos() {
  elements.progressList.innerHTML = "";
  elements.backlogList.innerHTML = "";
  elements.doneList.innerHTML = "";

  const groupedTodos = {
    progress: sortTodos(state.todos.filter((todo) => todo.status === "progress")),
    backlog: sortTodos(state.todos.filter((todo) => todo.status === "backlog")),
    done: sortTodos(state.todos.filter((todo) => todo.status === "done")),
  };

  TODO_STATUSES.forEach((status) => {
    groupedTodos[status].forEach((todo) => {
      const item = elements.todoItemTemplate.content.firstElementChild.cloneNode(true);
      const text = item.querySelector(".todo-text");
      const deleteButton = item.querySelector(".delete-button");
      const dueButton = item.querySelector(".due-button");
      const dueEditor = item.querySelector(".due-editor");
      const dueDateInput = item.querySelector(".due-date-input");
      const clearDueButton = item.querySelector(".clear-due-button");
      const statusButtons = item.querySelectorAll(".status-option");

      text.textContent = todo.text;
      item.classList.toggle("completed", todo.status === "done");
      dueDateInput.value = todo.due_date || "";
      dueButton.textContent = formatDueDate(todo.due_date);
      dueButton.classList.toggle("has-date", Boolean(todo.due_date));

      statusButtons.forEach((button) => {
        const nextStatus = button.dataset.status;
        button.classList.toggle("active", nextStatus === todo.status);
        button.addEventListener("click", () => {
          if (nextStatus === todo.status) {
            return;
          }

          const nextTodos = state.todos.map((currentTodo) =>
            currentTodo.id === todo.id
              ? { ...currentTodo, status: nextStatus, completed: nextStatus === "done" }
              : currentTodo
          );
          void updateTodos(nextTodos, `Move todo: ${truncateCommitText(todo.text)}`);
        });
      });

      deleteButton.addEventListener("click", () => {
        const nextTodos = state.todos.filter((currentTodo) => currentTodo.id !== todo.id);
        void updateTodos(nextTodos, `Delete todo: ${truncateCommitText(todo.text)}`);
      });

      dueButton.addEventListener("click", () => {
        dueEditor.toggleAttribute("hidden");
      });

      dueDateInput.addEventListener("change", () => {
        const nextTodos = state.todos.map((currentTodo) =>
          currentTodo.id === todo.id
            ? { ...currentTodo, due_date: dueDateInput.value || null }
            : currentTodo
        );
        dueEditor.setAttribute("hidden", "");
        void updateTodos(nextTodos, `Update due date: ${truncateCommitText(todo.text)}`);
      });

      clearDueButton.addEventListener("click", () => {
        dueDateInput.value = "";
        const nextTodos = state.todos.map((currentTodo) =>
          currentTodo.id === todo.id ? { ...currentTodo, due_date: null } : currentTodo
        );
        dueEditor.setAttribute("hidden", "");
        void updateTodos(nextTodos, `Clear due date: ${truncateCommitText(todo.text)}`);
      });

      getListElement(status).appendChild(item);
    });
  });

  elements.progressCount.textContent = String(groupedTodos.progress.length);
  elements.backlogCount.textContent = String(groupedTodos.backlog.length);
  elements.doneCount.textContent = String(groupedTodos.done.length);
  elements.doneList.hidden = state.doneCollapsed;
  elements.doneToggleButton.setAttribute("aria-expanded", String(!state.doneCollapsed));
  elements.doneChevron.textContent = state.doneCollapsed ? "▸" : "▾";
  elements.emptyState.hidden = state.todos.length > 0;
}

function getListElement(status) {
  if (status === "progress") {
    return elements.progressList;
  }

  if (status === "backlog") {
    return elements.backlogList;
  }

  return elements.doneList;
}

function normalizeTodo(todo) {
  const status = TODO_STATUSES.includes(todo.status)
    ? todo.status
    : todo.completed
      ? "done"
      : "progress";

  return {
    id: String(todo.id),
    text: String(todo.text),
    status,
    completed: status === "done",
    created_at: String(todo.created_at || new Date().toISOString()),
    due_date: normalizeDueDate(todo.due_date),
  };
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

    state.todos = cloneTodos(parsed.todos);
    state.lastSyncedTodos = cloneTodos(state.todos);
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

  state.todos = normalizeTodos(nextTodos);
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
      const snapshot = normalizeTodos(state.todos);
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
    todos: normalizeTodos(parsed.todos),
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

function normalizeTodos(todos) {
  return todos.map((todo) => normalizeTodo(todo));
}

function todosEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sortTodos(todos) {
  return [...todos].sort((left, right) => {
    const leftDue = left.due_date || "9999-12-31";
    const rightDue = right.due_date || "9999-12-31";

    if (leftDue !== rightDue) {
      return leftDue.localeCompare(rightDue);
    }

    return left.created_at.localeCompare(right.created_at);
  });
}

function normalizeDueDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "")) ? String(value) : null;
}

function formatDueDate(value) {
  if (!value) {
    return "Set date";
  }

  const deltaDays = getRelativeDayDistance(value);
  if (deltaDays === 0) {
    return "Today";
  }

  if (deltaDays === 1) {
    return "Tomorrow";
  }

  if (deltaDays > 1 && deltaDays <= 7) {
    return `Next ${formatWeekday(value)}`;
  }

  if (deltaDays === -1) {
    return "Yesterday";
  }

  return formatShortDate(value);
}

function getRelativeDayDistance(value) {
  const target = createLocalDate(value);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const millisecondsPerDay = 24 * 60 * 60 * 1000;
  return Math.round((target.getTime() - today.getTime()) / millisecondsPerDay);
}

function createLocalDate(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatWeekday(value) {
  return createLocalDate(value).toLocaleDateString(undefined, { weekday: "short" });
}

function formatShortDate(value) {
  return createLocalDate(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
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
