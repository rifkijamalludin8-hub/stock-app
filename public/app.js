const flash = document.querySelector('.flash');
if (flash) {
  setTimeout(() => {
    flash.style.opacity = '0';
    flash.style.transform = 'translateY(-6px)';
  }, 4000);
}

const menuToggle = document.querySelector('.menu-toggle');
const overlay = document.querySelector('.overlay');
const navLinks = document.querySelectorAll('.nav-link');

function closeSidebar() {
  document.body.classList.remove('sidebar-open');
}

if (menuToggle) {
  menuToggle.addEventListener('click', () => {
    document.body.classList.toggle('sidebar-open');
  });
}

if (overlay) {
  overlay.addEventListener('click', closeSidebar);
}

navLinks.forEach((link) => {
  link.addEventListener('click', closeSidebar);
});
