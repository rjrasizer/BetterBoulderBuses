// var toggleBtn = document.querySelector('.sidebar-toggle');
// var sidebar = document.querySelector('.sidebar');

// toggleBtn.addEventListener('click', function() {
//   toggleBtn.classList.toggle('is-closed');
//   sidebar.classList.toggle('is-closed');
// })

//second implementation
// const toggleBtn = document.querySelector('.sidebar-toggle');
// const sidebar = document.querySelector('.sidebar');

// if (toggleBtn && sidebar) {
//   toggleBtn.addEventListener('click', () => {
//     toggleBtn.classList.toggle('is-closed');
//     sidebar.classList.toggle('is-closed');
//   });
// }
//third implementation
(function() {
  const toggleBtn = document.querySelector('.sidebar-toggle');
  const sidebar = document.querySelector('.sidebar');

  if (toggleBtn && sidebar) {
    toggleBtn.addEventListener('click', () => {
      sidebar.classList.toggle('is-open');
      sidebar.classList.toggle('is-closed');
    });
  }
})();
