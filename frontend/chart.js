/**
 * chart.js — rendu canvas multi-canaux style traceur EEG.
 *
 * Responsabilités :
 *   - Dimensionner le canvas en pixels physiques (HiDPI).
 *   - Dessiner la grille temporelle et les séparateurs de pistes.
 *   - Tracer chaque canal dans son propre couloir horizontal.
 *   - Afficher les marqueurs (lignes verticales rouges) à la bonne position.
 *   - Construire le rail de labels + pastilles d'impédance à gauche.
 */

import { state, els } from "./state.js";

const ctx = els.canvas.getContext("2d");

// --- Buffers ---

/**
 * (Ré)initialise les buffers circulaires si le nombre de canaux ou la taille change.
 * Appelé à chaque réception du message "info" du backend.
 */
export function ensureBuffers(channelCount, fs) {
  const newSize = Math.max(1, Math.floor(fs * state.windowSeconds));
  if (state.buffers.length === channelCount && state.bufferSize === newSize) return;
  state.bufferSize = newSize;
  state.buffers = Array.from({ length: channelCount }, () => new Float32Array(newSize));
  state.writeIdx = 0;
  state.markers = [];
}

// --- Rail des canaux (HTML) ---

/**
 * Génère les lignes du rail gauche : label + pastille impédance + valeur kΩ.
 * Une ligne par canal, dans l'ordre du stream.
 */
export function renderChannelRail() {
  els.channelRail.innerHTML = "";
  state.channels.forEach((name, idx) => {
    const row = document.createElement("div");
    row.className = "channel-row";
    row.dataset.channelIdx = String(idx);
    row.innerHTML = `
      <span class="ch-label">${name}</span>
      <span class="ch-imp-box none" id="impBox-${idx}"></span>
      <span class="ch-imp-val" id="impVal-${idx}">&mdash;</span>
    `;
    els.channelRail.appendChild(row);
  });
}

// --- Canvas ---

/**
 * Recalcule la taille physique du canvas en tenant compte du devicePixelRatio.
 * À appeler au resize de la fenêtre et à l'initialisation.
 *
 * Le canvas HTML a deux tailles :
 *   - CSS (pixels CSS = référence de mise en page)
 *   - physique (= CSS × dpr = vrais pixels de l'écran → rendu net sur écrans Retina/HiDPI)
 */
export function resizeCanvas() {
  const rect = els.canvas.parentElement.getBoundingClientRect();
  const dpr  = window.devicePixelRatio || 1;
  state.dpr    = dpr;
  state.width  = Math.max(100, Math.floor(rect.width));
  state.height = Math.max(100, Math.floor(rect.height));
  els.canvas.width  = Math.floor(state.width  * dpr);
  els.canvas.height = Math.floor(state.height * dpr);
  // setTransform remet l'échelle CSS pour que draw() travaille en px CSS.
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  draw();
}

/**
 * Dessin complet d'une frame.
 * Appelé par requestAnimationFrame (boucle dans app.js).
 */
export function draw() {
  const w = state.width;
  const h = state.height;
  ctx.clearRect(0, 0, w, h);

  const chCount = state.channels.length;
  if (chCount === 0 || state.bufferSize === 0) {
    ctx.fillStyle = "#666";
    ctx.font = '12px "Segoe UI","Liberation Sans",system-ui,sans-serif';
    ctx.fillText("Attente du flux EEG…", 12, 18);
    return;
  }

  const lanePx = h / chCount;
  _drawGrid(w, h, chCount, lanePx);
  _drawMarkers(w, h);
  _drawTraces(w, chCount, lanePx);
  _drawLegend(w, h);
}

// --- Privé ---

function _drawGrid(w, h, chCount, lanePx) {
  // Lignes horizontales de séparation des pistes
  ctx.strokeStyle = "#dcdcdc";
  ctx.lineWidth = 1;
  for (let c = 0; c <= chCount; c++) {
    const y = Math.round(c * lanePx) + 0.5;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }

  // Lignes verticales temporelles (1 s = 1 div, grille principale toutes les 5 s)
  const secs = state.windowSeconds;
  for (let s = 0; s <= secs; s++) {
    const x = Math.round((s / secs) * w) + 0.5;
    ctx.strokeStyle = s % 5 === 0 ? "#c8c8c8" : "#e8e8e8";
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
  }

  // Ligne médiane par piste (ligne de zéro µV)
  ctx.strokeStyle = "#cdcdcd";
  for (let c = 0; c < chCount; c++) {
    const yMid = Math.round(c * lanePx + lanePx / 2) + 0.5;
    ctx.beginPath(); ctx.moveTo(0, yMid); ctx.lineTo(w, yMid); ctx.stroke();
  }
}

function _drawMarkers(w, h) {
  // Un marqueur est placé à un instant T (= totalSamplesAtPlacement).
  // Il apparaît au bord droit (newest) et glisse vers la gauche au fur et à mesure
  // que de nouveaux samples arrivent. Il disparaît quand il sort du buffer (k >= N).
  const N = state.bufferSize;
  ctx.strokeStyle = state.impedanceActive ? "rgba(168,50,50,0.25)" : "#a83232";
  ctx.lineWidth = 1;
  for (const m of state.markers) {
    const k = state.totalSamples - m.totalSamplesAtPlacement; // samples depuis placement
    if (k < 0 || k >= N) continue;
    const x = Math.round(((N - 1 - k) / N) * w) + 0.5;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    ctx.fillStyle = "#a83232";
    ctx.font = '10px "Segoe UI",system-ui,sans-serif';
    ctx.fillText(m.label, x + 2, 10);
  }
}

function _drawTraces(w, chCount, lanePx) {
  const N     = state.bufferSize;
  const scale = state.scaleMicroV;
  // Quand le mode impédance est actif, on atténue les traces pour laisser la place aux valeurs kΩ.
  const opacity = state.impedanceActive ? 0.2 : 1.0;
  ctx.lineWidth = 1;

  for (let c = 0; c < chCount; c++) {
    const buf  = state.buffers[c];
    const yMid = c * lanePx + lanePx / 2;
    const halfH = lanePx / 2 - 2; // pixels disponibles de la médiane au bord de piste

    ctx.strokeStyle = `rgba(20,40,90,${opacity})`;
    ctx.beginPath();
    for (let i = 0; i < N; i++) {
      // Le buffer est un ring : l'échantillon le plus ancien est à writeIdx,
      // le plus récent est à (writeIdx - 1 + N) % N.
      const bufIdx = (state.writeIdx + i) % N;
      const v = buf[bufIdx];
      // Clamp à ±1 pour rester dans la piste (saturation visible, pas de débordement).
      const y = yMid - Math.max(-1, Math.min(1, v / scale)) * halfH;
      const x = (i / N) * w;
      if (i === 0) ctx.moveTo(x, y);
      else         ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

function _drawLegend(w, h) {
  ctx.fillStyle = "#666";
  ctx.font = '11px "Segoe UI",system-ui,sans-serif';
  ctx.fillText(`±${state.scaleMicroV} µV · ${state.windowSeconds}s`, w - 110, h - 6);
}
