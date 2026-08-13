export function setStatus(message, tone = 'neutral') {
  const status = document.getElementById('mlf-status');
  if (!status) return;
  status.dataset.tone = tone;
  status.textContent = message || 'Load listings, then filter';
}

export function renderOdometer(value) {
  const odometer = document.getElementById('mlf-odo');
  if (!odometer) return;
  const digits = String(Math.max(0, Math.min(value, 9999))).padStart(4, '0').split('');
  if (odometer.childElementCount !== digits.length) {
    odometer.innerHTML = digits.map(() => '<span class="mlf-digit"><i>0</i></span>').join('');
  }
  Array.from(odometer.children).forEach((cell, index) => {
    const inner = cell.firstElementChild;
    if (!inner || inner.textContent === digits[index]) return;
    inner.textContent = digits[index];
    cell.classList.remove('roll');
    void cell.offsetWidth;
    cell.classList.add('roll');
  });
}

export function updatePanelMeta(cardCount) {
  renderOdometer(cardCount);
}

