const menuToggle = document.querySelector('.menu-toggle');
const menu = document.querySelector('#plan-menu');

function toggleMenu(open) {
  menuToggle.setAttribute('aria-expanded', String(open));
  menu.classList.toggle('is-open', open);
}

menuToggle?.addEventListener('click', () => toggleMenu(menuToggle.getAttribute('aria-expanded') !== 'true'));
menu?.addEventListener('keydown', event => {
  if (event.key === 'Escape' && menu.classList.contains('is-open')) {
    toggleMenu(false);
    menuToggle.focus();
  }
});

document.querySelector('[data-back]')?.addEventListener('click', event => {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const previousEntry = window.navigation?.entries()[window.navigation.currentEntry.index - 1];
  const previousUrl = previousEntry?.url ?? (!window.navigation && document.referrer);
  if (previousUrl && new URL(previousUrl).origin === location.origin && history.length > 1) {
    event.preventDefault();
    history.back();
  }
});

const reference = document.querySelector('#missing-reference');
if (reference) reference.textContent = new URLSearchParams(location.search).get('ref') ?? '';

const current = menu?.querySelector('[aria-current="page"]');
if (current) {
  const bounds = menu.getBoundingClientRect();
  const position = current.getBoundingClientRect();
  if (position.bottom > bounds.bottom && bounds.height > 0) {
    menu.scrollTop += position.bottom - bounds.bottom + 24;
  }
}
