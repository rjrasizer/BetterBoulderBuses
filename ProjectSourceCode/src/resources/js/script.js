// Better Boulder Buses – sidebar interactions
// 1) Sidebar open/close toggle
// 2) Paged scrolling for route cards (4 per "page")

// ---------------- SIDEBAR TOGGLE ----------------
(function () {
  const sidebar = document.querySelector('.sidebar');
  const toggleBtn = document.querySelector('.sidebar-toggle');

  if (!sidebar || !toggleBtn) return;

  let isAnimating = false;

  function toggleSidebar() {
    if (isAnimating) return;
    isAnimating = true;

    const willOpen = sidebar.classList.contains('is-closed');

    sidebar.classList.toggle('is-closed');
    sidebar.classList.toggle('is-open');

    toggleBtn.classList.toggle('is-closed');
    toggleBtn.classList.toggle('is-open');

    toggleBtn.setAttribute(
      'aria-label',
      willOpen ? 'Close routes panel' : 'Open routes panel'
    );

    setTimeout(() => {
      isAnimating = false;
    }, 500); // match your CSS transition
  }

  toggleBtn.addEventListener('click', toggleSidebar);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sidebar.classList.contains('is-open')) {
      toggleSidebar();
    }
  });
})();

// ---------------- PAGED SCROLLING ----------------

// Core paging logic: force scrollTop to jump exactly 1 page at a time
function initSidebarPaging() {
  const container = document.querySelector('.sidebar-scroll-container');
  if (!container) return;

  // Always keep these dynamic so search / re-render still works
  function getPages() {
    return Array.from(container.querySelectorAll('.route-page'));
  }

  function getPageHeight() {
    const first = container.querySelector('.route-page');
    return first ? first.offsetHeight : container.clientHeight;
  }

  function getCurrentIndex() {
    const h = getPageHeight();
    if (!h) return 0;
    return Math.round(container.scrollTop / h);
  }

  function goToPage(index) {
    const pages = getPages();
    if (!pages.length) return;

    const h = getPageHeight();
    const maxIndex = pages.length - 1;
    const clamped = Math.max(0, Math.min(maxIndex, index || 0));

    container.scrollTop = clamped * h;
  }

  let lastStepTime = 0;
  const STEP_DEBOUNCE_MS = 140; // short debounce – keeps it responsive
  const MIN_DELTA = 8;          // ignore micro wheel noise

  function onWheel(e) {
    const now = Date.now();

    // Kill native scroll / momentum completely
    e.preventDefault();

    // Hard debounce so 1 gesture == 1 page hop
    if (now - lastStepTime < STEP_DEBOUNCE_MS) {
      return;
    }

    const dy = e.deltaY || 0;
    if (Math.abs(dy) < MIN_DELTA) {
      return;
    }

    const pages = getPages();
    if (!pages.length) return;

    const current = getCurrentIndex();

    if (dy > 0 && current < pages.length - 1) {
      goToPage(current + 1);
    } else if (dy < 0 && current > 0) {
      goToPage(current - 1);
    }

    lastStepTime = now;
  }

  // If we previously bound a handler, remove it first
  if (container._bbPageWheelHandler) {
    container.removeEventListener('wheel', container._bbPageWheelHandler);
  }

  container.addEventListener('wheel', onWheel, { passive: false });
  container._bbPageWheelHandler = onWheel;

  // Start on page 0
  goToPage(0);
}

// Poll until the route pages exist (since they’re added async via fetch)
(function () {
  const POLL_EVERY_MS = 200;
  let pollId = null;

  function tryInit() {
    const container = document.querySelector('.sidebar-scroll-container');
    if (!container) return;
    if (container.querySelector('.route-page')) {
      clearInterval(pollId);
      initSidebarPaging();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      pollId = setInterval(tryInit, POLL_EVERY_MS);
    });
  } else {
    pollId = setInterval(tryInit, POLL_EVERY_MS);
  }
})();
