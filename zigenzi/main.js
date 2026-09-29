'use strict';

const header = document.querySelector('.site-header');
const progress = document.querySelector('.reading-progress');
const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
const hero = document.querySelector('.hero');
const activeAnimations = new Set();
const motionButton = document.querySelector('.motion-toggle');
let userPaused = false;
let waterTrail = null;
const motionEnabled = () => !motionPreference.matches && !userPaused && !document.documentElement.classList.contains('is-loading');

function playMotion(element, frames, options) {
  if (!motionEnabled() || !element || typeof element.animate !== 'function') return;
  const animation = element.animate(frames, options);
  activeAnimations.add(animation);
  animation.onfinish = () => activeAnimations.delete(animation);
  animation.oncancel = () => activeAnimations.delete(animation);
  return animation;
}

// Animate complete lines: Japanese punctuation and line breaks stay intact.
function revealHeading(heading, delay = 0) {
  if (!motionEnabled()) return;
  const lines = heading.children.length ? [...heading.children] : [heading];
  lines.forEach((line, index) => {
    playMotion(line, [
      { opacity: .35, filter: 'blur(3px)', transform: 'translateY(9px)' },
      { opacity: 1, filter: 'blur(0px)', transform: 'translateY(0)' }
    ], { duration: 1400, delay: delay + index * 180, easing: 'cubic-bezier(.2,.65,.2,1)' });
  });
}

let waterSequence = 0;
function revealWaterPhoto(frame) {
  if (!motionEnabled()) return;
  const img = frame.querySelector('img');
  if (!img || (img.complete && !img.naturalWidth)) return;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.classList.add('water-filter');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const filter = document.createElementNS(ns, 'filter');
  const id = 'water-rise-' + ++waterSequence;
  filter.id = id;
  filter.setAttribute('x', '-10%');
  filter.setAttribute('y', '-10%');
  filter.setAttribute('width', '120%');
  filter.setAttribute('height', '120%');
  filter.setAttribute('color-interpolation-filters', 'sRGB');
  const noise = document.createElementNS(ns, 'feTurbulence');
  noise.setAttribute('type', 'fractalNoise');
  noise.setAttribute('baseFrequency', '.012 .045');
  noise.setAttribute('numOctaves', '2');
  noise.setAttribute('seed', '4');
  noise.setAttribute('result', 'water');
  const displacement = document.createElementNS(ns, 'feDisplacementMap');
  displacement.setAttribute('in', 'SourceGraphic');
  displacement.setAttribute('in2', 'water');
  displacement.setAttribute('xChannelSelector', 'R');
  displacement.setAttribute('yChannelSelector', 'G');
  displacement.setAttribute('scale', '20');
  filter.append(noise, displacement);
  svg.append(filter);
  document.body.append(svg);
  const duration = frame.classList.contains('hero-photo') ? 3400 : 2800;
  const ripple = 'url(#' + id + ')';
  const animation = playMotion(img, [
    { opacity: .45, translate: '0 3%', scale: 1.09, filter: ripple + ' blur(6px) saturate(.7)', offset: 0 },
    { opacity: .85, translate: '0 1%', scale: 1.04, filter: ripple + ' blur(2px) saturate(.9)', offset: .45 },
    { opacity: 1, translate: '0 0', scale: 1, filter: ripple + ' blur(0px) saturate(1)', offset: 1 }
  ], { duration, easing: 'cubic-bezier(.22,.61,.36,1)' });
  if (!animation) { svg.remove(); return; }
  playMotion(frame.querySelector('.water-sheen'), [
    { opacity: 0, transform: 'translateY(35%) scale(1.15)', offset: 0 },
    { opacity: .55, transform: 'translateY(0) scale(1.06)', offset: .3 },
    { opacity: 0, transform: 'translateY(-65%) scale(1)', offset: 1 }
  ], { duration, easing: 'ease-out' });
  let rippleFrame;
  function updateRipple() {
    const time = Math.min(1, Math.max(0, Number(animation.currentTime) / duration));
    displacement.setAttribute('scale', String(20 * (1 - time) ** 2));
    if (animation.playState === 'running') rippleFrame = requestAnimationFrame(updateRipple);
  }
  const cleanup = () => { cancelAnimationFrame(rippleFrame); svg.remove(); };
  animation.finished.then(cleanup, cleanup);
  updateRipple();
}

// A finger drawn across still water: pointer movement feeds a small height
// field that is propagated each frame, then painted as the light bending on a
// water surface. TOP photo only, pointer devices only, never while paused.
function createWaterTrail() {
  const surface = document.querySelector('.hero-photo .photo-water');
  if (!surface || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return null;
  const canvas = document.createElement('canvas');
  canvas.className = 'water-trail';
  canvas.setAttribute('aria-hidden', 'true');
  const context = canvas.getContext('2d');
  if (!context) return null;
  surface.append(canvas);

  // One cell per ~7 CSS pixels: the browser smooths the rest as it scales up.
  const CELL = 7, DAMPING = .94, RADIUS = 3, IDLE = 2600;
  let columns = 0, rows = 0, previous, current, surfaceImage;
  let running = false, visible = true, lastInput = 0, frameId = 0, pointer = null;

  function resize() {
    const rect = surface.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    columns = Math.max(80, Math.min(240, Math.round(rect.width / CELL)));
    rows = Math.max(60, Math.round(columns * rect.height / rect.width));
    canvas.width = columns;
    canvas.height = rows;
    previous = new Float32Array(columns * rows);
    current = new Float32Array(columns * rows);
    surfaceImage = context.createImageData(columns, rows);
    // Mid grey is the neutral value of the overlay blend: a still surface
    // leaves the photo untouched, including the edges paint never reaches.
    surfaceImage.data.fill(128);
    for (let offset = 3; offset < surfaceImage.data.length; offset += 4) surfaceImage.data[offset] = 255;
    pointer = null;
  }

  function disturb(x, y, power) {
    for (let j = -RADIUS; j <= RADIUS; j++) {
      const row = Math.round(y + j);
      if (row < 1 || row >= rows - 1) continue;
      for (let i = -RADIUS; i <= RADIUS; i++) {
        const column = Math.round(x + i);
        if (column < 1 || column >= columns - 1) continue;
        const fade = 1 - Math.hypot(i, j) / RADIUS;
        if (fade > 0) previous[row * columns + column] += power * fade;
      }
    }
  }

  function step() {
    for (let y = 1; y < rows - 1; y++) {
      const row = y * columns;
      for (let x = 1; x < columns - 1; x++) {
        const index = row + x;
        current[index] = ((previous[index - 1] + previous[index + 1] + previous[index - columns] + previous[index + columns]) * .5 - current[index]) * DAMPING;
      }
    }
    const swap = previous;
    previous = current;
    current = swap;
  }

  function paint() {
    const data = surfaceImage.data;
    for (let y = 1; y < rows - 1; y++) {
      const row = y * columns;
      for (let x = 1; x < columns - 1; x++) {
        const index = row + x;
        // The slope of the surface is what lightens or darkens the water.
        const shade = (previous[index - 1] - previous[index + 1] + previous[index - columns] - previous[index + columns]) * 4;
        const offset = index * 4;
        data[offset] = 128 + shade * .88;
        data[offset + 1] = 128 + shade;
        data[offset + 2] = 128 + shade * 1.12;
      }
    }
    context.putImageData(surfaceImage, 0, 0);
  }

  function stop() {
    running = false;
    cancelAnimationFrame(frameId);
    context.clearRect(0, 0, canvas.width, canvas.height);
  }

  function reset() {
    stop();
    if (previous) { previous.fill(0); current.fill(0); }
    pointer = null;
  }

  function tick(time) {
    if (!running) return;
    step();
    paint();
    // By the idle mark the damping has flattened the surface: nothing snaps.
    if (!motionEnabled() || !visible || time - lastInput > IDLE) { stop(); return; }
    frameId = requestAnimationFrame(tick);
  }

  function start() {
    if (running || !motionEnabled() || !visible) return;
    running = true;
    frameId = requestAnimationFrame(tick);
  }

  function track(event) {
    if (event.pointerType === 'touch' || !columns || !motionEnabled()) return;
    const rect = surface.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const x = (event.clientX - rect.left) / rect.width * columns;
    const y = (event.clientY - rect.top) / rect.height * rows;
    if (x < 0 || y < 0 || x > columns || y > rows) { pointer = null; return; }
    lastInput = performance.now();
    if (pointer) {
      // Stamp along the segment so a fast sweep still draws one wake.
      const dx = x - pointer.x, dy = y - pointer.y;
      const steps = Math.min(14, Math.ceil(Math.hypot(dx, dy) / 2));
      for (let s = 1; s <= steps; s++) disturb(pointer.x + dx * s / steps, pointer.y + dy * s / steps, 15);
    }
    pointer = { x, y };
    start();
  }

  hero.addEventListener('pointermove', track, { passive: true });
  hero.addEventListener('pointerdown', event => {
    if (event.pointerType === 'touch' || !columns || !motionEnabled()) return;
    track(event);
    if (pointer) disturb(pointer.x, pointer.y, 48);
  }, { passive: true });
  hero.addEventListener('pointerleave', () => { pointer = null; });
  document.addEventListener('visibilitychange', () => {
    visible = !document.hidden;
    if (!visible) reset();
  });
  if ('ResizeObserver' in window) new ResizeObserver(() => { resize(); reset(); }).observe(surface);
  else window.addEventListener('resize', () => { resize(); reset(); }, { passive: true });
  resize();
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(entries => entries.forEach(entry => { if (!entry.isIntersecting) reset(); })).observe(surface);
  }
  return { reset };
}

const mobileMenu = document.querySelector('#mobile-menu');
const menuToggle = document.querySelector('.menu-toggle');
const mobileViewport = window.matchMedia('(max-width: 850px)');
function closeMobileMenu(restoreFocus = true) {
  if (mobileMenu.open) mobileMenu.close();
  document.body.classList.remove('menu-open');
  menuToggle.setAttribute('aria-expanded', 'false');
  if (restoreFocus && mobileViewport.matches) menuToggle.focus({ preventScroll: true });
}
if (typeof mobileMenu.showModal === 'function') {
  document.documentElement.classList.add('mobile-menu-enabled');
  menuToggle.addEventListener('click', () => {
    menuToggle.focus({ preventScroll: true });
    mobileMenu.showModal();
    document.body.classList.add('menu-open');
    menuToggle.setAttribute('aria-expanded', 'true');
  });
  mobileMenu.querySelector('.menu-close').addEventListener('click', () => closeMobileMenu());
  mobileMenu.addEventListener('cancel', event => {
    event.preventDefault();
    closeMobileMenu();
  });
  mobileMenu.addEventListener('close', () => {
    if (!mobileMenu.open) closeMobileMenu(false);
  });
  mobileMenu.querySelectorAll('a').forEach(link => link.addEventListener('click', () => {
    closeMobileMenu(false);
    if (link.hash) {
      const target = document.querySelector(link.hash);
      if (target) {
        target.setAttribute('tabindex', '-1');
        target.focus({ preventScroll: true });
        target.addEventListener('blur', () => target.removeAttribute('tabindex'), { once: true });
      }
    }
  }));
  mobileViewport.addEventListener('change', event => {
    if (!event.matches && mobileMenu.open) closeMobileMenu(false);
  });
}

function startHeroIntro() {
  if (!motionEnabled()) return;
  const intro = [...document.querySelectorAll('.hero-intro > .eyebrow, .hero-bottom')];
  intro.forEach((element, index) => {
    playMotion(element, [
      { opacity: .4, transform: 'translateY(16px)' },
      { opacity: 1, transform: 'translateY(0)' }
    ], { duration: 1800, delay: index * 600, easing: 'cubic-bezier(.16,1,.3,1)' });
  });
  revealHeading(document.querySelector('.hero h1'), 150);
  const heroImage = document.querySelector('.hero-photo img');
  if (heroImage.complete) revealWaterPhoto(heroImage.closest('figure'));
  else heroImage.addEventListener('load', () => revealWaterPhoto(heroImage.closest('figure')), { once: true });
}

function syncMotion() {
  const enabled = motionEnabled();
  document.documentElement.classList.toggle('motion-enabled', enabled);
  motionButton.setAttribute('aria-pressed', String(!enabled));
  motionButton.textContent = motionPreference.matches ? '演出オフ（端末設定）' : enabled ? '演出を止める' : '演出を再開';
  motionButton.disabled = motionPreference.matches;
  if (!enabled) {
    activeAnimations.forEach(animation => animation.cancel());
    activeAnimations.clear();
    waterTrail?.reset();
  }
  updateScroll();
}
motionButton.hidden = false;
motionButton.addEventListener('click', () => {
  userPaused = !userPaused;
  syncMotion();
});
motionPreference.addEventListener('change', syncMotion);

// Keep every anchor below the fixed navigation, including when mobile links wrap.
function measureHeader() {
  document.documentElement.style.setProperty('--header-height', header.offsetHeight + 'px');
}
measureHeader();
if ('ResizeObserver' in window) new ResizeObserver(measureHeader).observe(header);
else window.addEventListener('resize', measureHeader, { passive: true });

let framePending = false;
const scenePhotos = [...document.querySelectorAll('.daikoku-photo, .history-current, .history-archive')];
function updateScroll() {
  const max = document.documentElement.scrollHeight - window.innerHeight;
  const position = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
  progress.style.transform = 'scaleX(' + position + ')';
  // Keep the navigation transparent until it reaches the next section.
  header.classList.toggle('scrolled', window.scrollY >= hero.offsetHeight - header.offsetHeight);
  if (motionEnabled()) {
    if (window.scrollY <= hero.offsetHeight) hero.style.setProperty('--hero-shift', Math.min(16, window.scrollY * .025) + 'px');
    scenePhotos.forEach(frame => {
      const rect = frame.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > innerHeight) return;
      const travel = (innerHeight / 2 - (rect.top + rect.height / 2)) / innerHeight;
      const limit = Math.min(12, rect.height * .025);
      frame.style.setProperty('--scene-shift', Math.max(-limit, Math.min(limit, travel * 24)) + 'px');
    });
  }
  framePending = false;
}
window.addEventListener('scroll', () => {
  if (!framePending) {
    framePending = true;
    requestAnimationFrame(updateScroll);
  }
}, { passive: true });
window.addEventListener('resize', updateScroll, { passive: true });
window.addEventListener('load', updateScroll);
syncMotion();

// Keep the resting state visible. Animate only after entering the viewport;
// clipping a heading to zero can prevent IntersectionObserver from seeing it.
function startPageReveals() {
  if (!('IntersectionObserver' in window)) return;
  const revealObserver = new IntersectionObserver(entries => {
    let staggerIndex = 0;
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        revealObserver.unobserve(entry.target);
        if (entry.target.matches('h2')) {
          revealHeading(entry.target);
        } else if (entry.target.matches('[data-reveal="photo"]')) {
          const img = entry.target.querySelector('img');
          if (img.complete) revealWaterPhoto(entry.target);
          else img.addEventListener('load', () => revealWaterPhoto(entry.target), { once: true });
        } else {
          const delay = Math.min(staggerIndex++, 3) * 130;
          playMotion(entry.target, [
            { opacity: .5, transform: 'translateY(14px)' },
            { opacity: 1, transform: 'translateY(0)' }
          ], { duration: 1300, delay, easing: 'cubic-bezier(.16,1,.3,1)' });
        }
      }
    });
  }, { threshold: 0.08 });
  document.querySelectorAll('[data-reveal]').forEach(element => {
    revealObserver.observe(element);
  });
  const sceneObserver = new IntersectionObserver(entries => entries.forEach(entry => {
    entry.target.classList.toggle('scene-active', entry.isIntersecting);
  }));
  document.querySelectorAll('.scene-mist').forEach(mist => sceneObserver.observe(mist.parentElement));
}

document.querySelectorAll('.photo-frame img').forEach(img => {
  const frame = img.closest('.photo-frame');
  const showFallback = () => {
    frame.dataset.photoLabel = img.alt;
    frame.classList.add('photo-missing');
  };
  img.addEventListener('error', showFallback);
  img.addEventListener('load', () => frame.classList.remove('photo-missing'));
  if (img.complete && img.naturalWidth === 0) showFallback();
});

if ('IntersectionObserver' in window) {
  const links = [...document.querySelectorAll('.site-header nav a')];
  const navigationObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      links.forEach(link => {
        if (link.hash === '#' + entry.target.id) link.setAttribute('aria-current', 'location');
        else link.removeAttribute('aria-current');
      });
    });
  }, { rootMargin: '-22% 0px -55% 0px' });
  document.querySelectorAll('main section[id]').forEach(section => navigationObserver.observe(section));
}

// The loading screen coordinates readiness, not animation performance. Start
// entrance effects only after the overlay is gone, including restored anchors.
let pageStarted = false;
function startPage() {
  if (pageStarted) return;
  pageStarted = true;
  syncMotion();
  startHeroIntro();
  startPageReveals();
  waterTrail = createWaterTrail();
}

async function preparePage() {
  const boot = window.jigenjiBoot;
  if (!boot || boot.done) { startPage(); return; }
  const loader = document.querySelector('.page-loader');
  document.querySelectorAll('.skip-link, .site-header, main, footer').forEach(element => {
    if (!element.inert) {
      element.setAttribute('data-loading-inert', '');
      element.inert = true;
    }
  });
  document.addEventListener('jigenji:loaded', startPage, { once: true });
  const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
  const img = document.querySelector('.hero-photo img');
  const imageReady = new Promise(resolve => {
    if (img.complete) resolve();
    else {
      const settled = () => {
        img.removeEventListener('load', settled);
        img.removeEventListener('error', settled);
        resolve();
      };
      img.addEventListener('load', settled);
      img.addEventListener('error', settled);
    }
  }).then(() => img.naturalWidth && typeof img.decode === 'function' ? img.decode().catch(() => {}) : undefined);
  const elapsed = performance.now() - boot.startedAt;
  await Promise.race([
    Promise.all([
      imageReady,
      document.fonts ? document.fonts.ready : Promise.resolve(),
      delay(Math.max(0, (motionPreference.matches ? 0 : 1500) - elapsed))
    ]),
    delay(Math.max(0, 4500 - elapsed))
  ]);
  if (boot.done) return;
  let exit;
  if (!motionPreference.matches && typeof loader.animate === 'function') {
    exit = loader.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 600, easing: 'ease-in-out', fill: 'forwards' });
    // Do not depend solely on a compositor event (background tabs, interrupted frames).
    await Promise.race([exit.finished.catch(() => {}), delay(700)]);
  }
  boot.release();
  if (exit) exit.cancel();
}
preparePage().catch(() => {
  if (window.jigenjiBoot) window.jigenjiBoot.release();
  else startPage();
});
