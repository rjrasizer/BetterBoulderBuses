// Better Boulder Buses – sidebar interactions
// 1) Sidebar open/close toggle ONLY
// 2) NO SCROLL PAGING – natural smooth scrolling restored

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
    }, 500);
  }

  toggleBtn.addEventListener('click', toggleSidebar);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sidebar.classList.contains('is-open')) {
      toggleSidebar();
    }
  });
})();
