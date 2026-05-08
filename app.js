const navItems = document.querySelectorAll('.nav-item');
const screens = document.querySelectorAll('.screen');
const installBanner = document.getElementById('installBanner');
const installBtn = document.getElementById('installBtn');
const offlineChip = document.getElementById('offlineChip');
let deferredPrompt = null;

function openScreen(target) {
  navItems.forEach(i => i.classList.toggle('active', i.dataset.screen === target));
  screens.forEach(screen => screen.classList.toggle('active', screen.id === target));
  window.scrollTo({ top: 0, behavior: 'smooth' });
  localStorage.setItem('lastScreen', target);
}

navItems.forEach(item => item.addEventListener('click', () => openScreen(item.dataset.screen)));
document.querySelectorAll('[data-open]').forEach(item => item.addEventListener('click', () => openScreen(item.dataset.open)));

const lastScreen = localStorage.getItem('lastScreen');
if (lastScreen && document.getElementById(lastScreen)) openScreen(lastScreen);

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredPrompt = event;
  installBanner.classList.add('show');
});

installBtn.addEventListener('click', async () => {
  if (!deferredPrompt) {
    alert('No Chrome Android: toque nos 3 pontos e escolha “Adicionar à tela inicial” ou “Instalar app”.');
    return;
  }

  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  installBanner.classList.remove('show');
});

window.addEventListener('appinstalled', () => {
  installBanner.classList.remove('show');
  deferredPrompt = null;
});

function updateOnlineStatus() {
  offlineChip.classList.toggle('show', !navigator.onLine);
}

window.addEventListener('online', updateOnlineStatus);
window.addEventListener('offline', updateOnlineStatus);
updateOnlineStatus();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js').catch(console.error);
  });
}
