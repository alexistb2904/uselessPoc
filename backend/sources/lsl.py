from __future__ import annotations

import asyncio
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


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


class LSLSource(EEGSource):
    """Bridges a Lab Streaming Layer EEG inlet (e.g. X.on) to the app.

    pylsl is imported lazily so the mock source keeps working on machines
    without liblsl installed.
    """

    def __init__(self, stream_type: str = "EEG", chunk_size: int = 25) -> None:
        self._stream_type = stream_type
        self._chunk_size = chunk_size
        self._task: Optional[asyncio.Task] = None
        self._info_cache: Optional[StreamInfo] = None
        self._inlet = None
        self._channels: List[str] = list(XON_CHANNELS)
        self._fs: float = XON_DEFAULT_FS

    def info(self) -> StreamInfo:
        if self._info_cache is not None:
            return self._info_cache
        return StreamInfo(
            channels=list(self._channels),
            fs=self._fs,
            reference=XON_REFERENCE,
            source="lsl",
        )

    def _ensure_inlet(self):
        if self._inlet is not None:
            return self._inlet
        from pylsl import StreamInlet, resolve_byprop  # type: ignore

        streams = resolve_byprop("type", self._stream_type, timeout=5.0)
        if not streams:
            raise RuntimeError(f"No LSL stream of type {self._stream_type!r} found")
        inlet = StreamInlet(streams[0])
        full_info = inlet.info()
        self._fs = full_info.nominal_srate() or XON_DEFAULT_FS
        ch_count = full_info.channel_count()
        channels: List[str] = []
        ch = full_info.desc().child("channels").child("channel")
        for _ in range(ch_count):
            label = ch.child_value("label")
            channels.append(label or f"CH{len(channels) + 1}")
            ch = ch.next_sibling()
        if channels:
            self._channels = channels
        self._inlet = inlet
        self._info_cache = StreamInfo(
            channels=list(self._channels),
            fs=self._fs,
            reference=XON_REFERENCE,
            source="lsl",
        )
        return inlet

    async def start(
        self,
        on_chunk: ChunkCallback,
        on_impedance: ImpedanceCallback,
    ) -> None:
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._loop(on_chunk))

    async def stop(self) -> None:
        if self._task and not self._task.done():
            self._task.cancel()
        self._task = None

    async def set_impedance_streaming(self, enabled: bool) -> None:
        # XON streams impedance over a separate LSL outlet in some configs.
        # Not implemented in this scaffold — placeholder for future wiring.
        return

    async def _loop(self, on_chunk: ChunkCallback) -> None:
        loop = asyncio.get_running_loop()
        try:
            inlet = await loop.run_in_executor(None, self._ensure_inlet)
        except Exception as exc:
            print(f"[lsl] resolve failed: {exc}")
            return

        try:
            while True:
                samples, _timestamps = await loop.run_in_executor(
                    None, inlet.pull_chunk, 0.5, self._chunk_size
                )
                if samples:
                    await on_chunk(_iso_now(), [list(map(float, row)) for row in samples])
                else:
                    await asyncio.sleep(0.02)
        except asyncio.CancelledError:
            return
