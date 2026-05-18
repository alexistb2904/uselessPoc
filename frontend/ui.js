/**
 * ui.js — mise à jour du DOM en réponse aux messages WebSocket et aux actions utilisateur.
 *
 * Reçoit les données brutes du backend et met à jour :
 *   - les buffers de signal (handleChunk)
 *   - les pastilles d'impédance (handleImpedance)
 *   - la liste des marqueurs et leur position dans le buffer (handleMarker)
 *   - les panneaux session/flux dans la sidebar (setStreamInfo, handleSession, applySessionUI)
 *   - le dot de connexion dans la status bar (setConnection)
 */

import { state, els } from "./state.js";
import { ensureBuffers, renderChannelRail, draw } from "./chart.js";

// ---- Connexion ----

export function setConnection(connected, label) {
  els.connDot.classList.toggle("connected", connected);
  els.connLabel.textContent = label;
}

// ---- Info stream ----

/**
 * Appelé une fois à la connexion (message WS "info").
 * Initialise les buffers, le rail de canaux et la sidebar.
 */
export function setStreamInfo(info) {
  state.info     = info;
  state.channels = info.channels || [];
  ensureBuffers(state.channels.length, info.fs || 250);

  els.titleMeta.textContent   = `${info.source} · ${info.fs} Hz · ${info.reference}`;
  els.infoSource.textContent  = info.source;
  els.infoFs.textContent      = `${info.fs} Hz`;
  els.infoChannels.textContent = state.channels.join(", ");
  els.infoRef.textContent     = info.reference;
  els.infoUnit.textContent    = info.units || "µV";
  els.stStream.textContent    = `Stream: ${info.source} ${info.fs}Hz ×${state.channels.length}`;

  renderChannelRail();
  draw();
}

// ---- Données EEG ----

/**
 * Ingère un chunk de samples dans les buffers circulaires.
 *
 * msg = { type: "eeg_chunk", fs, t0, values: [[c1..c8], [c1..c8], ...] }
 *
 * Chaque chunk contient typiquement 25 samples à 250 Hz = 100 ms de signal.
 * On les écrit séquentiellement dans le ring buffer de chaque canal.
 */
export function handleChunk(msg) {
  if (!state.info || !msg.values?.length) return;
  const chCount = state.channels.length;

  for (const sample of msg.values) {
    for (let c = 0; c < chCount; c++) {
      const v = sample[c];
      state.buffers[c][state.writeIdx] = Number.isFinite(v) ? v : 0;
    }
    state.writeIdx = (state.writeIdx + 1) % state.bufferSize;
    state.totalSamples += 1;
  }

  state.chunkCounter += 1;
  if (state.session.running) {
    state.session.samples += msg.values.length;
    els.sessSamples.textContent = String(state.session.samples);
  }
}

// ---- Impédance ----

/**
 * Met à jour les pastilles d'impédance dans le rail gauche.
 *
 * msg = { type: "impedance", t, values_kohm: [kΩ|null, ...] }
 *
 * Seuils X.on recommandés :
 *   < 10 kΩ  → vert  (bon contact)
 *   10–25 kΩ → jaune (acceptable)
 *   > 25 kΩ  → rouge (mauvais contact)
 *   null     → gris  (pas de mesure, ex. BIP1)
 */
export function handleImpedance(msg) {
  state.impedance = msg.values_kohm || [];
  state.impedance.forEach((kohm, idx) => {
    const box = document.getElementById(`impBox-${idx}`);
    const val = document.getElementById(`impVal-${idx}`);
    if (!box || !val) return;
    box.classList.remove("green", "yellow", "red", "none");
    if (kohm === null || kohm === undefined) {
      box.classList.add("none");
      val.textContent = "—";
    } else {
      box.classList.add(kohm < 10 ? "green" : kohm < 25 ? "yellow" : "red");
      val.textContent = `${kohm.toFixed(1)} kΩ`;
    }
  });
}

// ---- Marqueurs ----

/**
 * Reçoit un marqueur posé par l'utilisateur et :
 *   - l'ajoute à state.markers pour affichage sur le canvas (cf. chart.js _drawMarkers)
 *   - l'insère en tête de la table dans la sidebar
 *
 * msg = { type: "marker", t: ISO, label: string }
 */
export function handleMarker(msg) {
  state.markers.push({
    timestamp: msg.t,
    label: msg.label,
    // totalSamples au moment de la réception = position dans le buffer côté rendu.
    // Voir chart.js _drawMarkers pour l'utilisation.
    totalSamplesAtPlacement: state.totalSamples,
  });

  state.session.markers += 1;
  els.sessMarkers.textContent = String(state.session.markers);

  const tr = document.createElement("tr");
  tr.innerHTML = `<td>${formatTime(msg.t)}</td><td>${escapeHTML(msg.label)}</td>`;
  els.markersBody.insertBefore(tr, els.markersBody.firstChild);
  while (els.markersBody.rows.length > 100) {
    els.markersBody.deleteRow(els.markersBody.rows.length - 1);
  }
}

// ---- Session ----

/**
 * Reçoit les changements d'état de session depuis le serveur.
 *
 * msg = { type: "session", state: "running"|"idle", started_at, duration_s, sample_count?, marker_count? }
 */
export function handleSession(msg) {
  state.session.running    = msg.state === "running";
  state.session.started_at = msg.started_at || state.session.started_at;
  state.session.duration_s = msg.duration_s || 0;
  if (typeof msg.sample_count === "number") state.session.samples = msg.sample_count;
  if (typeof msg.marker_count === "number") state.session.markers = msg.marker_count;
  applySessionUI();
}

/** Met à jour tous les contrôles visuels liés à l'état de session. */
export function applySessionUI() {
  const running = state.session.running;
  els.sessState.textContent = running ? "enregistrement" : "idle";
  els.sessStart.textContent = state.session.started_at ? formatTime(state.session.started_at) : "—";
  els.sessSamples.textContent = String(state.session.samples);
  els.sessMarkers.textContent = String(state.session.markers);
  els.btnStart.disabled  = running;
  els.btnStop.disabled   = !running;
  els.btnMarker.disabled = false; // toujours disponible, session ou non
  els.stRec.textContent  = running ? "REC: actif" : "REC: idle";
}

// ---- Utilitaires de format ----

export function formatTime(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString("fr-FR", { hour12: false }) +
      "." + String(d.getMilliseconds()).padStart(3, "0");
  } catch {
    return iso;
  }
}

export function escapeHTML(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

export function formatDuration(seconds) {
  const s  = Math.max(0, Math.floor(seconds));
  const h  = String(Math.floor(s / 3600)).padStart(2, "0");
  const m  = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${h}:${m}:${ss}`;
}
