"use strict";

(function () {
  /* 
     Constants
     */
  const STORAGE_KEY = "daymark.events.v1";
  const WEEK_STARTS_ON = 1; // 0 = Sunday, 1 = Monday
  const MINUTES_PER_DAY = 1440;
  const MAX_CHIPS_PER_DAY = 3;
  const UPCOMING_LIMIT = 5;

  const MONTH_NAMES = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];
  // Index matches Date.getDay(): 0 = Sunday
  const WEEKDAY_NAMES = [
    "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"
  ];
  const CATEGORIES = {
    study: "Study",
    work: "Work",
    personal: "Personal",
    other: "Other"
  };

  /* 
     DOM references
      */
  const $ = (selector) => document.querySelector(selector);

  const els = {
    periodTitle: $("#period-title"),
    periodCount: $("#period-count"),
    prevBtn: $("#prev-btn"),
    nextBtn: $("#next-btn"),
    todayBtn: $("#today-btn"),
    viewMonthBtn: $("#view-month"),
    viewWeekBtn: $("#view-week"),
    newEventBtn: $("#new-event-btn"),
    calendarView: $("#calendar-view"),
    selectedDay: $("#selected-day"),
    upcomingList: $("#upcoming-list"),
    toast: $("#toast"),
    composer: $("#composer"),
    form: $("#event-form"),
    composerTitle: $("#composer-title"),
    closeBtn: $("#composer-close"),
    cancelBtn: $("#cancel-btn"),
    saveBtn: $("#save-btn"),
    deleteBtn: $("#delete-btn"),
    fields: {
      id: $("#event-id"),
      title: $("#event-title"),
      date: $("#event-date"),
      time: $("#event-time"),
      description: $("#event-description")
    }
  };

  /* =========================================================
     Application state (single source of truth)
     ========================================================= */
  const state = {
    events: [],
    eventsByDate: new Map(),
    view: "month",                       // "month" | "week"
    anchorDate: startOfDay(new Date()),  // decides which month/week is shown
    selectedKey: toDateKey(new Date()),  // "YYYY-MM-DD"
    todayKey: toDateKey(new Date())
  };

  /* 
     Date helpers
     Every date is handled in LOCAL time. Keys are "YYYY-MM-DD".
     We never use toISOString() because it converts to UTC and can
     shift the date by a day.
     */
  function pad(number) {
    return String(number).padStart(2, "0");
  }

  function toDateKey(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  // Returns a Date, or null if the key is not a real calendar date.
  function parseDateKey(key) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]) - 1;
    const day = Number(match[3]);
    const date = new Date(year, month, day);
    // Round-trip check rejects things like 2025-02-30
    if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) {
      return null;
    }
    return date;
  }

  function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function addDays(date, amount) {
    // The Date constructor handles overflow into other months/years
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount);
  }

  function daysInMonth(year, month) {
    // Day 0 of the next month is the last day of this month (handles leap years)
    return new Date(year, month + 1, 0).getDate();
  }

  function addMonths(date, amount) {
    const target = new Date(date.getFullYear(), date.getMonth() + amount, 1);
    const lastDay = daysInMonth(target.getFullYear(), target.getMonth());
    // Clamp so 31 Jan + 1 month becomes 28/29 Feb, not 3 March
    return new Date(target.getFullYear(), target.getMonth(), Math.min(date.getDate(), lastDay));
  }

  function startOfWeek(date) {
    const offset = (date.getDay() - WEEK_STARTS_ON + 7) % 7;
    return addDays(date, -offset);
  }

  // Always 42 dates (6 rows x 7 columns) so the grid height never jumps
  function getMonthGridDates(anchor) {
    const firstOfMonth = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const gridStart = startOfWeek(firstOfMonth);
    return Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
  }

  function getWeekDates(anchor) {
    const weekStart = startOfWeek(anchor);
    return Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  }

  // Weekday indexes in display order, e.g. [1,2,3,4,5,6,0] when the week starts Monday
  function getWeekdayOrder() {
    return Array.from({ length: 7 }, (_, index) => (WEEK_STARTS_ON + index) % 7);
  }

  function timeToMinutes(time) {
    const [hours, minutes] = time.split(":").map(Number);
    return hours * 60 + minutes;
  }

  /* 
     Formatting
      */
  function formatLongDate(date) {
    return `${WEEKDAY_NAMES[date.getDay()]}, ${date.getDate()} ${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`;
  }

  function formatShortDate(date) {
    return `${WEEKDAY_NAMES[date.getDay()].slice(0, 3)} ${date.getDate()} ${MONTH_NAMES[date.getMonth()].slice(0, 3)}`;
  }

  function formatTime(time) {
    if (!time) return "All day";
    const [hours, minutes] = time.split(":").map(Number);
    const suffix = hours >= 12 ? "PM" : "AM";
    return `${hours % 12 || 12}:${pad(minutes)} ${suffix}`;
  }

  function formatWeekRange(weekDates) {
    const first = weekDates[0];
    const last = weekDates[6];
    const shortMonth = (date) => MONTH_NAMES[date.getMonth()].slice(0, 3);

    if (first.getFullYear() !== last.getFullYear()) {
      return `${first.getDate()} ${shortMonth(first)} ${first.getFullYear()} \u2013 ${last.getDate()} ${shortMonth(last)} ${last.getFullYear()}`;
    }
    if (first.getMonth() !== last.getMonth()) {
      return `${first.getDate()} ${shortMonth(first)} \u2013 ${last.getDate()} ${shortMonth(last)} ${last.getFullYear()}`;
    }
    return `${first.getDate()} \u2013 ${last.getDate()} ${MONTH_NAMES[first.getMonth()]} ${first.getFullYear()}`;
  }

  function pluralizeEvents(count) {
    if (count === 0) return "No events";
    return `${count} ${count === 1 ? "event" : "events"}`;
  }

  /* 
     Persistence (localStorage)
      */
  function isValidTime(value) {
    return value === "" || /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
  }

  // Turns untrusted stored data into a clean event, or null if unusable
  function sanitizeEvent(raw) {
    if (!raw || typeof raw !== "object") return null;
    if (typeof raw.id !== "string" || raw.id === "") return null;

    const title = typeof raw.title === "string" ? raw.title.trim() : "";
    if (title === "") return null;
    if (typeof raw.date !== "string" || !parseDateKey(raw.date)) return null;

    return {
      id: raw.id,
      title: title.slice(0, 80),
      description: typeof raw.description === "string" ? raw.description.slice(0, 500) : "",
      date: raw.date,
      time: typeof raw.time === "string" && isValidTime(raw.time) ? raw.time : "",
      category: Object.prototype.hasOwnProperty.call(CATEGORIES, raw.category) ? raw.category : "other"
    };
  }

  function loadEvents() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) return [];
      const parsed = JSON.parse(stored);
      if (!Array.isArray(parsed)) return [];
      return parsed.map(sanitizeEvent).filter(Boolean);
    } catch (error) {
      return []; // corrupt JSON or storage blocked
    }
  }

  function saveEvents() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.events));
      return true;
    } catch (error) {
      return false;
    }
  }

  /* 
     Event data helpers
     */
  function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  // Untimed events ("" sorts first), then by time, then by title
  function compareEvents(a, b) {
    if (a.time !== b.time) return a.time < b.time ? -1 : 1;
    return a.title.localeCompare(b.title);
  }

  function groupEventsByDate(events) {
    const groups = new Map();
    events.forEach((event) => {
      if (!groups.has(event.date)) groups.set(event.date, []);
      groups.get(event.date).push(event);
    });
    groups.forEach((list) => list.sort(compareEvents));
    return groups;
  }

  // Keys are zero-padded, so plain string comparison orders dates correctly
  function countEventsBetween(startKey, endKey) {
    return state.events.filter((event) => event.date >= startKey && event.date <= endKey).length;
  }

  function getUpcomingEvents(limit) {
    return state.events
      .filter((event) => event.date >= state.todayKey)
      .sort((a, b) => (a.date !== b.date ? (a.date < b.date ? -1 : 1) : compareEvents(a, b)))
      .slice(0, limit);
  }

  /* 
     Small DOM helper (textContent only, so titles can never inject HTML)
      */
  function createEl(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function createButton(className, text) {
    const button = createEl("button", className, text);
    button.type = "button";
    return button;
  }

  /* 
     Rendering
      */
  function renderAll(animate = false) {
    state.todayKey = toDateKey(new Date());
    state.eventsByDate = groupEventsByDate(state.events);
    renderHeader();
    renderCalendar(animate);
    renderSelectedDay();
    renderUpcoming();
    paintLiveIndicators();
  }

  function renderHeader() {
    const isMonth = state.view === "month";
    let startKey;
    let endKey;

    if (isMonth) {
      const year = state.anchorDate.getFullYear();
      const month = state.anchorDate.getMonth();
      els.periodTitle.textContent = `${MONTH_NAMES[month]} ${year}`;
      startKey = toDateKey(new Date(year, month, 1));
      endKey = toDateKey(new Date(year, month, daysInMonth(year, month)));
    } else {
      const weekDates = getWeekDates(state.anchorDate);
      els.periodTitle.textContent = formatWeekRange(weekDates);
      startKey = toDateKey(weekDates[0]);
      endKey = toDateKey(weekDates[6]);
    }

    els.periodCount.textContent = pluralizeEvents(countEventsBetween(startKey, endKey));

    const unit = isMonth ? "month" : "week";
    els.prevBtn.setAttribute("aria-label", `Previous ${unit}`);
    els.nextBtn.setAttribute("aria-label", `Next ${unit}`);
    els.viewMonthBtn.setAttribute("aria-pressed", String(isMonth));
    els.viewWeekBtn.setAttribute("aria-pressed", String(!isMonth));
  }

  function renderCalendar(animate) {
    const view = state.view === "month" ? buildMonthView() : buildWeekView();
    els.calendarView.replaceChildren(view);

    if (animate) {
      els.calendarView.classList.remove("is-entering");
      void els.calendarView.offsetWidth; // restart the CSS animation
      els.calendarView.classList.add("is-entering");
    }
  }

  /* Month view*/
  function buildMonthView() {
    const viewMonth = state.anchorDate.getMonth();
    const dates = getMonthGridDates(state.anchorDate);

    const table = createEl("table", "month");
    table.setAttribute("aria-label", `${MONTH_NAMES[viewMonth]} ${state.anchorDate.getFullYear()}`);

    const headRow = createEl("tr");
    getWeekdayOrder().forEach((weekdayIndex) => {
      const th = createEl("th", null, WEEKDAY_NAMES[weekdayIndex].slice(0, 3));
      th.scope = "col";
      th.abbr = WEEKDAY_NAMES[weekdayIndex];
      headRow.appendChild(th);
    });
    const thead = createEl("thead");
    thead.appendChild(headRow);

    const tbody = createEl("tbody");
    for (let week = 0; week < 6; week += 1) {
      const row = createEl("tr");
      dates.slice(week * 7, week * 7 + 7).forEach((date) => {
        row.appendChild(buildMonthCell(date, viewMonth));
      });
      tbody.appendChild(row);
    }

    table.append(thead, tbody);
    return table;
  }

  function buildMonthCell(date, viewMonth) {
    const key = toDateKey(date);
    const events = state.eventsByDate.get(key) || [];

    const td = createEl("td");
    const cell = createEl("div", "day-cell");
    if (date.getMonth() !== viewMonth) cell.classList.add("is-outside");
    if (key === state.todayKey) cell.classList.add("is-today");
    if (key === state.selectedKey) cell.classList.add("is-selected");
    cell.addEventListener("click", () => openComposerForDate(key));

    const number = createButton("day-number", String(date.getDate()));
    number.setAttribute("aria-label", `Add event on ${formatLongDate(date)}`);
    cell.appendChild(number);

    if (events.length > 0) {
      const chips = createEl("div", "chips");
      events.slice(0, MAX_CHIPS_PER_DAY).forEach((event) => chips.appendChild(buildChip(event)));

      if (events.length > MAX_CHIPS_PER_DAY) {
        const hidden = events.length - MAX_CHIPS_PER_DAY;
        const more = createButton("more-btn", `+${hidden} more`);
        more.setAttribute("aria-label", `Show all ${events.length} events on ${formatLongDate(date)}`);
        more.addEventListener("click", (clickEvent) => {
          clickEvent.stopPropagation();
          selectDate(key);
          focusSelectedDay();
        });
        chips.appendChild(more);
      }
      cell.appendChild(chips);
    }

    td.appendChild(cell);
    return td;
  }

  function buildChip(event) {
    const chip = createButton("chip");
    chip.dataset.category = event.category;
    chip.title = event.title;
    chip.setAttribute(
      "aria-label",
      `${event.title}, ${formatTime(event.time)}, ${CATEGORIES[event.category]}. Edit event`
    );
    if (event.time) chip.appendChild(createEl("span", "chip-time", formatTime(event.time)));
    chip.appendChild(createEl("span", "chip-title", event.title));
    chip.addEventListener("click", (clickEvent) => {
      clickEvent.stopPropagation(); // do not also open "new event" for the cell
      openComposerForEvent(event.id);
    });
    return chip;
  }

  /* Week view */
  function buildWeekView() {
    const grid = createEl("div", "week");
    getWeekDates(state.anchorDate).forEach((date) => grid.appendChild(buildWeekDay(date)));
    return grid;
  }

  function buildWeekDay(date) {
    const key = toDateKey(date);
    const events = state.eventsByDate.get(key) || [];

    const column = createEl("section", "week-day");
    column.setAttribute("aria-label", formatLongDate(date));
    if (key === state.todayKey) column.classList.add("is-today");
    if (key === state.selectedKey) column.classList.add("is-selected");
    column.addEventListener("click", () => openComposerForDate(key));

    const head = createEl("div", "week-head");
    head.appendChild(createEl("span", "weekday-label", WEEKDAY_NAMES[date.getDay()].slice(0, 3)));
    const number = createButton("day-number", String(date.getDate()));
    number.setAttribute("aria-label", `Add event on ${formatLongDate(date)}`);
    head.appendChild(number);
    column.appendChild(head);

    if (events.length === 0) {
      column.appendChild(createEl("p", "week-empty", "No events"));
    } else {
      events.forEach((event) => column.appendChild(buildEventCard(event)));
    }
    return column;
  }

  function buildEventCard(event) {
    const card = createButton("event-card");
    card.dataset.category = event.category;
    card.setAttribute(
      "aria-label",
      `${event.title}, ${formatTime(event.time)}, ${CATEGORIES[event.category]}. Edit event`
    );
    card.appendChild(createEl("span", "event-card-time", formatTime(event.time)));
    card.appendChild(createEl("span", "event-card-title", event.title));
    if (event.description) card.appendChild(createEl("span", "event-card-desc", event.description));
    card.addEventListener("click", (clickEvent) => {
      clickEvent.stopPropagation();
      openComposerForEvent(event.id);
    });
    return card;
  }

  /*  Sidebar: selected day  */
  function renderSelectedDay() {
    const date = parseDateKey(state.selectedKey);
    const events = state.eventsByDate.get(state.selectedKey) || [];

    const head = createEl("div", "selected-head");
    const number = createEl("span", "selected-number", String(date.getDate()));
    if (state.selectedKey === state.todayKey) number.classList.add("is-today-text");

    const meta = createEl("div", "selected-meta");
    meta.appendChild(createEl("strong", null, WEEKDAY_NAMES[date.getDay()]));
    meta.appendChild(createEl("span", null, `${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`));
    meta.appendChild(createEl("span", "selected-count", pluralizeEvents(events.length)));
    head.append(number, meta);

    const nodes = [head, buildDayRuler(events)];

    if (events.length === 0) {
      nodes.push(createEl("p", "empty", "Nothing planned for this day."));
    } else {
      const list = createEl("ul", "event-list");
      events.forEach((event) => list.appendChild(buildEventRow(event, false)));
      nodes.push(list);
    }

    const addButton = createButton("btn btn-block", "Add event");
    addButton.addEventListener("click", () => openComposerForDate(state.selectedKey));
    nodes.push(addButton);

    els.selectedDay.replaceChildren(...nodes);
  }

  // Signature feature: a 24-hour ruler with one tick per timed event
  function buildDayRuler(events) {
    const ruler = createEl("div", "ruler");
    ruler.setAttribute("role", "group");
    ruler.setAttribute("aria-label", "Timeline of timed events, midnight to midnight");

    const track = createEl("div", "ruler-track");
    events.filter((event) => event.time).forEach((event) => {
      const mark = createButton("ruler-mark");
      mark.dataset.category = event.category;
      mark.style.left = `${(timeToMinutes(event.time) / MINUTES_PER_DAY) * 100}%`;
      mark.title = `${formatTime(event.time)} \u00b7 ${event.title}`;
      mark.setAttribute("aria-label", `${event.title} at ${formatTime(event.time)}. Edit event`);
      mark.addEventListener("click", () => openComposerForEvent(event.id));
      track.appendChild(mark);
    });

    if (state.selectedKey === state.todayKey) {
      track.appendChild(createEl("span", "ruler-now"));
    }

    const labels = createEl("div", "ruler-labels");
    labels.setAttribute("aria-hidden", "true");
    ["12 AM", "6 AM", "12 PM", "6 PM", "12 AM"].forEach((text) => {
      labels.appendChild(createEl("span", null, text));
    });

    ruler.append(track, labels);
    return ruler;
  }

  /* Sidebar: upcoming  */
  function buildEventRow(event, showDate) {
    const item = createEl("li");
    const row = createButton("event-row");
    row.dataset.category = event.category;
    row.setAttribute(
      "aria-label",
      `${event.title}, ${formatShortDate(parseDateKey(event.date))}, ${formatTime(event.time)}. Edit event`
    );

    const when = createEl("span", "row-when");
    if (showDate) when.appendChild(createEl("span", "row-date", formatShortDate(parseDateKey(event.date))));
    when.appendChild(createEl("span", "row-time", formatTime(event.time)));

    const body = createEl("span", "row-body");
    body.appendChild(createEl("span", "row-title", event.title));
    if (event.description) body.appendChild(createEl("span", "row-desc", event.description));

    row.append(when, body);
    row.addEventListener("click", () => openComposerForEvent(event.id));
    item.appendChild(row);
    return item;
  }

  function renderUpcoming() {
    const upcoming = getUpcomingEvents(UPCOMING_LIMIT);
    if (upcoming.length === 0) {
      const empty = createEl("li");
      empty.appendChild(createEl("p", "empty", "No upcoming events."));
      els.upcomingList.replaceChildren(empty);
      return;
    }
    els.upcomingList.replaceChildren(...upcoming.map((event) => buildEventRow(event, true)));
  }

  /*  Living date indicator  */
  function paintLiveIndicators() {
    const now = new Date();
    const percent = `${((now.getHours() * 60 + now.getMinutes()) / MINUTES_PER_DAY) * 100}%`;
    document.querySelectorAll(".is-today").forEach((node) => node.style.setProperty("--elapsed", percent));
    document.querySelectorAll(".ruler-now").forEach((node) => { node.style.left = percent; });
  }

  // Runs every minute: refresh the bar, or re-render if midnight has passed
  function tick() {
    if (toDateKey(new Date()) !== state.todayKey) {
      renderAll();
    } else {
      paintLiveIndicators();
    }
  }

  /* 
     Navigation and view switching
     */
  function setSelectedDate(key) {
    state.selectedKey = key;
    state.anchorDate = parseDateKey(key);
  }

  function selectDate(key) {
    setSelectedDate(key);
    renderAll();
  }

  function navigate(direction) {
    state.anchorDate = state.view === "month"
      ? addMonths(state.anchorDate, direction)
      : addDays(state.anchorDate, 7 * direction);
    renderAll();
  }

  function goToToday() {
    const today = startOfDay(new Date());
    state.anchorDate = today;
    state.selectedKey = toDateKey(today);
    renderAll();
  }

  function setView(view) {
    if (state.view === view) return;
    state.view = view; // anchorDate is kept, so the same month/week stays in focus
    renderAll(true);
  }

  function focusSelectedDay() {
    const target = els.calendarView.querySelector(".is-selected .day-number");
    if (target) target.focus();
  }

  /* 
     Event composer: open / fill / validate
     */
  function openComposerForDate(dateKey) {
    setSelectedDate(dateKey);
    renderAll();
    fillComposer(null, dateKey);
    showComposer();
  }

  function openComposerForEvent(eventId) {
    const event = state.events.find((item) => item.id === eventId);
    if (!event) return;
    setSelectedDate(event.date);
    renderAll();
    fillComposer(event, event.date);
    showComposer();
  }

  function showComposer() {
    if (!els.composer.open) els.composer.showModal();
    els.fields.title.focus();
  }

  function setCategory(value) {
    const radio = els.form.querySelector(`input[name="category"][value="${value}"]`);
    if (radio) radio.checked = true;
  }

  function fillComposer(event, dateKey) {
    const editing = Boolean(event);
    els.fields.id.value = editing ? event.id : "";
    els.fields.title.value = editing ? event.title : "";
    els.fields.date.value = editing ? event.date : dateKey;
    els.fields.time.value = editing ? event.time : "";
    els.fields.description.value = editing ? event.description : "";
    setCategory(editing ? event.category : "study");

    clearErrors();
    resetDeleteButton();
    els.composerTitle.textContent = editing ? "Edit event" : "New event";
    els.saveBtn.textContent = editing ? "Save changes" : "Add event";
    els.deleteBtn.hidden = !editing;
  }

  function clearFieldError(field) {
    const message = $(`#${field.id}-error`);
    if (message) message.textContent = "";
    field.removeAttribute("aria-invalid");
  }

  function clearErrors() {
    clearFieldError(els.fields.title);
    clearFieldError(els.fields.date);
  }

  function showFieldError(field, text) {
    $(`#${field.id}-error`).textContent = text;
    field.setAttribute("aria-invalid", "true");
  }

  function validateForm() {
    clearErrors();
    let firstInvalid = null;

    if (els.fields.title.value.trim() === "") {
      showFieldError(els.fields.title, "Give the event a title.");
      firstInvalid = els.fields.title;
    }
    if (!parseDateKey(els.fields.date.value)) {
      showFieldError(els.fields.date, "Choose a valid date.");
      firstInvalid = firstInvalid || els.fields.date;
    }

    if (firstInvalid) {
      firstInvalid.focus();
      return false;
    }
    return true;
  }

  function readForm() {
    return {
      id: els.fields.id.value,
      title: els.fields.title.value.trim(),
      date: els.fields.date.value,
      time: isValidTime(els.fields.time.value) ? els.fields.time.value : "",
      description: els.fields.description.value.trim(),
      category: els.form.querySelector('input[name="category"]:checked').value
    };
  }

  /* 
     Event actions: create / update / delete
     */
  function handleSubmit(submitEvent) {
    submitEvent.preventDefault();
    if (!validateForm()) return;

    const data = readForm();
    if (data.id) {
      updateEvent(data);
    } else {
      createEvent(data);
    }
  }

  function createEvent(data) {
    state.events.push({ ...data, id: generateId() });
    commitChange("Event added", data.date);
  }

  function updateEvent(data) {
    const index = state.events.findIndex((event) => event.id === data.id);
    if (index === -1) return;
    state.events[index] = data;
    commitChange("Event updated", data.date);
  }

  function deleteEvent(eventId) {
    state.events = state.events.filter((event) => event.id !== eventId);
    commitChange("Event deleted");
  }

  // Shared finish: save, move selection to the event's date, close, redraw, confirm
  function commitChange(message, dateKey) {
    const saved = saveEvents();
    if (dateKey) setSelectedDate(dateKey);
    els.composer.close();
    renderAll();
    showToast(saved ? message : `${message} (browser storage unavailable, so it will not persist)`);
  }

  // Two-step delete: first click arms the button, second click deletes
  let deleteArmed = false;

  function resetDeleteButton() {
    deleteArmed = false;
    els.deleteBtn.textContent = "Delete";
    els.deleteBtn.classList.remove("is-armed");
  }

  function handleDeleteClick() {
    if (!deleteArmed) {
      deleteArmed = true;
      els.deleteBtn.textContent = "Confirm delete";
      els.deleteBtn.classList.add("is-armed");
      return;
    }
    deleteEvent(els.fields.id.value);
  }

  /* 
     Toast
      */
  let toastTimer = null;

  function showToast(message) {
    els.toast.textContent = message;
    els.toast.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove("is-visible"), 2600);
  }

  /* 
     Wiring
    */
  function bindEvents() {
    els.prevBtn.addEventListener("click", () => navigate(-1));
    els.nextBtn.addEventListener("click", () => navigate(1));
    els.todayBtn.addEventListener("click", goToToday);
    els.viewMonthBtn.addEventListener("click", () => setView("month"));
    els.viewWeekBtn.addEventListener("click", () => setView("week"));
    els.newEventBtn.addEventListener("click", () => openComposerForDate(state.selectedKey));

    els.form.addEventListener("submit", handleSubmit);
    els.closeBtn.addEventListener("click", () => els.composer.close());
    els.cancelBtn.addEventListener("click", () => els.composer.close());
    els.deleteBtn.addEventListener("click", handleDeleteClick);
    els.deleteBtn.addEventListener("blur", resetDeleteButton);

    els.fields.title.addEventListener("input", () => clearFieldError(els.fields.title));
    els.fields.date.addEventListener("input", () => clearFieldError(els.fields.date));

    // Close when the backdrop is clicked (but not when a text selection
    // drag started inside the form and ended on the backdrop)
    let pressStartedOnBackdrop = false;
    els.composer.addEventListener("mousedown", (event) => {
      pressStartedOnBackdrop = event.target === els.composer;
    });
    els.composer.addEventListener("click", (event) => {
      if (pressStartedOnBackdrop && event.target === els.composer) els.composer.close();
    });

    // The calendar is re-rendered while the composer is open, so give focus back
    els.composer.addEventListener("close", () => {
      if (document.activeElement === document.body) focusSelectedDay();
    });
  }

  function init() {
    state.events = loadEvents();
    bindEvents();
    renderAll();
    setInterval(tick, 60000);
  }

  init();
})();