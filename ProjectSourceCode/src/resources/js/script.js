var toggleBtn = document.querySelector('.sidebar-toggle');
var sidebar = document.querySelector('.sidebar');

toggleBtn.addEventListener('click', function() {
  toggleBtn.classList.toggle('is-closed');
  sidebar.classList.toggle('is-closed');
})