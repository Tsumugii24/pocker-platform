from openai import OpenAI
from pathlib import Path
import sys

ai_dir = Path(__file__).parent.parent
project_root = ai_dir.parent
if str(ai_dir) not in sys.path:
    sys.path.insert(0, str(ai_dir))

from runtime_config import get_openai_credentials, get_river_exploit_config, load_ai_env

load_ai_env()

api_key, base_url = get_openai_credentials()
river_config = get_river_exploit_config()

client = OpenAI(
    api_key=api_key,
    base_url=base_url
)

model = str(river_config.get("model") or "Qwen/Qwen3.5-27B")
extra_body = river_config.get("extra_body") or {"enable_thinking": True}

print(f"Testing model: {model}")

try:
    # Test 1: Non-streaming with enable_thinking=True
    print("\n--- Test 1: Non-streaming, enable_thinking=True ---")
    try:
        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": "You are a helpful assistant."},
                {"role": "user", "content": "Why is the sky blue?"}
            ],
            extra_body=extra_body
        )
        message = response.choices[0].message
        reasoning_content = getattr(message, "reasoning_content", "") or ""
        final_response = message.content or ""

        print("reasoning_content:")
        print(reasoning_content if reasoning_content else "<empty>")
        print("\nfinal_response:")
        print(final_response if final_response else "<empty>")
    except Exception as e:
        print(f"Caught expected error: {e}")

    # Test 2: Streaming with enable_thinking=True
    print("\n--- Test 2: Streaming, enable_thinking=True ---")
    stream = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": "You are a helpful assistant."},
            {"role": "user", "content": "Why is the sky blue?"}
        ],
        stream=True,
        extra_body=extra_body
    )

    reasoning_parts = []
    response_parts = []

    print("Streaming chunks:")
    for chunk in stream:
        if not chunk.choices:
            continue

        delta = chunk.choices[0].delta
        reasoning_delta = getattr(delta, "reasoning_content", "") or ""
        content_delta = delta.content or ""

        if reasoning_delta:
            reasoning_parts.append(reasoning_delta)
            print(f"{reasoning_delta}", end="", flush=True)

        if content_delta:
            response_parts.append(content_delta)
            print(f"{content_delta}", end="", flush=True)

    reasoning_content = "".join(reasoning_parts)
    final_response = "".join(response_parts)

    print("\n\nstream_reasoning_content:")
    print(reasoning_content if reasoning_content else "<empty>")
    print("\nstream_final_response:")
    print(final_response if final_response else "<empty>")

except Exception as e:
    print(f"Error: {e}")
