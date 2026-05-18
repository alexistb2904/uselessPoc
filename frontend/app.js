/**
 * app.js — point d'entrée principal.
 *
 * Ce fichier câble les événements UI (boutons, select, resize)
 * sur les fonctions des autres modules et lance l'application.
 *
 * Imports :
 *   state.js  → état partagé + refs DOM
 *   chart.js  → rendu canvas
 *   ui.js     → handlers WS + formatters
 *   ws.js     → connexion WebSocket
 */

import { state, els } from "./state.js";
import { resizeCanvas, draw } from "./chart.js";
import { setStreamInfo, applySessionUI, formatDuration } from "./ui.js";
import { openSocket, closeSocket, isWantConnected } from "./ws.js";

// ---- API helpers ----

async function postJSON(path, body) {
	const resp = await fetch(path, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: body ? JSON.stringify(body) : null,
	});
	if (!resp.ok) throw new Error(`${path} → ${resp.status}`);
	return resp.json();
}

/**
 * Récupère l'état courant du stream au démarrage via HTTP.
 * Permet d'hydrater l'UI même si on charge la page en milieu de session.
 */
async function fetchInitialInfo() {
	try {
		const resp = await fetch("/api/stream/info");
		if (!resp.ok) return;
		const info = await resp.json();
		if (!info?.channels) return;
		setStreamInfo(info);
		if (info.session) {
			state.session.running = info.session.running;
			state.session.started_at = info.session.started_at;
			state.session.duration_s = info.session.duration_s;
			state.session.samples = info.session.sample_count;
			state.session.markers = info.session.marker_count;
			applySessionUI();
		}
	} catch {
		/* ignorer si le serveur n'est pas encore prêt */
	}
}

// ---- Boutons toolbar ----

els.btnConnect.addEventListener("click", () => {
	const nowWant = !isWantConnected();
	els.btnConnect.classList.toggle("active", nowWant);
	els.btnConnect.textContent = nowWant ? "Déconnecter" : "Connecter";
	if (nowWant) openSocket();
	else closeSocket();
});

els.btnStart.addEventListener("click", async () => {
	try {
		await postJSON("/api/session/start");
	} catch (e) {
		alert(e.message);
	}
});

els.btnStop.addEventListener("click", async () => {
	try {
		await postJSON("/api/session/stop");
	} catch (e) {
		alert(e.message);
	}
});

els.btnMarker.addEventListener("click", async () => {
	const label = els.markerLabel.value.trim() || "event";
	try {
		await postJSON("/api/session/marker", { label });
		// feedback visuel rapide sur le bouton
		els.btnMarker.textContent = "✓";
		setTimeout(() => {
			els.btnMarker.textContent = "+ Marqueur";
		}, 600);
	} catch (e) {
		alert(e.message);
	}
});

// Entrée clavier dans le champ label = poser un marqueur directement
els.markerLabel.addEventListener("keydown", (e) => {
	if (e.key === "Enter") els.btnMarker.click();
});

els.btnImpedance.addEventListener("click", async () => {
	state.impedanceActive = !state.impedanceActive;
	els.btnImpedance.classList.toggle("active", state.impedanceActive);
	els.canvasWrap.classList.toggle("impedance-active", state.impedanceActive);
	try {
		await postJSON(state.impedanceActive ? "/api/impedance/start" : "/api/impedance/stop");
	} catch (e) {
		alert(e.message);
	}
});

els.btnExport.addEventListener("click", async () => {
	els.btnExport.disabled = true;
	const orig = els.btnExport.textContent;
	els.btnExport.textContent = "Export…";
	try {
		const resp = await fetch("/api/export/excel");
		if (!resp.ok) throw new Error("Export impossible");
		const blob = await resp.blob();
		const url = window.URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = "xon_eeg.xlsx";
		document.body.appendChild(a);
		a.click();
		a.remove();
		window.URL.revokeObjectURL(url);
	} catch (e) {
		alert(e.message);
	} finally {
		els.btnExport.disabled = false;
		els.btnExport.textContent = orig;
	}
});

els.btnReset.addEventListener("click", async () => {
	try {
		await postJSON("/api/session/reset");
		if (state.bufferSize > 0) {
			for (const b of state.buffers) b.fill(0);
			state.writeIdx = 0;
			state.totalSamples = 0;
		}
		state.markers = [];
		els.markersBody.innerHTML = "";
		state.session.samples = 0;
		state.session.markers = 0;
		applySessionUI();
	} catch (e) {
		alert(e.message);
	}
});

els.scaleSelect.addEventListener("change", () => {
	state.scaleMicroV = parseInt(els.scaleSelect.value, 10) || 100;
});

// ---- Timers ----

// Boucle d'animation : draw() à chaque frame (typiquement 60 fps).
// chart.js lit l'état courant des buffers → pas besoin de lui passer des données.
function animationLoop() {
	draw();
	requestAnimationFrame(animationLoop);
}

// Tick à 1 Hz : chrono de session + affichage du débit de chunks.
setInterval(() => {
	if (state.session.running && state.session.started_at) {
		const elapsed = (Date.now() - new Date(state.session.started_at).getTime()) / 1000;
		state.session.duration_s = elapsed;
		els.sessDuration.textContent = formatDuration(elapsed);
		els.stClock.textContent = formatDuration(elapsed);
	} else {
		els.sessDuration.textContent = formatDuration(0);
		els.stClock.textContent = formatDuration(0);
	}
	els.stRate.textContent = `${state.chunkCounter} chunks/s`;
	state.chunkCounter = 0;
}, 1000);

window.addEventListener("resize", resizeCanvas);

// ---- Boot ----

(async () => {
	await fetchInitialInfo();
	resizeCanvas();

	// Connexion automatique à l'ouverture.
	els.btnConnect.classList.add("active");
	els.btnConnect.textContent = "Déconnecter";
	openSocket();

	animationLoop();
})();
