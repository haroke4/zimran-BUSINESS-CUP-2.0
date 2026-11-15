const $ = selector => document.querySelector(selector);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const video = $('#landing-video');
const playDemo = $('#play-demo');
const modal = $('#watch');
let demoRequest = 0;
playDemo.addEventListener('click', async () => {
  const request = ++demoRequest;
  if (!modal.open) modal.showModal();
  $('#video-error').hidden = true;
  try {
    await video.play();
    if (request !== demoRequest) video.pause();
  } catch {
    // Native controls remain available when a browser requires another tap.
    if (video.error) $('#video-error').hidden = false;
  }
});
function closeDemo() {
  demoRequest++;
  video.pause();
  modal.close();
}
$('#close-demo').addEventListener('click', closeDemo);
modal.addEventListener('cancel', () => { demoRequest++; video.pause(); });
modal.addEventListener('close', () => {
  demoRequest++;
  video.pause();
  playDemo.focus({ preventScroll: true });
});
let pressedBackdrop = false;
function outsideModal(event) {
  const bounds = modal.getBoundingClientRect();
  return event.clientX < bounds.left || event.clientX > bounds.right
    || event.clientY < bounds.top || event.clientY > bounds.bottom;
}
modal.addEventListener('pointerdown', event => { pressedBackdrop = event.target === modal && outsideModal(event); });
modal.addEventListener('click', event => {
  if (pressedBackdrop && event.target === modal && outsideModal(event)) closeDemo();
  pressedBackdrop = false;
});
video.addEventListener('error', () => { $('#video-error').hidden = false; });
document.addEventListener('visibilitychange', () => { if (document.hidden) { demoRequest++; video.pause(); } });
window.addEventListener('pagehide', () => { demoRequest++; video.pause(); });
const suggestions = {
  mystery: 'A night train stops inside a tunnel. Someone knocks from an empty carriage.',
  romance: 'Two strangers keep missing the last train. Tonight, one of them knows why.',
  horror: 'A hotel receptionist gets a call from a room that was sealed twenty years ago.',
  scifi: 'A repair engineer on an empty space station receives a distress signal in their own voice.',
  surprise: 'A courier receives a letter they sent themselves tomorrow. It says not to deliver the next one.',
};
document.querySelectorAll('[data-genre]').forEach(button => button.addEventListener('click', () => {
  $('#story-idea').value = suggestions[button.dataset.genre];
  $('#create').scrollIntoView({ behavior: reducedMotion.matches ? 'auto' : 'smooth', block: 'center' });
  $('#story-idea').focus({ preventScroll: true });
  $('#idea-status').textContent = '';
}));
let creating = false;
$('#story-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (creating) return;
  const field = $('#story-idea');
  const premise = field.value.trim();
  if (!premise) {
    field.setCustomValidity('Write a premise or choose a starting point.');
    field.reportValidity();
    return;
  }
  creating = true;
  const button = event.currentTarget.querySelector('button[type="submit"]');
  button.disabled = true;
  $('#idea-status').textContent = 'Starting your story…';
  try {
    const response = await fetch('/api/stories', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ premise, mode: 'live' }),
    });
    if (!response.ok) throw new Error('Unable to start your story. Please try again.');
    const result = await response.json();
    window.location.assign(`/app?story=${encodeURIComponent(result.storyId)}&job=${encodeURIComponent(result.jobId)}`);
  } catch (error) {
    $('#idea-status').textContent = error.message;
    creating = false;
    button.disabled = false;
  }
});
$('#story-idea').addEventListener('input', event => {
  event.target.setCustomValidity('');
  if (!creating) $('#idea-status').textContent = '';
});
// Finished portraits only: character rig and animation library stay on the server.
function mountPortrait(host, id) {
  const portrait = document.createElement('img');
  portrait.src = `/static/portraits/${id}.svg`;
  portrait.alt = '';
  portrait.loading = 'lazy';
  host.append(portrait);
}
const posterTitles = [
  ['Afterglow', 'kit', 'surprise'], ['The last call', 'roxy', 'mystery'], ['Orbit 9', 'nova', 'scifi'],
  ['Nobody home', 'lis', 'horror'], ['Almost us', 'mika', 'romance'], ['The other side', 'nord', 'mystery'],
  ['Dead end', 'theo', 'horror'], ['Our fault', 'ray', 'romance'], ['Void signal', 'ada', 'scifi'],
  ['Last light', 'lumi', 'surprise'], ['The witness', 'sana', 'mystery'], ['Us, again', 'oscar', 'romance'],
  ['Night shift', 'felix', 'mystery'], ['Never tell', 'vera', 'horror'], ['Blue hour', 'amir', 'scifi'],
];
for (let i = 0; i < 5; i++) {
  const column = document.createElement('div');
  column.className = 'poster-col';
  for (const [title, character, genre] of posterTitles.slice(i * 3, i * 3 + 3)) {
    const poster = document.createElement('div');
    poster.className = `wall-poster ${genre}`;
    const art = document.createElement('div');
    art.className = 'poster-art';
    mountPortrait(art, character);
    const name = document.createElement('strong');
    name.textContent = title;
    const tag = document.createElement('span');
    tag.textContent = genre.toUpperCase();
    poster.append(art, tag, name);
    column.append(poster);
  }
  $('#poster-wall').append(column);
}
document.querySelectorAll('.story-card[data-character]').forEach(card => {
  mountPortrait(card.querySelector('.card-art'), card.dataset.character);
});
