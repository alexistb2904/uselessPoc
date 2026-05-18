/**
 * ws.js — connexion WebSocket au backend EEG.
 *
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │  Comment fonctionne WebSocket                                       │
 * │                                                                     │
 * │  WebSocket est un protocole full-duplex sur TCP.                    │
 * │  Contrairement à HTTP (requête → réponse), la connexion reste       │
 * │  ouverte et les deux côtés peuvent envoyer des données à tout       │
 * │  moment, sans re-négocier.                                          │
 * │                                                                     │
 * │  Cycle de vie côté client :                                         │
 * │    1. new WebSocket(url)  → poignée de main HTTP (Upgrade)         │
 * │    2. "open"              → connexion établie, prêt à envoyer       │
 * │    3. "message"           → frame reçue du serveur                  │
 * │    4. "close"             → connexion fermée (code + raison)        │
 * │    5. "error"             → erreur réseau (toujours suivi de close) │
 * │                                                                     │
 * │  États d'un WebSocket :                                             │
 * │    CONNECTING (0) → OPEN (1) → CLOSING (2) → CLOSED (3)            │
 * │                                                                     │
 * │  Ici le backend (FastAPI / Starlette) pousse les chunks EEG         │
 * │  en JSON à ~10 msg/s (25 samples × 250 Hz = 100 ms/msg).           │
 * │  On envoie côté client uniquement pour garder la connexion          │
 * │  ouverte (le serveur attend receive_text en boucle).                │
 * └─────────────────────────────────────────────────────────────────────┘
 */

import { state } from "./state.js";
import {
  setConnection,
  setStreamInfo,
  handleChunk,
  handleImpedance,
  handleMarker,
  handleSession,
} from "./ui.js";

// URL WebSocket construite depuis l'URL courante (HTTP → WS, HTTPS → WSS).
const WS_URL = `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/ws/eeg`;

let socket        = null; // instance WebSocket active
let reconnectTimer = null; // setTimeout en attente de reconnexion
let wantConnected = false; // intention de l'utilisateur (persiste à travers les reconnexions)

/**
 * Ouvre la connexion WebSocket.
 * Si un socket est déjà en cours de connexion ou ouvert, ne fait rien.
 * Se reconnecte automatiquement toutes les 2 s si `wantConnected` est true.
 */
export function openSocket() {
  // Ne pas empiler les connexions si déjà en cours.
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return;
  }

  wantConnected = true;
  setConnection(false, "Connexion…");
  socket = new WebSocket(WS_URL);

  // --- Connexion établie ---
  socket.addEventListener("open", () => {
    setConnection(true, "Connecté");
    // On n'envoie rien de particulier à l'ouverture :
    // le serveur pousse immédiatement le message "info" puis le flux de chunks.
  });

  // --- Frame reçue du serveur ---
  // Toutes les frames sont du JSON.  On route selon msg.type.
  socket.addEventListener("message", (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return; // frame non-JSON, ignorée
    }

    switch (msg.type) {
      case "info":       setStreamInfo(msg); break;
      case "eeg_chunk":  handleChunk(msg);   break;
      case "impedance":  handleImpedance(msg); break;
      case "marker":     handleMarker(msg);  break;
      case "session":    handleSession(msg); break;
      // Autres types ignorés pour robustesse future.
    }
  });

  // --- Connexion fermée (réseau, serveur redémarré, timeout, etc.) ---
  socket.addEventListener("close", (event) => {
    // code 1000 = fermeture normale, 1001 = serveur going away, etc.
    // On reconecte automatiquement uniquement si l'utilisateur voulait rester connecté.
    if (wantConnected) {
      setConnection(false, "Reconnexion 2s…");
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(openSocket, 2000);
    } else {
      setConnection(false, "Déconnecté");
    }
  });

  // --- Erreur réseau ---
  // Un événement "error" est toujours suivi d'un "close".
  // On met juste à jour le label ; la reconnexion se fera via le handler "close".
  socket.addEventListener("error", () => {
    setConnection(false, "Erreur WebSocket");
  });
}

/**
 * Ferme la connexion et annule la reconnexion automatique.
 * Appelé quand l'utilisateur clique sur "Déconnecter".
 */
export function closeSocket() {
  wantConnected = false;
  clearTimeout(reconnectTimer);
  if (socket) socket.close();
}

/** Retourne true si la connexion est voulue par l'utilisateur. */
export function isWantConnected() {
  return wantConnected;
}
