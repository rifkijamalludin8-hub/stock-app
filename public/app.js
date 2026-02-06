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

document.querySelectorAll('.select-search').forEach((input) => {
  const targetId = input.dataset.target;
  const select = document.getElementById(targetId);
  if (!select) return;
  const allOptions = Array.from(select.options).map((opt) => ({
    value: opt.value,
    text: opt.text,
    disabled: opt.disabled,
  }));

  function render(query) {
    const lower = query.toLowerCase();
    const current = select.value;
    select.innerHTML = '';
    allOptions.forEach((opt) => {
      if (opt.value === '' || opt.text.toLowerCase().includes(lower)) {
        const el = document.createElement('option');
        el.value = opt.value;
        el.textContent = opt.text;
        el.disabled = opt.disabled;
        select.appendChild(el);
      }
    });
    if (current) {
      select.value = current;
    }
  }

  input.addEventListener('input', () => {
    render(input.value || '');
  });
});
