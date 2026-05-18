# X.on EEG — Interface Linux

Interface web pour le casque EEG [X.on](https://xon-eeg.com/) sur Linux.  
Backend Python (FastAPI) + frontend HTML/CSS/JS vanilla.  
Mode mock intégré — le vrai casque se branche via LSL sans app Windows.
<img width="1826" height="944" alt="image" src="https://github.com/user-attachments/assets/38734de9-5518-4612-b509-b4a1cb9abc86" />

---

## Installation

```bash
python -m venv .venv
source .venv/bin/activate        # Windows : .venv\Scripts\activate
pip install -r backend/requirements.txt
```

## Lancer

```bash
uvicorn backend.main:app --host 0.0.0.0 --port 8000
```

Puis ouvrir **http://localhost:8000**

Variable d'environnement optionnelle :

| Variable     | Valeurs        | Défaut |
| ------------ | -------------- | ------ |
| `EEG_SOURCE` | `mock` / `lsl` | `mock` |

```bash
EEG_SOURCE=lsl uvicorn backend.main:app --host 0.0.0.0 --port 8000
```

---

## Ce qui est fait

| Fonctionnalité          | Détail                                                                |
| ----------------------- | --------------------------------------------------------------------- |
| **8 canaux X.on**       | F3, F4, C3, Cz, C4, P3, P4, BIP1 — système 10-20 + bipolaire          |
| **250 Hz**              | Mock fidèle au format réel (chunks de 25 samples / 100 ms)            |
| **Tracé multi-canaux**  | Affichage scrollant style traceur EEG, échelle ±µV ajustable          |
| **Check d'impédance**   | Pastille verte/jaune/rouge par canal (seuils 10/25 kΩ)                |
| **Session + marqueurs** | Start/Stop avec chrono, bouton Marqueur horodaté visible sur le tracé |
| **Export Excel**        | Feuilles EEG (toutes valeurs µV) + Markers + Meta                     |
| **Prêt pour LSL**       | `EEG_SOURCE=lsl` branche `pylsl` sans toucher au reste du code        |

---

## Brancher le vrai casque

Le casque X.on communique en **BLE 5.0**.  
L'app Windows officielle sert surtout à streamer en LSL et checker l'impédance.  
Sur Linux, l'app **Android X.on** fait la même chose.

### Prérequis Linux

```bash
# Librairie LSL native
sudo apt install liblsl0

# Binding Python
pip install pylsl
```

### Procédure

1. Installer l'app **X.on** sur un téléphone Android (Play Store).
2. Connecter le casque au téléphone via Bluetooth.
3. Dans l'app Android → activer le **streaming LSL**.
4. Le téléphone et le PC Linux doivent être sur le **même réseau local** (Wi-Fi).
5. Lancer le backend en mode LSL :

```bash
EEG_SOURCE=lsl uvicorn backend.main:app --host 0.0.0.0 --port 8000
```

Le backend résout automatiquement le stream LSL de type `EEG` sur le réseau.  
Les noms de canaux, la fréquence et la référence sont lus depuis les métadonnées LSL.

### Vérifier que le stream LSL est visible

```python
from pylsl import resolve_byprop
streams = resolve_byprop("type", "EEG", timeout=5)
print(streams)  # doit lister le stream X.on
```

### Dépannage

| Problème                 | Cause probable                                | Solution                                                     |
| ------------------------ | --------------------------------------------- | ------------------------------------------------------------ |
| `No LSL stream found`    | Pas sur le même réseau                        | Vérifier Wi-Fi commun téléphone/PC                           |
| `No LSL stream found`    | App Android en veille                         | Garder l'écran allumé pendant le stream                      |
| Impédance non disponible | X.on Android ne publie pas l'impédance en LSL | Checker l'impédance depuis l'app Android avant d'enregistrer |
| `ImportError: pylsl`     | `liblsl0` absent                              | `sudo apt install liblsl0`                                   |

---

## Structure du projet

```
uselessPoc/
├── backend/
│   ├── main.py          # Routes FastAPI, état session, export Excel
│   ├── ws_manager.py    # ConnectionManager WebSocket (broadcast)
│   ├── sources/
│   │   ├── __init__.py  # EEGSource ABC + factory get_source()
│   │   ├── mock.py      # Signal mock 8 canaux 250 Hz + impédance simulée
│   │   └── lsl.py       # Adapter pylsl → même interface qu'EEGSource
│   └── requirements.txt
└── frontend/
    ├── index.html       # Structure HTML (toolbar, canvas, sidebar, statusbar)
    ├── styles.css       # Style labo sobre (gris, bordures 1px, pas de gradients)
    ├── state.js         # État partagé + refs DOM
    ├── chart.js         # Rendu canvas (grille, traces, marqueurs)
    ├── ui.js            # Handlers WS + mise à jour DOM
    ├── ws.js            # Connexion WebSocket (reconnexion automatique)
    └── app.js           # Câblage événements + boot
```
