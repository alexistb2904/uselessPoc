"""
ws_manager.py — gestion des connexions WebSocket côté serveur (FastAPI / Starlette).

┌─────────────────────────────────────────────────────────────────────────┐
│  Comment fonctionne WebSocket côté serveur (FastAPI)                    │
│                                                                         │
│  FastAPI expose les WebSockets via @app.websocket("/chemin").           │
│  À chaque nouvelle connexion, FastAPI instancie un objet `WebSocket`    │
│  et appelle le handler coroutine.                                       │
│                                                                         │
│  Cycle de vie serveur :                                                 │
│    1. Le client envoie une requête HTTP avec en-têtes Upgrade.          │
│    2. FastAPI accepte via websocket.accept() → la connexion est ouverte │
│    3. Le serveur peut envoyer à tout moment avec send_text() / send_bytes() │
│    4. Le serveur reçoit via receive_text() / receive_bytes()            │
│    5. La connexion se ferme quand l'une des deux parties la clôt,       │
│       ou quand une exception WebSocketDisconnect est levée.             │
│                                                                         │
│  Ici, le serveur pousse les données (EEG chunks, impédance, marqueurs) │
│  à tous les clients connectés via la méthode `broadcast`.              │
│  Le client envoie uniquement pour garder la connexion vivante           │
│  (le handler server-side est en receive_text() bloquant).              │
└─────────────────────────────────────────────────────────────────────────┘
"""

from __future__ import annotations

import asyncio
import json
from typing import Set

from fastapi import WebSocket


class ConnectionManager:
    """Registre de connexions WebSocket actives avec broadcast thread-safe.

    Utilisation :
        manager = ConnectionManager()

        @app.websocket("/ws/eeg")
        async def handler(ws: WebSocket):
            await manager.connect(ws)
            try:
                while True:
                    await ws.receive_text()   # maintient la connexion ouverte
            except WebSocketDisconnect:
                await manager.disconnect(ws)

        # Depuis n'importe quelle coroutine :
        await manager.broadcast({"type": "eeg_chunk", ...})
    """

    def __init__(self) -> None:
        self.active: Set[WebSocket] = set()
        # Lock asyncio pour protéger `active` contre les modifications concurrentes.
        # FastAPI utilise un event loop unique par processus uvicorn, donc asyncio.Lock
        # suffit (pas besoin de threading.Lock).
        self._lock = asyncio.Lock()

    async def connect(self, websocket: WebSocket) -> None:
        """Accepte la connexion HTTP Upgrade et enregistre le client."""
        await websocket.accept()
        async with self._lock:
            self.active.add(websocket)

    async def disconnect(self, websocket: WebSocket) -> None:
        """Retire le client du registre (appelé après WebSocketDisconnect)."""
        async with self._lock:
            self.active.discard(websocket)

    async def broadcast(self, message: dict) -> None:
        """Sérialise `message` en JSON et l'envoie à tous les clients connectés.

        Les clients morts (connexion coupée sans handshake propre) sont détectés
        à l'envoi et supprimés du registre.
        """
        payload = json.dumps(message)

        # Snapshot de la liste pour éviter de tenir le lock pendant les envois
        # (send_text est une coroutine qui peut suspendre).
        async with self._lock:
            clients = list(self.active)

        dead: list[WebSocket] = []
        for client in clients:
            try:
                await client.send_text(payload)
            except Exception:
                # Connexion fermée de façon abrupte (timeout réseau, fermeture navigateur…)
                dead.append(client)

        if dead:
            async with self._lock:
                for client in dead:
                    self.active.discard(client)

    @property
    def count(self) -> int:
        """Nombre de clients actuellement connectés (sans lock — valeur approximative)."""
        return len(self.active)
