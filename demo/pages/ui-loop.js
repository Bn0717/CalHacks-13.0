// Deterministic fixture; these settings affect only this page, never the computer.
(() => {
  const state = { page: 'home', battery: false, size: 'Small', wallpaper: '', camera: false, prompt: false };
  const content = document.getElementById('content');
  function render() {
    document.body.dataset.page = state.page;
    document.body.dataset.battery = String(state.battery);
    document.body.dataset.size = state.size;
    document.body.dataset.wallpaper = state.wallpaper;
    document.body.dataset.camera = String(state.camera);
    if (state.page === 'menu') content.innerHTML = `<h2>Menu Bar</h2><button data-action="battery" role="switch" aria-checked="${state.battery}">Show battery percentage</button><p data-status>Battery percentage: ${state.battery ? 'On' : 'Off'}</p>`;
    if (state.page === 'display') content.innerHTML = `<h2>Display</h2><p>Text size</p><button data-action="small" aria-pressed="${state.size === 'Small'}">Small</button> <button data-action="large" aria-pressed="${state.size === 'Large'}">Large</button><p data-status>Text size: ${state.size}</p>`;
    if (state.page === 'wallpaper') content.innerHTML = '<h2>Wallpaper</h2><div role="group" aria-label="Wallpaper choices"><button data-action="ocean">Ocean wallpaper</button> <button data-action="mountain">Mountain wallpaper</button></div><p data-status>Choose a wallpaper you like.</p>';
    if (state.page === 'privacy') content.innerHTML = state.prompt
      ? '<div role="dialog" aria-label="Camera permission"><h2>Allow Fixture to use the camera?</h2><p>This grants camera access to Fixture.</p><button data-action="allow">Allow</button> <button data-action="deny">Don’t Allow</button></div>'
      : '<h2>Privacy</h2><button data-action="prompt">Open camera permission prompt</button><p data-status>Camera access: Not granted</p>';
  }
  document.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.page) state.page = button.dataset.page;
    const action = button.dataset.action;
    if (action === 'battery') state.battery = !state.battery;
    if (action === 'small') state.size = 'Small';
    if (action === 'large') state.size = 'Large';
    if (action === 'ocean' || action === 'mountain') state.wallpaper = action;
    if (action === 'prompt') state.prompt = true;
    if (action === 'allow') state.camera = true;
    if (action === 'deny') state.prompt = false;
    render();
  });
  render();
})();
