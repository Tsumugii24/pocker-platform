from openai import OpenAI
from pathlib import Path
import sys

ai_dir = Path(__file__).parent.parent
if str(ai_dir) not in sys.path:
    sys.path.insert(0, str(ai_dir))

from runtime_config import get_openai_credentials, get_river_exploit_config, load_ai_env

load_ai_env()
api_key, base_url = get_openai_credentials()
river_config = get_river_exploit_config()

# docs
# https://modelscope.cn/models/Qwen/Qwen3.5-397B-A17B#instruct-or-non-thinking-mode

# 模型调用测试
client = OpenAI(
    api_key=api_key,
    base_url=base_url
)

messages=[
    {
        'role': 'system',
        'content': 'You are a helpful assistant.'
    },
    {
        'role': 'user',
        'content': 'hello'
    }
]

# thinking mode
response = client.chat.completions.create(
    model=str(river_config.get("model") or "Qwen/Qwen3.5-27B"),
    messages=messages
)

# # instruct mode
# response = client.chat.completions.create(
#     model="Qwen/Qwen3.5-397B-A17B",
#     messages=messages,
#     max_tokens=32768,
#     temperature=0.7,
#     top_p=0.8,
#     presence_penalty=1.5,
#     extra_body={
#         "top_k": 20,
#         "chat_template_kwargs": {"enable_thinking": False},
#     }, 
# )


if __name__ == "__main__":
    # print(response)
    print("content:")
    print(response.choices[0].message.content if response.choices[0].message.content else "<empty>")
    print("reasoning_content:")
    print(response.choices[0].message.reasoning_content if response.choices[0].message.reasoning_content else "<empty>")
