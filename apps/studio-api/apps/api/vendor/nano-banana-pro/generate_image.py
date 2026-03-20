#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "requests>=2.31.0",
#     "pillow>=10.0.0",
# ]
# ///
"""
Generate images using Google's Nano Banana Pro (Gemini 3 Pro Image) API.

Usage:
    uv run generate_image.py --prompt "your image description" --filename "output.png" [--resolution 1K|2K|4K] [--api-key KEY] [--api-endpoint URL]
"""

import argparse
import base64
import os
import sys
from pathlib import Path
from io import BytesIO

import requests
from PIL import Image


def get_api_key(provided_key: str | None) -> str | None:
    """Get API key from argument first, then environment."""
    if provided_key:
        return provided_key
    return os.environ.get("GEMINI_API_KEY")


def encode_image(image_path: str) -> str:
    """Encode image to base64."""
    with open(image_path, "rb") as f:
        return base64.b64encode(f.read()).decode("utf-8")


def main():
    parser = argparse.ArgumentParser(
        description="Generate images using Nano Banana Pro (Gemini 3 Pro Image)"
    )
    parser.add_argument(
        "--prompt", "-p",
        required=True,
        help="Image description/prompt"
    )
    parser.add_argument(
        "--filename", "-f",
        required=True,
        help="Output filename (e.g., sunset-mountains.png)"
    )
    parser.add_argument(
        "--input-image", "-i",
        help="Optional input image path for editing/modification"
    )
    parser.add_argument(
        "--resolution", "-r",
        choices=["1K", "2K", "4K"],
        default="1K",
        help="Output resolution: 1K (default), 2K, or 4K"
    )
    parser.add_argument(
        "--api-key", "-k",
        help="Gemini API key (overrides GEMINI_API_KEY env var)"
    )
    parser.add_argument(
        "--api-endpoint", "-e",
        default="https://api.apiyi.com/v1beta",
        help="API base URL (e.g. https://api.apiyi.com/v1beta or https://generativelanguage.googleapis.com/v1beta)"
    )

    args = parser.parse_args()

    # Get API key
    api_key = get_api_key(args.api_key)
    if not api_key:
        print("Error: No API key provided.", file=sys.stderr)
        print("Please either:", file=sys.stderr)
        print("  1. Provide --api-key argument", file=sys.stderr)
        print("  2. Set GEMINI_API_KEY environment variable", file=sys.stderr)
        sys.exit(1)

    # Set up output path
    output_path = Path(args.filename)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    # Gemini REST / 兼容网关：imageSize 须为 "1K" | "2K" | "4K"，不能传 "1024" 等像素值
    image_size = args.resolution

    # Build request payload（REST 使用 camelCase：inlineData / mimeType）
    contents = []

    if args.input_image:
        print(f"Editing image with resolution {args.resolution}...")
        # Encode input image
        image_b64 = encode_image(args.input_image)
        contents.append({
            "inlineData": {
                "mimeType": "image/png",
                "data": image_b64
            }
        })
        contents.append({"text": args.prompt})
    else:
        print(f"Generating image with resolution {args.resolution}...")
        contents.append({"text": args.prompt})

    payload = {
        "contents": [{
            "role": "user",
            "parts": contents
        }],
        "generationConfig": {
            "responseModalities": ["TEXT", "IMAGE"],
            "imageConfig": {
                "imageSize": image_size
            }
        }
    }

    # Build API URL: {base}/models/nano-banana-pro:generateContent
    api_url = f"{args.api_endpoint.rstrip('/')}/models/nano-banana-pro:generateContent"

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}"
    }

    try:
        response = requests.post(api_url, json=payload, headers=headers, timeout=120)
        response.raise_for_status()

        result = response.json()

        # Process response
        image_saved = False
        if "candidates" in result:
            for candidate in result["candidates"]:
                if "content" in candidate and "parts" in candidate["content"]:
                    for part in candidate["content"]["parts"]:
                        if "text" in part:
                            print(f"Model response: {part['text']}")
                        elif "inlineData" in part:
                            image_data = part["inlineData"]["data"]
                            # Decode base64 to bytes
                            image_bytes = base64.b64decode(image_data)
                            image = Image.open(BytesIO(image_bytes))

                            # Ensure RGB mode for PNG
                            if image.mode == 'RGBA':
                                rgb_image = Image.new('RGB', image.size, (255, 255, 255))
                                rgb_image.paste(image, mask=image.split()[3])
                                rgb_image.save(str(output_path), 'PNG')
                            elif image.mode == 'RGB':
                                image.save(str(output_path), 'PNG')
                            else:
                                image.convert('RGB').save(str(output_path), 'PNG')
                            image_saved = True

        if image_saved:
            full_path = output_path.resolve()
            print(f"\nImage saved: {full_path}")
        else:
            print(f"Error: No image was generated. Response: {result}", file=sys.stderr)
            sys.exit(1)

    except requests.exceptions.HTTPError as e:
        print(f"HTTP Error: {e}", file=sys.stderr)
        if e.response.text:
            print(f"Response: {e.response.text}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"Error generating image: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
