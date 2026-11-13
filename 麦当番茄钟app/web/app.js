(function () {
  'use strict';

  const STORAGE_KEY = 'maidang-pomodoro-app:v1';
  const DEFAULT_DURATION = 25 * 60;
  const MIN_DURATION = 5 * 60;
  const MAX_DURATION = 120 * 60;
  const DURATION_STEP = 5;
  const MAX_RECORDS = 80;
  const CIRCUMFERENCE = 2 * Math.PI * 94;
  const isWidget = Boolean(window.chrome && window.chrome.webview);

  const el = {
    clockText: document.getElementById('clockText'),
    stateText: document.getElementById('stateText'),
    timerRing: document.getElementById('timerRing'),
    ringProgress: document.getElementById('ringProgress'),
    status: document.getElementById('status'),
    tuneLabel: document.getElementById('tuneLabel'),
    durationNumber: document.getElementById('durationNumber'),
    minus: document.getElementById('minus'),
    plus: document.getElementById('plus'),
    primary: document.getElementById('primary'),
    primaryLabel: document.getElementById('primaryLabel'),
    playIcon: document.getElementById('playIcon'),
    pauseIcon: document.getElementById('pauseIcon'),
    record: document.getElementById('record'),
    reset: document.getElementById('reset'),
    todayTotal: document.getElementById('todayTotal'),
    todayCount: document.getElementById('todayCount'),
    allTotal: document.getElementById('allTotal'),
    historyCount: document.getElementById('historyCount'),
    historyBody: document.getElementById('historyBody'),
    pill: document.getElementById('widgetPill'),
    pillClock: document.getElementById('pillClock'),
    pillDot: document.getElementById('pillDot'),
    pillProgress: document.getElementById('pillProgress'),
    collapseApp: document.getElementById('collapseApp'),
    closeApp: document.getElementById('closeApp'),
  };

  let state = {
    duration: DEFAULT_DURATION,
    remaining: DEFAULT_DURATION,
    running: false,
    endsAt: null,
    startedAt: null,
    records: [],
  };
  let tickHandle = null;
  let toastTimer = null;
  let toastText = '';
  let finishing = false;

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function pad(value) {
    return String(value).padStart(2, '0');
  }

  function normalizeDuration(value) {
    const seconds = Number(value);
    if (!Number.isFinite(seconds) || seconds <= 0) return DEFAULT_DURATION;
    const minutes = clamp(
      Math.round(seconds / 60),
      MIN_DURATION / 60,
      MAX_DURATION / 60,
    );
    return minutes * 60;
  }

  function cleanRecords(value) {
    if (!Array.isArray(value)) return [];
    const out = [];
    for (const raw of value) {
      if (!raw || typeof raw !== 'object') continue;
      const seconds = Number(raw.seconds);
      const endedAt = Number(raw.endedAt);
      if (!Number.isFinite(seconds) || seconds < 1) continue;
      if (!Number.isFinite(endedAt) || endedAt <= 0) continue;
      const startedAt = Number(raw.startedAt);
      out.push({
        id: typeof raw.id === 'string' && raw.id ? raw.id : 'mdp-app-' + endedAt + '-' + out.length,
        seconds: Math.round(seconds),
        startedAt: Number.isFinite(startedAt) && startedAt > 0 ? startedAt : endedAt - seconds * 1000,
        endedAt,
      });
      if (out.length >= MAX_RECORDS) break;
    }
    return out;
  }

  function loadState() {
    const fallback = {
      state: {
        duration: DEFAULT_DURATION,
        remaining: DEFAULT_DURATION,
        running: false,
        endsAt: null,
        startedAt: null,
        records: [],
      },
      autoRecorded: false,
    };

    let raw = null;
    try {
      const text = window.localStorage.getItem(STORAGE_KEY);
      if (text) raw = JSON.parse(text);
    } catch (error) {
      raw = null;
    }
    if (!raw || typeof raw !== 'object') return fallback;

    let records = cleanRecords(raw.records);
    const duration = normalizeDuration(raw.duration);
    let running = raw.running === true;
    let endsAt = Number(raw.endsAt);
    let startedAt = Number(raw.startedAt);
    if (!Number.isFinite(endsAt) || endsAt <= 0) {
      running = false;
      endsAt = null;
    }
    if (!Number.isFinite(startedAt) || startedAt <= 0) startedAt = null;

    if (running && endsAt) {
      const left = Math.ceil((endsAt - Date.now()) / 1000);
      if (left > 0) {
        return {
          state: {
            duration,
            remaining: clamp(left, 0, duration),
            running: true,
            endsAt,
            startedAt: startedAt || endsAt - duration * 1000,
            records,
          },
          autoRecorded: false,
        };
      }
      const finishedAt = endsAt;
      const beganAt = startedAt || finishedAt - duration * 1000;
      records = [newRecord(duration, beganAt, finishedAt), ...records].slice(0, MAX_RECORDS);
      return {
        state: {
          duration,
          remaining: duration,
          running: false,
          endsAt: null,
          startedAt: null,
          records,
        },
        autoRecorded: true,
      };
    }

    const storedRemaining = Number(raw.remaining);
    const remaining = Number.isFinite(storedRemaining) && storedRemaining > 0
      ? clamp(Math.round(storedRemaining), 1, duration)
      : duration;
    return {
      state: {
        duration,
        remaining,
        running: false,
        endsAt: null,
        startedAt: null,
        records,
      },
      autoRecorded: false,
    };
  }

  function persist() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
        duration: state.duration,
        remaining: state.remaining,
        running: state.running,
        endsAt: state.endsAt,
        startedAt: state.startedAt,
        records: state.records,
      }));
    } catch (error) {
      /* Keep the session in memory when storage is unavailable. */
    }
  }

  function newRecord(seconds, startedAt, endedAt) {
    return {
      id: 'mdp-app-' + endedAt + '-' + Math.random().toString(36).slice(2, 8),
      seconds: Math.max(1, Math.round(seconds)),
      startedAt,
      endedAt,
    };
  }

  const unitFormatters = new Map();
  function formatUnit(value, unit) {
    let formatter = unitFormatters.get(unit);
    if (!formatter) {
      try {
        formatter = new Intl.NumberFormat('zh-CN', {
          style: 'unit',
          unit,
          unitDisplay: 'short',
        });
      } catch (error) {
        formatter = null;
      }
      unitFormatters.set(unit, formatter);
    }
    if (formatter) return formatter.format(value);
    const fallback = { second: '秒', minute: '分钟', hour: '小时' };
    return String(value) + (fallback[unit] || '');
  }

  function formatDuration(seconds) {
    const total = Math.max(0, Math.round(seconds));
    if (total === 0) return formatUnit(0, 'minute');
    if (total < 60) return formatUnit(total, 'second');
    const minutes = Math.max(1, Math.round(total / 60));
    if (minutes < 60) return formatUnit(minutes, 'minute');
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest > 0
      ? formatUnit(hours, 'hour') + formatUnit(rest, 'minute')
      : formatUnit(hours, 'hour');
  }

  function formatClock(seconds) {
    const total = Math.max(0, Math.round(seconds));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    if (hours > 0) return hours + ':' + pad(minutes) + ':' + pad(secs);
    return pad(minutes) + ':' + pad(secs);
  }

  let timeFormatter = null;
  function formatRange(start, end) {
    if (!timeFormatter) {
      try {
        timeFormatter = new Intl.DateTimeFormat('zh-CN', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        });
      } catch (error) {
        timeFormatter = null;
      }
    }
    if (timeFormatter) {
      return timeFormatter.format(new Date(start)) + ' – ' + timeFormatter.format(new Date(end));
    }
    const a = new Date(start);
    const b = new Date(end);
    return pad(a.getHours()) + ':' + pad(a.getMinutes()) + ' – '
      + pad(b.getHours()) + ':' + pad(b.getMinutes());
  }

  function sameDay(left, right) {
    const a = new Date(left);
    const b = new Date(right);
    return a.getFullYear() === b.getFullYear()
      && a.getMonth() === b.getMonth()
      && a.getDate() === b.getDate();
  }

  function displayRemaining() {
    if (!state.running || !state.endsAt) return state.remaining;
    return clamp(Math.ceil((state.endsAt - Date.now()) / 1000), 0, state.duration);
  }

  function elapsedSeconds() {
    return Math.max(0, state.duration - displayRemaining());
  }

  function clearToast() {
    if (toastTimer) {
      window.clearTimeout(toastTimer);
      toastTimer = null;
    }
    toastText = '';
  }

  function showToast(text) {
    if (toastTimer) window.clearTimeout(toastTimer);
    toastText = text;
    renderStatus();
    toastTimer = window.setTimeout(function () {
      toastTimer = null;
      toastText = '';
      renderStatus();
    }, 2800);
  }

  function renderStatus() {
    el.status.classList.toggle('toast', Boolean(toastText));
    if (toastText) {
      el.status.textContent = toastText;
      return;
    }
    if (state.running) {
      el.status.textContent = '麦当在陪你一起专注。';
    } else if (elapsedSeconds() > 0) {
      el.status.textContent = '暂停也算数，记得回来。';
    } else {
      el.status.textContent = '准备好了，就出发吧。';
    }
  }

  function renderClock() {
    const shown = displayRemaining();
    const clock = formatClock(shown);
    el.clockText.textContent = clock;
    el.stateText.textContent = state.running
      ? '专注中'
      : shown < state.duration
        ? '已暂停'
        : '准备出发';
    el.timerRing.setAttribute('aria-label', '麦当番茄钟 ' + clock);
    el.ringProgress.style.strokeDashoffset = String(
      CIRCUMFERENCE * (1 - clamp(shown / state.duration, 0, 1)),
    );
    if (el.pillClock) el.pillClock.textContent = clock;
    if (el.pillProgress) {
      el.pillProgress.style.width = String(
        Math.round((1 - clamp(shown / state.duration, 0, 1)) * 100),
      ) + '%';
    }
    document.title = state.running ? clock + ' · 麦当番茄钟' : '麦当番茄钟';
  }

  function renderControls() {
    const locked = state.running || state.remaining < state.duration;
    const minutes = Math.round(state.duration / 60);
    el.durationNumber.textContent = String(minutes);
    el.tuneLabel.textContent = locked ? '先记录或重置' : '专注时长';
    el.minus.disabled = locked || minutes <= MIN_DURATION / 60;
    el.plus.disabled = locked || minutes >= MAX_DURATION / 60;
    if (el.pillDot) el.pillDot.classList.toggle('is-live', state.running);

    const elapsed = elapsedSeconds();
    el.primaryLabel.textContent = state.running
      ? '暂停一下'
      : elapsed > 0
        ? '继续专注'
        : '开始专注';
    el.playIcon.hidden = state.running;
    el.pauseIcon.hidden = !state.running;
    el.record.disabled = elapsed < 1;
    el.reset.disabled = elapsed < 1 && !state.running;
  }

  function renderStats() {
    const now = Date.now();
    const today = state.records.filter(function (record) {
      return sameDay(record.endedAt, now);
    });
    const todaySeconds = today.reduce(function (sum, record) {
      return sum + record.seconds;
    }, 0);
    const allSeconds = state.records.reduce(function (sum, record) {
      return sum + record.seconds;
    }, 0);
    el.todayTotal.textContent = formatDuration(todaySeconds);
    el.todayCount.textContent = String(today.length);
    el.allTotal.textContent = formatDuration(allSeconds);
    el.historyCount.textContent = String(today.length);
  }

  function make(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function renderHistory() {
    const now = Date.now();
    const today = state.records.filter(function (record) {
      return sameDay(record.endedAt, now);
    });
    el.historyBody.replaceChildren();

    if (today.length === 0) {
      const empty = make('div', 'empty');
      empty.appendChild(make('span', 'empty-star', '✦'));
      empty.appendChild(make('p', '', '今天还没有专注记录'));
      empty.appendChild(make('small', '', '开始一次专注，星图就会多一颗星。'));
      el.historyBody.appendChild(empty);
      return;
    }

    const list = make('ul', 'record-list');
    today.forEach(function (record) {
      const item = make('li', 'record');
      item.appendChild(make('span', 'record-dot'));

      const main = make('span', 'record-main');
      main.appendChild(make('span', 'record-time', formatRange(record.startedAt, record.endedAt)));
      main.appendChild(make('span', 'record-duration', formatDuration(record.seconds)));
      item.appendChild(main);

      const remove = make('button', 'record-delete', '×');
      remove.type = 'button';
      remove.title = '删除这条记录';
      remove.setAttribute('aria-label', '删除这条记录');
      remove.addEventListener('click', function () {
        removeRecord(record.id);
      });
      item.appendChild(remove);
      list.appendChild(item);
    });
    el.historyBody.appendChild(list);
  }

  function renderAll() {
    renderClock();
    renderControls();
    renderStats();
    renderHistory();
    renderStatus();
  }

  function startTicker() {
    stopTicker();
    tickHandle = window.setInterval(tick, 250);
    tick();
  }

  function stopTicker() {
    if (tickHandle) {
      window.clearInterval(tickHandle);
      tickHandle = null;
    }
  }

  function tick() {
    if (!state.running || !state.endsAt) return;
    const left = clamp(
      Math.ceil((state.endsAt - Date.now()) / 1000),
      0,
      state.duration,
    );
    if (left !== state.remaining) {
      state.remaining = left;
      renderClock();
      renderControls();
    }
    if (left <= 0) finish(true);
  }

  function start() {
    if (state.running) return;
    clearToast();
    finishing = false;
    if (state.remaining <= 0) state.startedAt = null;
    const left = state.remaining > 0 ? state.remaining : state.duration;
    state.endsAt = Date.now() + left * 1000;
    state.startedAt = state.startedAt || Date.now();
    state.running = true;
    state.remaining = left;
    persist();
    renderAll();
    startTicker();
  }

  function pause() {
    const left = displayRemaining();
    if (left <= 0) {
      finish(true);
      return;
    }
    state.remaining = left;
    state.running = false;
    state.endsAt = null;
    stopTicker();
    persist();
    renderAll();
  }

  function finish(auto) {
    if (finishing) return;
    const seconds = auto
      ? state.duration
      : Math.max(0, state.duration - displayRemaining());
    if (seconds < 1) {
      showToast('先专注一会儿，再来记录。');
      return;
    }
    finishing = true;
    const endedAt = Date.now();
    const startedAt = state.startedAt || endedAt - seconds * 1000;
    const record = newRecord(seconds, startedAt, endedAt);
    if (auto) postWidget('finished');
    state.records = [record, ...state.records].slice(0, MAX_RECORDS);
    state.running = false;
    state.remaining = state.duration;
    state.endsAt = null;
    state.startedAt = null;
    stopTicker();
    persist();
    showToast(auto
      ? '番茄完成！起身活动一下吧。'
      : '已记录，这次专注已经收进星图。');
    renderAll();
  }

  function reset() {
    finishing = false;
    state.running = false;
    state.remaining = state.duration;
    state.endsAt = null;
    state.startedAt = null;
    stopTicker();
    persist();
    showToast('计时已重置，本次没有记录。');
    renderAll();
  }

  function adjustDuration(deltaMinutes) {
    if (state.running || state.remaining < state.duration) return;
    const currentMinutes = Math.round(state.duration / 60);
    const nextMinutes = clamp(
      currentMinutes + deltaMinutes,
      MIN_DURATION / 60,
      MAX_DURATION / 60,
    );
    if (nextMinutes === currentMinutes) return;
    state.duration = nextMinutes * 60;
    state.remaining = state.duration;
    state.endsAt = null;
    state.startedAt = null;
    persist();
    renderAll();
  }

  function removeRecord(id) {
    state.records = state.records.filter(function (record) {
      return record.id !== id;
    });
    persist();
    showToast('这条记录已删除。');
    renderAll();
  }

  function postWidget(type, value) {
    if (!isWidget) return;
    const payload = typeof value === 'undefined' ? { type: type } : { type: type, value: value };
    try {
      window.chrome.webview.postMessage(payload);
    } catch (error) {
      /* The host owns the window; ignore a failed post. */
    }
  }

  function updateWidgetScale() {
    if (!isWidget) return;
    const view = document.documentElement.dataset.view || 'panel';
    const width = document.documentElement.clientWidth || window.innerWidth;
    const designWidth = view === 'pill' ? 260 : 390;
    if (width > 0) {
      document.documentElement.style.setProperty('--widget-scale', String(width / designWidth));
    }
  }

  function setWidgetView(view) {
    document.documentElement.dataset.view = view;
    window.requestAnimationFrame(updateWidgetScale);
  }

  function init() {
    const boot = loadState();
    state = boot.state;
    if (boot.autoRecorded) persist();

    el.primary.addEventListener('click', function () {
      if (state.running) pause();
      else start();
    });
    el.record.addEventListener('click', function () {
      finish(false);
    });
    el.reset.addEventListener('click', reset);
    el.minus.addEventListener('click', function () {
      adjustDuration(-DURATION_STEP);
    });
    el.plus.addEventListener('click', function () {
      adjustDuration(DURATION_STEP);
    });

    if (isWidget) {
      document.documentElement.dataset.widget = 'true';
      setWidgetView('pill');
      updateWidgetScale();
      window.addEventListener('resize', updateWidgetScale);
      if (el.pill) {
        el.pill.addEventListener('click', function () {
          postWidget('expand');
        });
      }
      if (el.collapseApp) {
        el.collapseApp.addEventListener('click', function () {
          postWidget('collapse');
        });
      }
      if (el.closeApp) {
        el.closeApp.addEventListener('click', function () {
          postWidget('close');
        });
      }
      window.chrome.webview.addEventListener('message', function (event) {
        const data = event.data;
        if (data && data.type === 'view' && (data.value === 'panel' || data.value === 'pill')) {
          setWidgetView(data.value);
        }
      });
    }

    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && state.running) tick();
    });
    document.addEventListener('keydown', function (event) {
      if (event.code === 'Space' && event.target === document.body) {
        event.preventDefault();
        if (state.running) pause();
        else start();
      }
    });

    renderAll();
    if (state.running) startTicker();
    postWidget('ready');
  }

  init();
})();
