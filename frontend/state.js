/**
 * state.js — état global de l'application et références DOM.
 *
 * Un seul objet `state` mutable partagé entre les modules.
 * Les modules importent `state` par référence : toute modification
 * dans chart.js ou ui.js est visible partout sans ré-export.
 */

// Références aux éléments DOM — requêtés une seule fois au démarrage.
export const els = {
  canvas:      document.getElementById("eegCanvas"),
  canvasWrap:  document.querySelector(".canvas-wrap"),
  channelRail: document.getElementById("channelRail"),
  connDot:     document.getElementById("connDot"),
  connLabel:   document.getElementById("connLabel"),
  titleMeta:   document.getElementById("titleMeta"),

  sessState:    document.getElementById("sessState"),
  sessStart:    document.getElementById("sessStart"),
  sessDuration: document.getElementById("sessDuration"),
  sessSamples:  document.getElementById("sessSamples"),
  sessMarkers:  document.getElementById("sessMarkers"),

  infoSource:   document.getElementById("infoSource"),
  infoFs:       document.getElementById("infoFs"),
  infoChannels: document.getElementById("infoChannels"),
  infoRef:      document.getElementById("infoRef"),
  infoUnit:     document.getElementById("infoUnit"),

  markersBody: document.getElementById("markersBody"),

  stStream: document.getElementById("stStream"),
  stRec:    document.getElementById("stRec"),
  stClock:  document.getElementById("stClock"),
  stRate:   document.getElementById("stRate"),

  btnConnect:   document.getElementById("btnConnect"),
  btnStart:     document.getElementById("btnStart"),
  btnStop:      document.getElementById("btnStop"),
  markerLabel:  document.getElementById("markerLabel"),
  btnMarker:    document.getElementById("btnMarker"),
  btnImpedance: document.getElementById("btnImpedance"),
  btnExport:    document.getElementById("btnExport"),
  btnReset:     document.getElementById("btnReset"),
  scaleSelect:  document.getElementById("scaleSelect"),
};

export const state = {
  // --- Info stream (rempli à la connexion via le message WS "info") ---
  info: null,          // { channels, fs, reference, source, units }
  channels: [],        // noms des canaux ex. ["F3","F4","C3","Cz","C4","P3","P4","BIP1"]

  // --- Buffer circulaire par canal ---
  // Chaque canal a un Float32Array de taille `bufferSize`.
  // `writeIdx` avance modulo bufferSize ; le buffer se lit de writeIdx (oldest) à writeIdx-1 (newest).
  windowSeconds: 10,   // durée affichée en secondes
  buffers: [],         // Float32Array[] — un tableau par canal
  bufferSize: 0,       // = fs * windowSeconds
  writeIdx: 0,         // index modulo bufferSize (prochain slot à écrire)
  totalSamples: 0,     // compteur monotone total (jamais remis à 0 mod N — sert à positionner les marqueurs)

  // --- Affichage ---
  scaleMicroV: 100,    // ±µV visible par piste
  width: 0,            // px CSS du canvas
  height: 0,
  dpr: 1,              // devicePixelRatio

  // --- Impédance ---
  impedance: [],       // valeurs kΩ par canal (null = pas de mesure)
  impedanceActive: false,

  // --- Session ---
  session: {
    running: false,
    started_at: null,  // ISO string
    duration_s: 0,
    samples: 0,
    markers: 0,
  },

  // --- Marqueurs posés par l'utilisateur ---
  // totalSamplesAtPlacement permet de calculer la position X dans le buffer
  // sans ambiguïté de modulo (cf. chart.js drawMarkers).
  markers: [],         // { timestamp, label, totalSamplesAtPlacement }

  // --- Stats débit ---
  chunkCounter: 0,     // chunks reçus depuis la dernière seconde
};
