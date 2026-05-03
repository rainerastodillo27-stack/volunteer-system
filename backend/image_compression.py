"""Image compression utility for base64-encoded images."""
import base64
from io import BytesIO
from PIL import Image

def compress_base64_image(base64_str: str, max_size_bytes: int = 200_000, max_width: int = 1280) -> str | None:
    """
    Compress a base64-encoded image to reduce its size.
    
    Args:
        base64_str: Base64-encoded image data
        max_size_bytes: Target maximum size in bytes (default ~200KB)
        max_width: Maximum width in pixels
    
    Returns:
        Compressed base64 string, or None if compression fails
    """
    if not base64_str or not isinstance(base64_str, str):
        return None
    
    try:
        # Decode base64
        image_data = base64.b64decode(base64_str)
        img = Image.open(BytesIO(image_data))
        
        # Convert RGBA to RGB (remove alpha channel if present)
        if img.mode == 'RGBA':
            rgb_img = Image.new('RGB', img.size, (255, 255, 255))
            rgb_img.paste(img, mask=img.split()[3])
            img = rgb_img
        
        # Resize if too large
        if img.width > max_width:
            aspect_ratio = img.height / img.width
            new_height = int(max_width * aspect_ratio)
            img = img.resize((max_width, new_height), Image.Resampling.LANCZOS)
        
        # Compress iteratively
        quality = 90
        while quality > 30:
            buffer = BytesIO()
            img.save(buffer, format='JPEG', quality=quality, optimize=True)
            compressed_data = buffer.getvalue()
            
            # If size is acceptable, return
            if len(compressed_data) <= max_size_bytes:
                return base64.b64encode(compressed_data).decode('utf-8')
            
            # Otherwise, reduce quality and try again
            quality -= 10
        
        # Last resort: return lowest quality version
        buffer = BytesIO()
        img.save(buffer, format='JPEG', quality=30, optimize=True)
        return base64.b64encode(buffer.getvalue()).decode('utf-8')
    
    except Exception as e:
        print(f"[ERROR] Image compression failed: {e}")
        return None

def get_image_size_kb(base64_str: str | None) -> float:
    """Get the size of a base64 image in KB."""
    if not base64_str or not isinstance(base64_str, str):
        return 0.0
    return len(base64_str) / 1024
