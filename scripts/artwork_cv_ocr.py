import json
import sys
import base64


def output(payload):
    sys.stdout.write(json.dumps(payload, ensure_ascii=False))
    sys.stdout.flush()


def main():
    try:
        raw = sys.stdin.read() or "{}"
        data = json.loads(raw)
    except Exception as e:
        output({"ok": False, "error": f"invalid_input: {e}"})
        return

    image_b64 = data.get("imageBase64", "")
    art_type = str(data.get("artType", "calligraphy")).strip() or "calligraphy"
    warnings = []

    try:
        import numpy as np
        import cv2
    except Exception as e:
        output({
            "ok": False,
            "error": f"opencv_import_failed: {e}",
            "warnings": ["请在服务器安装 opencv-python 与 numpy"],
            "metrics": {},
            "ocrText": "",
        })
        return

    try:
        img_bytes = base64.b64decode(image_b64)
        arr = np.frombuffer(img_bytes, dtype=np.uint8)
        img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        if img is None:
            raise ValueError("image decode failed")
    except Exception as e:
        output({"ok": False, "error": f"image_decode_failed: {e}"})
        return

    h, w = img.shape[:2]
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    blur = cv2.GaussianBlur(gray, (5, 5), 0)
    _, th = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    fg_ratio = float((th > 0).sum()) / float(max(1, h * w))
    white_ratio = 1.0 - fg_ratio

    edges = cv2.Canny(gray, 80, 180)
    edge_density = float((edges > 0).sum()) / float(max(1, h * w))

    ys, xs = np.where(th > 0)
    if len(xs) > 0:
        cx = float(xs.mean()) / float(max(1, w))
        cy = float(ys.mean()) / float(max(1, h))
        center_offset = ((cx - 0.5) ** 2 + (cy - 0.5) ** 2) ** 0.5
    else:
        center_offset = 0.5

    num_labels, labels, stats, _ = cv2.connectedComponentsWithStats((th > 0).astype("uint8"), connectivity=8)
    comp_areas = [int(stats[i, cv2.CC_STAT_AREA]) for i in range(1, num_labels)]
    comp_count = sum(1 for a in comp_areas if a > 8)

    hist = cv2.calcHist([gray], [0], None, [32], [0, 256]).flatten()
    tonal_layers = int((hist > (hist.max() * 0.08)).sum())

    # Stroke width proxy (distance transform over foreground)
    dist = cv2.distanceTransform((th > 0).astype("uint8"), cv2.DIST_L2, 3)
    stroke_width_proxy = float(dist[dist > 0].mean() * 2.0) if (dist > 0).any() else 0.0
    stroke_width_std = float(dist[dist > 0].std() * 2.0) if (dist > 0).any() else 0.0

    ocr_text = ""
    try:
        from paddleocr import PaddleOCR
        ocr = PaddleOCR(use_angle_cls=True, lang='ch', show_log=False)
        result = ocr.ocr(img, cls=True)
        parts = []
        for line in result or []:
            for item in line or []:
                if len(item) >= 2 and isinstance(item[1], (list, tuple)) and len(item[1]) > 0:
                    parts.append(str(item[1][0]))
        ocr_text = "".join(parts).strip()
    except Exception:
        warnings.append("paddleocr 不可用，跳过OCR文本提取")

    metrics = {
        "imageWidth": int(w),
        "imageHeight": int(h),
        "foregroundRatio": round(fg_ratio, 4),
        "whiteSpaceRatio": round(white_ratio, 4),
        "edgeDensity": round(edge_density, 4),
        "compositionCenterOffset": round(float(center_offset), 4),
        "componentCount": int(comp_count),
        "tonalLayerCount": int(tonal_layers),
        "strokeWidthMean": round(float(stroke_width_proxy), 4),
        "strokeWidthStd": round(float(stroke_width_std), 4),
        "artType": art_type,
    }

    if art_type == "calligraphy":
        # Calligraphy emphasis
        metrics["structureStability"] = round(max(0.0, 1.0 - min(1.0, center_offset * 1.8)), 4)
        metrics["strokeStability"] = round(max(0.0, 1.0 - min(1.0, stroke_width_std / 12.0)), 4)
    else:
        # Painting emphasis
        metrics["compositionBalance"] = round(max(0.0, 1.0 - min(1.0, center_offset * 1.5)), 4)
        metrics["layerRichness"] = round(min(1.0, tonal_layers / 10.0), 4)

    output({
        "ok": True,
        "metrics": metrics,
        "ocrText": ocr_text,
        "warnings": warnings,
    })


if __name__ == "__main__":
    main()

