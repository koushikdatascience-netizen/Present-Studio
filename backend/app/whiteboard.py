import json
import math
from urllib.parse import urlsplit

from fastapi import HTTPException


def active_document(document):
    if not document:
        return None
    page = next((page for page in document.get('pages', []) if page.get('id') == document.get('activePageId')), None)
    return {**document, 'pages': [page] if page else []}


def validate_document(document):
    if not isinstance(document, dict):
        raise HTTPException(422, 'Invalid whiteboard document')
    try:
        encoded = json.dumps(document, allow_nan=False)
    except (ValueError, TypeError):
        raise HTTPException(422, 'Whiteboard contains invalid values')
    if len(encoded.encode()) > 750_000:
        raise HTTPException(413, 'Whiteboard is too large. Export your board and remove some content before saving.')
    pages = document.get('pages')
    if not isinstance(pages, list) or not 1 <= len(pages) <= 40:
        raise HTTPException(422, 'A board must have between 1 and 40 pages')
    ids = set()
    objects = 0
    surface_ids = set()

    def inspect_value(value, depth=0):
        nonlocal objects
        if depth > 15:
            raise HTTPException(422, 'Whiteboard nesting limit exceeded')
        if isinstance(value, dict):
            if 'type' in value and value['type'] not in {'image', 'path', 'rect', 'circle', 'line', 'textbox', 'text', 'i-text', 'group', 'triangle', 'ellipse', 'polygon', 'polyline', 'pattern'}:
                raise HTTPException(422, 'Unsupported whiteboard object type')
            if value.get('type') in {'image', 'path', 'rect', 'circle', 'line', 'textbox', 'text', 'i-text', 'group', 'triangle', 'ellipse', 'polygon', 'polyline'}:
                objects += 1
            for key, item in value.items():
                if key == 'wbLatex' and (not isinstance(item, str) or len(item) > 2000):
                    raise HTTPException(422, 'Invalid editable equation')
                if key == 'wbMath':
                    if not isinstance(item, dict) or item.get('version') != 1 or item.get('kind') not in {'graph', 'fraction', 'numberline', 'geometry', 'tangent', 'integral', 'matrix', 'sequence', 'surface3d'}:
                        raise HTTPException(422, 'Invalid live math object')
                    for name in ('parameter', 'minimum', 'maximum', 'numerator', 'denominator', 'position', 'count', 'angle', 'stretch'):
                        if not isinstance(item.get(name), (int, float)) or isinstance(item.get(name), bool) or not math.isfinite(item[name]):
                            raise HTTPException(422, 'Invalid live math parameter')
                    if not isinstance(item.get('expression'), str) or len(item['expression']) > 500:
                        raise HTTPException(422, 'Invalid live math expression')
                    if item.get('kind') == 'surface3d' and (not isinstance(item.get('id'), str) or not 1 <= len(item['id']) <= 80):
                        raise HTTPException(422, 'Invalid surface identity')
                    if item.get('kind') == 'surface3d':
                        if item['id'] in surface_ids or len(surface_ids) >= 4:
                            raise HTTPException(422, 'Use at most four uniquely identified 3D surfaces per page')
                        surface_ids.add(item['id'])
                    if 'camera' in item:
                        camera = item['camera']
                        if not isinstance(camera, dict) or any(not isinstance(camera.get(name), list) or len(camera[name]) != 3 or any(not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value) or abs(value) > 1e12 for value in camera[name]) for name in ('position', 'target')):
                            raise HTTPException(422, 'Invalid camera state')
                if key in {'__proto__', 'constructor', 'prototype', 'clipPath'}:
                    raise HTTPException(422, 'Unsupported whiteboard property')
                if key in {'src', 'source'} and isinstance(item, str):
                    url = urlsplit(item)
                    if not (url.scheme in {'http', 'https'} or (not url.scheme and item.startswith('/') and not item.startswith('//')) or item.startswith('data:image/png;base64,')):
                        raise HTTPException(422, 'Unsupported whiteboard image URL')
                if key == 'objects' and (not isinstance(item, list) or any(not isinstance(obj, dict) or obj.get('type') not in {'image', 'path', 'rect', 'circle', 'line', 'textbox', 'text', 'i-text', 'group', 'triangle', 'ellipse', 'polygon', 'polyline'} for obj in item)):
                    raise HTTPException(422, 'Invalid whiteboard drawing objects')
                inspect_value(item, depth + 1)
        elif isinstance(value, list):
            if len(value) > 20_000:
                raise HTTPException(422, 'Whiteboard object is too complex')
            for item in value:
                inspect_value(item, depth + 1)
        elif isinstance(value, float) and not math.isfinite(value):
            raise HTTPException(422, 'Invalid whiteboard coordinates')

    for page in pages:
        surface_ids.clear()
        if not isinstance(page, dict) or not isinstance(page.get('id'), str) or not 1 <= len(page['id']) <= 80 or page['id'] in ids:
            raise HTTPException(422, 'Invalid or duplicate whiteboard page')
        ids.add(page['id'])
        for dimension in ('width', 'height'):
            if dimension in page and (not isinstance(page[dimension], (int, float)) or isinstance(page[dimension], bool) or not 100 <= page[dimension] <= 8000):
                raise HTTPException(422, 'Invalid whiteboard page dimensions')
        scene = page.get('scene')
        if not isinstance(scene, dict) or not isinstance(scene.get('objects'), list):
            raise HTTPException(422, 'Invalid whiteboard page content')
        if len(str(page.get('title', ''))) > 120:
            raise HTTPException(422, 'Page title is too long')
        inspect_value(scene)
    if objects > 2500 or document.get('activePageId') not in ids:
        raise HTTPException(422, 'Invalid whiteboard page selection or too many objects')
    return document
