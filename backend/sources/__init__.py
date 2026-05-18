from __future__ import annotations

import os
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Awaitable, Callable, List, Optional


@dataclass
class StreamInfo:
    channels: List[str]
    fs: float
    reference: str
    source: str
    units: str = "uV"


ChunkCallback = Callable[[str, List[List[float]]], Awaitable[None]]
ImpedanceCallback = Callable[[str, List[Optional[float]]], Awaitable[None]]


class EEGSource(ABC):
    @abstractmethod
    def info(self) -> StreamInfo: ...

    @abstractmethod
    async def start(
        self,
        on_chunk: ChunkCallback,
        on_impedance: ImpedanceCallback,
    ) -> None: ...

    @abstractmethod
    async def stop(self) -> None: ...

    @abstractmethod
    async def set_impedance_streaming(self, enabled: bool) -> None: ...


XON_CHANNELS = ["F3", "F4", "C3", "Cz", "C4", "P3", "P4", "BIP1"]
XON_REFERENCE = "A1/A2"
XON_DEFAULT_FS = 250.0


def get_source(name: Optional[str] = None) -> EEGSource:
    selected = (name or os.environ.get("EEG_SOURCE", "mock")).lower()
    if selected == "lsl":
        from .lsl import LSLSource
        return LSLSource()
    from .mock import MockSource
    return MockSource()
