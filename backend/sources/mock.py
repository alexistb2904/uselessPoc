from __future__ import annotations

import asyncio
import math
import random
from datetime import datetime, timezone
from typing import List, Optional

from . import (
    XON_CHANNELS,
    XON_DEFAULT_FS,
    XON_REFERENCE,
    ChunkCallback,
    EEGSource,
    ImpedanceCallback,
    StreamInfo,
)


CHUNK_SIZE = 25
CHUNK_INTERVAL = CHUNK_SIZE / XON_DEFAULT_FS
IMPEDANCE_INTERVAL = 1.5


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


class MockSource(EEGSource):
    def __init__(self) -> None:
        self._task: Optional[asyncio.Task] = None
        self._imp_task: Optional[asyncio.Task] = None
        self._impedance_enabled = False
        self._t = 0.0
        self._impedance_state: List[float] = [
            8.0, 11.0, 4.5, 5.0, 9.0, 14.0, 6.0, 3.0
        ]

    def info(self) -> StreamInfo:
        return StreamInfo(
            channels=list(XON_CHANNELS),
            fs=XON_DEFAULT_FS,
            reference=XON_REFERENCE,
            source="mock",
        )

    async def start(
        self,
        on_chunk: ChunkCallback,
        on_impedance: ImpedanceCallback,
    ) -> None:
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._chunk_loop(on_chunk))
        if self._imp_task is None or self._imp_task.done():
            self._imp_task = asyncio.create_task(self._impedance_loop(on_impedance))

    async def stop(self) -> None:
        for task in (self._task, self._imp_task):
            if task and not task.done():
                task.cancel()
        self._task = None
        self._imp_task = None

    async def set_impedance_streaming(self, enabled: bool) -> None:
        self._impedance_enabled = enabled

    async def _chunk_loop(self, on_chunk: ChunkCallback) -> None:
        dt = 1.0 / XON_DEFAULT_FS
        try:
            while True:
                t0 = _iso_now()
                chunk: List[List[float]] = []
                for _ in range(CHUNK_SIZE):
                    sample = self._make_sample(self._t)
                    chunk.append(sample)
                    self._t += dt
                await on_chunk(t0, chunk)
                await asyncio.sleep(CHUNK_INTERVAL)
        except asyncio.CancelledError:
            return

    def _make_sample(self, t: float) -> List[float]:
        values: List[float] = []
        for idx, _name in enumerate(XON_CHANNELS):
            if idx < 7:
                alpha = math.sin(2 * math.pi * 10 * t + idx * 0.6) * (12 + idx * 1.5)
                slow = math.sin(2 * math.pi * 0.7 * t + idx) * 6
                noise = random.uniform(-3.5, 3.5)
                values.append(round(alpha + slow + noise, 3))
            else:
                beta = math.sin(2 * math.pi * 20 * t) * 18
                noise = random.uniform(-5, 5)
                values.append(round(beta + noise, 3))
        return values

    async def _impedance_loop(self, on_impedance: ImpedanceCallback) -> None:
        try:
            while True:
                if self._impedance_enabled:
                    drifted: List[Optional[float]] = []
                    for i in range(len(self._impedance_state)):
                        self._impedance_state[i] += random.uniform(-0.5, 0.5)
                        self._impedance_state[i] = max(1.5, min(35.0, self._impedance_state[i]))
                        if XON_CHANNELS[i] == "BIP1":
                            drifted.append(None)
                        else:
                            drifted.append(round(self._impedance_state[i], 1))
                    await on_impedance(_iso_now(), drifted)
                await asyncio.sleep(IMPEDANCE_INTERVAL)
        except asyncio.CancelledError:
            return
