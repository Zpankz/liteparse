# ocr/

Example OCR server implementations that conform to the LiteParse OCR API specification.

These servers allow you to use alternative OCR engines instead of the built-in Tesseract.js.

## Why Use an External OCR Server?

| Feature | Tesseract.js (built-in) | EasyOCR | PaddleOCR |
|---------|-------------------------|---------|-----------|
| Setup | Zero (included) | Docker | Docker |
| Speed | Moderate | Moderate | Fast (2-3x) |
| Accuracy (Latin) | Good | Good | Good |
| Accuracy (CJK) | Fair | Good | Excellent |
| Languages | 100+ | 80+ | 80+ |
| Memory | In-process | Separate | Separate |

**Recommendations:**
- **Quick start**: Use built-in Tesseract (no setup)
- **Asian languages**: Use PaddleOCR (best CJK support)
- **General use**: EasyOCR (good balance)

## Available Servers

### [easyocr/](./easyocr/)
Flask server wrapping EasyOCR library.
- Port: **8828**
- Good general-purpose OCR
- 80+ languages

### [paddleocr/](./paddleocr/)
Flask server wrapping PaddleOCR library.
- Port: **8829**
- Excellent for Chinese, Japanese, Korean
- 2-3x faster than EasyOCR

## Quick Start

```bash
# Start EasyOCR server
cd ocr/easyocr
docker build -t liteparse-easyocr .
docker run -p 8828:8828 liteparse-easyocr

# OR start PaddleOCR server
cd ocr/paddleocr
docker build -t liteparse-paddleocr .
docker run -p 8829:8829 liteparse-paddleocr
```

Then use with LiteParse:

```bash
# CLI
lit parse document.pdf --ocr-server-url http://localhost:8828/ocr

# Code
const parser = new LiteParse({
  ocrServerUrl: 'http://localhost:8828/ocr',
  ocrLanguage: 'en',
});
```

## API Specification

All servers implement the same API (defined in `OCR_API_SPEC.md`):

**Endpoint:** `POST /ocr`

**Request:**
- Content-Type: `multipart/form-data`
- Fields:
  - `file` - Image file
  - `language` - Language code (e.g., 'en', 'zh', 'ja')

**Response:**
```json
{
  "results": [
    {
      "text": "recognized text",
      "bbox": [x1, y1, x2, y2],
      "confidence": 0.95
    }
  ]
}
```

## Creating a Custom OCR Server

To implement your own OCR server:

1. Create a Flask/FastAPI/Express server
2. Accept `POST /ocr` with multipart form data
3. Return JSON with `results` array containing:
   - `text` - Recognized text string
   - `bbox` - Bounding box as `[x1, y1, x2, y2]`
   - `confidence` - Confidence score (0-1)

4. (Optional) Implement `GET /health` endpoint

See the existing servers as reference implementations.

## Language Codes

Most servers accept ISO 639-1 codes (e.g., 'en', 'zh', 'ja') and map them internally:

| ISO Code | Language | Notes |
|----------|----------|-------|
| en | English | |
| zh | Chinese (Simplified) | |
| zh-tw | Chinese (Traditional) | |
| ja | Japanese | |
| ko | Korean | |
| fr | French | |
| de | German | |
| es | Spanish | |
| ar | Arabic | |
| hi | Hindi | |
