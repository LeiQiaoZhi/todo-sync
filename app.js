const STORAGE_KEY = "github-todo-sync-config";
const THEME_KEY = "github-todo-theme";
const DRAFT_KEY = "github-todo-unsynced-draft";
const TODOS_PATH = "todos.json";
const APP_VERSION = "2026-03-16 11:59";
const APP_COMMIT_MESSAGE = "Unify missing hover states";
const TODO_STATUSES = ["progress", "backlog", "done"];
const INITIAL_DRAFT = loadDraftState();
const SYNC_RETRY_MS = 4000;
const SYNC_STALL_MS = 20000;
let syncRetryTimer = null;
let syncWatchdogTimer = null;
let dateRefreshTimer = null;
let completionCelebrationTimer = null;

const state = {
  config: loadSavedConfig(),
  todos: INITIAL_DRAFT?.todos || [],
  lastSyncedTodos: [],
  currentSha: null,
  isBusy: false,
  isSyncing: false,
  hasUnsyncedChanges: Boolean(INITIAL_DRAFT),
  pendingCommitMessage: INITIAL_DRAFT?.pendingCommitMessage || "",
  celebratingTodoId: null,
  celebratingDoneSection: false,
  collapsedSubtodos: {},
  collapsedSections: {
    progress: false,
    backlog: false,
    done: true,
  },
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
  entryDateShell: document.getElementById("entryDateShell"),
  todoDateButton: document.getElementById("todoDateButton"),
  todoDateClearButton: document.getElementById("todoDateClearButton"),
  todoDateInput: document.getElementById("todoDateInput"),
  refreshButton: document.getElementById("refreshButton"),
  progressList: document.getElementById("progressList"),
  backlogList: document.getElementById("backlogList"),
  doneList: document.getElementById("doneList"),
  progressCount: document.getElementById("progressCount"),
  backlogCount: document.getElementById("backlogCount"),
  doneCount: document.getElementById("doneCount"),
  progressToggleButton: document.getElementById("progressToggleButton"),
  backlogToggleButton: document.getElementById("backlogToggleButton"),
  doneToggleButton: document.getElementById("doneToggleButton"),
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
    clearDraftState();
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
    void runSyncAction({ manual: true });
  });

  elements.progressToggleButton.addEventListener("click", () => toggleSection("progress"));
  elements.backlogToggleButton.addEventListener("click", () => toggleSection("backlog"));
  elements.doneToggleButton.addEventListener("click", () => toggleSection("done"));

  elements.toggleThemeButton.addEventListener("click", () => {
    const nextTheme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    applyTheme(nextTheme);
    localStorage.setItem(THEME_KEY, nextTheme);
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      refreshRelativeDates();
    }
  });

  elements.entryDateShell.addEventListener("click", (event) => {
    if (event.target === elements.todoDateInput) {
      return;
    }

    openEntryDatePicker();
  });

  elements.todoDateInput.addEventListener("input", () => {
    updateEntryDateButton();
  });

  elements.todoDateInput.addEventListener("change", () => {
    updateEntryDateButton();
  });

  elements.todoDateClearButton.addEventListener("click", (event) => {
    event.stopPropagation();
    elements.todoDateInput.value = "";
    updateEntryDateButton();
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
    updateEntryDateButton();
    void updateTodos(nextTodos, `Add todo: ${truncateCommitText(text)}`);
  });

  if (state.hasUnsyncedChanges) {
    setStatus("Restored unsynced local changes.", "idle");
    if (isConfigReady()) {
      scheduleBackgroundSync(0);
    }
  } else if (isConfigReady()) {
    void fetchTodosFromGitHub({ isStartup: true });
  } else {
    setStatus("Add your GitHub settings to connect this app.", "idle");
  }

  scheduleRelativeDateRefresh();
  updateEntryDateButton();
}

function updateEntryDateButton() {
  const value = elements.todoDateInput.value;
  const hasValue = Boolean(value);
  elements.todoDateButton.textContent = hasValue ? formatShortDate(value) : "Date";
  elements.todoDateButton.classList.toggle("has-value", hasValue);
  elements.todoDateClearButton.hidden = !hasValue;
}

function isSubtodoCollapsed(todoId) {
  return state.collapsedSubtodos[todoId] ?? true;
}

function focusSubtodoInput(todoId) {
  const item = document.querySelector(`[data-todo-id="${todoId}"]`);
  item?.querySelector(".subtodo-input")?.focus();
}

function syncSubtodoPresentation(todo, toggle, count, body, list) {
  const subtodos = Array.isArray(todo.subtodos) ? todo.subtodos : [];
  const completedCount = subtodos.filter((subtodo) => subtodo.completed).length;
  const collapsed = isSubtodoCollapsed(todo.id);

  count.textContent = subtodos.length === 0 ? "0" : `${completedCount}/${subtodos.length}`;
  toggle.setAttribute("aria-expanded", String(!collapsed));
  body.hidden = collapsed;
  list.innerHTML = "";

  subtodos.forEach((subtodo) => {
    const item = document.createElement("li");
    item.className = "subtodo-item";
    item.classList.toggle("completed", subtodo.completed);

    const label = document.createElement("label");
    label.className = "subtodo-check";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = subtodo.completed;
    checkbox.setAttribute("aria-label", `Mark sub-todo ${subtodo.text} complete`);

    const marker = document.createElement("span");
    marker.className = "subtodo-check-mark";
    marker.setAttribute("aria-hidden", "true");

    const text = document.createElement("span");
    text.className = "subtodo-text";
    text.textContent = subtodo.text;

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "subtodo-remove";
    removeButton.setAttribute("aria-label", `Delete sub-todo ${subtodo.text}`);
    removeButton.textContent = "×";

    checkbox.addEventListener("change", () => {
      const nextTodos = state.todos.map((currentTodo) =>
        currentTodo.id === todo.id
          ? {
              ...currentTodo,
              subtodos: currentTodo.subtodos.map((currentSubtodo) =>
                currentSubtodo.id === subtodo.id
                  ? { ...currentSubtodo, completed: checkbox.checked }
                  : currentSubtodo
              ),
            }
          : currentTodo
      );
      void updateTodos(
        nextTodos,
        `${checkbox.checked ? "Complete" : "Reopen"} sub-todo: ${truncateCommitText(subtodo.text)}`
      );
    });

    removeButton.addEventListener("click", () => {
      const nextTodos = state.todos.map((currentTodo) =>
        currentTodo.id === todo.id
          ? {
              ...currentTodo,
              subtodos: currentTodo.subtodos.filter((currentSubtodo) => currentSubtodo.id !== subtodo.id),
            }
          : currentTodo
      );
      void updateTodos(nextTodos, `Delete sub-todo: ${truncateCommitText(subtodo.text)}`);
    });

    label.append(checkbox, marker);
    item.append(label, text, removeButton);
    list.appendChild(item);
  });
}

function openEntryDatePicker() {
  try {
    if (typeof elements.todoDateInput.showPicker === "function") {
      elements.todoDateInput.showPicker();
      return;
    }
  } catch (error) {
    // Fall through to focus/click for browsers that block showPicker here.
  }

  elements.todoDateInput.focus({ preventScroll: true });
  elements.todoDateInput.click();
}

function celebrateCompletion(todoId) {
  state.celebratingTodoId = todoId;
  state.celebratingDoneSection = true;
  document.body.classList.add("done-background-pulse");
  renderTodos();

  if (completionCelebrationTimer) {
    window.clearTimeout(completionCelebrationTimer);
  }

  completionCelebrationTimer = window.setTimeout(() => {
    state.celebratingTodoId = null;
    state.celebratingDoneSection = false;
    document.body.classList.remove("done-background-pulse");
    completionCelebrationTimer = null;
    renderTodos();
  }, 900);
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
  elements.toggleThemeButton.textContent = theme === "dark" ? "◌" : "☾";
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

function loadDraftState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null");
    if (!parsed || !Array.isArray(parsed.todos)) {
      return null;
    }

    return {
      todos: normalizeTodos(parsed.todos),
      pendingCommitMessage: String(parsed.pendingCommitMessage || "Update todos"),
    };
  } catch (error) {
    return null;
  }
}

function persistDraftState() {
  if (!state.hasUnsyncedChanges) {
    clearDraftState();
    return;
  }

  localStorage.setItem(
    DRAFT_KEY,
    JSON.stringify({
      todos: state.todos,
      pendingCommitMessage: state.pendingCommitMessage || "Update todos",
    })
  );
}

function clearDraftState() {
  localStorage.removeItem(DRAFT_KEY);
}

function clearSyncRetryTimer() {
  if (syncRetryTimer !== null) {
    window.clearTimeout(syncRetryTimer);
    syncRetryTimer = null;
  }
}

function clearSyncWatchdog() {
  if (syncWatchdogTimer !== null) {
    window.clearTimeout(syncWatchdogTimer);
    syncWatchdogTimer = null;
  }
}

function scheduleBackgroundSync(delay = SYNC_RETRY_MS) {
  clearSyncRetryTimer();

  if (!state.hasUnsyncedChanges || !isConfigReady()) {
    return;
  }

  syncRetryTimer = window.setTimeout(() => {
    syncRetryTimer = null;
    void runSyncAction({ manual: false });
  }, delay);
}

function startSyncWatchdog() {
  clearSyncWatchdog();
  syncWatchdogTimer = window.setTimeout(() => {
    if (!state.isSyncing) {
      return;
    }

    state.isSyncing = false;
    state.hasUnsyncedChanges = true;
    persistDraftState();
    setStatus("Background sync stalled. Retrying...", "idle");
    scheduleBackgroundSync(250);
  }, SYNC_STALL_MS);
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

function toggleSection(section) {
  state.collapsedSections[section] = !state.collapsedSections[section];
  syncSectionVisibility();
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
      const textEditor = item.querySelector(".todo-text-editor");
      const deleteButton = item.querySelector(".delete-button");
      const deleteConfirmButton = item.querySelector(".delete-confirm-button");
      const dueDateInput = item.querySelector(".due-date-input");
      const dueDateDisplay = item.querySelector(".due-date-display");
      const statusButtons = item.querySelectorAll(".status-option");
      const subtodoToggle = item.querySelector(".subtodo-toggle");
      const subtodoCount = item.querySelector(".subtodo-count");
      const subtodoBody = item.querySelector(".subtodo-body");
      const subtodoList = item.querySelector(".subtodo-list");
      const subtodoForm = item.querySelector(".subtodo-form");
      const subtodoInput = item.querySelector(".subtodo-input");
      const subtodoAddToggle = item.querySelector(".subtodo-add-toggle");

      item.style.viewTransitionName = getTodoTransitionName(todo.id);
      item.dataset.todoId = todo.id;
      text.textContent = todo.text;
      textEditor.value = todo.text;
      item.classList.toggle("completed", todo.status === "done");
      item.classList.toggle("celebrate-done", state.celebratingTodoId === todo.id);
      dueDateInput.value = todo.due_date || "";
      syncTodoDatePresentation(dueDateInput, dueDateDisplay, todo.due_date);
      syncSubtodoPresentation(todo, subtodoToggle, subtodoCount, subtodoBody, subtodoList);

      text.addEventListener("click", () => {
        text.hidden = true;
        textEditor.hidden = false;
        textEditor.value = todo.text;
        queueMicrotask(() => {
          textEditor.focus();
          textEditor.setSelectionRange(textEditor.value.length, textEditor.value.length);
          autoSizeTaskEditor(textEditor);
        });
      });

      textEditor.addEventListener("input", () => {
        autoSizeTaskEditor(textEditor);
      });

      textEditor.addEventListener("blur", () => {
        void commitTaskTextEdit(todo, text, textEditor);
      });

      textEditor.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          textEditor.value = todo.text;
          textEditor.hidden = true;
          text.hidden = false;
          return;
        }

        if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
          event.preventDefault();
          textEditor.blur();
        }
      });

      statusButtons.forEach((button) => {
        const nextStatus = button.dataset.status;
        button.classList.toggle("active", nextStatus === todo.status);
        button.addEventListener("click", () => {
          if (nextStatus === todo.status) {
            return;
          }

          if (nextStatus === "done") {
            celebrateCompletion(todo.id);
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
        deleteButton.hidden = true;
        deleteConfirmButton.hidden = false;
      });

      deleteConfirmButton.addEventListener("click", () => {
        const nextTodos = state.todos.filter((currentTodo) => currentTodo.id !== todo.id);
        void updateTodos(nextTodos, `Delete todo: ${truncateCommitText(todo.text)}`);
      });

      item.addEventListener("mouseleave", () => {
        deleteButton.hidden = false;
        deleteConfirmButton.hidden = true;
      });

      dueDateDisplay.addEventListener("click", () => {
        dueDateDisplay.hidden = true;
        dueDateInput.hidden = false;
        queueMicrotask(() => {
          dueDateInput.focus();
        });
      });

      dueDateInput.addEventListener("input", () => {
        syncTodoDatePresentation(dueDateInput, dueDateDisplay, dueDateInput.value || null);
        const nextTodos = state.todos.map((currentTodo) =>
          currentTodo.id === todo.id ? { ...currentTodo, due_date: dueDateInput.value || null } : currentTodo
        );
        void updateTodos(
          nextTodos,
          `${dueDateInput.value ? "Update due date" : "Clear due date"}: ${truncateCommitText(todo.text)}`
        );
      });

      subtodoToggle.addEventListener("click", () => {
        state.collapsedSubtodos[todo.id] = !isSubtodoCollapsed(todo.id);
        renderTodos();
      });

      subtodoAddToggle.addEventListener("click", () => {
        state.collapsedSubtodos[todo.id] = false;
        renderTodos();
        queueMicrotask(() => {
          focusSubtodoInput(todo.id);
        });
      });

      subtodoForm.addEventListener("submit", (event) => {
        event.preventDefault();
        const nextText = subtodoInput.value.trim();
        if (!nextText) {
          return;
        }

        const nextTodos = state.todos.map((currentTodo) =>
          currentTodo.id === todo.id
            ? {
                ...currentTodo,
                subtodos: [
                  ...currentTodo.subtodos,
                  {
                    id: crypto.randomUUID(),
                    text: nextText,
                    completed: false,
                  },
                ],
              }
            : currentTodo
        );
        state.collapsedSubtodos[todo.id] = false;
        void updateTodos(nextTodos, `Add sub-todo: ${truncateCommitText(nextText)}`);
      });

      getListElement(status).appendChild(item);
    });
  });

  elements.progressCount.textContent = String(groupedTodos.progress.length);
  elements.backlogCount.textContent = String(groupedTodos.backlog.length);
  elements.doneCount.textContent = String(groupedTodos.done.length);
  elements.doneToggleButton.classList.toggle("celebrate-done-section", state.celebratingDoneSection);
  elements.doneCount.classList.toggle("celebrate-done-count", state.celebratingDoneSection);
  syncSectionVisibility();
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

function getToggleButton(status) {
  if (status === "progress") {
    return elements.progressToggleButton;
  }

  if (status === "backlog") {
    return elements.backlogToggleButton;
  }

  return elements.doneToggleButton;
}

function syncSectionVisibility() {
  TODO_STATUSES.forEach((status) => {
    const list = getListElement(status);
    const button = getToggleButton(status);
    const isCollapsed = state.collapsedSections[status];

    button.setAttribute("aria-expanded", String(!isCollapsed));
    list.hidden = isCollapsed;
    list.dataset.expanded = String(!isCollapsed);
    list.style.removeProperty("height");
    list.style.removeProperty("opacity");
    list.style.removeProperty("overflow");
  });
}

function withOptionalViewTransition(updateFn) {
  const canTransition = typeof document.startViewTransition === "function";
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (!canTransition || reduceMotion) {
    updateFn();
    return;
  }

  document.startViewTransition(() => {
    updateFn();
  });
}

function getTodoTransitionName(id) {
  return `todo-${String(id).replace(/[^a-zA-Z0-9_-]/g, "")}`;
}

function autoSizeTaskEditor(editor) {
  editor.style.height = "0px";
  editor.style.height = `${Math.max(editor.scrollHeight, 26)}px`;
}

async function commitTaskTextEdit(todo, text, editor) {
  const nextText = editor.value.trim();
  editor.hidden = true;
  text.hidden = false;

  if (!nextText || nextText === todo.text) {
    editor.value = todo.text;
    text.textContent = todo.text;
    return;
  }

  text.textContent = nextText;
  const nextTodos = state.todos.map((currentTodo) =>
    currentTodo.id === todo.id ? { ...currentTodo, text: nextText } : currentTodo
  );
  await updateTodos(nextTodos, `Edit todo: ${truncateCommitText(nextText)}`);
}

function syncTodoDatePresentation(input, display, value) {
  const hasValue = Boolean(value);
  input.classList.toggle("has-value", hasValue);
  input.hidden = hasValue;
  display.hidden = !hasValue;
  display.textContent = hasValue ? formatDueDate(value) : "";
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
    subtodos: normalizeSubtodos(todo.subtodos),
  };
}

function normalizeSubtodos(subtodos) {
  if (!Array.isArray(subtodos)) {
    return [];
  }

  return subtodos
    .filter((subtodo) => subtodo && typeof subtodo === "object")
    .map((subtodo) => ({
      id: String(subtodo.id || crypto.randomUUID()),
      text: String(subtodo.text || "").trim(),
      completed: Boolean(subtodo.completed),
    }))
    .filter((subtodo) => subtodo.text);
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
      clearDraftState();
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
    clearDraftState();
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

  withOptionalViewTransition(() => {
    state.todos = normalizeTodos(nextTodos);
    state.hasUnsyncedChanges = true;
    state.pendingCommitMessage = commitMessage;
    persistDraftState();
    renderTodos();
  });
  setStatus("Saving changes...", "idle");
  scheduleBackgroundSync(0);
}

async function runSyncAction(options = {}) {
  const { manual = false } = options;

  if (state.hasUnsyncedChanges || state.isSyncing) {
    await flushPendingSync({ manual });
    return;
  }

  if (manual) {
    await fetchTodosFromGitHub();
  }
}

function refreshRelativeDates() {
  renderTodos();
  scheduleRelativeDateRefresh();
}

function scheduleRelativeDateRefresh() {
  if (dateRefreshTimer) {
    window.clearTimeout(dateRefreshTimer);
  }

  const now = new Date();
  const nextMidnight = new Date(now);
  nextMidnight.setHours(24, 0, 5, 0);
  const delay = Math.max(1000, nextMidnight.getTime() - now.getTime());

  dateRefreshTimer = window.setTimeout(() => {
    dateRefreshTimer = null;
    refreshRelativeDates();
  }, delay);
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
  clearSyncRetryTimer();
  startSyncWatchdog();
  setStatus("Syncing latest changes...", "idle");

  try {
    while (state.hasUnsyncedChanges) {
      const snapshot = normalizeTodos(state.todos);
      const commitMessage = state.pendingCommitMessage || "Update todos";
      state.hasUnsyncedChanges = false;

      const data = await commitTodos(snapshot, commitMessage);
      state.currentSha = data.content?.sha || null;
      state.lastSyncedTodos = cloneTodos(snapshot);
      clearDraftState();

      if (!todosEqual(state.todos, snapshot)) {
        state.hasUnsyncedChanges = true;
        persistDraftState();
      }
    }

    setStatus("Changes synced to GitHub.", "success");
  } catch (error) {
    state.hasUnsyncedChanges = true;
    persistDraftState();
    setStatus(formatGitHubError(error, false), "error");
  } finally {
    clearSyncWatchdog();
    state.isSyncing = false;
    if (state.hasUnsyncedChanges) {
      scheduleBackgroundSync();
    } else {
      setStatus("Changes synced to GitHub.", "success");
    }
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
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 15000);
    return await fetch(url, {
      method,
      cache: "no-store",
      signal: controller.signal,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${state.config.token}`,
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: body ? JSON.stringify(body) : undefined,
    }).finally(() => {
      window.clearTimeout(timeoutId);
    });
  } catch (error) {
    if (retries > 0) {
      await delay(500);
      return githubRequest(method, url, body, { retries: retries - 1 });
    }

    if (error?.name === "AbortError") {
      throw new Error("GitHub request timed out.");
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
  return todos.map((todo) => ({
    ...todo,
    subtodos: Array.isArray(todo.subtodos)
      ? todo.subtodos.map((subtodo) => ({ ...subtodo }))
      : [],
  }));
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

  const shortDate = formatShortDate(value);
  const deltaDays = getRelativeDayDistance(value);
  if (deltaDays === 0) {
    return `Today · ${shortDate}`;
  }

  if (deltaDays === 1) {
    return `Tomorrow · ${shortDate}`;
  }

  if (deltaDays > 1 && deltaDays <= 7) {
    return `This ${formatWeekday(value)} · ${shortDate}`;
  }

  if (deltaDays === -1) {
    return `Yesterday · ${shortDate}`;
  }

  return shortDate;
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
  if (/timed out/i.test(error?.message || "")) {
    return "GitHub sync timed out. Your local changes were kept. Try Sync Now again.";
  }

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
