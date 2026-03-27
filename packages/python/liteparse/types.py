from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import List, Optional, Any, Dict, Iterator


class OutputFormat(str, Enum):
    """Output format options."""
    JSON = "json"
    TEXT = "text"


class ImageFormat(str, Enum):
    """Image format options for screenshots."""
    PNG = "png"
    JPG = "jpg"


@dataclass
class BoundingBox:
    """Bounding box coordinates."""
    x1: float
    y1: float
    x2: float
    y2: float


@dataclass
class TextItem:
    """Individual text item extracted from a document."""
    text: str
    x: float
    y: float
    width: float
    height: float
    confidence: Optional[float] = None
    fontName: Optional[str] = None
    fontSize: Optional[float] = None


@dataclass
class ParsedPage:
    """A parsed page from a document."""
    pageNum: int
    width: float
    height: float
    text: str
    textItems: List[TextItem] = field(default_factory=list)
    boundingBoxes: List[BoundingBox] = field(default_factory=list)


@dataclass
class ParseResult:
    """Result of parsing a document."""
    pages: List[ParsedPage]
    text: str
    json: Optional[Dict[str, Any]] = None

    @property
    def num_pages(self) -> int:
        """Number of pages in the document."""
        return len(self.pages)

    def get_page(self, page_num: int) -> Optional[ParsedPage]:
        """Get a specific page by number (1-indexed)."""
        for page in self.pages:
            if page.pageNum == page_num:
                return page
        return None


@dataclass
class BatchResult:
    """Result of batch parsing."""
    output_dir: str


@dataclass
class ScreenshotResult:
    """Result of a single page screenshot."""
    page_num: int
    image_path: str
    image_bytes: Optional[bytes] = None


@dataclass
class ScreenshotBatchResult:
    """Result of screenshot operation."""
    screenshots: List[ScreenshotResult]
    output_dir: str

    def __len__(self) -> int:
        return len(self.screenshots)

    def __iter__(self) -> Iterator[ScreenshotResult]:
        return iter(self.screenshots)

    def get_page(self, page_num: int) -> Optional[ScreenshotResult]:
        """Get screenshot for a specific page."""
        for s in self.screenshots:
            if s.page_num == page_num:
                return s
        return None


class ParseError(Exception):
    """Exception raised when parsing fails."""
    def __init__(self, message: str, stderr: Optional[str] = None):
        super().__init__(message)
        self.stderr = stderr


class CLINotFoundError(Exception):
    """Exception raised when the liteparse CLI is not found."""
    pass
