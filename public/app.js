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

const bulkForm = document.querySelector('[data-bulk-form="transactions"]');
if (bulkForm) {
  const selectAll = document.querySelector('[data-select-all]');
  const checkboxes = Array.from(document.querySelectorAll('[data-row-select]'));
  const deleteBtn = bulkForm.querySelector('[data-bulk-delete]');

  const updateBulkState = () => {
    const anyChecked = checkboxes.some((cb) => cb.checked);
    if (deleteBtn) deleteBtn.disabled = !anyChecked;
    if (selectAll) {
      const allChecked = checkboxes.length > 0 && checkboxes.every((cb) => cb.checked);
      selectAll.checked = allChecked;
      selectAll.indeterminate = !allChecked && anyChecked;
    }
  };

  if (selectAll) {
    selectAll.addEventListener('change', () => {
      checkboxes.forEach((cb) => {
        cb.checked = selectAll.checked;
      });
      updateBulkState();
    });
  }

  checkboxes.forEach((cb) => {
    cb.addEventListener('change', updateBulkState);
  });

  updateBulkState();
}
